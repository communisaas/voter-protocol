// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/CampaignRegistry.sol";

/// @title Deploy to Scroll Sepolia Testnet (Phase 1)
/// @notice Complete deployment script for VOTER Protocol on Scroll Sepolia
/// @dev Deploys DistrictRegistry, NullifierRegistry, DistrictGate, and CampaignRegistry
///
/// PHASE 1 DEPLOYMENT (Solo Founder):
/// - TimelockGovernance: 7-day governance timelock, 14-day verifier timelock
/// - No GuardianShield: Nation-state resistance requires real multi-jurisdiction guardians
/// - Honest threat model: Founder key compromise = governance compromise
contract DeployToScrollSepolia is Script {
    function run() external {
        // Get deployer and governance from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Deploying to Scroll Sepolia (Phase 1)");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("Governance:", governance);
        console.log("Verifier:", verifier);
        console.log("");
        console.log("SECURITY NOTE: Phase 1 has no GuardianShield.");
        console.log("Timelocks provide community exit window only.");
        console.log("");

        // Validate addresses
        require(governance != address(0), "Governance address not set");
        require(verifier != address(0), "Verifier address not set");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DistrictRegistry
        console.log("Deploying DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(governance);
        console.log("DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        console.log("Deploying NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(governance);
        console.log("NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy DistrictGate (Phase 1: no guardians)
        console.log("Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            verifier,
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );
        console.log("DistrictGate deployed at:", address(gate));

        // 4. Deploy CampaignRegistry (Phase 1.5)
        console.log("Deploying CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(governance);
        console.log("CampaignRegistry deployed at:", address(campaignRegistry));

        // 5. Authorize DistrictGate as caller on NullifierRegistry
        nullifierRegistry.authorizeCaller(address(gate));
        console.log("DistrictGate authorized as NullifierRegistry caller");

        // 6. Authorize DistrictGate as caller on CampaignRegistry
        campaignRegistry.authorizeCaller(address(gate));
        console.log("DistrictGate authorized as CampaignRegistry caller");

        // 7. Set CampaignRegistry on DistrictGate
        gate.setCampaignRegistry(address(campaignRegistry));
        console.log("CampaignRegistry set on DistrictGate");

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE (Phase 1)");
        console.log("==========================================");
        console.log("DistrictRegistry:", address(districtRegistry));
        console.log("NullifierRegistry:", address(nullifierRegistry));
        console.log("DistrictGate:", address(gate));
        console.log("CampaignRegistry:", address(campaignRegistry));
        console.log("Governance:", governance);
        console.log("==========================================");
    }
}
