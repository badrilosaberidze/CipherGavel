// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint64, euint32, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract CipherGavel is ZamaEthereumConfig {
    enum Phase {
        Bidding,
        Closed,
        Revealed
    }

    struct Bid {
        address bidder;
        euint64 amount; // encrypted bid
    }

    address public immutable seller;
    uint256 public immutable depositWei; // uniform, refundable anti-grief bond
    uint256 public immutable biddingDeadline;
    uint8 public immutable maxBidders; // cap of bidders

    Phase public phase;

    Bid[] private _bids;
    mapping(address => bool) public hasBid;
    mapping(address => uint256) public depositOf;

    euint64 private _reserve; // sellers secret reserved price
    bool public reserveSet;

    // Encrypted results, produced by closeAuction()
    euint32 private _winnerIndexEnc;
    euint64 private _clearingPriceEnc;
    euint32 private _reserveMetEnc; // 1 if highest bid >= reserve, else 0

    // Cleartext results, published after off-chain decryption
    bool    public resultPublished;
    uint32  public winnerIndex;
    address public winner;
    uint64  public clearingPrice;
    bool    public reserveMet;

    event BidPlaced(address indexed bidder, uint256 indexed index);
    event ReserveSet(address indexed seller);
    event AuctionClosed(uint256 bidCount);
    event ResultPublished(address indexed winner, uint64 clearingPrice, bool reserveMet);
    event DepositWithdrawn(address indexed bidder, uint256 amount);

    modifier onlySeller() {
        require(msg.sender == seller, "Only seller");
        _;
    }

    constructor(uint256 _depositWei, uint256 _biddingPeriodSeconds, uint8 _maxBidders) {
        require(_maxBidders >= 1 && _maxBidders <= 10, "maxBidders 1..10");
        seller = msg.sender;
        depositWei = _depositWei;
        biddingDeadline = block.timestamp + _biddingPeriodSeconds;
        maxBidders = _maxBidders;
        phase = Phase.Bidding;

        _reserve = FHE.asEuint64(0);
        FHE.allowThis(_reserve);
    }

    /// Seller commits a SECRET reserve price.
    function setReserve(externalEuint64 encReserve, bytes calldata inputProof) external onlySeller {
        require(phase == Phase.Bidding, "Not bidding");
        require(block.timestamp < biddingDeadline, "Bidding ended");
        euint64 r = FHE.fromExternal(encReserve, inputProof); // verify proof + import ciphertext
        _reserve = r;
        FHE.allowThis(_reserve);
        reserveSet = true;
        emit ReserveSet(msg.sender);
    }

    /// Bidder submits an ENCRYPTED bid and locks the uniform deposit.
    function placeBid(externalEuint64 encBid, bytes calldata inputProof) external payable {
        require(phase == Phase.Bidding, "Not bidding");
        require(block.timestamp < biddingDeadline, "Bidding ended");
        require(msg.value == depositWei, "Wrong deposit");
        require(!hasBid[msg.sender], "Already bid");
        require(_bids.length < maxBidders, "Auction full");

        euint64 amount = FHE.fromExternal(encBid, inputProof); // verify + import
        FHE.allowThis(amount); // the CONTRACT may compute on it later
        FHE.allow(amount, msg.sender); // the BIDDER may decrypt their own bid — nobody else

        _bids.push(Bid({bidder: msg.sender, amount: amount}));
        hasBid[msg.sender] = true;
        depositOf[msg.sender] = msg.value;

        emit BidPlaced(msg.sender, _bids.length - 1);
    }

    /// Anyone can close after the deadline; the seller may also close early.
    /// Computes the winner, the second-highest price, and the reserve check —
    /// entirely on the ENCRYPTED bids.
    function closeAuction() external {
        require(phase == Phase.Bidding, "Not bidding");
        require(block.timestamp >= biddingDeadline || msg.sender == seller, "Too early");
        require(_bids.length > 0, "No bids");

        euint64 highest = FHE.asEuint64(0);
        euint64 second = FHE.asEuint64(0);
        euint32 winIdx = FHE.asEuint32(0);

        for (uint256 i = 0; i < _bids.length; i++) {
            euint64 b = _bids[i].amount;

            ebool isHigher = FHE.gt(b, highest);

            euint64 contender = FHE.max(second, b);
            second = FHE.select(isHigher, highest, contender);
            highest = FHE.select(isHigher, b, highest);
            winIdx = FHE.select(isHigher, FHE.asEuint32(uint32(i)), winIdx);
        }

        ebool met = FHE.ge(highest, _reserve);

        euint64 priceIfMet = FHE.max(second, _reserve);
        euint64 price = FHE.select(met, priceIfMet, FHE.asEuint64(0));
        euint32 metFlag = FHE.select(met, FHE.asEuint32(1), FHE.asEuint32(0));

        _winnerIndexEnc = winIdx;
        _clearingPriceEnc = price;
        _reserveMetEnc = metFlag;

        FHE.allowThis(_winnerIndexEnc);
        FHE.allowThis(_clearingPriceEnc);
        FHE.allowThis(_reserveMetEnc);
        FHE.allow(_winnerIndexEnc, seller);
        FHE.allow(_clearingPriceEnc, seller);
        FHE.allow(_reserveMetEnc, seller);
        FHE.makePubliclyDecryptable(_winnerIndexEnc);
        FHE.makePubliclyDecryptable(_clearingPriceEnc);
        FHE.makePubliclyDecryptable(_reserveMetEnc);

        phase = Phase.Closed;
        emit AuctionClosed(_bids.length);
    }

    // Seller publishes the decrypted outcome.
    /// The values are publicly verifiable (anyone can re-decrypt the result handles)
    /// so a dishonest seller would be caught immediately.
    function publishResult(uint32 _winnerIndex, uint64 _clearingPrice, bool _reserveMet) external onlySeller {
        require(phase == Phase.Closed, "Not closed");
        require(_winnerIndex < _bids.length, "Bad index");

        winnerIndex   = _winnerIndex;
        clearingPrice = _clearingPrice;
        reserveMet    = _reserveMet;
        winner        = _reserveMet ? _bids[_winnerIndex].bidder : address(0);
        resultPublished = true;
        phase = Phase.Revealed;

        emit ResultPublished(winner, _clearingPrice, _reserveMet);
    }

    /// Each bidder reclaims their uniform deposit after the result is revealed.
    function withdrawDeposit() external {
        require(phase == Phase.Revealed, "Not revealed");
        uint256 amt = depositOf[msg.sender];
        require(amt > 0, "Nothing to withdraw");

        depositOf[msg.sender] = 0;                 
        (bool ok, ) = msg.sender.call{ value: amt }("");
        require(ok, "Transfer failed");

        emit DepositWithdrawn(msg.sender, amt);
    }

    function getWinnerIndexEnc() external view returns (euint32) {
        return _winnerIndexEnc;
    }
    function getClearingPriceEnc() external view returns (euint64) {
        return _clearingPriceEnc;
    }
    function getReserveMetEnc() external view returns (euint32) {
        return _reserveMetEnc;
    }

    function bidCount() external view returns (uint256) {
        return _bids.length;
    }
    function bidderAt(uint256 i) external view returns (address) {
        return _bids[i].bidder;
    }
    function bidAmountAt(uint256 i) external view returns (euint64) {
        return _bids[i].amount;
    }
}
