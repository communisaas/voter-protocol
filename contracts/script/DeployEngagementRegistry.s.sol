// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/EngagementRootRegistry.sol";
import "../src/DistrictGate.sol";

/// @title DeployEngagementRegistry
/// @notice Deployment script for Tree 3 (Engagement) registry contract
/// @dev Run with: forge script script/DeployEngagementRegistry.s.sol --rpc-url <RPC_URL> --broadcast
///
/// PREREQUISITES:
/// - DistrictGate must already be deployed
/// - Caller must be the governance address for DistrictGate
///
/// ENVIRONMENT VARIABLES:
/// - DISTRICT_GATE: Address of existing DistrictGate contract
/// - GOVERNANCE: Governance address (must match DistrictGate governance)
/// - USE_GENESIS: Set to "true" if DistrictGate genesis is NOT yet sealed
///
/// DEPLOYMENT MODES:
/// A) Genesis (USE_GENESIS=true): Direct registration, no timelock. Use when deploying
///    alongside initial DistrictGate setup before sealGenesis().
/// B) Post-genesis (USE_GENESIS=false): Proposes via 7-day timelock. Use when adding
///    engagement support to an already-live DistrictGate.
contract DeployEngagementRegistry is Script {
    function run() external {
        address districtGateAddr = vm.envAddress("DISTRICT_GATE");
        address governance = vm.envAddress("GOVERNANCE");
        bool useGenesis = vm.envOr("USE_GENESIS", false);

        require(districtGateAddr != address(0), "DISTRICT_GATE must be set");
        require(governance != address(0), "GOVERNANCE must be set");

        DistrictGate gate = DistrictGate(districtGateAddr);

        console.log("=== Engagement Registry Deployment ===");
        console.log("DistrictGate:", districtGateAddr);
        console.log("Governance:", governance);
        console.log("Genesis mode:", useGenesis);

        vm.startBroadcast();

        // 1. Deploy EngagementRootRegistry (Tree 3 - engagement data roots)
        EngagementRootRegistry engagementRegistry = new EngagementRootRegistry(governance);
        console.log("EngagementRootRegistry deployed at:", address(engagementRegistry));

        // 2. Configure on DistrictGate
        if (useGenesis) {
            gate.setEngagementRegistryGenesis(address(engagementRegistry));
            console.log("Engagement registry set via genesis (immediate)");
        } else {
            gate.proposeEngagementRegistry(address(engagementRegistry));
            console.log("Engagement registry proposed on DistrictGate (7-day timelock started)");
        }

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("EngagementRootRegistry:", address(engagementRegistry));
        console.log("DistrictGate:", districtGateAddr);

        if (useGenesis) {
            console.log("\nPOST-DEPLOYMENT STEPS:");
            console.log("  1. Register engagement roots: engagementRegistry.registerEngagementRoot(root, depth)");
            console.log("  2. Call gate.sealGenesis() when all genesis config is complete");
        } else {
            console.log("\nPOST-DEPLOYMENT STEPS:");
            console.log("  1. Wait 7 days for timelock to expire");
            console.log("  2. Call gate.executeEngagementRegistry()");
            console.log("  3. Register engagement roots: engagementRegistry.registerEngagementRoot(root, depth)");
        }
    }
}
