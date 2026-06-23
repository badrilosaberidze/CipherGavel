import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// Launches CipherGavel. Tweak the three constructor args for your demo.
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const depositWei = hre.ethers.parseEther("0.001"); // uniform refundable bond
  const biddingPeriodSeconds = 300;                  // 5 min (seller can also close early)
  const maxBidders = 3;                              // keep small for the live demo

  const deployed = await deploy("CipherGavel", {
    from: deployer,
    args: [depositWei, biddingPeriodSeconds, maxBidders],
    log: true,
  });

  console.log(`CipherGavel deployed at: ${deployed.address}`);
};

export default func;
func.id = "deploy_ciphergavel";
func.tags = ["CipherGavel"];