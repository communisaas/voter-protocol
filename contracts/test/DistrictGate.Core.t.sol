// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";

/// @title DistrictGate Core Verification Tests
/// @notice Comprehensive tests for multi-depth ZK verifier orchestration
/// @dev Tests cover:
///      1. Depth Routing - proof routes to correct verifier based on district depth
///      2. District Validation (SA-004) - isValidRoot lifecycle checks
///      3. Nullifier Management - double-voting prevention with domain separation
///      4. Country Validation - expectedCountry must match district's actual country
///      5. Verifier Integration - MockVerifier/MockRejectingVerifier for proof verification
contract DistrictGateCoreTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;

    // Mock verifiers for different depths
    MockVerifier public verifierDepth18;
    MockVerifier public verifierDepth20;
    MockVerifier public verifierDepth22;
    MockVerifier public verifierDepth24;
    MockRejectingVerifier public rejectingVerifier;

    address public governance = address(0x1);
    address public user = address(0x2);

    // Test constants
    bytes32 public constant DISTRICT_ROOT_18 = bytes32(uint256(0x1818));
    bytes32 public constant DISTRICT_ROOT_20 = bytes32(uint256(0x2020));
    bytes32 public constant DISTRICT_ROOT_22 = bytes32(uint256(0x2222));
    bytes32 public constant DISTRICT_ROOT_24 = bytes32(uint256(0x2424));
    bytes32 public constant DISTRICT_ROOT_INACTIVE = bytes32(uint256(0xDEAD));
    bytes32 public constant DISTRICT_ROOT_EXPIRED = bytes32(uint256(0xE7D1));
    bytes32 public constant DISTRICT_ROOT_UNREGISTERED = bytes32(uint256(0xBEEF));

    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant NULLIFIER_3 = bytes32(uint256(0xABC));

    bytes32 public constant ACTION_DOMAIN_1 = keccak256("election-2024");
    bytes32 public constant ACTION_DOMAIN_2 = keccak256("petition-123");
    bytes32 public constant ACTION_DOMAIN_3 = keccak256("referendum-456");

    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");

    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";
    bytes3 public constant JPN = "JPN";

    // Events from DistrictGate
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

    function setUp() public {
        // Deploy mock verifiers
        verifierDepth18 = new MockVerifier();
        verifierDepth20 = new MockVerifier();
        verifierDepth22 = new MockVerifier();
        verifierDepth24 = new MockVerifier();
        rejectingVerifier = new MockRejectingVerifier();

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance, 7 days);
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        verifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        // Setup registries
        vm.startPrank(governance);

        // Register verifiers for all supported depths (genesis registration)
        verifierRegistry.registerVerifier(18, address(verifierDepth18));
        verifierRegistry.registerVerifier(20, address(verifierDepth20));
        verifierRegistry.registerVerifier(22, address(verifierDepth22));
        verifierRegistry.registerVerifier(24, address(verifierDepth24));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        vm.startPrank(governance);

        // Register districts with different depths
        districtRegistry.registerDistrict(DISTRICT_ROOT_18, USA, 18);
        districtRegistry.registerDistrict(DISTRICT_ROOT_20, GBR, 20);
        districtRegistry.registerDistrict(DISTRICT_ROOT_22, USA, 22);
        districtRegistry.registerDistrict(DISTRICT_ROOT_24, JPN, 24);

        // Register inactive district (for SA-004 tests)
        districtRegistry.registerDistrict(DISTRICT_ROOT_INACTIVE, USA, 18);

        // Register expired district (for SA-004 tests)
        districtRegistry.registerDistrict(DISTRICT_ROOT_EXPIRED, USA, 18);

        // Authorize gate as caller on NullifierRegistry (with 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        // Whitelist action domains for tests (batch propose, single warp, batch execute)
        vm.startPrank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN_1);
        gate.proposeActionDomain(ACTION_DOMAIN_2);
        gate.proposeActionDomain(ACTION_DOMAIN_3);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(ACTION_DOMAIN_1);
        gate.executeActionDomain(ACTION_DOMAIN_2);
        gate.executeActionDomain(ACTION_DOMAIN_3);
    }

    // ============================================================================
    // 1. DEPTH ROUTING TESTS
    // ============================================================================

    /// @notice Verify proof routes to depth-18 verifier
    function test_SuccessWhen_ProofRoutesToDepth18Verifier() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Expect event with depth 18
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_18,
            USA,
            18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify the depth-18 verifier was called
        assertTrue(verifierDepth18.wasCalledWith(proof));
    }

    /// @notice Verify proof routes to depth-20 verifier
    function test_SuccessWhen_ProofRoutesToDepth20Verifier() public {
        bytes memory proof = hex"cafebabe";
        uint256 userPrivateKey = 0x2345;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_20,
            GBR,
            20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );

        assertTrue(verifierDepth20.wasCalledWith(proof));
    }

    /// @notice Verify proof routes to depth-22 verifier
    function test_SuccessWhen_ProofRoutesToDepth22Verifier() public {
        bytes memory proof = hex"12345678";
        uint256 userPrivateKey = 0x3456;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_22,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_22,
            USA,
            22,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_22,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        assertTrue(verifierDepth22.wasCalledWith(proof));
    }

    /// @notice Verify proof routes to depth-24 verifier
    function test_SuccessWhen_ProofRoutesToDepth24Verifier() public {
        bytes memory proof = hex"87654321";
        uint256 userPrivateKey = 0x4567;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_24,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            JPN
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_24,
            JPN,
            24,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_24,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            JPN,
            deadline,
            signature
        );

        assertTrue(verifierDepth24.wasCalledWith(proof));
    }

    /// @notice Revert when verifier not found for depth (verifier removed after district registration)
    function test_RevertWhen_VerifierNotFoundForDepth() public {
        // Register a new district with depth 18 but remove the verifier
        bytes32 newRoot = bytes32(uint256(0x9999));

        vm.startPrank(governance);
        districtRegistry.registerDistrict(newRoot, USA, 18);

        // Upgrade the depth-18 verifier to address(0) - simulate no verifier
        // First we need to create a new registry without depth-18 verifier
        vm.stopPrank();

        // Create a new setup with missing verifier
        VerifierRegistry newVerifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);
        DistrictGate newGate = new DistrictGate(
            address(newVerifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        vm.startPrank(governance);
        // Only register depth 20, not 18 (genesis registration)
        newVerifierRegistry.registerVerifier(20, address(verifierDepth20));
        newVerifierRegistry.sealGenesis();
        vm.stopPrank();

        vm.startPrank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(newGate));
        vm.stopPrank();
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        nullifierRegistry.executeCallerAuthorization(address(newGate));

        // Whitelist action domain for newGate
        vm.prank(governance);
        newGate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(t1 + 7 days + 1);
        newGate.executeActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignatureForGate(
            newGate,
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.VerifierNotFound.selector);
        newGate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Revert when district not registered
    function test_RevertWhen_DistrictNotRegistered() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_UNREGISTERED,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_UNREGISTERED,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    // ============================================================================
    // 2. DISTRICT VALIDATION TESTS (SA-004)
    // ============================================================================

    /// @notice SA-004: Reject proofs with inactive district roots
    function test_RevertWhen_DistrictRootIsInactive() public {
        // Deactivate the district root
        vm.prank(governance);
        districtRegistry.initiateRootDeactivation(DISTRICT_ROOT_INACTIVE);

        vm.warp(block.timestamp + 7 days + 1);
        districtRegistry.executeRootDeactivation(DISTRICT_ROOT_INACTIVE);

        // Verify isValidRoot returns false
        assertFalse(districtRegistry.isValidRoot(DISTRICT_ROOT_INACTIVE));

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_INACTIVE,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_INACTIVE,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice SA-004: Reject proofs with expired district roots
    function test_RevertWhen_DistrictRootIsExpired() public {
        // Set expiry on the district root
        uint64 expiryTime = uint64(block.timestamp + 1 days);

        vm.prank(governance);
        districtRegistry.initiateRootExpiry(DISTRICT_ROOT_EXPIRED, expiryTime);

        vm.warp(block.timestamp + 7 days + 1);
        districtRegistry.executeRootExpiry(DISTRICT_ROOT_EXPIRED);

        // Warp past expiry time
        vm.warp(expiryTime + 1);

        // Verify isValidRoot returns false
        assertFalse(districtRegistry.isValidRoot(DISTRICT_ROOT_EXPIRED));

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_EXPIRED,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_EXPIRED,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice SA-004: Accept proofs with active (valid) district roots
    function test_SuccessWhen_DistrictRootIsActive() public {
        // Verify isValidRoot returns true for active root
        assertTrue(districtRegistry.isValidRoot(DISTRICT_ROOT_18));

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        // Should succeed
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify nullifier was recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    /// @notice SA-004: Verify isValidRoot is called, not just registration check
    /// @dev This test ensures the fix properly calls isValidRoot() which checks:
    ///      1. Registration (registeredAt != 0)
    ///      2. Active status (isActive == true)
    ///      3. Not expired (expiresAt == 0 || block.timestamp <= expiresAt)
    function test_VerifiesIsValidRootNotJustRegistration() public {
        // Create a root that is registered but not valid (inactive)
        bytes32 registeredButInactiveRoot = bytes32(uint256(0xAABBCC));

        vm.prank(governance);
        districtRegistry.registerDistrict(registeredButInactiveRoot, USA, 18);

        // Verify it's registered (country != 0)
        (bytes3 country, uint8 depth) = districtRegistry.getCountryAndDepth(registeredButInactiveRoot);
        assertEq(country, USA);
        assertEq(depth, 18);

        // Deactivate it
        vm.prank(governance);
        districtRegistry.initiateRootDeactivation(registeredButInactiveRoot);
        vm.warp(block.timestamp + 7 days + 1);
        districtRegistry.executeRootDeactivation(registeredButInactiveRoot);

        // Still registered (getCountryAndDepth returns data)
        (country, depth) = districtRegistry.getCountryAndDepth(registeredButInactiveRoot);
        assertEq(country, USA);
        assertEq(depth, 18);

        // But isValidRoot returns false
        assertFalse(districtRegistry.isValidRoot(registeredButInactiveRoot));

        // SA-004 FIX: Gate should reject because isValidRoot is false
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            registeredButInactiveRoot,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.DistrictRootNotActive.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            registeredButInactiveRoot,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    // ============================================================================
    // 3. NULLIFIER TESTS
    // ============================================================================

    /// @notice Record nullifier on successful verification
    function test_SuccessWhen_NullifierRecordedOnVerification() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // Verify nullifier not used before
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify nullifier is now used
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));

        // Verify participant count increased
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    /// @notice Prevent double-voting with same actionDomain + nullifier
    function test_RevertWhen_DoubleVotingSameActionDomain() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // First vote
        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Advance time to avoid rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Second vote with same nullifier and actionDomain
        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );
    }

    /// @notice Different actionDomains have independent nullifier spaces
    function test_SuccessWhen_SameNullifierDifferentActionDomains() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // Vote on ACTION_DOMAIN_1 with NULLIFIER_1
        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Advance time to avoid rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Vote on ACTION_DOMAIN_2 with same NULLIFIER_1 - should succeed
        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_2,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );

        // Verify both are recorded independently
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_2, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_2), 1);
    }

    /// @notice Multiple users can vote on same action with different nullifiers
    function test_SuccessWhen_MultipleUsersVoteOnSameAction() public {
        bytes memory proof = hex"deadbeef";

        // User 1 votes
        uint256 user1PrivateKey = 0xAAA;
        address user1 = vm.addr(user1PrivateKey);
        bytes32 nullifier1 = bytes32(uint256(0x111));

        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            user1PrivateKey,
            user1,
            proof,
            DISTRICT_ROOT_18,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user1,
            proof,
            DISTRICT_ROOT_18,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Advance time to avoid rate limit
        vm.warp(block.timestamp + 61 seconds);

        // User 2 votes with different nullifier
        uint256 user2PrivateKey = 0xBBB;
        address user2 = vm.addr(user2PrivateKey);
        bytes32 nullifier2 = bytes32(uint256(0x222));

        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            user2PrivateKey,
            user2,
            proof,
            DISTRICT_ROOT_18,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user2,
            proof,
            DISTRICT_ROOT_18,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );

        // Verify participant count
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 2);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier1));
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, nullifier2));
    }

    // ============================================================================
    // 4. COUNTRY VALIDATION TESTS
    // ============================================================================

    /// @notice Reject when expectedCountry doesn't match district's actual country
    function test_RevertWhen_CountryMismatch() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // DISTRICT_ROOT_18 is registered with USA, but we pass GBR
        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR // Wrong country
        );

        vm.expectRevert(DistrictGate.UnauthorizedDistrict.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );
    }

    /// @notice Accept when expectedCountry matches district's actual country
    function test_SuccessWhen_CountryMatches() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // DISTRICT_ROOT_20 is registered with GBR
        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT_20,
            GBR,
            20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_20,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            GBR,
            deadline,
            signature
        );
    }

    // ============================================================================
    // 5. VERIFIER INTEGRATION TESTS
    // ============================================================================

    /// @notice Revert when verifier.verifyProof returns false
    function test_RevertWhen_VerifierRejectsProof() public {
        // Create a new gate with rejecting verifier for depth 18
        VerifierRegistry rejectingVerifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);
        DistrictGate rejectingGate = new DistrictGate(
            address(rejectingVerifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        vm.startPrank(governance);
        // Register rejecting verifier (genesis registration)
        rejectingVerifierRegistry.registerVerifier(18, address(rejectingVerifier));
        rejectingVerifierRegistry.sealGenesis();
        vm.stopPrank();

        vm.startPrank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(rejectingGate));
        vm.stopPrank();
        uint256 t1 = block.timestamp + 7 days;
        vm.warp(t1);
        nullifierRegistry.executeCallerAuthorization(address(rejectingGate));

        // Whitelist action domain
        vm.prank(governance);
        rejectingGate.proposeActionDomain(ACTION_DOMAIN_1);
        vm.warp(t1 + 7 days + 1);
        rejectingGate.executeActionDomain(ACTION_DOMAIN_1);

        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignatureForGate(
            rejectingGate,
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.VerificationFailed.selector);
        rejectingGate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Verify MockVerifier correctly returns true and records proof
    function test_MockVerifierAcceptsValidProofs() public {
        bytes memory proof = hex"74657374";
        bytes32[] memory publicInputs = new bytes32[](5);

        bool result = verifierDepth18.verify(proof, publicInputs);
        assertTrue(result);
        assertTrue(verifierDepth18.wasCalledWith(proof));
    }

    /// @notice Verify MockRejectingVerifier correctly returns false
    function test_MockRejectingVerifierRejectsProofs() public view {
        bytes memory proof = hex"74657374";
        bytes32[] memory publicInputs = new bytes32[](5);

        bool result = rejectingVerifier.verify(proof, publicInputs);
        assertFalse(result);
    }

    /// @notice Verify correct public inputs are passed to verifier
    function test_CorrectPublicInputsPassedToVerifier() public {
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_1,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify the public inputs passed to verifier
        bytes32[] memory capturedInputs = verifierDepth18.getLastPublicInputs();
        assertEq(capturedInputs.length, 5, "publicInputs length mismatch");
        assertEq(capturedInputs[0], DISTRICT_ROOT_18, "merkleRoot mismatch");
        assertEq(capturedInputs[1], NULLIFIER_1, "nullifier mismatch");
        assertEq(capturedInputs[2], bytes32(uint256(AUTHORITY_LEVEL)), "authorityLevel mismatch");
        assertEq(capturedInputs[3], ACTION_DOMAIN_1, "actionDomain mismatch");
        assertEq(capturedInputs[4], DISTRICT_ID, "districtId mismatch");
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// @notice Helper to whitelist an action domain (propose + execute)
    function _whitelistActionDomain(bytes32 actionDomain) internal {
        vm.prank(governance);
        gate.proposeActionDomain(actionDomain);

        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(actionDomain);
    }

    /// @notice Helper to compute EIP-712 digest for DistrictGate
    function _getEIP712Digest(
        DistrictGate _gate,
        address, /* signer */
        bytes32 proofHash,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _gate.SUBMIT_PROOF_TYPEHASH(),
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

        return keccak256(
            abi.encodePacked("\x19\x01", _gate.DOMAIN_SEPARATOR(), structHash)
        );
    }

    /// @notice Helper to generate EIP-712 signature for proof submission
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

    /// @notice Helper to generate EIP-712 signature for a specific gate instance
    function _generateSignatureForGate(
        DistrictGate _gate,
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
        uint256 nonce = _gate.nonces(signer);

        bytes32 digest = _getEIP712Digest(
            _gate,
            signer,
            keccak256(proof),
            districtRoot,
            nullifier,
            authorityLevel,
            actionDomain,
            districtId,
            country,
            nonce,
            deadline
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

// ============================================================================
// MOCK CONTRACTS
// ============================================================================

/// @notice Mock verifier that accepts all proofs and records calls
contract MockVerifier {
    mapping(bytes32 => bool) public calledWithProof;
    bytes32[] public lastPublicInputs;
    bytes public lastProof;

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external returns (bool) {
        bytes32 proofHash = keccak256(proof);
        calledWithProof[proofHash] = true;
        lastProof = proof;
        delete lastPublicInputs;
        for (uint256 i = 0; i < publicInputs.length; i++) {
            lastPublicInputs.push(publicInputs[i]);
        }
        return true;
    }

    function wasCalledWith(bytes memory proof) external view returns (bool) {
        return calledWithProof[keccak256(proof)];
    }

    function getLastPublicInputs() external view returns (bytes32[] memory) {
        return lastPublicInputs;
    }

    function getLastProof() external view returns (bytes memory) {
        return lastProof;
    }
}

/// @notice Mock verifier that rejects all proofs
contract MockRejectingVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}
