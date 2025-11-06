// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/DistrictGate.sol";

/// @title Deploy to Scroll Sepolia Testnet
/// @notice Complete deployment script for VOTER Protocol on Scroll Sepolia
/// @dev Deploys DistrictRegistry and DistrictGate (Halo2Verifier deployed separately)
contract DeployToScrollSepolia is Script {
    function run() external {
        // Get deployer and governance from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Deploying to Scroll Sepolia Testnet");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("Governance:", governance);
        console.log("Verifier:", verifier);
        console.log("");

        // Validate addresses
        require(governance != address(0), "Governance address not set");
        require(verifier != address(0), "Verifier address not set");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DistrictRegistry
        console.log("Deploying DistrictRegistry...");
        DistrictRegistry registry = new DistrictRegistry(governance);
        console.log("DistrictRegistry deployed at:", address(registry));
        console.log("");

        // 2. Deploy DistrictGate
        console.log("Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            verifier,
            address(registry),
            governance
        );
        console.log("DistrictGate deployed at:", address(gate));
        console.log("");

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==========================================");
        console.log("DistrictRegistry:", address(registry));
        console.log("DistrictGate:", address(gate));
        console.log("Halo2Verifier:", verifier);
        console.log("Governance:", governance);
        console.log("==========================================");
        console.log("");
        console.log("Next steps:");
        console.log("1. Verify contracts on Scrollscan:");
        console.log("   forge verify-contract", address(registry), "DistrictRegistry --chain scroll-sepolia");
        console.log("   forge verify-contract", address(gate), "DistrictGate --chain scroll-sepolia");
        console.log("2. Register test district:");
        console.log("   cast send", address(registry), '"registerDistrict(bytes32,bytes3)" 0x013d1a976ba17a1dd1af3014083bf82caac6a5b0d9b1b1c1a5dbbe7183e7b0a9 0x555341');
        console.log("3. Authorize test action:");
        console.log("   cast send", address(gate), '"authorizeAction(bytes32)" 0x019c4a794edb218627607ae2bc92939aecb000cbf93cfdfd788787577ffff488');
        console.log("4. Run proof verification test");
        console.log("==========================================");
    }
}
