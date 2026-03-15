// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";
import "../src/DistrictGate.sol";

/// @title DeployTwoTree
/// @notice Deployment script for two-tree registry contracts (UserRootRegistry + CellMapRegistry)
/// @dev Run with: forge script script/DeployTwoTree.s.sol --rpc-url <RPC_URL> --broadcast
///
/// PREREQUISITES:
/// - DistrictGate must already be deployed
/// - Caller must be the governance address for DistrictGate
///
/// ENVIRONMENT VARIABLES:
/// - DISTRICT_GATE: Address of existing DistrictGate contract
/// - GOVERNANCE: Governance address (must match DistrictGate governance)
///
/// POST-DEPLOYMENT:
/// After running this script, you must wait 7 days and then call:
///   gate.executeTwoTreeRegistries()
/// to finalize the two-tree registry configuration.
contract DeployTwoTree is Script {
    function run() external {
        // Read configuration from environment
        address districtGateAddr = vm.envAddress("DISTRICT_GATE");
        address governance = vm.envAddress("GOVERNANCE");

        require(districtGateAddr != address(0), "DISTRICT_GATE must be set");
        require(governance != address(0), "GOVERNANCE must be set");

        DistrictGate gate = DistrictGate(districtGateAddr);

        console.log("=== Two-Tree Registry Deployment ===");
        console.log("DistrictGate:", districtGateAddr);
        console.log("Governance:", governance);

        vm.startBroadcast();

        // 1. Deploy UserRootRegistry (Tree 1 - user identity roots)
        UserRootRegistry userRootRegistry = new UserRootRegistry(governance, 10 minutes);
        console.log("UserRootRegistry deployed at:", address(userRootRegistry));

        // 2. Deploy CellMapRegistry (Tree 2 - cell-district mapping roots)
        CellMapRegistry cellMapRegistry = new CellMapRegistry(governance, 10 minutes);
        console.log("CellMapRegistry deployed at:", address(cellMapRegistry));

        // 3. Propose two-tree registries on existing DistrictGate (starts 7-day timelock)
        gate.proposeTwoTreeRegistries(address(userRootRegistry), address(cellMapRegistry));
        console.log("Two-tree registries proposed on DistrictGate (7-day timelock started)");

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("UserRootRegistry:", address(userRootRegistry));
        console.log("CellMapRegistry:", address(cellMapRegistry));
        console.log("DistrictGate:", districtGateAddr);
        console.log("Governance:", governance);
        console.log("\nPOST-DEPLOYMENT STEPS:");
        console.log("  1. Wait 7 days for timelock to expire");
        console.log("  2. Call gate.executeTwoTreeRegistries()");
        console.log("  3. Register user roots: userRootRegistry.registerUserRoot(root, country, depth)");
        console.log("  4. Register cell map roots: cellMapRegistry.registerCellMapRoot(root, country, depth)");
    }
}
