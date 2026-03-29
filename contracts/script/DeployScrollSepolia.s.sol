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
import "../src/SnapshotAnchor.sol";

/// @title Deploy to Scroll Sepolia — Genesis Model
/// @notice Mirrors the exact mainnet deployment flow on Scroll Sepolia testnet.
/// @dev Identical to DeployScrollMainnet.s.sol except for chain ID validation.
///      This ensures testnet validates the real deployment path:
///        1. Deploy 5 contracts with deployer as governance
///        2. Register verifiers directly (no timelock — genesis phase)
///        3. Seal genesis (irreversible — future changes require 14-day timelock)
///        4. Propose caller authorizations (7-day timelock)
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY             — Deployer private key (funded with Scroll Sepolia ETH)
///   GOVERNANCE_ADDRESS      — (optional) Post-genesis governance target; defaults to deployer
///   ETHERSCAN_API_KEY       — (optional) For Scrollscan contract verification
///
/// VERIFIER ADDRESSES (set one or more):
///   VERIFIER_ADDRESS_18     — Pre-deployed HonkVerifier for depth 18
///   VERIFIER_ADDRESS_20     — Pre-deployed HonkVerifier for depth 20
///   VERIFIER_ADDRESS_22     — Pre-deployed HonkVerifier for depth 22
///   VERIFIER_ADDRESS_24     — Pre-deployed HonkVerifier for depth 24
///
/// BACKWARD COMPATIBILITY (legacy single-verifier):
///   VERIFIER_ADDRESS        — Single verifier address
///   VERIFIER_DEPTH          — Depth for single verifier (default: 20)
///
/// USAGE:
///   forge script script/DeployScrollSepolia.s.sol:DeployScrollSepolia \
///     --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --verify --slow
contract DeployScrollSepolia is Script {
    // =========================================================================
    // Constants
    // =========================================================================

    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;
    uint8 constant DEFAULT_VERIFIER_DEPTH = 20;
    uint8 constant DEPTH_18 = 18;
    uint8 constant DEPTH_20 = 20;
    uint8 constant DEPTH_22 = 22;
    uint8 constant DEPTH_24 = 24;

    // =========================================================================
    // State for tracking registered verifiers
    // =========================================================================

    uint8[] internal registeredDepths;
    address[] internal registeredAddresses;

    // =========================================================================
    // Deployment
    // =========================================================================

    function run() external {
        // =====================================================================
        // Pre-flight Checks
        // =====================================================================

        require(
            block.chainid == SCROLL_SEPOLIA_CHAIN_ID,
            "WRONG NETWORK: Must deploy to Scroll Sepolia (chainId 534351)"
        );

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Post-genesis governance target. If unset, deployer retains governance.
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

        address verifier18 = _tryEnvAddress("VERIFIER_ADDRESS_18");
        address verifier20 = _tryEnvAddress("VERIFIER_ADDRESS_20");
        address verifier22 = _tryEnvAddress("VERIFIER_ADDRESS_22");
        address verifier24 = _tryEnvAddress("VERIFIER_ADDRESS_24");

        // Backward compatibility: legacy single-verifier mode
        if (verifier18 == address(0) && verifier20 == address(0)
            && verifier22 == address(0) && verifier24 == address(0))
        {
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
        // Banner
        // =====================================================================

        console.log("============================================================");
        console.log("  SCROLL SEPOLIA DEPLOYMENT - VOTER PROTOCOL (GENESIS)");
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

        // =====================================================================
        // Deployment
        // =====================================================================

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DistrictRegistry
        console.log("[1/8] Deploying DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(deployer, 10 minutes);
        console.log("      DistrictRegistry deployed at:", address(districtRegistry));

        // 2. Deploy NullifierRegistry
        console.log("[2/8] Deploying NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer, 10 minutes, 10 minutes);
        console.log("      NullifierRegistry deployed at:", address(nullifierRegistry));

        // 3. Deploy VerifierRegistry
        console.log("[3/8] Deploying VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(deployer, 10 minutes, 10 minutes);
        console.log("      VerifierRegistry deployed at:", address(verifierRegistry));

        // 4. Deploy DistrictGate
        console.log("[4/8] Deploying DistrictGate...");
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            deployer,
            10 minutes,
            10 minutes,
            10 minutes,
            10 minutes
        );
        console.log("      DistrictGate deployed at:", address(gate));

        // 5. Deploy CampaignRegistry
        console.log("[5/8] Deploying CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(deployer, 10 minutes, 10 minutes);
        console.log("      CampaignRegistry deployed at:", address(campaignRegistry));

        // 6. Deploy UserRootRegistry (Tree 1)
        console.log("[6/8] Deploying UserRootRegistry...");
        UserRootRegistry userRootRegistry = new UserRootRegistry(deployer, 10 minutes);
        console.log("      UserRootRegistry deployed at:", address(userRootRegistry));

        // 7. Deploy CellMapRegistry (Tree 2)
        console.log("[7/8] Deploying CellMapRegistry...");
        CellMapRegistry cellMapRegistry = new CellMapRegistry(deployer, 10 minutes);
        console.log("      CellMapRegistry deployed at:", address(cellMapRegistry));

        // 8. Deploy SnapshotAnchor
        console.log("[8/8] Deploying SnapshotAnchor...");
        SnapshotAnchor snapshotAnchor = new SnapshotAnchor(deployer, 10 minutes);
        console.log("      SnapshotAnchor deployed at:", address(snapshotAnchor));

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
        console.log("  - Setting registries (UserRoot + CellMap) on DistrictGate (ACTIVE IMMEDIATELY)");
        gate.setRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));

        // Register a default action domain for testing (bytes32(uint256(100)))
        // This matches the ACTION_DOMAIN used in E2E proof tests
        bytes32 testActionDomain = bytes32(uint256(100));
        console.log("  - Registering test action domain (ACTIVE IMMEDIATELY)");
        gate.registerActionDomainGenesis(testActionDomain);

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
            snapshotAnchor.initiateGovernanceTransfer(governanceTarget);
        }

        vm.stopBroadcast();

        // =====================================================================
        // Deployment Summary
        // =====================================================================

        console.log("");
        console.log("============================================================");
        console.log("  DEPLOYMENT COMPLETE - SCROLL SEPOLIA (GENESIS)");
        console.log("============================================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("  DistrictRegistry:   ", address(districtRegistry));
        console.log("  NullifierRegistry:  ", address(nullifierRegistry));
        console.log("  VerifierRegistry:   ", address(verifierRegistry));
        console.log("  DistrictGate:       ", address(gate));
        console.log("  CampaignRegistry:   ", address(campaignRegistry));
        console.log("  UserRootRegistry:   ", address(userRootRegistry));
        console.log("  CellMapRegistry:    ", address(cellMapRegistry));
        console.log("  SnapshotAnchor:     ", address(snapshotAnchor));
        console.log("");
        console.log("Genesis Status:");
        for (uint256 i = 0; i < registeredDepths.length; i++) {
            console.log("  Verifier depth", registeredDepths[i], ": ACTIVE");
            console.log("    Address:", registeredAddresses[i]);
        }
        console.log("  VerifierRegistry genesis:   SEALED");
        console.log("  NullifierRegistry genesis:  SEALED (DistrictGate authorized)");
        console.log("  DistrictGate genesis:       SEALED (CampaignRegistry + TwoTree registries + action domain)");
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
        console.log("============================================================");
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    function _tryEnvAddress(string memory envVar) internal view returns (address) {
        try vm.envAddress(envVar) returns (address addr) {
            return addr;
        } catch {
            return address(0);
        }
    }

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
}
