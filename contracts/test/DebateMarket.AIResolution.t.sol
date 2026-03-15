// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DebateMarket.sol";
import "../src/AIEvaluationRegistry.sol";
import "../src/IAIEvaluationRegistry.sol";
import "../src/IDebateWeightVerifier.sol";
import "../src/IPositionNoteVerifier.sol";
import "../src/TimelockGovernance.sol";
import "../src/NullifierRegistry.sol";

/// @title DebateMarket AI Resolution Tests
/// @notice Tests for Phase 3: AI evaluation submission, α-blended resolution,
///         governance override, and appeal mechanism.
/// @dev Uses real AIEvaluationRegistry and real EIP-712 signatures (vm.sign).
///      Mock architecture matches existing test files.
contract DebateMarketAIResolutionTest is Test {
	DebateMarket public market;
	AIEvaluationRegistry public registry;
	MockDistrictGate public mockGate;
	NullifierRegistry public nullifierRegistry;
	MockERC20 public token;

	address public governance = address(0x1);
	address public proposer = address(0x10);
	address public arguer1 = address(0x20);
	address public arguer2 = address(0x30);
	address public arguer3 = address(0x40);
	address public appealer = address(0x70);

	// Model signer private keys (for vm.sign)
	uint256 constant MODEL_KEY_1 = 0xA001;
	uint256 constant MODEL_KEY_2 = 0xA002;
	uint256 constant MODEL_KEY_3 = 0xA003;
	uint256 constant MODEL_KEY_4 = 0xA004;
	uint256 constant MODEL_KEY_5 = 0xA005;

	address public model1;
	address public model2;
	address public model3;
	address public model4;
	address public model5;

	bytes32 public constant ACTION_DOMAIN = keccak256("debate-housing-2026");
	bytes32 public constant PROPOSITION_HASH = keccak256("Should we increase housing density?");

	bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x2000));
	bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x3000));
	bytes32 public constant NULLIFIER_3 = bytes32(uint256(0x4000));

	uint256 public constant STANDARD_DURATION = 4 days;
	uint256 public constant STANDARD_BOND = 5e6;
	uint256 public constant STANDARD_STAKE = 2e6;
	uint256 public constant JURISDICTION_SIZE = 700_000;

	bytes public constant DUMMY_PROOF = hex"deadbeef";
	uint8 public constant VERIFIER_DEPTH = 20;

	// Events
	event AIEvaluationSubmitted(bytes32 indexed debateId, uint256 signatureCount, uint256 nonce);
	event DebateResolvedWithAI(
		bytes32 indexed debateId,
		uint256 winningArgumentIndex,
		uint256 aiScore,
		uint256 communityScore,
		uint256 finalScore,
		uint8 resolutionMethod
	);
	event GovernanceResolutionSubmitted(bytes32 indexed debateId, uint256 winningIndex, bytes32 justification);
	event ResolutionAppealed(bytes32 indexed debateId, address indexed appealer, uint256 bond);
	event AppealFinalized(bytes32 indexed debateId, bool upheld);

	function setUp() public {
		// Derive model addresses from private keys
		model1 = vm.addr(MODEL_KEY_1);
		model2 = vm.addr(MODEL_KEY_2);
		model3 = vm.addr(MODEL_KEY_3);
		model4 = vm.addr(MODEL_KEY_4);
		model5 = vm.addr(MODEL_KEY_5);

		// Deploy NullifierRegistry + MockDistrictGate
		nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
		mockGate = new MockDistrictGate(address(nullifierRegistry));

		vm.prank(governance);
		nullifierRegistry.proposeCallerAuthorization(address(mockGate));
		vm.warp(block.timestamp + 7 days);
		nullifierRegistry.executeCallerAuthorization(address(mockGate));

		mockGate.setActionDomainAllowed(ACTION_DOMAIN, true);

		// Deploy AIEvaluationRegistry
		registry = new AIEvaluationRegistry(governance, 7 days);

		// Register 5 models from 5 providers
		vm.startPrank(governance);
		registry.registerModel(model1, 0); // OpenAI
		registry.registerModel(model2, 1); // Google
		registry.registerModel(model3, 2); // DeepSeek
		registry.registerModel(model4, 3); // Mistral
		registry.registerModel(model5, 4); // Anthropic
		vm.stopPrank();

		token = new MockERC20("Test USD", "TUSD", 6);

		// Deploy verifiers + DebateMarket
		MockDebateWeightVerifier dwVerifier = new MockDebateWeightVerifier();
		MockPositionNoteVerifier pnVerifier = new MockPositionNoteVerifier();
		market = new DebateMarket(
			address(mockGate),
			address(dwVerifier),
			address(pnVerifier),
			address(registry),
			governance,
			address(token),
			200
		);
		mockGate.setDeriverAuthorized(address(market), true);

		address[5] memory participants = [proposer, arguer1, arguer2, arguer3, appealer];
		for (uint256 i = 0; i < participants.length; i++) {
			token.mint(participants[i], 10_000e6);
			vm.prank(participants[i]);
			token.approve(address(market), type(uint256).max);
		}

		// Set resolution extension to minimum for test efficiency (R2-F01 grace period)
		vm.prank(governance);
		market.setResolutionExtension(1 days);
		vm.prank(governance);
		market.setMinParticipants(1);
	}

	// ============================================================================
	// REGISTRY TESTS
	// ============================================================================

	function test_registerModel() public view {
		assertTrue(registry.isRegistered(model1));
		assertTrue(registry.isRegistered(model2));
		assertEq(registry.modelCount(), 5);
	}

	function test_removeModel() public {
		vm.prank(governance);
		registry.removeModel(model5);
		assertFalse(registry.isRegistered(model5));
		assertEq(registry.modelCount(), 4);
	}

	function test_removeModel_revert_minModels() public {
		vm.startPrank(governance);
		registry.removeModel(model5);
		registry.removeModel(model4);
		// Now at 3 — removing another should revert
		vm.expectRevert(AIEvaluationRegistry.BelowMinModels.selector);
		registry.removeModel(model3);
		vm.stopPrank();
	}

	function test_removeModel_revert_minProviders() public {
		// Register a second model on provider 0, then remove model2 (provider 1) and model3 (provider 2)
		// should eventually fail on provider diversity
		vm.startPrank(governance);
		address extra = address(0xBBBB);
		registry.registerModel(extra, 0); // second OpenAI model
		// Now 6 models, 5 providers. Remove model2 (Google) → 5 models, 4 providers. OK.
		registry.removeModel(model2);
		// Remove model3 (DeepSeek) → 4 models, 3 providers. OK.
		registry.removeModel(model3);
		// Remove model4 (Mistral) → 3 models, 2 providers → should fail
		vm.expectRevert(AIEvaluationRegistry.BelowMinProviders.selector);
		registry.removeModel(model4);
		vm.stopPrank();
	}

	function test_quorum_calculation() public view {
		// 5 models → ceil(10/3) = 4
		assertEq(registry.quorum(), 4);
	}

	function test_quorum_3models() public {
		vm.startPrank(governance);
		registry.removeModel(model5);
		registry.removeModel(model4);
		vm.stopPrank();
		// 3 models → ceil(6/3) = 2
		assertEq(registry.quorum(), 2);
	}

	function test_setAIWeight_capped() public {
		vm.prank(governance);
		vm.expectRevert(AIEvaluationRegistry.WeightExceedsMax.selector);
		registry.setAIWeight(7001);
	}

	function test_setAIWeight_success() public {
		vm.prank(governance);
		registry.setAIWeight(5000);
		assertEq(registry.aiWeight(), 5000);
	}

	function test_onlyGovernance_registerModel() public {
		vm.prank(arguer1);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		registry.registerModel(address(0xDEAD), 0);
	}

	function test_providerCount() public view {
		assertEq(registry.providerCount(), 5);
	}

	// ============================================================================
	// AI SUBMISSION TESTS
	// ============================================================================

	function test_submitAIEvaluation_happyPath() public {
		bytes32 debateId = _createDebateWithArguments();

		// Advance past deadline
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// Pack scores: arg0 scores high, arg1 lower, arg2 medium
		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000); // strong
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000); // weak
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000); // medium

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);

		vm.expectEmit(true, false, false, true);
		emit AIEvaluationSubmitted(debateId, 5, 0);

		market.submitAIEvaluation(debateId, scores, deadline, sigs);

		// Verify state
		(,,,,,,,,,,, DebateMarket.DebateStatus status,,,,
		 bool aiSubmitted,,,,,) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVING));
		assertTrue(aiSubmitted);
		assertEq(market.aiSignatureCount(debateId), 5);
	}

	function test_submitAIEvaluation_revert_beforeDeadline() public {
		bytes32 debateId = _createDebateWithArguments();

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);

		vm.expectRevert(DebateMarket.DebateStillActive.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
	}

	function test_submitAIEvaluation_revert_insufficientSigs() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;

		// Only sign with 2 models (need 4)
		bytes[] memory sigs = new bytes[](2);
		bytes32 digest = _computeDigest(debateId, scores, 0, deadline);
		(uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(MODEL_KEY_1, digest);
		sigs[0] = abi.encodePacked(r1, s1, v1);
		(uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(MODEL_KEY_2, digest);
		sigs[1] = abi.encodePacked(r2, s2, v2);

		vm.expectRevert(DebateMarket.InsufficientSignatures.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
	}

	function test_submitAIEvaluation_revert_duplicateSigner() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes32 digest = _computeDigest(debateId, scores, 0, deadline);

		// Sign 5 times with same key
		bytes[] memory sigs = new bytes[](5);
		for (uint256 i = 0; i < 5; i++) {
			(uint8 v, bytes32 r, bytes32 s) = vm.sign(MODEL_KEY_1, digest);
			sigs[i] = abi.encodePacked(r, s, v);
		}

		// Only 1 unique signer, need 4
		vm.expectRevert(DebateMarket.InsufficientSignatures.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
	}

	function test_submitAIEvaluation_revert_alreadySubmitted() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);

		// Second submission should revert — status is now RESOLVING, not ACTIVE
		bytes[] memory sigs2 = _signEvaluation(debateId, scores, 1, deadline);
		vm.expectRevert(DebateMarket.DebateNotActive.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs2);
	}

	function test_submitAIEvaluation_revert_expiredSignatureDeadline() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		// Deadline in the past
		uint256 deadline = block.timestamp - 1;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);

		vm.expectRevert(DebateMarket.SignatureExpired.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
	}

	function test_submitAIEvaluation_revert_unregisteredSigner() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes32 digest = _computeDigest(debateId, scores, 0, deadline);

		// Sign with unregistered keys
		uint256[5] memory fakeKeys = [uint256(0xF001), uint256(0xF002), uint256(0xF003), uint256(0xF004), uint256(0xF005)];
		bytes[] memory sigs = new bytes[](5);
		for (uint256 i = 0; i < 5; i++) {
			(uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeKeys[i], digest);
			sigs[i] = abi.encodePacked(r, s, v);
		}

		vm.expectRevert(DebateMarket.InsufficientSignatures.selector);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
	}

	// ============================================================================
	// SCORE PACKING TESTS
	// ============================================================================

	function test_packScores_roundTrip() public pure {
		uint256 packed = _packScores(8500, 7200, 6300, 5100, 4000);
		assertEq((packed >> 64) & 0xFFFF, 8500);
		assertEq((packed >> 48) & 0xFFFF, 7200);
		assertEq((packed >> 32) & 0xFFFF, 6300);
		assertEq((packed >> 16) & 0xFFFF, 5100);
		assertEq(packed & 0xFFFF, 4000);
	}

	function test_computeWeightedAIScore_knownValues() public pure {
		// reasoning=8000(w=0.3), accuracy=7000(w=0.25), evidence=6000(w=0.2),
		// constructiveness=5000(w=0.15), feasibility=4000(w=0.1)
		// = (8000*3000 + 7000*2500 + 6000*2000 + 5000*1500 + 4000*1000) / 10000
		// = (24000000 + 17500000 + 12000000 + 7500000 + 4000000) / 10000
		// = 65000000 / 10000 = 6500
		uint256 packed = _packScores(8000, 7000, 6000, 5000, 4000);
		uint256 weighted = _computeWeightedAIScoreTest(packed);
		assertEq(weighted, 6500);
	}

	function test_computeWeightedAIScore_maxValues() public pure {
		uint256 packed = _packScores(10000, 10000, 10000, 10000, 10000);
		uint256 weighted = _computeWeightedAIScoreTest(packed);
		assertEq(weighted, 10000);
	}

	function test_computeWeightedAIScore_zeroValues() public pure {
		uint256 packed = _packScores(0, 0, 0, 0, 0);
		uint256 weighted = _computeWeightedAIScoreTest(packed);
		assertEq(weighted, 0);
	}

	// ============================================================================
	// RESOLUTION TESTS
	// ============================================================================

	function test_resolveDebateWithAI_happyPath() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// arg0: AI=high, community=low
		// arg1: AI=low, community=high
		// arg2: AI=medium, community=medium
		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(9000, 8500, 8000, 7500, 7000); // AI score high
		scores[1] = _packScores(3000, 2500, 2000, 1500, 1000); // AI score low
		scores[2] = _packScores(6000, 5500, 5000, 4500, 4000); // AI score medium

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);

		market.resolveDebateWithAI(debateId);

		(,,,,,,, uint256 winIdx,,,,
		 DebateMarket.DebateStatus status,,,,
		 ,,,,uint8 method,) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
		assertEq(method, 1); // ai_community
		// arg0 should win: highest AI + decent community (2e6 stake, tier 3)
		assertEq(winIdx, 0);
	}

	function test_resolveDebateWithAI_communityDominates() public {
		// Set α to minimum (10% AI) — community should dominate
		vm.prank(governance);
		registry.setAIWeight(1000); // 10% AI

		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// AI favors arg1, but community strongly favors arg0
		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(2000, 2000, 2000, 2000, 2000); // AI: weak
		scores[1] = _packScores(9000, 9000, 9000, 9000, 9000); // AI: strong
		scores[2] = _packScores(5000, 5000, 5000, 5000, 5000); // AI: medium

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);

		market.resolveDebateWithAI(debateId);

		// Community scores: arg0 has highest weighted score from setUp
		// With α=0.1, community should dominate
		(,,,,,,, uint256 winIdx,,,,,,,,,,,,, ) = market.debates(debateId);
		// arg0: community is highest (arguer1 tier 3, stake 2e6 → weight = sqrt(1_960_000)*8)
		assertEq(winIdx, 0);
	}

	function test_resolveDebateWithAI_aiFlipsCommunity() public {
		// Set α to maximum (70% AI) — AI should be able to flip community
		vm.prank(governance);
		registry.setAIWeight(7000); // 70% AI

		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// AI strongly favors arg1, community favors arg0
		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(1000, 1000, 1000, 1000, 1000); // AI: terrible
		scores[1] = _packScores(10000, 10000, 10000, 10000, 10000); // AI: perfect
		scores[2] = _packScores(3000, 3000, 3000, 3000, 3000); // AI: weak

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);

		market.resolveDebateWithAI(debateId);

		(,,,,,,, uint256 winIdx,,,,,,,,,,,,, ) = market.debates(debateId);
		// At 70% AI weight, perfect AI score on arg1 should flip the community leader
		assertEq(winIdx, 1);
	}

	function test_resolveDebateWithAI_tieBreaking() public {
		bytes32 debateId = _createDebateWithEqualArguments();

		// Warp past debate deadline (via_ir warp fix: explicit variable)
		uint256 postDeadlineTs = block.timestamp + STANDARD_DURATION + 1;
		vm.warp(postDeadlineTs);

		// Give all arguments identical AI scores
		uint256[] memory scores = new uint256[](2);
		scores[0] = _packScores(5000, 5000, 5000, 5000, 5000);
		scores[1] = _packScores(5000, 5000, 5000, 5000, 5000);

		// via_ir warp fix: compute deadline from explicit variable, not block.timestamp
		uint256 sigDeadline = postDeadlineTs + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, sigDeadline);
		market.submitAIEvaluation(debateId, scores, sigDeadline, sigs);

		market.resolveDebateWithAI(debateId);

		// Tie goes to lower index (first-mover)
		(,,,,,,, uint256 winIdx,,,,,,,,,,,,, ) = market.debates(debateId);
		assertEq(winIdx, 0);
	}

	function test_resolveDebateWithAI_revert_noAIScores() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// Try to resolve without submitting AI scores
		vm.expectRevert(DebateMarket.DebateNotResolving.selector);
		market.resolveDebateWithAI(debateId);
	}

	function test_resolveDebateWithAI_revert_alreadyResolved() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(8000, 7500, 8000, 7000, 6000);
		scores[1] = _packScores(5000, 4000, 3000, 4000, 3000);
		scores[2] = _packScores(7000, 6500, 7000, 6000, 5000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
		market.resolveDebateWithAI(debateId);

		// Second resolution should fail
		vm.expectRevert(DebateMarket.DebateNotResolving.selector);
		market.resolveDebateWithAI(debateId);
	}

	// ============================================================================
	// GOVERNANCE OVERRIDE TESTS
	// ============================================================================

	function test_escalateToGovernance() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		vm.prank(governance);
		market.escalateToGovernance(debateId);

		(,,,,,,,,,,, DebateMarket.DebateStatus status,,,,
		 , uint256 resDl,,,,) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.AWAITING_GOVERNANCE));
		assertEq(resDl, block.timestamp + 1 days);
	}

	function test_escalateToGovernance_revert_beforeDeadline() public {
		bytes32 debateId = _createDebateWithArguments();
		// Don't advance past deadline
		vm.prank(governance);
		vm.expectRevert(DebateMarket.DebateStillActive.selector);
		market.escalateToGovernance(debateId);
	}

	function test_submitGovernanceResolution() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		bytes32 justification = keccak256("AI models disagreed on factual claims");

		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, justification);

		(,,,,,,, uint256 winIdx,,,,
		 DebateMarket.DebateStatus status,,,,
		 ,, uint256 appealDl, bytes32 storedJust, uint8 method,) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.UNDER_APPEAL));
		assertEq(winIdx, 1);
		assertEq(method, 2); // governance_override
		assertEq(storedJust, justification);
		assertEq(appealDl, block.timestamp + 7 days);
	}

	function test_submitGovernanceResolution_revert_nonGovernance() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		vm.prank(arguer1);
		vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
		market.submitGovernanceResolution(debateId, 0, bytes32(0));
	}

	function test_submitGovernanceResolution_revert_wrongStatus() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		// Don't escalate — debate is still ACTIVE

		vm.prank(governance);
		vm.expectRevert(DebateMarket.DebateNotAwaitingGovernance.selector);
		market.submitGovernanceResolution(debateId, 0, bytes32(0));
	}

	// ============================================================================
	// APPEAL TESTS
	// ============================================================================

	function test_appealResolution() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, keccak256("reason"));

		uint256 requiredBond = STANDARD_BOND * 2; // 2× proposer bond

		vm.prank(appealer);
		market.appealResolution(debateId);

		assertEq(market.appealBonds(debateId, appealer), requiredBond);
		assertTrue(market.hasAppeal(debateId));
	}

	function test_appealResolution_revert_windowExpired() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, keccak256("reason"));

		// Advance past appeal window
		vm.warp(block.timestamp + 7 days + 1);

		vm.prank(appealer);
		vm.expectRevert(DebateMarket.AppealWindowExpired.selector);
		market.appealResolution(debateId);
	}

	function test_finalizeAppeal_noAppeal() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, keccak256("reason"));

		// Advance past appeal window without filing appeal
		vm.warp(block.timestamp + 7 days + 1);

		vm.expectEmit(true, false, false, true);
		emit AppealFinalized(debateId, true);

		market.finalizeAppeal(debateId);

		(,,,,,,,,,,, DebateMarket.DebateStatus status,,,,,,,,, ) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
	}

	function test_finalizeAppeal_revert_windowActive() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, keccak256("reason"));

		// Don't advance past appeal window
		vm.expectRevert(DebateMarket.AppealWindowActive.selector);
		market.finalizeAppeal(debateId);
	}

	// ============================================================================
	// INTEGRATION TESTS
	// ============================================================================

	function test_fullLifecycle_aiResolve_settle() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// Submit AI evaluation (arg0 wins)
		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(9000, 8500, 8000, 7500, 7000);
		scores[1] = _packScores(3000, 2500, 2000, 1500, 1000);
		scores[2] = _packScores(5000, 4500, 4000, 3500, 3000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
		market.resolveDebateWithAI(debateId);

		// arguer1 (arg0 winner) claims settlement
		uint256 balanceBefore = token.balanceOf(arguer1);
		vm.prank(arguer1);
		market.claimSettlement(debateId, NULLIFIER_1);
		uint256 balanceAfter = token.balanceOf(arguer1);
		assertTrue(balanceAfter > balanceBefore, "Winner should receive payout");
	}

	function test_fullLifecycle_governanceOverride_settle() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// AI consensus fails → escalate
		vm.prank(governance);
		market.escalateToGovernance(debateId);

		// Governance resolves with arg1 winning
		vm.prank(governance);
		market.submitGovernanceResolution(debateId, 1, keccak256("manual review"));

		// No appeal filed → finalize after window
		vm.warp(block.timestamp + 7 days + 1);
		market.finalizeAppeal(debateId);

		// arguer2 (arg1 winner) claims settlement
		uint256 balanceBefore = token.balanceOf(arguer2);
		vm.prank(arguer2);
		market.claimSettlement(debateId, NULLIFIER_2);
		uint256 balanceAfter = token.balanceOf(arguer2);
		assertTrue(balanceAfter > balanceBefore, "Winner should receive payout");
	}

	function test_existingResolveDebate_stillWorks() public {
		bytes32 debateId = _createDebateWithArguments();
		// Must warp past deadline + resolutionExtension (R2-F01 grace period)
		vm.warp(block.timestamp + STANDARD_DURATION + 1 days + 1);

		// Old path: resolveDebate (pure community signal) still works after grace period
		market.resolveDebate(debateId);

		(,,,,,,,,,,, DebateMarket.DebateStatus status,,,,,,,,, ) = market.debates(debateId);
		assertEq(uint8(status), uint8(DebateMarket.DebateStatus.RESOLVED));
	}

	function test_settlement_uses_aiResolution_winner() public {
		bytes32 debateId = _createDebateWithArguments();
		vm.warp(block.timestamp + STANDARD_DURATION + 1);

		// AI picks arg1 as winner (different from what community would pick)
		vm.prank(governance);
		registry.setAIWeight(7000);

		uint256[] memory scores = new uint256[](3);
		scores[0] = _packScores(1000, 1000, 1000, 1000, 1000);
		scores[1] = _packScores(10000, 10000, 10000, 10000, 10000);
		scores[2] = _packScores(1000, 1000, 1000, 1000, 1000);

		uint256 deadline = block.timestamp + 1 hours;
		bytes[] memory sigs = _signEvaluation(debateId, scores, 0, deadline);
		market.submitAIEvaluation(debateId, scores, deadline, sigs);
		market.resolveDebateWithAI(debateId);

		// arguer1 (arg0) should NOT be able to claim (arg1 won)
		vm.prank(arguer1);
		vm.expectRevert(DebateMarket.NotWinningSide.selector);
		market.claimSettlement(debateId, NULLIFIER_1);

		// arguer2 (arg1) SHOULD be able to claim
		vm.prank(arguer2);
		market.claimSettlement(debateId, NULLIFIER_2);
	}

	// ============================================================================
	// HELPERS
	// ============================================================================

	/// @dev Create a debate with 3 arguments, each with different stakes/tiers
	function _createDebateWithArguments() internal returns (bytes32 debateId) {
		// Propose debate
		vm.prank(proposer);
		debateId = market.proposeDebate(
			PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
		);

		// Build public inputs array
		bytes32 debateActionDomain = market.deriveDomain(ACTION_DOMAIN, PROPOSITION_HASH);

		// Argument 0: arguer1, SUPPORT, tier 3, stake STANDARD_STAKE
		uint256[31] memory pi1;
		pi1[27] = uint256(debateActionDomain);
		pi1[26] = uint256(NULLIFIER_1);
		pi1[30] = 3; // tier
		vm.prank(arguer1);
		market.submitArgument(
			debateId,
			DebateMarket.Stance.SUPPORT,
			keccak256("Strong argument for density"),
			bytes32(0),
			STANDARD_STAKE,
			arguer1,
			DUMMY_PROOF,
			pi1,
			VERIFIER_DEPTH,
			block.timestamp + 1 hours,
			"",
		address(0)
);

		// Argument 1: arguer2, OPPOSE, tier 2, stake 3e6
		uint256[31] memory pi2;
		pi2[27] = uint256(debateActionDomain);
		pi2[26] = uint256(NULLIFIER_2);
		pi2[30] = 2; // tier
		vm.prank(arguer2);
		market.submitArgument(
			debateId,
			DebateMarket.Stance.OPPOSE,
			keccak256("Counter argument against density"),
			bytes32(0),
			3e6,
			arguer2,
			DUMMY_PROOF,
			pi2,
			VERIFIER_DEPTH,
			block.timestamp + 1 hours,
			"",
		address(0)
);

		// Argument 2: arguer3, AMEND, tier 1, stake MIN_PROPOSER_BOND
		uint256[31] memory pi3;
		pi3[27] = uint256(debateActionDomain);
		pi3[26] = uint256(NULLIFIER_3);
		pi3[30] = 1; // tier
		vm.prank(arguer3);
		market.submitArgument(
			debateId,
			DebateMarket.Stance.AMEND,
			keccak256("Amendment: add displacement data"),
			keccak256("Add census displacement statistics"),
			MIN_PROPOSER_BOND,
			arguer3,
			DUMMY_PROOF,
			pi3,
			VERIFIER_DEPTH,
			block.timestamp + 1 hours,
			"",
		address(0)
);
	}

	/// @dev Create a debate with 2 arguments that have identical community scores
	function _createDebateWithEqualArguments() internal returns (bytes32 debateId) {
		vm.prank(proposer);
		debateId = market.proposeDebate(
			PROPOSITION_HASH, STANDARD_DURATION, JURISDICTION_SIZE, ACTION_DOMAIN, STANDARD_BOND
		);

		bytes32 debateActionDomain = market.deriveDomain(ACTION_DOMAIN, PROPOSITION_HASH);

		// Both args: same tier, same stake → same community score
		uint256[31] memory pi1;
		pi1[27] = uint256(debateActionDomain);
		pi1[26] = uint256(NULLIFIER_1);
		pi1[30] = 2;
		vm.prank(arguer1);
		market.submitArgument(
			debateId, DebateMarket.Stance.SUPPORT, keccak256("arg1"), bytes32(0),
			STANDARD_STAKE, arguer1, DUMMY_PROOF, pi1, VERIFIER_DEPTH, block.timestamp + 1 hours, "",
		address(0)
);

		uint256[31] memory pi2;
		pi2[27] = uint256(debateActionDomain);
		pi2[26] = uint256(NULLIFIER_2);
		pi2[30] = 2;
		vm.prank(arguer2);
		market.submitArgument(
			debateId, DebateMarket.Stance.OPPOSE, keccak256("arg2"), bytes32(0),
			STANDARD_STAKE, arguer2, DUMMY_PROOF, pi2, VERIFIER_DEPTH, block.timestamp + 1 hours, "",
		address(0)
);
	}

	/// @dev Pack 5 dimension scores into a single uint256
	function _packScores(
		uint16 reasoning, uint16 accuracy, uint16 evidence,
		uint16 constructiveness, uint16 feasibility
	) internal pure returns (uint256) {
		return (uint256(reasoning) << 64)
			| (uint256(accuracy) << 48)
			| (uint256(evidence) << 32)
			| (uint256(constructiveness) << 16)
			| uint256(feasibility);
	}

	/// @dev Mirror of DebateMarket._computeWeightedAIScore for test assertions
	function _computeWeightedAIScoreTest(uint256 packed) internal pure returns (uint256) {
		uint256 reasoning        = (packed >> 64) & 0xFFFF;
		uint256 accuracy         = (packed >> 48) & 0xFFFF;
		uint256 evidence         = (packed >> 32) & 0xFFFF;
		uint256 constructiveness = (packed >> 16) & 0xFFFF;
		uint256 feasibility      = packed & 0xFFFF;
		return (reasoning * 3000 + accuracy * 2500 + evidence * 2000
		      + constructiveness * 1500 + feasibility * 1000) / 10000;
	}

	/// @dev Compute EIP-712 digest for AI evaluation
	function _computeDigest(
		bytes32 debateId,
		uint256[] memory packedScores,
		uint256 nonce,
		uint256 deadline
	) internal view returns (bytes32) {
		bytes32 structHash = keccak256(
			abi.encode(
				market.AI_EVALUATION_TYPEHASH(),
				debateId,
				keccak256(abi.encodePacked(packedScores)),
				nonce,
				deadline
			)
		);
		return keccak256(
			abi.encodePacked("\x19\x01", market.AI_EVAL_DOMAIN_SEPARATOR(), structHash)
		);
	}

	/// @dev Sign an AI evaluation with all 5 model keys
	function _signEvaluation(
		bytes32 debateId,
		uint256[] memory scores,
		uint256 nonce,
		uint256 deadline
	) internal view returns (bytes[] memory sigs) {
		bytes32 digest = _computeDigest(debateId, scores, nonce, deadline);
		uint256[5] memory keys = [MODEL_KEY_1, MODEL_KEY_2, MODEL_KEY_3, MODEL_KEY_4, MODEL_KEY_5];
		sigs = new bytes[](5);

		for (uint256 i = 0; i < 5; i++) {
			(uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
			sigs[i] = abi.encodePacked(r, s, v);
		}
	}

	uint256 public constant MIN_PROPOSER_BOND = 1e6;
}

// ============================================================================
// Mocks (same pattern as other test files)
// ============================================================================

contract MockDistrictGate {
	NullifierRegistry public nullifierRegistry;
	mapping(bytes32 => bool) public allowedActionDomains;
	mapping(address => bool) public deriverAuthorized;

	constructor(address _nullifierRegistry) {
		nullifierRegistry = NullifierRegistry(_nullifierRegistry);
	}

	function setActionDomainAllowed(bytes32 domain, bool allowed) external {
		allowedActionDomains[domain] = allowed;
	}

	function setDeriverAuthorized(address deriver, bool authorized) external {
		deriverAuthorized[deriver] = authorized;
	}

	function verifyThreeTreeProof(
		address,
		bytes calldata,
		uint256[31] calldata publicInputs,
		uint8,
		uint256,
		bytes calldata
	) external {
		bytes32 nullifier = bytes32(publicInputs[26]);
		bytes32 actionDomain = bytes32(publicInputs[27]);
		bytes32 userRoot = bytes32(publicInputs[0]);
		nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);
	}

	function registerDerivedDomain(bytes32, bytes32 derivedDomain) external {
		require(deriverAuthorized[msg.sender], "Not authorized");
		allowedActionDomains[derivedDomain] = true;
	}
}

contract MockDebateWeightVerifier is IDebateWeightVerifier {
	function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
		return true;
	}
}

contract MockPositionNoteVerifier is IPositionNoteVerifier {
	function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
		return true;
	}
}

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
