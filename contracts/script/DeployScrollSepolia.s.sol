// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/NullifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";

/// @title DeployScrollSepolia
/// @notice Deployment script for Scroll Sepolia testnet
/// @dev Run with: forge script script/DeployScrollSepolia.s.sol --rpc-url scroll_sepolia --broadcast
contract DeployScrollSepolia is Script {
    function run() external {
        // Configuration
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        
        // Guardian addresses (must be at least 2, different jurisdictions)
        // TODO: Replace with real guardian addresses before mainnet
        address guardian1 = vm.envOr("GUARDIAN_1", address(0x100));
        address guardian2 = vm.envOr("GUARDIAN_2", address(0x101));
        
        address[] memory guardians = new address[](2);
        guardians[0] = guardian1;
        guardians[1] = guardian2;
        
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

        // 3. Deploy DistrictGate with guardians
        DistrictGate gate = new DistrictGate(
            verifier,
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            guardians
        );
        console.log("DistrictGate deployed at:", address(gate));

        // 4. Authorize DistrictGate as caller on NullifierRegistry
        nullifierRegistry.authorizeCaller(address(gate));
        console.log("DistrictGate authorized as NullifierRegistry caller");

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("Network: Scroll Sepolia");
        console.log("DistrictRegistry:", address(districtRegistry));
        console.log("NullifierRegistry:", address(nullifierRegistry));
        console.log("DistrictGate:", address(gate));
        console.log("Governance:", governance);
        console.log("Guardian 1:", guardian1);
        console.log("Guardian 2:", guardian2);
    }
}
