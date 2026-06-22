// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CipherGavel is ZamaEthereumConfig  {
    enum Phase { Bidding, Closed, Revealed }

    struct Bid {
        address bidder;
        euint64 amount; // encrypted bid
    }

    address public immutable seller;
    uint256 public immutable depositWei;      // uniform, refundable anti-grief bond
    uint256 public immutable biddingDeadline;
    uint8   public immutable maxBidders;       // cap of bidders

    Phase public phase;

    Bid[] private _bids;
    mapping(address => bool) public hasBid;
    mapping(address => uint256) public depositOf;

    euint64 private _reserve;   // sellers secret reserved price
    bool public reserveSet;

    event BidPlaced(address indexed bidder, uint256 indexed index);
    event ReserveSet(address indexed seller);

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
        FHE.allowThis(amount);          // the CONTRACT may compute on it later
        FHE.allow(amount, msg.sender);  // the BIDDER may decrypt their own bid — nobody else

        _bids.push(Bid({ bidder: msg.sender, amount: amount }));
        hasBid[msg.sender] = true;
        depositOf[msg.sender] = msg.value;

        emit BidPlaced(msg.sender, _bids.length - 1);
    }

    function bidCount() external view returns (uint256) { return _bids.length; }
    function bidderAt(uint256 i) external view returns (address) { return _bids[i].bidder; }
    function bidAmountAt(uint256 i) external view returns (euint64) { return _bids[i].amount; }
}