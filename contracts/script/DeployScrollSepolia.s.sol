// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
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
///
/// VERIFIER DEPTHS:
/// - VERIFIER_DEPTH_18: For depth-18 circuits (262K addresses)
/// - VERIFIER_DEPTH_20: For depth-20 circuits (1M addresses) - most common
/// - VERIFIER_DEPTH_22: For depth-22 circuits (4M addresses)
/// - VERIFIER_DEPTH_24: For depth-24 circuits (16M addresses)
contract DeployScrollSepolia is Script {
    // Default verifier depth (can be overridden via environment)
    uint8 constant DEFAULT_VERIFIER_DEPTH = 20;

    function run() external {
        // Configuration
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        // Optional: specify verifier depth (defaults to 20)
        uint8 verifierDepth = DEFAULT_VERIFIER_DEPTH;
        try vm.envUint("VERIFIER_DEPTH") returns (uint256 depth) {
            verifierDepth = uint8(depth);
        } catch {}

        // If no verifier deployed yet, use a placeholder
        if (verifier == address(0)) {
            console.log("WARNING: Using placeholder verifier address");
            verifier = address(0xdead);
        }

        require(verifierDepth >= 18 && verifierDepth <= 24 && verifierDepth % 2 == 0, "Invalid verifier depth");

        vm.startBroadcast();

        // 1. Deploy DistrictRegistry
        DistrictRegistry districtRegistry = new DistrictRegistry(governance);
        console.log("DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        NullifierRegistry nullifierRegistry = new NullifierRegistry(governance);
        console.log("NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy VerifierRegistry
        VerifierRegistry verifierRegistry = new VerifierRegistry(governance);
        console.log("VerifierRegistry deployed at:", address(verifierRegistry));

        // 4. Propose verifier in VerifierRegistry (requires 7-day timelock)
        console.log("Proposing verifier for depth", verifierDepth, "...");
        verifierRegistry.proposeVerifier(verifierDepth, verifier);
        console.log("Verifier proposed for depth", verifierDepth, "(execute after 7 days)");

        // 5. Deploy DistrictGate with VerifierRegistry
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );
        console.log("DistrictGate deployed at:", address(gate));

        // 6. Deploy CampaignRegistry
        CampaignRegistry campaignRegistry = new CampaignRegistry(governance);
        console.log("CampaignRegistry deployed at:", address(campaignRegistry));

        // 7. Propose DistrictGate as caller on NullifierRegistry (requires 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        console.log("DistrictGate caller authorization proposed on NullifierRegistry (execute after 7 days)");

        // 8. Authorize DistrictGate as caller on CampaignRegistry
        campaignRegistry.authorizeCaller(address(gate));
        console.log("DistrictGate authorized as CampaignRegistry caller");

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary (Phase 1) ===");
        console.log("Network: Scroll Sepolia");
        console.log("DistrictRegistry:", address(districtRegistry));
        console.log("NullifierRegistry:", address(nullifierRegistry));
        console.log("VerifierRegistry:", address(verifierRegistry));
        console.log("DistrictGate:", address(gate));
        console.log("CampaignRegistry:", address(campaignRegistry));
        console.log("Governance:", governance);
        console.log("\nSECURITY NOTE: Phase 1 has no GuardianShield.");
        console.log("Founder key compromise = governance compromise.");
        console.log("Timelocks provide community exit window only.");
        console.log("\nPOST-DEPLOYMENT (all require 7-day timelock):");
        console.log("  1. Wait 7 days after deployment");
        console.log("  2. Call verifierRegistry.executeVerifier(depth)");
        console.log("  3. Call nullifierRegistry.executeCallerAuthorization(gate)");
        console.log("  4. Call gate.proposeCampaignRegistry(campaignRegistry)");
        console.log("  5. Wait 7 days");
        console.log("  6. Call gate.executeCampaignRegistry()");
    }
}
