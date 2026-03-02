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

/// @title Deploy V5 to Scroll Sepolia — Full Stack with DebateMarket
/// @notice Fresh genesis deployment including three-tree registries + DebateMarket.
///         Supersedes v4 deployment (7 contracts) with 10 contracts + 3 mocks.
///
/// PURPOSE: End-to-end testnet debugging of the full debate flow.
///          Uses mock verifiers and mock ERC-20 — not production.
///
/// WHAT'S NEW vs v4 (DeployScrollSepolia.s.sol):
///   - EngagementRootRegistry (Tree 3 — required for three-tree proofs)
///   - MockERC20 (staking token for DebateMarket)
///   - MockDebateWeightVerifier + MockPositionNoteVerifier (always-pass)
///   - DebateMarket (staked deliberation protocol)
///   - DebateMarket authorized as derived-domain deriver during genesis
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY             — Deployer private key (funded with Scroll Sepolia ETH)
///   VERIFIER_ADDRESS_20     — Pre-deployed HonkVerifier for depth 20 (or VERIFIER_ADDRESS)
///
/// USAGE:
///   cd contracts
///   forge script script/DeploySepoliaV5.s.sol:DeploySepoliaV5 \
///     --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --verify --slow
contract DeploySepoliaV5 is Script {
    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;

    function run() external {
        require(
            block.chainid == SCROLL_SEPOLIA_CHAIN_ID,
            "WRONG NETWORK: Must deploy to Scroll Sepolia (chainId 534351)"
        );

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Resolve verifier address (at least depth 20 required)
        address verifier20 = _tryEnvAddress("VERIFIER_ADDRESS_20");
        if (verifier20 == address(0)) {
            verifier20 = _tryEnvAddress("VERIFIER_ADDRESS");
        }
        require(verifier20 != address(0), "Set VERIFIER_ADDRESS_20 or VERIFIER_ADDRESS");

        console.log("============================================================");
        console.log("  SCROLL SEPOLIA V5 - FULL STACK WITH DEBATE MARKET");
        console.log("============================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Verifier (depth 20):", verifier20);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // =====================================================================
        // Core Registries (same as v4)
        // =====================================================================

        console.log("[1/10] DistrictRegistry...");
        DistrictRegistry districtRegistry = new DistrictRegistry(deployer);
        console.log("        ", address(districtRegistry));

        console.log("[2/10] NullifierRegistry...");
        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer);
        console.log("        ", address(nullifierRegistry));

        console.log("[3/10] VerifierRegistry...");
        VerifierRegistry verifierRegistry = new VerifierRegistry(deployer);
        console.log("        ", address(verifierRegistry));

        console.log("[4/10] DistrictGate...");
        DistrictGate gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            deployer
        );
        console.log("        ", address(gate));

        console.log("[5/10] CampaignRegistry...");
        CampaignRegistry campaignRegistry = new CampaignRegistry(deployer);
        console.log("        ", address(campaignRegistry));

        console.log("[6/10] UserRootRegistry...");
        UserRootRegistry userRootRegistry = new UserRootRegistry(deployer);
        console.log("        ", address(userRootRegistry));

        console.log("[7/10] CellMapRegistry...");
        CellMapRegistry cellMapRegistry = new CellMapRegistry(deployer);
        console.log("        ", address(cellMapRegistry));

        // =====================================================================
        // NEW: Three-Tree + Debate Infrastructure
        // =====================================================================

        console.log("[8/10] EngagementRootRegistry...");
        EngagementRootRegistry engagementRootRegistry = new EngagementRootRegistry(deployer);
        console.log("        ", address(engagementRootRegistry));

        console.log("[9/10] Mock tokens + verifiers...");
        MockERC20 stakingToken = new MockERC20("Test USDC", "tUSDC", 6);
        console.log("         MockERC20 (tUSDC):", address(stakingToken));

        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        console.log("         MockDebateWeightVerifier:", address(dwVerifier));

        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        console.log("         MockPositionNoteVerifier:", address(pnVerifier));

        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();
        console.log("         MockAIEvaluationRegistry:", address(aiRegistry));

        console.log("[10/10] DebateMarket...");
        DebateMarket debateMarket = new DebateMarket(
            address(gate),
            address(dwVerifier),
            address(pnVerifier),
            address(aiRegistry),
            deployer,
            address(stakingToken),
            200 // 2% protocol fee
        );
        console.log("         ", address(debateMarket));

        // =====================================================================
        // Genesis Configuration
        // =====================================================================

        console.log("");
        console.log("Genesis configuration...");

        // VerifierRegistry
        console.log("  - Registering verifier depth 20");
        verifierRegistry.registerVerifier(20, verifier20);
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

        // Mint test tokens to deployer (1M tUSDC)
        console.log("  - Minting 1M tUSDC to deployer");
        stakingToken.mint(deployer, 1_000_000e6);

        vm.stopBroadcast();

        // =====================================================================
        // Summary
        // =====================================================================

        console.log("");
        console.log("============================================================");
        console.log("  V5 DEPLOYMENT COMPLETE - SCROLL SEPOLIA");
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
        console.log("  Deployer minted 1M tUSDC");
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
}

// =============================================================================
// Mock Contracts (testnet only — always-pass verifiers + mintable ERC-20)
// =============================================================================

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

/// @notice Mock debate_weight verifier — always returns true (testnet only)
contract MockDebateWeightVerifier is IDebateWeightVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock position_note verifier — always returns true (testnet only)
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
