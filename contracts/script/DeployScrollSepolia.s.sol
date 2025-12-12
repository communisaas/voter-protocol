// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/NullifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/CampaignRegistry.sol";

/// @title DeployScrollSepolia
/// @notice Deployment script for Scroll Sepolia testnet (Phase 1)
/// @dev Run with: forge script script/DeployScrollSepolia.s.sol --rpc-url scroll_sepolia --broadcast
///
/// PHASE 1 DEPLOYMENT (Solo Founder):
/// - TimelockGovernance: 7-day governance timelock, 14-day verifier timelock
/// - No GuardianShield: Nation-state resistance requires real multi-jurisdiction guardians
/// - Honest threat model: Founder key compromise = governance compromise
contract DeployScrollSepolia is Script {
    function run() external {
        // Configuration
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        // If no verifier deployed yet, use a placeholder
        if (verifier == address(0)) {
            console.log("WARNING: Using placeholder verifier address");
            verifier = address(0xdead);
        }

        vm.startBroadcast();

        // 1. Deploy DistrictRegistry
        DistrictRegistry districtRegistry = new DistrictRegistry(governance);
        console.log("DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        NullifierRegistry nullifierRegistry = new NullifierRegistry(governance);
        console.log("NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy DistrictGate (Phase 1: no guardians)
        DistrictGate gate = new DistrictGate(
            verifier,
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );
        console.log("DistrictGate deployed at:", address(gate));

        // 4. Deploy CampaignRegistry (Phase 1.5)
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

        // Output deployment summary
        console.log("\n=== Deployment Summary (Phase 1) ===");
        console.log("Network: Scroll Sepolia");
        console.log("DistrictRegistry:", address(districtRegistry));
        console.log("NullifierRegistry:", address(nullifierRegistry));
        console.log("DistrictGate:", address(gate));
        console.log("CampaignRegistry:", address(campaignRegistry));
        console.log("Governance:", governance);
        console.log("\nSECURITY NOTE: Phase 1 has no GuardianShield.");
        console.log("Founder key compromise = governance compromise.");
        console.log("Timelocks provide community exit window only.");
    }
}
