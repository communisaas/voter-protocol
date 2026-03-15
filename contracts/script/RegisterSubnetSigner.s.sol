// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/AIEvaluationRegistry.sol";

/// @title RegisterSubnetSigner
/// @notice Register the Bittensor subnet bridge operator as an AI model signer
/// @dev Two-phase registration on AIEvaluationRegistry with vm.warp() for local testnet.
///
/// PROVIDER SLOT ASSIGNMENT:
///   0 = OpenAI, 1 = Google, 2 = DeepSeek, 3 = Mistral, 4 = Anthropic
///   5 = Bittensor Subnet (this script)
///
/// PREREQUISITES:
///   - AIEvaluationRegistry deployed (real, not mock)
///   - Caller must be governance on the registry
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY           - Governance private key (deployer on local testnet)
///   AI_REGISTRY           - AIEvaluationRegistry contract address
///   SUBNET_SIGNER_KEY     - (Optional) Private key for the subnet signer.
///                            If not set, derives a deterministic key for demo.
///
/// USAGE (local Anvil):
///   forge script script/RegisterSubnetSigner.s.sol:RegisterSubnetSigner \
///     --rpc-url http://127.0.0.1:8545 --private-key $PRIVATE_KEY --broadcast
contract RegisterSubnetSigner is Script {
    /// @notice Provider slot reserved for Bittensor Subnet
    uint8 constant BITTENSOR_SLOT = 5;

    /// @notice Deterministic demo key: keccak256("bittensor-subnet-signer-demo")
    /// @dev Only used when SUBNET_SIGNER_KEY is not set. Never use on mainnet.
    uint256 constant DEMO_SIGNER_KEY = uint256(keccak256("bittensor-subnet-signer-demo"));

    function run() external {
        uint256 governanceKey = vm.envUint("PRIVATE_KEY");
        address registryAddr = vm.envAddress("AI_REGISTRY");

        // Resolve subnet signer key
        uint256 signerKey = _getSignerKey();
        address signer = vm.addr(signerKey);

        AIEvaluationRegistry registry = AIEvaluationRegistry(registryAddr);

        console.log("============================================================");
        console.log("  REGISTER BITTENSOR SUBNET SIGNER");
        console.log("============================================================");
        console.log("");
        console.log("AIEvaluationRegistry:", registryAddr);
        console.log("Subnet signer:       ", signer);
        console.log("Provider slot:        5 (Bittensor)");
        console.log("");

        // Check if already registered
        (, bool alreadyActive) = registry.models(signer);
        if (alreadyActive) {
            console.log("Signer is ALREADY registered. Nothing to do.");
            return;
        }

        // Check if a pending registration exists
        (, uint256 pendingTime) = registry.pendingRegistrations(signer);
        if (pendingTime != 0) {
            console.log("Pending registration exists, skipping initiation...");
        } else {
            // Phase 1: Initiate registration (requires governance)
            console.log("[1/2] Initiating model registration...");
            vm.startBroadcast(governanceKey);
            registry.initiateModelRegistration(signer, BITTENSOR_SLOT);
            vm.stopBroadcast();
            console.log("       Registration initiated.");
        }

        // Phase 2: Warp past timelock and execute (local testnet only)
        uint256 modelTimelock = registry.MODEL_TIMELOCK();
        console.log("MODEL_TIMELOCK:      ", modelTimelock, "seconds");

        if (modelTimelock > 0) {
            console.log("       Warping past timelock (local testnet)...");
            vm.warp(block.timestamp + modelTimelock + 1);
        }

        console.log("[2/2] Executing model registration...");
        vm.startBroadcast(governanceKey);
        registry.executeModelRegistration(signer);
        vm.stopBroadcast();

        // Verify
        (, bool isActive) = registry.models(signer);
        require(isActive, "Post-registration check failed: signer not active");

        console.log("");
        console.log("============================================================");
        console.log("  REGISTRATION COMPLETE");
        console.log("============================================================");
        console.log("");
        console.log("Signer address: ", signer);
        console.log("Provider slot:   5 (Bittensor Subnet)");
        console.log("Model count:    ", registry.modelCount());
        console.log("Provider count: ", registry.providerCount());
        console.log("Quorum (M):     ", registry.quorum());
        console.log("");
        console.log("Export for subnet bridge:");
        console.log("  SUBNET_SIGNER_ADDRESS=", signer);
        console.log("  SUBNET_SIGNER_KEY=<see script output or env>");
        console.log("============================================================");
    }

    function _getSignerKey() internal view returns (uint256) {
        try vm.envUint("SUBNET_SIGNER_KEY") returns (uint256 key) {
            console.log("Using SUBNET_SIGNER_KEY from environment");
            return key;
        } catch {
            console.log("No SUBNET_SIGNER_KEY set - using deterministic demo key");
            console.log("WARNING: Demo key only! Do not use on mainnet.");
            return DEMO_SIGNER_KEY;
        }
    }
}
