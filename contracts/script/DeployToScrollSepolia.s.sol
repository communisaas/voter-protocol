// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
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
///
/// VERIFIER DEPTHS:
/// - VERIFIER_DEPTH_18: For depth-18 circuits (262K addresses)
/// - VERIFIER_DEPTH_20: For depth-20 circuits (1M addresses) - most common
/// - VERIFIER_DEPTH_22: For depth-22 circuits (4M addresses)
/// - VERIFIER_DEPTH_24: For depth-24 circuits (16M addresses)
contract DeployToScrollSepolia is Script {
    // Default verifier depth (can be overridden via environment)
    uint8 constant DEFAULT_VERIFIER_DEPTH = 20;

    function run() external {
        // Get deployer and governance from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        // Optional: specify verifier depth (defaults to 20)
        uint8 verifierDepth = DEFAULT_VERIFIER_DEPTH;
        try vm.envUint("VERIFIER_DEPTH") returns (uint256 depth) {
            verifierDepth = uint8(depth);
        } catch {}

        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("Deploying to Scroll Sepolia (Phase 1)");
        console.log("==========================================");
        console.log("Deployer:", deployer);
        console.log("Governance:", governance);
        console.log("Verifier:", verifier);
        console.log("Verifier Depth:", verifierDepth);
        console.log("");
        console.log("SECURITY NOTE: Phase 1 has no GuardianShield.");
        console.log("Timelocks provide community exit window only.");
        console.log("");

        // Validate addresses
        require(governance != address(0), "Governance address not set");
        require(verifier != address(0), "Verifier address not set");
        require(verifierDepth >= 18 && verifierDepth <= 24 && verifierDepth % 2 == 0, "Invalid verifier depth");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DistrictRegistry
        console.log("Deploying DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(governance);
        console.log("DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        console.log("Deploying NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(governance);
        console.log("NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy VerifierRegistry
        console.log("Deploying VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(governance);
        console.log("VerifierRegistry deployed at:", address(verifierRegistry));

        // 4. Propose verifier in VerifierRegistry (requires 7-day timelock)
        console.log("Proposing verifier for depth", verifierDepth, "...");
        verifierRegistry.proposeVerifier(verifierDepth, verifier);
        console.log("Verifier proposed for depth", verifierDepth, "(execute after 7 days)");

        // 5. Deploy DistrictGate with VerifierRegistry
        console.log("Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );
        console.log("DistrictGate deployed at:", address(gate));

        // 6. Deploy CampaignRegistry (Phase 1.5)
        console.log("Deploying CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(governance);
        console.log("CampaignRegistry deployed at:", address(campaignRegistry));

        // 7. Propose DistrictGate as caller on NullifierRegistry (requires 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        console.log("DistrictGate caller authorization proposed on NullifierRegistry (execute after 7 days)");

        // 8. Authorize DistrictGate as caller on CampaignRegistry
        campaignRegistry.authorizeCaller(address(gate));
        console.log("DistrictGate authorized as CampaignRegistry caller");

        vm.stopBroadcast();

        console.log("==========================================");
        console.log("DEPLOYMENT COMPLETE (Phase 1)");
        console.log("==========================================");
        console.log("DistrictRegistry:", address(districtRegistry));
        console.log("NullifierRegistry:", address(nullifierRegistry));
        console.log("VerifierRegistry:", address(verifierRegistry));
        console.log("DistrictGate:", address(gate));
        console.log("CampaignRegistry:", address(campaignRegistry));
        console.log("Governance:", governance);
        console.log("");
        console.log("POST-DEPLOYMENT (all require 7-day timelock):");
        console.log("  1. Wait 7 days after deployment");
        console.log("  2. Call verifierRegistry.executeVerifier(depth)");
        console.log("  3. Call nullifierRegistry.executeCallerAuthorization(gate)");
        console.log("  4. Call gate.proposeCampaignRegistry(campaignRegistry)");
        console.log("  5. Wait 7 days");
        console.log("  6. Call gate.executeCampaignRegistry()");
        console.log("==========================================");
    }
}
