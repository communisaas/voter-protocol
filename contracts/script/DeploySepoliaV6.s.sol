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
import "../src/DebateMarket.sol";
import "../src/IDebateWeightVerifier.sol";
import "../src/IPositionNoteVerifier.sol";
import "../src/IAIEvaluationRegistry.sol";

/// @title Deploy V8 to Scroll Sepolia — Full Stack with DebateMarket (USDC + Protocol Fee)
/// @notice Fresh genesis deployment including three-tree registries + DebateMarket.
///         Supersedes v6 deployment with USDC staking and protocol fee.
///
/// PURPOSE: End-to-end testnet debugging of the full debate flow.
///          Uses mock verifiers, MockERC20 (tUSDC), and 2% protocol fee — not production.
///
/// WHAT'S NEW vs v6:
///   - DebateMarket uses ERC-20 staking (USDC) instead of native ETH.
///   - 2% protocol fee on argument stakes (submitArgument, coSignArgument only).
///   - Constructor: 7 params (added _stakingToken, _protocolFeeBps).
///   - New governance: sweepFees(address), setProtocolFee(uint256).
///   - MIN_PROPOSER_BOND/MIN_ARGUMENT_STAKE: 1e6 (1 USDC).
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY             — Deployer private key (funded with Scroll Sepolia ETH)
///   VERIFIER_ADDRESS_20     — Pre-deployed HonkVerifier for depth 20 (or VERIFIER_ADDRESS)
///
/// USAGE:
///   cd contracts
///   forge script script/DeploySepoliaV6.s.sol:DeploySepoliaV6 \
///     --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --verify --slow
contract DeploySepoliaV6 is Script {
    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;

    function run() external {
        require(
            block.chainid == SCROLL_SEPOLIA_CHAIN_ID,
            "WRONG NETWORK: Must deploy to Scroll Sepolia (chainId 534351)"
        );

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Resolve verifier address (at least depth 20 required)
        // If MOCK_HONK_VERIFIER=1 is set, deploy an always-pass mock instead of using a real verifier.
        // This is required for E2E testing with dummy proofs.
        address verifier20;
        bool useMockHonkVerifier = _tryEnvBool("MOCK_HONK_VERIFIER");
        if (useMockHonkVerifier) {
            verifier20 = address(0); // will be deployed below after startBroadcast
        } else {
            verifier20 = _tryEnvAddress("VERIFIER_ADDRESS_20");
            if (verifier20 == address(0)) {
                verifier20 = _tryEnvAddress("VERIFIER_ADDRESS");
            }
            require(verifier20 != address(0), "Set VERIFIER_ADDRESS_20, VERIFIER_ADDRESS, or MOCK_HONK_VERIFIER=1");
        }

        console.log("============================================================");
        console.log("  SCROLL SEPOLIA V8 - USDC STAKING + PROTOCOL FEE");
        console.log("============================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Verifier (depth 20):", verifier20);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock HonkVerifier if requested (for E2E testing with dummy proofs)
        if (useMockHonkVerifier) {
            MockHonkVerifier mockHonk = new MockHonkVerifier();
            verifier20 = address(mockHonk);
            console.log("MockHonkVerifier (always-pass):", verifier20);
        }

        // =====================================================================
        // Core Registries (same as v5)
        // =====================================================================

        console.log("[1/10] DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(deployer, 10 minutes);
        console.log("        ", address(districtRegistry));

        console.log("[2/10] NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer, 10 minutes, 10 minutes);
        console.log("        ", address(nullifierRegistry));

        console.log("[3/10] VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(deployer, 10 minutes, 10 minutes);
        console.log("        ", address(verifierRegistry));

        console.log("[4/10] DistrictGate...");
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
        console.log("        ", address(gate));

        console.log("[5/10] CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(deployer, 10 minutes, 10 minutes);
        console.log("        ", address(campaignRegistry));

        console.log("[6/10] UserRootRegistry...");
        UserRootRegistry userRootRegistry = new UserRootRegistry(deployer, 10 minutes);
        console.log("        ", address(userRootRegistry));

        console.log("[7/10] CellMapRegistry...");
        CellMapRegistry cellMapRegistry = new CellMapRegistry(deployer, 10 minutes);
        console.log("        ", address(cellMapRegistry));

        // =====================================================================
        // Three-Tree + Debate Infrastructure
        // =====================================================================

        console.log("[8/10] EngagementRootRegistry...");
        EngagementRootRegistry engagementRootRegistry = new EngagementRootRegistry(deployer, 10 minutes);
        console.log("        ", address(engagementRootRegistry));

        console.log("[9/10] Mock verifiers...");

        // Mock verifiers: always-pass, testnet only.
        // Interface: verify(bytes calldata proof, bytes32[] calldata publicInputs) external returns (bool)
        // Real DebateWeightVerifier.sol and PositionNoteVerifier.sol (bb.js-generated) are
        // NOT used here — they require real UltraHonk proofs (separate cycle).
        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        console.log("         MockDebateWeightVerifier:", address(dwVerifier));

        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        console.log("         MockPositionNoteVerifier:", address(pnVerifier));

        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();
        console.log("         MockAIEvaluationRegistry:", address(aiRegistry));

        // Deploy test USDC (MockERC20, 6 decimals)
        MockERC20 stakingToken = new MockERC20("Test USDC", "tUSDC", 6);
        console.log("         MockERC20 (tUSDC):       ", address(stakingToken));

        // Mint test tokens to deployer
        stakingToken.mint(deployer, 10_000_000e6); // 10M tUSDC

        // DebateMarket constructor (USDC staking + 2% protocol fee):
        //   (address _districtGate, address _debateWeightVerifier,
        //    address _positionNoteVerifier, address _aiRegistry, address _governance,
        //    address _stakingToken, uint256 _protocolFeeBps)
        console.log("[10/10] DebateMarket (USDC staking, 2% fee)...");
        DebateMarket debateMarket = new DebateMarket(
            address(gate),
            address(dwVerifier),
            address(pnVerifier),
            address(aiRegistry),
            deployer,
            10 minutes,
            address(stakingToken),
            200 // 2% protocol fee
        );
        console.log("         ", address(debateMarket));

        // =====================================================================
        // Genesis Configuration
        // =====================================================================

        console.log("");
        console.log("Genesis configuration...");

        // VerifierRegistry — register both two-tree (legacy) and three-tree (primary)
        console.log("  - Registering two-tree verifier depth 20");
        verifierRegistry.registerVerifier(20, verifier20);
        console.log("  - Registering three-tree verifier depth 20");
        verifierRegistry.registerThreeTreeVerifier(20, verifier20);
        console.log("  - Sealing VerifierRegistry genesis");
        verifierRegistry.sealGenesis();

        // NullifierRegistry
        console.log("  - Authorizing DistrictGate on NullifierRegistry");
        nullifierRegistry.authorizeCallerGenesis(address(gate));
        console.log("  - Sealing NullifierRegistry genesis");
        nullifierRegistry.sealGenesis();

        // CampaignRegistry
        console.log("  - Authorizing DistrictGate on CampaignRegistry");
        campaignRegistry.authorizeCaller(address(gate));

        // DistrictGate
        console.log("  - Setting CampaignRegistry on DistrictGate");
        gate.setCampaignRegistryGenesis(address(campaignRegistry));
        console.log("  - Setting two-tree registries");
        gate.setTwoTreeRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        console.log("  - Setting EngagementRootRegistry");
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        console.log("  - Authorizing DebateMarket as derived-domain deriver");
        gate.authorizeDeriverGenesis(address(debateMarket));

        // Register test action domain (matches E2E proof tests)
        bytes32 testActionDomain = bytes32(uint256(100));
        console.log("  - Registering test action domain");
        gate.registerActionDomainGenesis(testActionDomain);

        console.log("  - Sealing DistrictGate genesis");
        gate.sealGenesis();

        vm.stopBroadcast();

        // =====================================================================
        // Summary
        // =====================================================================

        console.log("");
        console.log("============================================================");
        console.log("  V8 DEPLOYMENT COMPLETE - SCROLL SEPOLIA");
        console.log("  (USDC staking + 2% protocol fee)");
        console.log("============================================================");
        console.log("");
        console.log("Core:");
        console.log("  DistrictRegistry:          ", address(districtRegistry));
        console.log("  NullifierRegistry:         ", address(nullifierRegistry));
        console.log("  VerifierRegistry:          ", address(verifierRegistry));
        console.log("  DistrictGate:              ", address(gate));
        console.log("  CampaignRegistry:          ", address(campaignRegistry));
        console.log("  UserRootRegistry:          ", address(userRootRegistry));
        console.log("  CellMapRegistry:           ", address(cellMapRegistry));
        console.log("");
        console.log("Three-Tree + Debate:");
        console.log("  EngagementRootRegistry:    ", address(engagementRootRegistry));
        console.log("  DebateMarket:              ", address(debateMarket));
        console.log("  StakingToken (tUSDC):      ", address(stakingToken));
        console.log("  DebateWeightVerifier (mock):", address(dwVerifier));
        console.log("  PositionNoteVerifier (mock):", address(pnVerifier));
        console.log("");
        console.log("Genesis: ALL SEALED");
        console.log("  DebateMarket authorized as deriver: YES");
        console.log("  EngagementRootRegistry wired: YES");
        console.log("  Staking: USDC (2% protocol fee)");
        console.log("");
        console.log("Update .env with these addresses:");
        console.log("  DISTRICT_GATE_ADDRESS=", address(gate));
        console.log("  VERIFIER_REGISTRY_ADDRESS=", address(verifierRegistry));
        console.log("  NULLIFIER_REGISTRY_ADDRESS=", address(nullifierRegistry));
        console.log("  USER_ROOT_REGISTRY_ADDRESS=", address(userRootRegistry));
        console.log("  CELL_MAP_REGISTRY_ADDRESS=", address(cellMapRegistry));
        console.log("  DISTRICT_REGISTRY_ADDRESS=", address(districtRegistry));
        console.log("  CAMPAIGN_REGISTRY_ADDRESS=", address(campaignRegistry));
        console.log("  ENGAGEMENT_ROOT_REGISTRY_ADDRESS=", address(engagementRootRegistry));
        console.log("  DEBATE_MARKET_ADDRESS=", address(debateMarket));
        console.log("  STAKING_TOKEN_ADDRESS=", address(stakingToken));
        console.log("============================================================");
    }

    function _tryEnvAddress(string memory envVar) internal view returns (address) {
        try vm.envAddress(envVar) returns (address addr) {
            return addr;
        } catch {
            return address(0);
        }
    }

    function _tryEnvBool(string memory envVar) internal view returns (bool) {
        try vm.envBool(envVar) returns (bool val) {
            return val;
        } catch {
            return false;
        }
    }
}

// =============================================================================
// Mock Contracts (testnet only — always-pass verifiers)
// =============================================================================

/// @notice Mock HonkVerifier — always returns true (testnet only)
/// @dev Same interface as the real HonkVerifier generated by bb.js getSolidityVerifier().
///      Used when MOCK_HONK_VERIFIER=true to enable E2E testing with dummy proofs.
contract MockHonkVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock debate_weight verifier — always returns true (testnet only)
/// @dev Implements IDebateWeightVerifier: verify(bytes calldata, bytes32[] calldata) external returns (bool)
///      `pure` satisfies the `view` mutability in the interface (more restrictive is compatible).
///      The real DebateWeightVerifier.sol (bb.js getSolidityVerifier()) uses the same signature.
contract MockDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock position_note verifier — always returns true (testnet only)
/// @dev Implements IPositionNoteVerifier: verify(bytes calldata, bytes32[] calldata) external returns (bool)
///      `pure` satisfies the `view` mutability in the interface (more restrictive is compatible).
///      The real PositionNoteVerifier.sol (bb.js getSolidityVerifier()) uses the same signature.
contract MockPositionNoteVerifier is IPositionNoteVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock AI evaluation registry — always registered, sensible defaults (testnet only)
contract MockAIEvaluationRegistry is IAIEvaluationRegistry {
    function isRegistered(address) external pure returns (bool) { return true; }
    function quorum() external pure returns (uint256) { return 3; }
    function modelCount() external pure returns (uint256) { return 5; }
    function aiWeight() external pure returns (uint256) { return 4000; }
    function minProviders() external pure returns (uint256) { return 3; }
    function providerCount() external pure returns (uint256) { return 5; }
}

/// @notice Mock ERC-20 token (tUSDC, 6 decimals) — testnet only
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
