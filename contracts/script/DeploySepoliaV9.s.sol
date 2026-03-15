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
import {MockHonkVerifier, MockDebateWeightVerifier, MockPositionNoteVerifier, MockAIEvaluationRegistry, MockERC20} from "./DeploySepoliaV6.s.sol";

/// @title Deploy V9 to Scroll Sepolia — Full Stack with DebateMarket (USDC + Protocol Fee)
/// @notice Fresh genesis deployment including three-tree registries + DebateMarket.
///         Supersedes V8 deployment. Same constructor, same staking model.
///
/// WHAT'S NEW vs V8:
///   - ArgumentSubmitted event now emits nullifier (bytes32) as 7th field.
///     Enables off-chain nullifier→argument mapping from event logs (audit trail).
///     No storage layout change. ABI-breaking (new event signature).
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY             — Deployer private key (funded with Scroll Sepolia ETH)
///   VERIFIER_ADDRESS_20     — Pre-deployed HonkVerifier for depth 20 (or VERIFIER_ADDRESS)
///
/// USAGE:
///   cd contracts
///   forge script script/DeploySepoliaV9.s.sol:DeploySepoliaV9 \
///     --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --verify --slow
contract DeploySepoliaV9 is Script {
    uint256 constant SCROLL_SEPOLIA_CHAIN_ID = 534351;

    function run() external {
        require(
            block.chainid == SCROLL_SEPOLIA_CHAIN_ID,
            "WRONG NETWORK: Must deploy to Scroll Sepolia (chainId 534351)"
        );

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address verifier20;
        bool useMockHonkVerifier = _tryEnvBool("MOCK_HONK_VERIFIER");
        if (useMockHonkVerifier) {
            verifier20 = address(0);
        } else {
            verifier20 = _tryEnvAddress("VERIFIER_ADDRESS_20");
            if (verifier20 == address(0)) {
                verifier20 = _tryEnvAddress("VERIFIER_ADDRESS");
            }
            require(verifier20 != address(0), "Set VERIFIER_ADDRESS_20, VERIFIER_ADDRESS, or MOCK_HONK_VERIFIER=1");
        }

        console.log("============================================================");
        console.log("  SCROLL SEPOLIA V9 - USDC STAKING + NULLIFIER IN EVENTS");
        console.log("============================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Verifier (depth 20):", verifier20);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        if (useMockHonkVerifier) {
            MockHonkVerifier mockHonk = new MockHonkVerifier();
            verifier20 = address(mockHonk);
            console.log("MockHonkVerifier (always-pass):", verifier20);
        }

        // =====================================================================
        // Core Registries
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

        MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
        console.log("         MockDebateWeightVerifier:", address(dwVerifier));

        MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
        console.log("         MockPositionNoteVerifier:", address(pnVerifier));

        MockAIEvaluationRegistry aiRegistry = new MockAIEvaluationRegistry();
        console.log("         MockAIEvaluationRegistry:", address(aiRegistry));

        MockERC20 stakingToken = new MockERC20("Test USDC", "tUSDC", 6);
        console.log("         MockERC20 (tUSDC):       ", address(stakingToken));

        stakingToken.mint(deployer, 10_000_000e6); // 10M tUSDC

        console.log("[10/10] DebateMarket (USDC staking, 2% fee)...");
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

        console.log("  - Registering two-tree verifier depth 20");
        verifierRegistry.registerVerifier(20, verifier20);
        console.log("  - Registering three-tree verifier depth 20");
        verifierRegistry.registerThreeTreeVerifier(20, verifier20);
        console.log("  - Sealing VerifierRegistry genesis");
        verifierRegistry.sealGenesis();

        console.log("  - Authorizing DistrictGate on NullifierRegistry");
        nullifierRegistry.authorizeCallerGenesis(address(gate));
        console.log("  - Sealing NullifierRegistry genesis");
        nullifierRegistry.sealGenesis();

        console.log("  - Authorizing DistrictGate on CampaignRegistry");
        campaignRegistry.authorizeCaller(address(gate));

        console.log("  - Setting CampaignRegistry on DistrictGate");
        gate.setCampaignRegistryGenesis(address(campaignRegistry));
        console.log("  - Setting registries (UserRoot + CellMap)");
        gate.setRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        console.log("  - Setting EngagementRootRegistry");
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        console.log("  - Authorizing DebateMarket as derived-domain deriver");
        gate.authorizeDeriverGenesis(address(debateMarket));

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
        console.log("  V9 DEPLOYMENT COMPLETE - SCROLL SEPOLIA");
        console.log("  (USDC staking + nullifier in ArgumentSubmitted event)");
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
