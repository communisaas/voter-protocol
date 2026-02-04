// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/CampaignRegistry.sol";

/// @title Deploy to Scroll Mainnet
/// @notice Production deployment script for VOTER Protocol on Scroll Mainnet
/// @dev DO NOT execute without completing MAINNET-DEPLOYMENT-CHECKLIST.md
///
/// CRITICAL PRE-DEPLOYMENT REQUIREMENTS:
/// 1. Security audit completed and all findings addressed
/// 2. All SA-001 through SA-007 security fixes verified
/// 3. Testnet deployment validated with 100+ proofs
/// 4. Governance multisig configured (minimum 3-of-5)
/// 5. Real verifier deployed (NOT MockVerifier)
/// 6. Environment variables set with mainnet values
///
/// ENVIRONMENT VARIABLES REQUIRED:
/// - PRIVATE_KEY: Deployer private key (DO NOT use production keys for testing)
/// - GOVERNANCE_ADDRESS: Multisig address for governance control
/// - VERIFIER_ADDRESS: Pre-deployed UltraPlonk verifier contract
/// - VERIFIER_DEPTH: Merkle tree depth (18, 20, 22, or 24)
/// - ETHERSCAN_API_KEY: For contract verification on Scrollscan
///
/// DEPLOYMENT COMMAND (EXAMPLE - DO NOT RUN WITHOUT CHECKLIST):
/// forge script script/DeployScrollMainnet.s.sol:DeployScrollMainnet \
///   --rpc-url scroll_mainnet \
///   --private-key $PRIVATE_KEY \
///   --broadcast \
///   --verify \
///   --slow
///
/// POST-DEPLOYMENT TIMELOCKS:
/// All critical operations require timelocks after deployment:
/// - Verifier activation: 14-day timelock
/// - DistrictGate caller authorization: 7-day timelock
/// - CampaignRegistry integration: 7-day timelock
/// - District registration: Immediate (governance only)
/// - ActionDomain registration: 7-day timelock
contract DeployScrollMainnet is Script {
    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Default verifier depth (can be overridden via VERIFIER_DEPTH env var)
    uint8 constant DEFAULT_VERIFIER_DEPTH = 20;

    /// @notice Scroll Mainnet Chain ID
    uint256 constant SCROLL_MAINNET_CHAIN_ID = 534352;

    // =========================================================================
    // Deployment
    // =========================================================================

    function run() external {
        // =====================================================================
        // Pre-flight Checks
        // =====================================================================

        // Verify we're on Scroll Mainnet
        require(
            block.chainid == SCROLL_MAINNET_CHAIN_ID,
            "WRONG NETWORK: Must deploy to Scroll Mainnet (chainId 534352)"
        );

        // Get deployer and configuration from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        // Optional: specify verifier depth (defaults to 20)
        uint8 verifierDepth = DEFAULT_VERIFIER_DEPTH;
        try vm.envUint("VERIFIER_DEPTH") returns (uint256 depth) {
            verifierDepth = uint8(depth);
        } catch {}

        address deployer = vm.addr(deployerPrivateKey);

        // =====================================================================
        // Safety Checks
        // =====================================================================

        console.log("============================================================");
        console.log("  SCROLL MAINNET DEPLOYMENT - VOTER PROTOCOL");
        console.log("============================================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Governance:", governance);
        console.log("Verifier:", verifier);
        console.log("Verifier Depth:", verifierDepth);
        console.log("");

        // Critical validations
        require(governance != address(0), "GOVERNANCE_ADDRESS not set");
        require(verifier != address(0), "VERIFIER_ADDRESS not set");
        require(governance != deployer, "Governance must differ from deployer (use multisig)");
        require(
            verifierDepth >= 18 && verifierDepth <= 24 && verifierDepth % 2 == 0,
            "Invalid verifier depth (must be 18, 20, 22, or 24)"
        );

        // Verify verifier contract has code (is deployed)
        uint256 verifierCodeSize;
        assembly {
            verifierCodeSize := extcodesize(verifier)
        }
        require(verifierCodeSize > 0, "VERIFIER_ADDRESS has no code - deploy verifier first");

        console.log("==> Pre-flight checks PASSED");
        console.log("");
        console.log("SECURITY REMINDER:");
        console.log("  - This is a MAINNET deployment with REAL FUNDS at risk");
        console.log("  - Ensure MAINNET-DEPLOYMENT-CHECKLIST.md is complete");
        console.log("  - All timelocks will apply - plan for 7-14 day activation");
        console.log("");

        // =====================================================================
        // Deployment
        // =====================================================================

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DistrictRegistry
        console.log("[1/5] Deploying DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(governance);
        console.log("      DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        console.log("[2/5] Deploying NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(governance);
        console.log("      NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy VerifierRegistry
        console.log("[3/5] Deploying VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(governance);
        console.log("      VerifierRegistry deployed at:", address(verifierRegistry));

        // 4. Deploy DistrictGate
        console.log("[4/5] Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );
        console.log("      DistrictGate deployed at:", address(gate));

        // 5. Deploy CampaignRegistry
        console.log("[5/5] Deploying CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(governance);
        console.log("      CampaignRegistry deployed at:", address(campaignRegistry));

        // =====================================================================
        // Initial Configuration (Governance-Controlled)
        // =====================================================================

        console.log("");
        console.log("Initiating governance-controlled configurations...");

        // Propose verifier in VerifierRegistry (requires 14-day timelock)
        console.log("  - Proposing verifier for depth", verifierDepth, "(14-day timelock)");
        verifierRegistry.proposeVerifier(verifierDepth, verifier);

        // Propose DistrictGate as caller on NullifierRegistry (requires 7-day timelock)
        console.log("  - Proposing DistrictGate caller authorization (7-day timelock)");
        nullifierRegistry.proposeCallerAuthorization(address(gate));

        // Authorize DistrictGate as caller on CampaignRegistry (immediate - governance tx)
        console.log("  - Authorizing DistrictGate on CampaignRegistry");
        campaignRegistry.authorizeCaller(address(gate));

        vm.stopBroadcast();

        // =====================================================================
        // Deployment Summary
        // =====================================================================

        console.log("");
        console.log("============================================================");
        console.log("  DEPLOYMENT COMPLETE - SCROLL MAINNET");
        console.log("============================================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("  DistrictRegistry:   ", address(districtRegistry));
        console.log("  NullifierRegistry:  ", address(nullifierRegistry));
        console.log("  VerifierRegistry:   ", address(verifierRegistry));
        console.log("  DistrictGate:       ", address(gate));
        console.log("  CampaignRegistry:   ", address(campaignRegistry));
        console.log("");
        console.log("Configuration:");
        console.log("  Governance:         ", governance);
        console.log("  Verifier:           ", verifier);
        console.log("  Verifier Depth:     ", verifierDepth);
        console.log("");
        console.log("============================================================");
        console.log("  POST-DEPLOYMENT ACTIONS REQUIRED");
        console.log("============================================================");
        console.log("");
        console.log("TIMELOCK OPERATIONS (execute from governance multisig):");
        console.log("");
        console.log("1. AFTER 14 DAYS - Execute verifier activation:");
        console.log("   verifierRegistry.executeVerifier(", verifierDepth, ")");
        console.log("   Address:", address(verifierRegistry));
        console.log("");
        console.log("2. AFTER 7 DAYS - Execute DistrictGate caller authorization:");
        console.log("   nullifierRegistry.executeCallerAuthorization(", address(gate), ")");
        console.log("   Address:", address(nullifierRegistry));
        console.log("");
        console.log("3. AFTER STEP 2 - Propose CampaignRegistry on DistrictGate:");
        console.log("   gate.proposeCampaignRegistry(", address(campaignRegistry), ")");
        console.log("   Address:", address(gate));
        console.log("");
        console.log("4. AFTER 7 MORE DAYS - Execute CampaignRegistry integration:");
        console.log("   gate.executeCampaignRegistry()");
        console.log("   Address:", address(gate));
        console.log("");
        console.log("5. ONGOING - Register districts (no timelock, governance only):");
        console.log("   districtRegistry.registerDistrict(root, country, depth)");
        console.log("   Address:", address(districtRegistry));
        console.log("");
        console.log("6. AS NEEDED - Register action domains (7-day timelock each):");
        console.log("   gate.proposeActionDomain(actionDomain)");
        console.log("   ... wait 7 days ...");
        console.log("   gate.executeActionDomain(actionDomain)");
        console.log("   Address:", address(gate));
        console.log("");
        console.log("============================================================");
        console.log("  VERIFICATION");
        console.log("============================================================");
        console.log("");
        console.log("Verify contracts on Scrollscan:");
        console.log("  forge verify-contract <address> <Contract> --chain scroll --watch");
        console.log("");
        console.log("Or re-run with --verify flag to auto-verify.");
        console.log("");
        console.log("============================================================");
        console.log("  SECURITY REMINDERS");
        console.log("============================================================");
        console.log("");
        console.log("1. Transfer deployer role to governance multisig");
        console.log("2. Secure deployer private key (rotate if single-use)");
        console.log("3. Monitor all pending timelock operations");
        console.log("4. Set up event monitoring for governance actions");
        console.log("5. Document all deployed addresses in version control");
        console.log("");
        console.log("For full checklist, see: MAINNET-DEPLOYMENT-CHECKLIST.md");
        console.log("============================================================");
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    /// @notice Estimate total deployment gas cost
    /// @dev Call this before deployment to estimate costs
    function estimateGas() external pure {
        console.log("============================================================");
        console.log("  GAS ESTIMATION FOR SCROLL MAINNET DEPLOYMENT");
        console.log("============================================================");
        console.log("");
        console.log("Estimated gas costs (approximate):");
        console.log("");
        console.log("  DistrictRegistry deployment:    ~1,500,000 gas");
        console.log("  NullifierRegistry deployment:   ~1,800,000 gas");
        console.log("  VerifierRegistry deployment:    ~1,200,000 gas");
        console.log("  DistrictGate deployment:        ~2,500,000 gas");
        console.log("  CampaignRegistry deployment:    ~2,000,000 gas");
        console.log("  -----------------------------------------");
        console.log("  Total deployment:               ~9,000,000 gas");
        console.log("");
        console.log("  Post-deployment transactions:");
        console.log("  proposeVerifier:                ~50,000 gas");
        console.log("  proposeCallerAuthorization:     ~50,000 gas");
        console.log("  authorizeCaller:                ~50,000 gas");
        console.log("  -----------------------------------------");
        console.log("  Total post-deployment:          ~150,000 gas");
        console.log("");
        console.log("  GRAND TOTAL:                    ~9,150,000 gas");
        console.log("");
        console.log("At Scroll L2 gas prices (typically 0.01-0.1 gwei):");
        console.log("  Estimated cost: ~0.00009 - 0.0009 ETH");
        console.log("  USD equivalent: ~$0.25 - $2.50 (at $2500/ETH)");
        console.log("");
        console.log("IMPORTANT: These are estimates. Actual costs may vary.");
        console.log("Run deployment with --dry-run first to get exact costs.");
        console.log("============================================================");
    }
}
