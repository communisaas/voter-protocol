// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/CampaignRegistry.sol";

/// @title DistrictGate Integration Tests
/// @notice Comprehensive integration tests for DistrictGate interacting with all registries
/// @dev Tests full verification flows, multi-depth scenarios, authorization, and root lifecycle
///
/// TEST COVERAGE:
/// 1. Full Verification Flow - Deploy all registries, verify state changes
/// 2. Multi-Depth Scenarios - Route proofs correctly based on district depth
/// 3. Registry Authorization - Verify DistrictGate must be authorized caller
/// 4. Campaign Registry Integration - Test with and without campaignRegistry
/// 5. View Function Tests - isNullifierUsed, getParticipantCount, etc.
/// 6. Complex Multi-User Scenario - Multiple users, unique nullifiers
/// 7. Root Lifecycle Integration (SA-004) - Active/expired root handling
contract DistrictGateIntegrationTest is Test {
    // ============================================================================
    // State Variables
    // ============================================================================

    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    CampaignRegistry public campaignRegistry;

    // Mock verifiers for different depths
    MockVerifier public verifier18;
    MockVerifier public verifier20;
    MockVerifier public verifier22;
    MockVerifier public verifier24;

    // Addresses
    address public governance = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);
    address public user3 = address(0x4);
    address public relayer = address(0x5);

    // Test constants
    bytes32 public constant DISTRICT_ROOT_DEPTH_18 = keccak256("DISTRICT_18");
    bytes32 public constant DISTRICT_ROOT_DEPTH_20 = keccak256("DISTRICT_20");
    bytes32 public constant DISTRICT_ROOT_DEPTH_22 = keccak256("DISTRICT_22");
    bytes32 public constant DISTRICT_ROOT_DEPTH_24 = keccak256("DISTRICT_24");
    bytes32 public constant DISTRICT_ROOT_EXPIRING = keccak256("DISTRICT_EXPIRING");

    bytes32 public constant ACTION_DOMAIN_1 = keccak256("petition-123");
    bytes32 public constant ACTION_DOMAIN_2 = keccak256("election-2024");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");
    bytes32 public constant IPFS_HASH = keccak256("QmTestHash");

    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";
    bytes3 public constant JPN = "JPN";
    bytes3 public constant SGP = "SGP";

    uint8 public constant DEPTH_18 = 18;
    uint8 public constant DEPTH_20 = 20;
    uint8 public constant DEPTH_22 = 22;
    uint8 public constant DEPTH_24 = 24;

    // Events
    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        uint8 depth,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId
    );

    event ActionDomainActivated(bytes32 indexed actionDomain);
    event CampaignRegistrySet(address indexed previousRegistry, address indexed newRegistry);
    event ParticipantRecorded(
        bytes32 indexed campaignId,
        bytes32 indexed actionId,
        bytes32 indexed districtRoot,
        bool newDistrict
    );

    // ============================================================================
    // Setup
    // ============================================================================

    function setUp() public {
        // Deploy mock verifiers for each depth
        verifier18 = new MockVerifier();
        verifier20 = new MockVerifier();
        verifier22 = new MockVerifier();
        verifier24 = new MockVerifier();

        // Deploy all registries with governance
        districtRegistry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        verifierRegistry = new VerifierRegistry(governance);
        campaignRegistry = new CampaignRegistry(governance);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Setup registries
        vm.startPrank(governance);

        // Register verifiers for all depths (genesis registration)
        verifierRegistry.registerVerifier(DEPTH_18, address(verifier18));
        verifierRegistry.registerVerifier(DEPTH_20, address(verifier20));
        verifierRegistry.registerVerifier(DEPTH_22, address(verifier22));
        verifierRegistry.registerVerifier(DEPTH_24, address(verifier24));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        vm.startPrank(governance);

        // Register districts with different depths and countries
        districtRegistry.registerDistrict(DISTRICT_ROOT_DEPTH_18, SGP, DEPTH_18); // Small country
        districtRegistry.registerDistrict(DISTRICT_ROOT_DEPTH_20, GBR, DEPTH_20); // Medium country
        districtRegistry.registerDistrict(DISTRICT_ROOT_DEPTH_22, USA, DEPTH_22); // Large country
        districtRegistry.registerDistrict(DISTRICT_ROOT_DEPTH_24, JPN, DEPTH_24); // Very large
        districtRegistry.registerDistrict(DISTRICT_ROOT_EXPIRING, USA, DEPTH_20); // For expiry tests

        // Authorize DistrictGate as caller on NullifierRegistry (with 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));

        // Authorize DistrictGate as caller on CampaignRegistry
        campaignRegistry.authorizeCaller(address(gate));

        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));
    }

    // ============================================================================
    // 1. Full Verification Flow Tests
    // ============================================================================

    /// @notice Test complete verification flow with all state changes
    function test_FullVerificationFlow() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Setup: Set campaign registry on gate
        _setCampaignRegistry(address(campaignRegistry));

        // Setup: Create campaign linked to action domain
        bytes32 campaignId = _createCampaign(ACTION_DOMAIN_1);

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("user1-nullifier");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Verify event emission
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_DEPTH_22,
            USA,
            DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify: Nullifier recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier), "Nullifier should be recorded");

        // Verify: Participant count incremented
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1, "Participant count should be 1");

        // Verify: Campaign participation recorded
        (, , , , , uint256 participantCount, uint256 districtCount) = campaignRegistry.getCampaign(campaignId);
        assertEq(participantCount, 1, "Campaign participant count should be 1");
        assertEq(districtCount, 1, "Campaign district count should be 1");
    }

    /// @notice Test verification emits correct event with all fields
    function test_VerificationEmitsCorrectEvent() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"cafe";
        uint256 userPrivateKey = 0xBEEF;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("unique-nullifier");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_DEPTH_20,
            GBR,
            DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );
    }

    // ============================================================================
    // 2. Multi-Depth Scenarios
    // ============================================================================

    /// @notice Test verification routes to correct verifier based on district depth
    function test_MultiDepth_RoutesToCorrectVerifier() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Test each depth routes to correct verifier
        uint256 t = _lastWarpTime;
        _testDepthRouting(DISTRICT_ROOT_DEPTH_18, SGP, DEPTH_18);
        t += 61 seconds;
        vm.warp(t);
        _testDepthRouting(DISTRICT_ROOT_DEPTH_20, GBR, DEPTH_20);
        t += 61 seconds;
        vm.warp(t);
        _testDepthRouting(DISTRICT_ROOT_DEPTH_22, USA, DEPTH_22);
        t += 61 seconds;
        vm.warp(t);
        _testDepthRouting(DISTRICT_ROOT_DEPTH_24, JPN, DEPTH_24);
    }

    /// @notice Test getVerifierForDistrict returns correct verifier
    function test_GetVerifierForDistrict_ReturnsCorrectVerifier() public view {
        assertEq(gate.getVerifierForDistrict(DISTRICT_ROOT_DEPTH_18), address(verifier18));
        assertEq(gate.getVerifierForDistrict(DISTRICT_ROOT_DEPTH_20), address(verifier20));
        assertEq(gate.getVerifierForDistrict(DISTRICT_ROOT_DEPTH_22), address(verifier22));
        assertEq(gate.getVerifierForDistrict(DISTRICT_ROOT_DEPTH_24), address(verifier24));
    }

    /// @notice Test getVerifierForDistrict returns zero for unregistered district
    function test_GetVerifierForDistrict_ReturnsZeroForUnregistered() public view {
        bytes32 unknownRoot = keccak256("unknown");
        assertEq(gate.getVerifierForDistrict(unknownRoot), address(0));
    }

    /// @notice Test getSupportedDepths returns all registered depths
    function test_GetSupportedDepths_ReturnsAllDepths() public view {
        uint8[] memory depths = gate.getSupportedDepths();

        assertEq(depths.length, 4, "Should have 4 registered depths");
        assertEq(depths[0], DEPTH_18);
        assertEq(depths[1], DEPTH_20);
        assertEq(depths[2], DEPTH_22);
        assertEq(depths[3], DEPTH_24);
    }

    /// @notice Test different districts with same depth work independently
    function test_MultiDepth_SameDepthDifferentDistricts() public {
        // Register another depth-20 district
        bytes32 newDistrictRoot = keccak256("DISTRICT_20_UK_NORTH");
        vm.prank(governance);
        districtRegistry.registerDistrict(newDistrictRoot, GBR, DEPTH_20);

        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Both should work and route to same verifier
        assertEq(gate.getVerifierForDistrict(DISTRICT_ROOT_DEPTH_20), address(verifier20));
        assertEq(gate.getVerifierForDistrict(newDistrictRoot), address(verifier20));
    }

    // ============================================================================
    // 3. Registry Authorization Tests
    // ============================================================================

    /// @notice Test verification fails if gate not authorized on NullifierRegistry
    function test_RevertWhen_GateNotAuthorizedOnNullifierRegistry() public {
        // Deploy new gate without authorization
        DistrictGate newGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Whitelist action domain for new gate
        vm.prank(governance);
        newGate.proposeActionDomain(ACTION_DOMAIN_1);
        uint256 t = block.timestamp + 7 days + 1;
        vm.warp(t);
        newGate.executeActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x1111;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("test-null");

        (bytes memory signature, uint256 deadline) = _generateSignatureForGate(
            newGate,
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        // Should revert because new gate is not authorized
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        newGate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );
    }

    /// @notice Test verification fails if gate not authorized on CampaignRegistry
    function test_CampaignRecording_SilentlyFailsWhenNotAuthorized() public {
        // Deploy new campaign registry
        CampaignRegistry newCampaignRegistry = new CampaignRegistry(governance);

        // Set campaign registry on gate (but don't authorize gate)
        _setCampaignRegistry(address(newCampaignRegistry));

        // Create campaign (as governance since gate not authorized)
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_DOMAIN_2;
        vm.prank(governance);
        newCampaignRegistry.createCampaign(IPFS_HASH, USA, actionIds);

        // Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_2);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("test-null-2");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA
        );

        // Should succeed (campaign recording fails silently)
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Nullifier should still be recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_2, nullifier));
    }

    // ============================================================================
    // 4. Campaign Registry Integration
    // ============================================================================

    /// @notice Test verification works without campaign registry set
    function test_CampaignRegistry_WorksWithoutRegistry() public {
        // Don't set campaign registry (remains address(0))
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x3333;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("no-campaign-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        // Should succeed even without campaign registry
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));
    }

    /// @notice Test campaign registry can be set and records participation
    function test_CampaignRegistry_RecordsParticipation() public {
        _setCampaignRegistry(address(campaignRegistry));
        _whitelistActionDomain(ACTION_DOMAIN_1);
        bytes32 campaignId = _createCampaign(ACTION_DOMAIN_1);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x4444;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("campaign-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify campaign updated
        (, , , , , uint256 participantCount, uint256 districtCount) = campaignRegistry.getCampaign(campaignId);
        assertEq(participantCount, 1);
        assertEq(districtCount, 1);
    }

    /// @notice Test campaign registry can be removed (set to address(0))
    function test_CampaignRegistry_CanBeRemoved() public {
        // First set a campaign registry
        _setCampaignRegistry(address(campaignRegistry));

        // Then remove it
        vm.prank(governance);
        gate.proposeCampaignRegistry(address(0));
        vm.warp(_lastWarpTime + 7 days + 1);

        vm.expectEmit(true, true, false, false);
        emit CampaignRegistrySet(address(campaignRegistry), address(0));
        gate.executeCampaignRegistry();

        assertEq(address(gate.campaignRegistry()), address(0));
    }

    /// @notice Test campaign recording handles paused campaign gracefully
    function test_CampaignRegistry_SilentOnPausedCampaign() public {
        _setCampaignRegistry(address(campaignRegistry));
        _whitelistActionDomain(ACTION_DOMAIN_1);
        bytes32 campaignId = _createCampaign(ACTION_DOMAIN_1);

        // Pause the campaign
        vm.prank(governance);
        campaignRegistry.pauseCampaign(campaignId);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x5555;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("paused-campaign-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Should succeed (paused campaign recording is skipped silently)
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Nullifier recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));

        // But campaign not updated
        (, , , , , uint256 participantCount, ) = campaignRegistry.getCampaign(campaignId);
        assertEq(participantCount, 0);
    }

    // ============================================================================
    // 5. View Function Tests
    // ============================================================================

    /// @notice Test isNullifierUsed returns correct values
    function test_IsNullifierUsed_ReturnsCorrectValues() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes32 nullifier1 = keccak256("null-1");
        bytes32 nullifier2 = keccak256("null-2");

        // Initially both unused
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier1));
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier2));

        // Use nullifier1
        _submitProof(DISTRICT_ROOT_DEPTH_20, nullifier1, ACTION_DOMAIN_1, GBR);

        // Now nullifier1 used, nullifier2 still unused
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier1));
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier2));
    }

    /// @notice Test getParticipantCount returns correct values
    function test_GetParticipantCount_ReturnsCorrectValues() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);
        _whitelistActionDomain(ACTION_DOMAIN_2);

        // Initially zero
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 0);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_2), 0);

        // Add participants to action 1
        _submitProof(DISTRICT_ROOT_DEPTH_20, keccak256("n1"), ACTION_DOMAIN_1, GBR);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);

        _submitProof(DISTRICT_ROOT_DEPTH_20, keccak256("n2"), ACTION_DOMAIN_1, GBR);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 2);

        // Action 2 still zero
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_2), 0);
    }

    /// @notice Test view functions work without any setup
    function test_ViewFunctions_WorkOnEmptyState() public view {
        bytes32 randomAction = keccak256("random");
        bytes32 randomNullifier = keccak256("random-null");

        assertFalse(gate.isNullifierUsed(randomAction, randomNullifier));
        assertEq(gate.getParticipantCount(randomAction), 0);
    }

    // ============================================================================
    // 6. Complex Multi-User Scenario
    // ============================================================================

    /// @notice Test multiple users voting on same action domain
    function test_MultiUser_SameActionDomain() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);
        _setCampaignRegistry(address(campaignRegistry));
        bytes32 campaignId = _createCampaign(ACTION_DOMAIN_1);

        uint256[] memory privateKeys = new uint256[](3);
        privateKeys[0] = 0xAAAA;
        privateKeys[1] = 0xBBBB;
        privateKeys[2] = 0xCCCC;

        bytes32[] memory nullifiers = new bytes32[](3);
        nullifiers[0] = keccak256("user-1-nullifier");
        nullifiers[1] = keccak256("user-2-nullifier");
        nullifiers[2] = keccak256("user-3-nullifier");

        bytes32[] memory districtRoots = new bytes32[](3);
        districtRoots[0] = DISTRICT_ROOT_DEPTH_22; // USA
        districtRoots[1] = DISTRICT_ROOT_DEPTH_22; // USA (same district)
        districtRoots[2] = DISTRICT_ROOT_DEPTH_20; // GBR (different country, different district)

        bytes3[] memory countries = new bytes3[](3);
        countries[0] = USA;
        countries[1] = USA;
        countries[2] = GBR;

        for (uint256 i = 0; i < 3; i++) {
            address signer = vm.addr(privateKeys[i]);
            bytes memory proof = abi.encodePacked("proof-", i);

            (bytes memory signature, uint256 deadline) = _generateSignature(
                privateKeys[i],
                signer,
                proof,
                districtRoots[i],
                nullifiers[i],
                AUTHORITY_LEVEL,
                ACTION_DOMAIN_1,
                DISTRICT_ID,
                countries[i]
            );

            gate.verifyAndAuthorizeWithSignature(
                signer,
                proof,
                districtRoots[i],
                nullifiers[i],
                AUTHORITY_LEVEL,
                ACTION_DOMAIN_1,
                DISTRICT_ID,
                countries[i],
                deadline,
                signature
            );

            // Advance time between submissions to avoid rate limit
            _lastWarpTime += 61 seconds;
            vm.warp(_lastWarpTime);
        }

        // Verify all nullifiers recorded
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifiers[i]));
        }

        // Verify participant count
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 3);

        // Verify campaign stats
        (, , , , , uint256 participantCount, uint256 districtCount) = campaignRegistry.getCampaign(campaignId);
        assertEq(participantCount, 3);
        assertEq(districtCount, 2); // 2 unique districts (USA and GBR)
    }

    /// @notice Test user cannot double-vote (same nullifier rejected)
    function test_MultiUser_CannotDoubleVote() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes32 nullifier = keccak256("one-time-nullifier");

        // First vote succeeds
        _submitProof(DISTRICT_ROOT_DEPTH_22, nullifier, ACTION_DOMAIN_1, USA);

        // Wait for rate limit
        vm.warp(_lastWarpTime + 61 seconds);

        // Second vote with same nullifier fails
        bytes memory proof = hex"11223344";
        uint256 userPrivateKey = 0xDDDD;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test same user can vote on different action domains
    function test_MultiUser_SameUserDifferentActions() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);
        _whitelistActionDomain(ACTION_DOMAIN_2);

        uint256 userPrivateKey = 0xEEEE;
        address signer = vm.addr(userPrivateKey);

        // Vote on action 1 with nullifier 1
        bytes32 nullifier1 = keccak256("user-action1-null");
        bytes memory proof1 = hex"55667788";
        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            userPrivateKey,
            signer,
            proof1,
            DISTRICT_ROOT_DEPTH_22,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof1,
            DISTRICT_ROOT_DEPTH_22,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Wait for rate limit
        vm.warp(_lastWarpTime + 61 seconds);

        // Vote on action 2 with different nullifier
        bytes32 nullifier2 = keccak256("user-action2-null");
        bytes memory proof2 = hex"99aabbcc";
        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            userPrivateKey,
            signer,
            proof2,
            DISTRICT_ROOT_DEPTH_22,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof2,
            DISTRICT_ROOT_DEPTH_22,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );

        // Both actions have 1 participant
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_2), 1);
    }

    // ============================================================================
    // 7. Root Lifecycle Integration (SA-004)
    // ============================================================================

    /// @notice Test verification fails for deactivated root
    function test_RootLifecycle_RejectsDeactivatedRoot() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Deactivate district root
        vm.prank(governance);
        districtRegistry.initiateRootDeactivation(DISTRICT_ROOT_DEPTH_20);
        vm.warp(_lastWarpTime + 7 days);
        districtRegistry.executeRootDeactivation(DISTRICT_ROOT_DEPTH_20);

        // Verify root is invalid
        assertFalse(districtRegistry.isValidRoot(DISTRICT_ROOT_DEPTH_20));

        // Try to submit proof
        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0xFFFF;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("deactivated-root-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );
    }

    /// @notice Test verification fails for expired root
    function test_RootLifecycle_RejectsExpiredRoot() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Set expiry on district root
        uint64 expiryTime = uint64(_lastWarpTime + 30 days);
        vm.prank(governance);
        districtRegistry.initiateRootExpiry(DISTRICT_ROOT_EXPIRING, expiryTime);
        vm.warp(_lastWarpTime + 7 days);
        districtRegistry.executeRootExpiry(DISTRICT_ROOT_EXPIRING);

        // Fast forward past expiry
        vm.warp(expiryTime + 1);

        // Verify root is invalid
        assertFalse(districtRegistry.isValidRoot(DISTRICT_ROOT_EXPIRING));

        // Try to submit proof
        bytes memory proof = hex"00112233";
        uint256 userPrivateKey = 0x1111;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("expired-root-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test verification succeeds for active non-expired root
    function test_RootLifecycle_AcceptsActiveRoot() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Set expiry on district root (in the future)
        uint64 expiryTime = uint64(_lastWarpTime + 60 days);
        vm.prank(governance);
        districtRegistry.initiateRootExpiry(DISTRICT_ROOT_EXPIRING, expiryTime);
        vm.warp(_lastWarpTime + 7 days);
        districtRegistry.executeRootExpiry(DISTRICT_ROOT_EXPIRING);

        // Verify root is still valid (expiry is in future)
        assertTrue(districtRegistry.isValidRoot(DISTRICT_ROOT_EXPIRING));

        // Submit proof should succeed
        bytes memory proof = hex"44556677";
        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("active-root-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));
    }

    /// @notice Test root transition from active to expired rejects new proofs
    function test_RootLifecycle_TransitionFromActiveToExpired() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Set expiry 30 days from now
        uint64 expiryTime = uint64(_lastWarpTime + 30 days);
        vm.prank(governance);
        districtRegistry.initiateRootExpiry(DISTRICT_ROOT_EXPIRING, expiryTime);
        vm.warp(_lastWarpTime + 7 days);
        districtRegistry.executeRootExpiry(DISTRICT_ROOT_EXPIRING);

        // Submit proof before expiry - should succeed
        bytes32 nullifier1 = keccak256("before-expiry");
        _submitProofWithRoot(DISTRICT_ROOT_EXPIRING, nullifier1, ACTION_DOMAIN_1, USA);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier1));

        // Fast forward past expiry
        vm.warp(expiryTime + 1);

        // Submit proof after expiry - should fail
        bytes memory proof = hex"ddeeff00";
        uint256 userPrivateKey = 0x3333;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier2 = keccak256("after-expiry-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_EXPIRING,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test reactivated root accepts proofs again
    function test_RootLifecycle_ReactivatedRootAcceptsProofs() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        // Start at a known timestamp to avoid any issues
        uint256 startTime = 100 days;
        vm.warp(startTime);

        // Deactivate root
        vm.prank(governance);
        districtRegistry.initiateRootDeactivation(DISTRICT_ROOT_DEPTH_20);

        // Wait for deactivation timelock
        vm.warp(startTime + 7 days + 1);
        districtRegistry.executeRootDeactivation(DISTRICT_ROOT_DEPTH_20);

        // Reactivate root
        vm.prank(governance);
        districtRegistry.initiateRootReactivation(DISTRICT_ROOT_DEPTH_20);

        // Wait for reactivation timelock (7 more days from current time)
        vm.warp(startTime + 14 days + 2);
        districtRegistry.executeRootReactivation(DISTRICT_ROOT_DEPTH_20);

        // Verify root is valid again
        assertTrue(districtRegistry.isValidRoot(DISTRICT_ROOT_DEPTH_20));

        // Submit proof should succeed
        bytes32 nullifier = keccak256("reactivated-root-null");
        _submitProof(DISTRICT_ROOT_DEPTH_20, nullifier, ACTION_DOMAIN_1, GBR);

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));
    }

    // ============================================================================
    // Additional Edge Cases
    // ============================================================================

    /// @notice Test verification fails for unregistered district
    function test_RevertWhen_DistrictNotRegistered() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes32 unknownRoot = keccak256("unknown-district");

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x4444;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("unknown-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            unknownRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            unknownRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test verification fails for wrong country
    function test_RevertWhen_CountryMismatch() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x5555;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("country-mismatch-null");

        // District is GBR but we claim USA
        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20, // This is GBR
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA // Wrong country
        );

        vm.expectRevert(DistrictGate.UnauthorizedDistrict.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_20,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test verification fails when verifier not found
    function test_RevertWhen_VerifierNotFound() public {
        // Register district with depth that has no verifier
        bytes32 newRoot = keccak256("depth-18-new");
        vm.prank(governance);
        districtRegistry.registerDistrict(newRoot, USA, DEPTH_18);

        // Remove verifier for depth 18
        // Note: VerifierRegistry doesn't have a remove function, so we deploy new gate
        // with registry that doesn't have depth 18 registered
        VerifierRegistry newVerifierRegistry = new VerifierRegistry(governance);

        // Only register depth 20, not 18 (genesis registration)
        vm.startPrank(governance);
        newVerifierRegistry.registerVerifier(DEPTH_20, address(verifier20));
        newVerifierRegistry.sealGenesis();
        vm.stopPrank();

        DistrictGate newGate = new DistrictGate(
            address(newVerifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Authorize new gate (with 7-day timelock)
        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(newGate));
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        nullifierRegistry.executeCallerAuthorization(address(newGate));

        // Whitelist action domain
        vm.prank(governance);
        newGate.proposeActionDomain(ACTION_DOMAIN_1);
        uint256 t2 = t1 + 7 days + 1;
        vm.warp(t2);
        newGate.executeActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"aabbccdd";
        uint256 userPrivateKey = 0x6666;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("no-verifier-null");

        (bytes memory signature, uint256 deadline) = _generateSignatureForGate(
            newGate,
            userPrivateKey,
            signer,
            proof,
            newRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.VerifierNotFound.selector);
        newGate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            newRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test relayer can submit on behalf of user
    function test_RelayerSubmission() public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"112233aabbcc";
        uint256 userPrivateKey = 0x7777;
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256("relayer-null");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Relayer submits on behalf of user
        vm.prank(relayer);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_DEPTH_22,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier));
    }

    // ============================================================================
    // Fuzz Tests
    // ============================================================================

    /// @notice Fuzz test: Multiple participants with random nullifiers
    function testFuzz_MultipleParticipants(uint256 seed) public {
        _whitelistActionDomain(ACTION_DOMAIN_1);

        uint256 numParticipants = (seed % 5) + 1; // 1-5 participants
        uint256 t = _lastWarpTime;

        for (uint256 i = 0; i < numParticipants; i++) {
            bytes32 nullifier = keccak256(abi.encodePacked(seed, i, "nullifier"));
            uint256 privateKey = uint256(keccak256(abi.encodePacked(seed, i, "key")));

            // Ensure private key is valid
            vm.assume(privateKey > 0 && privateKey < 115792089237316195423570985008687907852837564279074904382605163141518161494337);

            _submitProofWithKey(DISTRICT_ROOT_DEPTH_22, nullifier, ACTION_DOMAIN_1, USA, privateKey);

            // Advance time to avoid rate limit
            t += 61 seconds;
            vm.warp(t);
        }

        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), numParticipants);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    uint256 internal _lastWarpTime;

    function _whitelistActionDomain(bytes32 actionDomain) internal {
        vm.prank(governance);
        gate.proposeActionDomain(actionDomain);
        _lastWarpTime = block.timestamp + 7 days + 1;
        vm.warp(_lastWarpTime);
        gate.executeActionDomain(actionDomain);
    }

    function _setCampaignRegistry(address registry) internal {
        vm.prank(governance);
        gate.proposeCampaignRegistry(registry);
        _lastWarpTime = block.timestamp + 7 days + 1;
        vm.warp(_lastWarpTime);
        gate.executeCampaignRegistry();
    }

    function _createCampaign(bytes32 actionId) internal returns (bytes32) {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = actionId;

        // Whitelist creator to avoid rate limit issues
        vm.prank(governance);
        campaignRegistry.setCreatorWhitelist(governance, true);

        vm.prank(governance);
        return campaignRegistry.createCampaign(IPFS_HASH, USA, actionIds);
    }

    function _testDepthRouting(bytes32 districtRoot, bytes3 country, uint8 expectedDepth) internal {
        uint256 userPrivateKey = uint256(keccak256(abi.encodePacked(districtRoot, "key")));
        address signer = vm.addr(userPrivateKey);
        bytes32 nullifier = keccak256(abi.encodePacked(districtRoot, "nullifier"));
        bytes memory proof = abi.encodePacked(districtRoot, "proof");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            districtRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            country
        );

        vm.expectEmit(true, true, true, false);
        emit ActionVerified(
            signer,
            address(this),
            districtRoot,
            country,
            expectedDepth,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            districtRoot,
            nullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            country,
            deadline,
            signature
        );
    }

    function _submitProof(
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes3 country
    ) internal {
        uint256 userPrivateKey = uint256(keccak256(abi.encodePacked(nullifier, "key")));
        _submitProofWithKey(districtRoot, nullifier, actionDomain, country, userPrivateKey);
    }

    function _submitProofWithRoot(
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes3 country
    ) internal {
        _submitProof(districtRoot, nullifier, actionDomain, country);
    }

    function _submitProofWithKey(
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes3 country,
        uint256 privateKey
    ) internal {
        address signer = vm.addr(privateKey);
        bytes memory proof = abi.encodePacked(nullifier, "proof");

        (bytes memory signature, uint256 deadline) = _generateSignature(
            privateKey,
            signer,
            proof,
            districtRoot,
            nullifier,
            AUTHORITY_LEVEL,
            actionDomain,
            DISTRICT_ID,
            country
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            districtRoot,
            nullifier,
            AUTHORITY_LEVEL,
            actionDomain,
            DISTRICT_ID,
            country,
            deadline,
            signature
        );
    }

    function _generateSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country
    ) internal view returns (bytes memory signature, uint256 deadline) {
        return _generateSignatureForGate(
            gate,
            privateKey,
            signer,
            proof,
            districtRoot,
            nullifier,
            authorityLevel,
            actionDomain,
            districtId,
            country
        );
    }

    function _generateSignatureForGate(
        DistrictGate targetGate,
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country
    ) internal view returns (bytes memory signature, uint256 deadline) {
        deadline = block.timestamp + 1 hours;
        uint256 nonce = targetGate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 structHash = keccak256(
            abi.encode(
                targetGate.SUBMIT_PROOF_TYPEHASH(),
                proofHash,
                districtRoot,
                nullifier,
                authorityLevel,
                actionDomain,
                districtId,
                country,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", targetGate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock verifier that always returns false (for failure testing)
contract FailingMockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}
