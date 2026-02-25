// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/DistrictGate.sol";
import "../src/CampaignRegistry.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";
import "../src/EngagementRootRegistry.sol";

/// @title Deploy to Scroll Mainnet
/// @notice Production deployment script for VOTER Protocol on Scroll Mainnet
/// @dev DO NOT execute without completing DEPLOY-CHECKLIST.md
///
/// CRITICAL PRE-DEPLOYMENT REQUIREMENTS:
/// 1. Security audit completed and all findings addressed
/// 2. All SA-001 through SA-007 security fixes verified
/// 3. Testnet deployment validated with 100+ proofs
/// 4. Governance multisig configured (minimum 3-of-5)
/// 5. Real verifier(s) deployed (NOT MockVerifier)
/// 6. Environment variables set with mainnet values
///
/// ENVIRONMENT VARIABLES REQUIRED:
/// - PRIVATE_KEY: Deployer private key (DO NOT use production keys for testing)
/// - GOVERNANCE_ADDRESS: Multisig address for governance control
/// - ETHERSCAN_API_KEY: For contract verification on Scrollscan
///
/// THREE-TREE VERIFIER ADDRESS VARIABLES (primary — set one or more):
/// - THREE_TREE_VERIFIER_18: Pre-deployed three-tree HonkVerifier for depth 18
/// - THREE_TREE_VERIFIER_20: Pre-deployed three-tree HonkVerifier for depth 20
/// - THREE_TREE_VERIFIER_22: Pre-deployed three-tree HonkVerifier for depth 22
/// - THREE_TREE_VERIFIER_24: Pre-deployed three-tree HonkVerifier for depth 24
///
/// TWO-TREE VERIFIER ADDRESS VARIABLES (legacy — optional):
/// - VERIFIER_ADDRESS_18: Pre-deployed two-tree HonkVerifier for depth 18
/// - VERIFIER_ADDRESS_20: Pre-deployed two-tree HonkVerifier for depth 20
/// - VERIFIER_ADDRESS_22: Pre-deployed two-tree HonkVerifier for depth 22
/// - VERIFIER_ADDRESS_24: Pre-deployed two-tree HonkVerifier for depth 24
///
/// BACKWARD COMPATIBILITY:
/// - VERIFIER_ADDRESS: (legacy) Single verifier address
/// - VERIFIER_DEPTH: (legacy) Depth for single verifier (default 20)
///
/// DEPLOYMENT COMMAND (EXAMPLE - DO NOT RUN WITHOUT CHECKLIST):
/// forge script script/DeployScrollMainnet.s.sol:DeployScrollMainnet \
///   --rpc-url scroll_mainnet \
///   --private-key $PRIVATE_KEY \
///   --broadcast \
///   --verify \
///   --slow
///
/// GENESIS FLOW (no timelocks — all contracts operational immediately):
/// 1. Deploy with deployer as initial governance (8 contracts)
/// 2. Register three-tree verifiers (registerThreeTreeVerifier — primary, no timelock)
/// 2b. Register two-tree verifiers (registerVerifier — legacy, no timelock)
/// 3. Authorize DistrictGate on NullifierRegistry (authorizeCallerGenesis — no timelock)
/// 4. Set CampaignRegistry on DistrictGate (setCampaignRegistryGenesis — no timelock)
/// 5. Set UserRootRegistry + CellMapRegistry on DistrictGate (setTwoTreeRegistriesGenesis — no timelock)
/// 5b. Set EngagementRootRegistry on DistrictGate (setEngagementRegistryGenesis — no timelock)
/// 6. Register initial action domain (registerActionDomainGenesis — no timelock)
/// 7. Seal genesis on all registries (irreversible)
/// 8. Transfer governance to multisig (7-day timelock)
///
/// POST-GENESIS TIMELOCKS:
/// - Verifier upgrades: 14-day timelock
/// - New depth registration: 14-day timelock
/// - Caller authorization changes: 7-day timelock
/// - ActionDomain registration: 7-day timelock
/// - CampaignRegistry changes: 7-day timelock
/// - District registration: Immediate (governance only)
contract DeployScrollMainnet is Script {
    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Scroll Mainnet Chain ID
    uint256 constant SCROLL_MAINNET_CHAIN_ID = 534352;

    /// @notice Default verifier depth for legacy single-verifier mode
    uint8 constant DEFAULT_VERIFIER_DEPTH = 20;

    /// @notice Supported depths
    uint8 constant DEPTH_18 = 18;
    uint8 constant DEPTH_20 = 20;
    uint8 constant DEPTH_22 = 22;
    uint8 constant DEPTH_24 = 24;

    // =========================================================================
    // State for tracking registered verifiers
    // =========================================================================

    /// @dev Track which depths were registered for the summary
    uint8[] internal registeredDepths;
    address[] internal registeredAddresses;

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

        // Post-genesis governance target (multisig). Governance transfers to
        // this address after genesis seal. Optional — if not set, deployer
        // retains governance (acceptable for Phase 1 solo operator).
        address governanceTarget;
        try vm.envAddress("GOVERNANCE_ADDRESS") returns (address g) {
            governanceTarget = g;
        } catch {
            governanceTarget = address(0);
        }

        address deployer = vm.addr(deployerPrivateKey);

        // =====================================================================
        // Resolve Verifier Addresses
        // =====================================================================

        // Per-depth verifier addresses (new multi-depth approach)
        address verifier18 = _tryEnvAddress("VERIFIER_ADDRESS_18");
        address verifier20 = _tryEnvAddress("VERIFIER_ADDRESS_20");
        address verifier22 = _tryEnvAddress("VERIFIER_ADDRESS_22");
        address verifier24 = _tryEnvAddress("VERIFIER_ADDRESS_24");

        // Backward compatibility: if VERIFIER_ADDRESS (singular) is set,
        // use it as a fallback for the specified depth (default 20)
        if (verifier18 == address(0) && verifier20 == address(0)
            && verifier22 == address(0) && verifier24 == address(0))
        {
            // No per-depth vars set — try legacy single-verifier mode
            address legacyVerifier = _tryEnvAddress("VERIFIER_ADDRESS");
            if (legacyVerifier != address(0)) {
                uint8 legacyDepth = DEFAULT_VERIFIER_DEPTH;
                try vm.envUint("VERIFIER_DEPTH") returns (uint256 d) {
                    legacyDepth = uint8(d);
                } catch {}

                console.log("NOTE: Using legacy VERIFIER_ADDRESS for depth", legacyDepth);

                if (legacyDepth == DEPTH_18) verifier18 = legacyVerifier;
                else if (legacyDepth == DEPTH_20) verifier20 = legacyVerifier;
                else if (legacyDepth == DEPTH_22) verifier22 = legacyVerifier;
                else if (legacyDepth == DEPTH_24) verifier24 = legacyVerifier;
                else revert("Invalid VERIFIER_DEPTH (must be 18, 20, 22, or 24)");
            }
        }

        // Count how many verifiers we have
        uint8 verifierCount = 0;
        if (verifier18 != address(0)) verifierCount++;
        if (verifier20 != address(0)) verifierCount++;
        if (verifier22 != address(0)) verifierCount++;
        if (verifier24 != address(0)) verifierCount++;

        require(
            verifierCount >= 1,
            "At least one verifier address required. Set VERIFIER_ADDRESS_18, _20, _22, or _24."
        );

        // =====================================================================
        // Safety Checks
        // =====================================================================

        console.log("============================================================");
        console.log("  SCROLL MAINNET DEPLOYMENT - VOTER PROTOCOL");
        console.log("============================================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Governance target:", governanceTarget == address(0) ? deployer : governanceTarget);
        console.log("");
        console.log("Verifiers to register:", verifierCount);
        if (verifier18 != address(0)) console.log("  Depth 18:", verifier18);
        if (verifier20 != address(0)) console.log("  Depth 20:", verifier20);
        if (verifier22 != address(0)) console.log("  Depth 22:", verifier22);
        if (verifier24 != address(0)) console.log("  Depth 24:", verifier24);
        console.log("");

        // Validate each provided verifier has on-chain code
        if (verifier18 != address(0)) _requireCodeAt(verifier18, "VERIFIER_ADDRESS_18");
        if (verifier20 != address(0)) _requireCodeAt(verifier20, "VERIFIER_ADDRESS_20");
        if (verifier22 != address(0)) _requireCodeAt(verifier22, "VERIFIER_ADDRESS_22");
        if (verifier24 != address(0)) _requireCodeAt(verifier24, "VERIFIER_ADDRESS_24");

        console.log("==> Pre-flight checks PASSED");
        console.log("");
        console.log("SECURITY REMINDER:");
        console.log("  - This is a MAINNET deployment with REAL FUNDS at risk");
        console.log("  - Ensure DEPLOY-CHECKLIST.md is complete");
        console.log("  - All timelocks will apply - plan for 7-14 day activation");
        console.log("");

        // =====================================================================
        // Deployment
        // =====================================================================

        vm.startBroadcast(deployerPrivateKey);

        // Deploy with deployer as initial governance (genesis phase)
        // Deployer registers verifiers directly, then seals genesis + transfers governance

        // 1. Deploy DistrictRegistry
        console.log("[1/8] Deploying DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(deployer);
        console.log("      DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        console.log("[2/8] Deploying NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer);
        console.log("      NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy VerifierRegistry
        console.log("[3/8] Deploying VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(deployer);
        console.log("      VerifierRegistry deployed at:", address(verifierRegistry));

        // 4. Deploy DistrictGate
        console.log("[4/8] Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            deployer
        );
        console.log("      DistrictGate deployed at:", address(gate));

        // 5. Deploy CampaignRegistry
        console.log("[5/8] Deploying CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(deployer);
        console.log("      CampaignRegistry deployed at:", address(campaignRegistry));

        // 6. Deploy UserRootRegistry (Tree 1)
        console.log("[6/8] Deploying UserRootRegistry...");
        UserRootRegistry userRootRegistry = new UserRootRegistry(deployer);
        console.log("      UserRootRegistry deployed at:", address(userRootRegistry));

        // 7. Deploy CellMapRegistry (Tree 2)
        console.log("[7/8] Deploying CellMapRegistry...");
        CellMapRegistry cellMapRegistry = new CellMapRegistry(deployer);
        console.log("      CellMapRegistry deployed at:", address(cellMapRegistry));

        // 8. Deploy EngagementRootRegistry (Tree 3 — three-tree primary)
        console.log("[8/8] Deploying EngagementRootRegistry...");
        EngagementRootRegistry engagementRootRegistry = new EngagementRootRegistry(deployer);
        console.log("      EngagementRootRegistry deployed at:", address(engagementRootRegistry));

        // =====================================================================
        // Genesis Configuration (direct — no timelocks)
        // =====================================================================

        console.log("");
        console.log("Genesis phase: configuring all contracts directly (no timelocks)...");

        // --- VerifierRegistry genesis ---
        _tryRegisterVerifier(verifierRegistry, DEPTH_18, verifier18);
        _tryRegisterVerifier(verifierRegistry, DEPTH_20, verifier20);
        _tryRegisterVerifier(verifierRegistry, DEPTH_22, verifier22);
        _tryRegisterVerifier(verifierRegistry, DEPTH_24, verifier24);

        console.log("");
        console.log("  Registered", registeredDepths.length, "verifier(s) during genesis.");

        require(registeredDepths.length >= 1, "No verifiers registered - cannot seal genesis");
        console.log("  - Sealing VerifierRegistry genesis (irreversible)");
        verifierRegistry.sealGenesis();

        // --- NullifierRegistry genesis ---
        console.log("  - Authorizing DistrictGate as caller on NullifierRegistry (ACTIVE IMMEDIATELY)");
        nullifierRegistry.authorizeCallerGenesis(address(gate));
        console.log("  - Sealing NullifierRegistry genesis (irreversible)");
        nullifierRegistry.sealGenesis();

        // --- CampaignRegistry ---
        console.log("  - Authorizing DistrictGate on CampaignRegistry");
        campaignRegistry.authorizeCaller(address(gate));

        // --- DistrictGate genesis ---
        console.log("  - Setting CampaignRegistry on DistrictGate (ACTIVE IMMEDIATELY)");
        gate.setCampaignRegistryGenesis(address(campaignRegistry));
        console.log("  - Setting two-tree registries on DistrictGate (ACTIVE IMMEDIATELY)");
        gate.setTwoTreeRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        console.log("  - Setting EngagementRootRegistry on DistrictGate (ACTIVE IMMEDIATELY)");
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));

        // Register a default action domain (bytes32(uint256(100)))
        // This matches the ACTION_DOMAIN used in E2E proof tests
        bytes32 defaultActionDomain = bytes32(uint256(100));
        console.log("  - Registering default action domain (ACTIVE IMMEDIATELY)");
        gate.registerActionDomainGenesis(defaultActionDomain);

        // --- DebateMarket deriver authorization ---
        // When DebateMarket is deployed, authorize it as a derived-domain deriver:
        //   DebateMarket debateMarket = new DebateMarket(address(gate), address(stakingToken), deployer);
        //   console.log("  - Authorizing DebateMarket as derived-domain deriver (ACTIVE IMMEDIATELY)");
        //   gate.authorizeDeriverGenesis(address(debateMarket));

        console.log("  - Sealing DistrictGate genesis (irreversible)");
        gate.sealGenesis();

        // Initiate governance transfer if target is set
        if (governanceTarget != address(0) && governanceTarget != deployer) {
            console.log("  - Initiating governance transfer to", governanceTarget, "(7-day timelock)");
            verifierRegistry.initiateGovernanceTransfer(governanceTarget);
            nullifierRegistry.initiateGovernanceTransfer(governanceTarget);
            districtRegistry.initiateGovernanceTransfer(governanceTarget);
            gate.initiateGovernanceTransfer(governanceTarget);
            campaignRegistry.initiateGovernanceTransfer(governanceTarget);
            userRootRegistry.initiateGovernanceTransfer(governanceTarget);
            cellMapRegistry.initiateGovernanceTransfer(governanceTarget);
            engagementRootRegistry.initiateGovernanceTransfer(governanceTarget);
        }

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
        console.log("  DistrictRegistry:        ", address(districtRegistry));
        console.log("  NullifierRegistry:       ", address(nullifierRegistry));
        console.log("  VerifierRegistry:        ", address(verifierRegistry));
        console.log("  DistrictGate:            ", address(gate));
        console.log("  CampaignRegistry:        ", address(campaignRegistry));
        console.log("  UserRootRegistry:        ", address(userRootRegistry));
        console.log("  CellMapRegistry:         ", address(cellMapRegistry));
        console.log("  EngagementRootRegistry:  ", address(engagementRootRegistry));
        console.log("");
        console.log("Genesis Status:");
        for (uint256 i = 0; i < registeredDepths.length; i++) {
            console.log("  Verifier depth", registeredDepths[i], ": ACTIVE");
            console.log("    Address:", registeredAddresses[i]);
        }
        console.log("  VerifierRegistry genesis:   SEALED");
        console.log("  NullifierRegistry genesis:  SEALED (DistrictGate authorized)");
        console.log("  DistrictGate genesis:       SEALED (CampaignRegistry + registries + action domain)");
        console.log("");
        console.log("  ==> ALL CONTRACTS FULLY OPERATIONAL - NO TIMELOCKS PENDING");
        console.log("");
        if (governanceTarget != address(0) && governanceTarget != deployer) {
            console.log("============================================================");
            console.log("  POST-DEPLOYMENT: GOVERNANCE TRANSFER (7-day timelock)");
            console.log("============================================================");
            console.log("");
            console.log("  AFTER 7 DAYS - Execute governance transfer:");
            console.log("  *.executeGovernanceTransfer(", governanceTarget, ")");
            console.log("  (call on all 8 contracts)");
            console.log("");
        }
        console.log("ONGOING - Register districts (no timelock, governance only):");
        console.log("   districtRegistry.registerDistrict(root, country, depth)");
        console.log("   Address:", address(districtRegistry));
        console.log("");
        console.log("POST-GENESIS - Register action domains (7-day timelock each):");
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
        console.log("For full checklist, see: DEPLOY-CHECKLIST.md");
        console.log("============================================================");
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    /// @notice Try to read an address from an environment variable, return address(0) if unset
    function _tryEnvAddress(string memory envVar) internal view returns (address) {
        try vm.envAddress(envVar) returns (address addr) {
            return addr;
        } catch {
            return address(0);
        }
    }

    /// @notice Require that an address has deployed code
    function _requireCodeAt(address addr, string memory label) internal view {
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(addr)
        }
        require(
            codeSize > 0,
            string.concat(label, " has no code - deploy verifier first")
        );
    }

    /// @notice Register a verifier for a depth if the address is provided
    /// @param registry The VerifierRegistry contract
    /// @param depth Merkle tree depth (18, 20, 22, or 24)
    /// @param verifier Verifier address (address(0) to skip)
    function _tryRegisterVerifier(
        VerifierRegistry registry,
        uint8 depth,
        address verifier
    ) internal {
        if (verifier == address(0)) return;

        console.log("  - Registering verifier for depth", depth, "(ACTIVE IMMEDIATELY)");
        registry.registerVerifier(depth, verifier);

        registeredDepths.push(depth);
        registeredAddresses.push(verifier);
    }

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
        console.log("  UserRootRegistry deployment:    ~1,500,000 gas");
        console.log("  CellMapRegistry deployment:     ~1,200,000 gas");
        console.log("  -----------------------------------------");
        console.log("  Total deployment:               ~11,700,000 gas");
        console.log("");
        console.log("  Post-deployment (genesis config):");
        console.log("  registerVerifier (x1-4):        ~50,000 gas each");
        console.log("  sealGenesis (x3):               ~30,000 gas each");
        console.log("  authorizeCallerGenesis:          ~50,000 gas");
        console.log("  setCampaignRegistryGenesis:      ~50,000 gas");
        console.log("  setTwoTreeRegistriesGenesis:     ~70,000 gas");
        console.log("  registerActionDomainGenesis:     ~50,000 gas");
        console.log("  -----------------------------------------");
        console.log("  Total genesis config:           ~510,000 gas (4 verifiers)");
        console.log("");
        console.log("  GRAND TOTAL:                    ~12,210,000 gas");
        console.log("");
        console.log("At current Scroll L2 gas prices (~0.00012 gwei L2 + L1 data fees):");
        console.log("  Estimated cost: ~0.001 - 0.01 ETH (L1 data fees dominate)");
        console.log("");
        console.log("IMPORTANT: These are estimates. Actual costs may vary.");
        console.log("Run deployment with --dry-run first to get exact costs.");
        console.log("============================================================");
    }
}
