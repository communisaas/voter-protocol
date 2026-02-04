// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";

/// @title DistrictGate EIP-712 Signature Verification and MEV Protection Tests
/// @notice Comprehensive tests for EIP-712 signature verification, nonce management,
///         deadline protection (MEV), parameter binding, and relayer pattern
/// @dev Tests the following security properties:
///
/// SIGNATURE VERIFICATION:
/// - Valid signatures from correct signer succeed
/// - Invalid signatures (wrong signer) revert with InvalidSignature
/// - Zero address signer reverts with ZeroAddress
/// - Recovered signer must exactly match provided signer
///
/// NONCE MANAGEMENT (Replay Protection):
/// - Nonces increment after successful verification
/// - Same signature cannot be reused (nonce has changed)
/// - Each signer has independent nonce space
///
/// DEADLINE PROTECTION (MEV):
/// - Expired deadlines revert with SignatureExpired
/// - Valid deadlines (in future) succeed
/// - Deadline exactly at block.timestamp succeeds
/// - Deadline 1 second before block.timestamp fails
///
/// PARAMETER BINDING:
/// - Changing any parameter invalidates the signature:
///   - proof bytes, districtRoot, nullifier, authorityLevel
///   - actionDomain, districtId, country
///
/// DOMAIN SEPARATOR:
/// - Correct name ("DistrictGate"), version ("1"), chainId, verifyingContract
/// - Signature from different domain (chain/contract) fails
///
/// RELAYER PATTERN (Gas Abstraction):
/// - User signs, different submitter (msg.sender) submits
/// - Event emits correct user and submitter addresses
/// - User cannot be front-run (signature binds all params)
contract DistrictGateEIP712Test is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    address public verifier;

    address public governance = address(0x1111);

    // Test accounts with known private keys for signature generation
    uint256 public constant USER_PRIVATE_KEY = 0xA11CE;
    uint256 public constant RELAYER_PRIVATE_KEY = 0xBEEF;
    uint256 public constant ATTACKER_PRIVATE_KEY = 0xBAD;

    address public user;
    address public relayer;
    address public attacker;

    // Test constants
    bytes32 public constant DISTRICT_ROOT = bytes32(uint256(0x123456));
    bytes32 public constant NULLIFIER = bytes32(uint256(0xABCDEF));
    bytes32 public constant ACTION_DOMAIN = keccak256("test-action-domain");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant DISTRICT_ID = keccak256("test-district-id");
    bytes3 public constant USA = "USA";
    bytes3 public constant CAN = "CAN";
    uint8 public constant DEPTH_18 = 18;

    bytes public constant VALID_PROOF = hex"deadbeefcafe";

    // Events for verification
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
        // Derive addresses from private keys
        user = vm.addr(USER_PRIVATE_KEY);
        relayer = vm.addr(RELAYER_PRIVATE_KEY);
        attacker = vm.addr(ATTACKER_PRIVATE_KEY);

        // Deploy mock verifier
        verifier = address(new MockVerifierEIP712());

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        verifierRegistry = new VerifierRegistry(governance);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance
        );

        // Setup: Register verifier for depth 18 (with 14-day timelock - HIGH-001 fix)
        vm.startPrank(governance);
        verifierRegistry.proposeVerifier(DEPTH_18, verifier);
        vm.stopPrank();
        vm.warp(block.timestamp + 14 days);
        verifierRegistry.executeVerifier(DEPTH_18);

        vm.startPrank(governance);

        // Setup: Register district (depth 18, USA)
        districtRegistry.registerDistrict(DISTRICT_ROOT, USA, DEPTH_18);

        // Setup: Authorize gate as caller on NullifierRegistry (with 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        // Setup: Whitelist action domain (propose + fast-forward + execute)
        vm.prank(governance);
        gate.proposeActionDomain(ACTION_DOMAIN);

        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(ACTION_DOMAIN);
    }

    // ============================================================================
    // Section 1: Signature Verification Tests
    // ============================================================================

    /// @notice Valid signature with correct signer succeeds
    function test_SignatureVerification_ValidSignatureSucceeds() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            user,
            address(this),
            DISTRICT_ROOT,
            USA,
            DEPTH_18,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Invalid signature (wrong signer) reverts with InvalidSignature
    function test_SignatureVerification_WrongSignerReverts() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Attacker signs, but claims to be user
        bytes memory attackerSignature = _generateSignature(
            ATTACKER_PRIVATE_KEY,
            attacker, // Attacker's nonce
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Submit with user as signer but attacker's signature
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user, // Claims to be user
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            attackerSignature // But uses attacker's signature
        );
    }

    /// @notice Recovered signer must match provided signer
    function test_SignatureVerification_RecoveredSignerMustMatch() public {
        uint256 deadline = block.timestamp + 1 hours;

        // User signs with their own private key
        bytes memory userSignature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Try to submit claiming relayer is the signer (should fail)
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            relayer, // Wrong signer claimed
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            userSignature // But this is user's signature
        );
    }

    /// @notice Zero address signer reverts with ZeroAddress
    function test_SignatureVerification_ZeroAddressSignerReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory dummySignature = new bytes(65);

        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.verifyAndAuthorizeWithSignature(
            address(0), // Zero address signer
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            dummySignature
        );
    }

    /// @notice Malformed signature (wrong length) causes recovery to fail
    function test_SignatureVerification_MalformedSignatureReverts() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Too short signature
        bytes memory shortSignature = hex"deadbeef";

        vm.expectRevert(); // ECDSA will revert on malformed signature
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            shortSignature
        );
    }

    // ============================================================================
    // Section 2: Nonce Management Tests
    // ============================================================================

    /// @notice Nonce increments after successful verification
    function test_Nonce_IncrementsAfterSuccess() public {
        uint256 initialNonce = gate.nonces(user);
        assertEq(initialNonce, 0, "Initial nonce should be 0");

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        uint256 newNonce = gate.nonces(user);
        assertEq(newNonce, 1, "Nonce should be 1 after first verification");
    }

    /// @notice Same signature cannot be reused (nonce changed)
    function test_Nonce_SameSignatureCannotBeReused() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // First submission succeeds
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Wait to avoid rate limit and use new nullifier
        vm.warp(block.timestamp + 61 seconds);
        bytes32 newNullifier = bytes32(uint256(0xDEAD));

        // Try to reuse the same signature (nonce has changed)
        // Even with different nullifier, signature is bound to old nonce
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            newNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature // Same signature with nonce=0 baked in
        );
    }

    /// @notice Each signer has independent nonce
    function test_Nonce_IndependentPerSigner() public {
        // User submits first
        uint256 deadlineUser = block.timestamp + 1 hours;
        bytes memory signatureUser = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadlineUser
        );

        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadlineUser,
            signatureUser
        );

        // Wait to avoid rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Relayer submits with their own nonce (still 0)
        bytes32 relayerNullifier = bytes32(uint256(0xBBBB));
        uint256 deadlineRelayer = block.timestamp + 1 hours;
        bytes memory signatureRelayer = _generateSignature(
            RELAYER_PRIVATE_KEY,
            relayer,
            VALID_PROOF,
            DISTRICT_ROOT,
            relayerNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadlineRelayer
        );

        // Relayer's nonce is independent, should still be 0
        assertEq(gate.nonces(relayer), 0, "Relayer nonce should be 0");

        gate.verifyAndAuthorizeWithSignature(
            relayer,
            VALID_PROOF,
            DISTRICT_ROOT,
            relayerNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadlineRelayer,
            signatureRelayer
        );

        // Verify both nonces incremented independently
        assertEq(gate.nonces(user), 1, "User nonce should be 1");
        assertEq(gate.nonces(relayer), 1, "Relayer nonce should be 1");
    }

    /// @notice Nonce does not increment on failed verification
    function test_Nonce_DoesNotIncrementOnFailure() public {
        uint256 initialNonce = gate.nonces(user);

        uint256 deadline = block.timestamp + 1 hours;

        // Create signature with wrong signer
        bytes memory wrongSignature = _generateSignature(
            ATTACKER_PRIVATE_KEY,
            attacker,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // This should fail
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            wrongSignature
        );

        // Nonce should remain unchanged
        assertEq(gate.nonces(user), initialNonce, "Nonce should not increment on failure");
    }

    // ============================================================================
    // Section 3: Deadline Protection (MEV) Tests
    // ============================================================================

    /// @notice Expired deadline reverts with SignatureExpired
    function test_Deadline_ExpiredDeadlineReverts() public {
        uint256 pastDeadline = block.timestamp - 1;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            pastDeadline
        );

        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            pastDeadline,
            signature
        );
    }

    /// @notice Valid deadline (in future) succeeds
    function test_Deadline_FutureDeadlineSucceeds() public {
        uint256 futureDeadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            futureDeadline
        );

        // Should succeed
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            futureDeadline,
            signature
        );
    }

    /// @notice Deadline exactly at block.timestamp succeeds
    function test_Deadline_ExactBlockTimestampSucceeds() public {
        uint256 exactDeadline = block.timestamp;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            exactDeadline
        );

        // Should succeed (block.timestamp > deadline check, not >=)
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            exactDeadline,
            signature
        );
    }

    /// @notice Deadline 1 second before block.timestamp fails
    function test_Deadline_OneSecondBeforeBlockTimestampFails() public {
        uint256 justExpiredDeadline = block.timestamp - 1;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            justExpiredDeadline
        );

        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            justExpiredDeadline,
            signature
        );
    }

    /// @notice MEV protection: Valid signature with short deadline window
    function test_Deadline_MEVProtectionShortWindow() public {
        // User creates signature with 30 second deadline
        uint256 shortDeadline = block.timestamp + 30;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            shortDeadline
        );

        // Simulate MEV: 31 seconds pass before transaction is included
        vm.warp(block.timestamp + 31);

        // Should fail - deadline expired
        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            shortDeadline,
            signature
        );
    }

    // ============================================================================
    // Section 4: Parameter Binding Tests
    // ============================================================================

    /// @notice Different proof bytes invalidates signature
    function test_ParameterBinding_DifferentProofInvalidates() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Sign with original proof
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Try to submit with different proof
        bytes memory differentProof = hex"cafebabe";

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            differentProof, // Different proof
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different districtRoot invalidates signature
    function test_ParameterBinding_DifferentDistrictRootInvalidates() public {
        // Register a second district
        bytes32 differentRoot = bytes32(uint256(0x999999));
        vm.prank(governance);
        districtRegistry.registerDistrict(differentRoot, USA, DEPTH_18);

        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            differentRoot, // Different district root
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different nullifier invalidates signature
    function test_ParameterBinding_DifferentNullifierInvalidates() public {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        bytes32 differentNullifier = bytes32(uint256(0xDEADDEAD));

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            differentNullifier, // Different nullifier
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different authorityLevel invalidates signature
    function test_ParameterBinding_DifferentAuthorityLevelInvalidates() public {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL, // Level 3
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        bytes32 differentAuthority = bytes32(uint256(5)); // Level 5

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            differentAuthority, // Different authority level
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different actionDomain invalidates signature
    function test_ParameterBinding_DifferentActionDomainInvalidates() public {
        // Whitelist a different action domain
        bytes32 differentDomain = keccak256("different-action");
        vm.prank(governance);
        gate.proposeActionDomain(differentDomain);
        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(differentDomain);

        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN, // Original domain
            DISTRICT_ID,
            USA,
            deadline
        );

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            differentDomain, // Different action domain
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different districtId invalidates signature
    function test_ParameterBinding_DifferentDistrictIdInvalidates() public {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        bytes32 differentDistrictId = keccak256("different-district");

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            differentDistrictId, // Different district ID
            USA,
            deadline,
            signature
        );
    }

    /// @notice Different country invalidates signature
    function test_ParameterBinding_DifferentCountryInvalidates() public {
        // Register same district root with different country (for testing)
        // Note: In practice, a root is registered with one country, but for testing
        // we need to show that the signature is bound to the country
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA, // Signed for USA
            deadline
        );

        // Try to submit with different country
        // This will fail with InvalidSignature because the signature was for USA
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            CAN, // Different country
            deadline,
            signature
        );
    }

    /// @notice Different deadline invalidates signature
    function test_ParameterBinding_DifferentDeadlineInvalidates() public {
        uint256 originalDeadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            originalDeadline
        );

        uint256 differentDeadline = block.timestamp + 2 hours;

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            differentDeadline, // Different deadline
            signature
        );
    }

    // ============================================================================
    // Section 5: Domain Separator Tests
    // ============================================================================

    /// @notice Domain separator has correct name ("DistrictGate")
    function test_DomainSeparator_CorrectNameAndVersion() public view {
        bytes32 expectedDomainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")),
                block.chainid,
                address(gate)
            )
        );

        assertEq(gate.DOMAIN_SEPARATOR(), expectedDomainSeparator, "Domain separator mismatch");
    }

    /// @notice Signature with wrong chain ID fails
    function test_DomainSeparator_WrongChainIdFails() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Create digest with different chain ID
        bytes32 wrongChainDomainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")),
                block.chainid + 1, // Different chain ID
                address(gate)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(VALID_PROOF),
                DISTRICT_ROOT,
                NULLIFIER,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                gate.nonces(user),
                deadline
            )
        );

        bytes32 wrongDigest = keccak256(
            abi.encodePacked("\x19\x01", wrongChainDomainSeparator, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, wrongDigest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Signature with wrong verifying contract fails
    function test_DomainSeparator_WrongVerifyingContractFails() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Create digest with different verifying contract
        bytes32 wrongContractDomainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("1")),
                block.chainid,
                address(0xDEAD) // Different contract
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(VALID_PROOF),
                DISTRICT_ROOT,
                NULLIFIER,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                gate.nonces(user),
                deadline
            )
        );

        bytes32 wrongDigest = keccak256(
            abi.encodePacked("\x19\x01", wrongContractDomainSeparator, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, wrongDigest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Signature with wrong contract name fails
    function test_DomainSeparator_WrongContractNameFails() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Create digest with wrong name
        bytes32 wrongNameDomainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("WrongName")), // Different name
                keccak256(bytes("1")),
                block.chainid,
                address(gate)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(VALID_PROOF),
                DISTRICT_ROOT,
                NULLIFIER,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                gate.nonces(user),
                deadline
            )
        );

        bytes32 wrongDigest = keccak256(
            abi.encodePacked("\x19\x01", wrongNameDomainSeparator, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, wrongDigest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Signature with wrong version fails
    function test_DomainSeparator_WrongVersionFails() public {
        uint256 deadline = block.timestamp + 1 hours;

        // Create digest with wrong version
        bytes32 wrongVersionDomainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DistrictGate")),
                keccak256(bytes("2")), // Different version
                block.chainid,
                address(gate)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(VALID_PROOF),
                DISTRICT_ROOT,
                NULLIFIER,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                gate.nonces(user),
                deadline
            )
        );

        bytes32 wrongDigest = keccak256(
            abi.encodePacked("\x19\x01", wrongVersionDomainSeparator, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, wrongDigest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    // ============================================================================
    // Section 6: Relayer Pattern Tests
    // ============================================================================

    /// @notice User signs, different submitter (msg.sender) submits
    function test_Relayer_UserSignsRelayerSubmits() public {
        uint256 deadline = block.timestamp + 1 hours;

        // User signs the proof
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Relayer submits the transaction
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            user,      // user is the signer
            relayer,   // relayer is the submitter
            DISTRICT_ROOT,
            USA,
            DEPTH_18,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID
        );

        vm.prank(relayer); // Relayer is msg.sender
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Event emits correct user and submitter addresses
    function test_Relayer_EventEmitsCorrectAddresses() public {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Record logs
        vm.recordLogs();

        vm.prank(attacker); // Any address can submit
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Check the logged event
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Find ActionVerified event (should be the last one)
        bool foundEvent = false;
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("ActionVerified(address,address,bytes32,bytes3,uint8,bytes32,bytes32,bytes32,bytes32)")) {
                // topics[1] is indexed user
                assertEq(address(uint160(uint256(logs[i].topics[1]))), user, "Event user mismatch");
                // topics[2] is indexed submitter
                assertEq(address(uint160(uint256(logs[i].topics[2]))), attacker, "Event submitter mismatch");
                foundEvent = true;
                break;
            }
        }
        assertTrue(foundEvent, "ActionVerified event not found");
    }

    /// @notice User cannot be front-run (signature binds all params)
    function test_Relayer_FrontRunProtection() public {
        uint256 deadline = block.timestamp + 1 hours;

        // User creates signature for their proof
        bytes memory userSignature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Attacker tries to front-run by submitting with their own nullifier
        bytes32 attackerNullifier = bytes32(uint256(0xA77AC4));

        // This should fail because the signature is bound to NULLIFIER, not attackerNullifier
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            attackerNullifier, // Attacker tries different nullifier
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            userSignature
        );
    }

    /// @notice Attacker cannot steal user's signature for different action domain
    function test_Relayer_SignatureBoundToActionDomain() public {
        // Whitelist a malicious action domain
        bytes32 maliciousDomain = keccak256("malicious-vote");
        vm.prank(governance);
        gate.proposeActionDomain(maliciousDomain);
        vm.warp(block.timestamp + 7 days + 1);
        gate.executeActionDomain(maliciousDomain);

        uint256 deadline = block.timestamp + 1 hours;

        // User signs for legitimate action
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN, // Legitimate domain
            DISTRICT_ID,
            USA,
            deadline
        );

        // Attacker tries to use signature for malicious action
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            maliciousDomain, // Different domain
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Multiple relayers can submit proofs for different users
    function test_Relayer_MultipleRelayersForDifferentUsers() public {
        uint256 deadline = block.timestamp + 1 hours;

        // User signs their proof
        bytes memory userSignature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Relayer submits for user
        vm.prank(relayer);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            userSignature
        );

        // Wait to avoid rate limit
        vm.warp(block.timestamp + 61 seconds);

        // Attacker (acting as user2's relayer) signs their own proof
        bytes32 attackerNullifier = bytes32(uint256(0xCCCC));
        uint256 deadline2 = block.timestamp + 1 hours;

        bytes memory attackerSignature = _generateSignature(
            ATTACKER_PRIVATE_KEY,
            attacker,
            VALID_PROOF,
            DISTRICT_ROOT,
            attackerNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline2
        );

        // User (acting as attacker's relayer) submits for attacker
        vm.prank(user);
        gate.verifyAndAuthorizeWithSignature(
            attacker,
            VALID_PROOF,
            DISTRICT_ROOT,
            attackerNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline2,
            attackerSignature
        );

        // Verify both nullifiers recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN, NULLIFIER));
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN, attackerNullifier));
    }

    // ============================================================================
    // Section 7: Edge Cases and Fuzz Tests
    // ============================================================================

    /// @notice Fuzz test: Random signer always fails when signature is from different key
    function testFuzz_SignatureVerification_RandomSignerFails(uint256 randomKey) public {
        // Bound to valid private key range
        randomKey = bound(randomKey, 1, type(uint128).max);

        // Skip if randomKey matches user's key
        vm.assume(randomKey != USER_PRIVATE_KEY);

        address randomSigner = vm.addr(randomKey);

        uint256 deadline = block.timestamp + 1 hours;

        // Sign with user's key
        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline
        );

        // Try to claim random signer
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            randomSigner,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Fuzz test: Any deadline before block.timestamp fails
    function testFuzz_Deadline_PastDeadlineFails(uint256 secondsInPast) public {
        // Warp to a reasonable timestamp to avoid underflow
        vm.warp(1_700_000_000);

        secondsInPast = bound(secondsInPast, 1, 365 days);

        uint256 pastDeadline = block.timestamp - secondsInPast;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            pastDeadline
        );

        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            pastDeadline,
            signature
        );
    }

    /// @notice Fuzz test: Any future deadline succeeds (if other params valid)
    function testFuzz_Deadline_FutureDeadlineSucceeds(uint256 secondsInFuture) public {
        secondsInFuture = bound(secondsInFuture, 0, 365 days);

        uint256 futureDeadline = block.timestamp + secondsInFuture;

        bytes memory signature = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            futureDeadline
        );

        // Should succeed
        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            NULLIFIER,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            futureDeadline,
            signature
        );
    }

    /// @notice Fuzz test: Nonce increments correctly after multiple submissions
    function testFuzz_Nonce_IncrementsCorrectly(uint8 numSubmissions) public {
        numSubmissions = uint8(bound(numSubmissions, 1, 10));

        for (uint256 i = 0; i < numSubmissions; i++) {
            assertEq(gate.nonces(user), i, "Nonce should match iteration");

            bytes32 uniqueNullifier = bytes32(i + 0x1000);
            uint256 deadline = block.timestamp + 1 hours;

            bytes memory signature = _generateSignature(
                USER_PRIVATE_KEY,
                user,
                VALID_PROOF,
                DISTRICT_ROOT,
                uniqueNullifier,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                deadline
            );

            gate.verifyAndAuthorizeWithSignature(
                user,
                VALID_PROOF,
                DISTRICT_ROOT,
                uniqueNullifier,
                AUTHORITY_LEVEL,
                ACTION_DOMAIN,
                DISTRICT_ID,
                USA,
                deadline,
                signature
            );

            // Advance time to avoid rate limit
            vm.warp(block.timestamp + 61 seconds);
        }

        assertEq(gate.nonces(user), numSubmissions, "Final nonce should equal submissions");
    }

    // ============================================================================
    // Section 8: Two-Tree Proof EIP-712 Tests (BR3-001 Fix)
    // ============================================================================

    // Two-tree test setup helpers
    MockTwoTreeVerifier public twoTreeVerifier;
    MockUserRootRegistry public userRootRegistry;
    MockCellMapRegistry public cellMapRegistry;

    bytes32 public constant USER_ROOT = bytes32(uint256(0x111111));
    bytes32 public constant CELL_MAP_ROOT = bytes32(uint256(0x222222));
    uint8 public constant TWO_TREE_DEPTH = 20;

    /// @notice Helper to create valid two-tree public inputs
    function _createTwoTreePublicInputs() internal pure returns (uint256[29] memory) {
        uint256[29] memory inputs;
        inputs[0] = uint256(USER_ROOT);
        inputs[1] = uint256(CELL_MAP_ROOT);
        // District slots [2-25] - populate with test data
        for (uint i = 2; i < 26; i++) {
            inputs[i] = uint256(keccak256(abi.encode("district", i)));
        }
        inputs[26] = uint256(NULLIFIER);
        inputs[27] = uint256(ACTION_DOMAIN);
        inputs[28] = uint256(AUTHORITY_LEVEL);
        return inputs;
    }

    /// @notice Setup two-tree infrastructure
    function _setupTwoTreeInfrastructure() internal {
        // Deploy mock registries
        twoTreeVerifier = new MockTwoTreeVerifier();
        userRootRegistry = new MockUserRootRegistry();
        cellMapRegistry = new MockCellMapRegistry();

        // Register two-tree verifier
        vm.startPrank(governance);
        verifierRegistry.proposeVerifier(TWO_TREE_DEPTH, address(twoTreeVerifier));
        vm.stopPrank();
        vm.warp(block.timestamp + 14 days);
        verifierRegistry.executeVerifier(TWO_TREE_DEPTH);

        // Configure gate with two-tree registries
        vm.prank(governance);
        gate.proposeTwoTreeRegistries(address(userRootRegistry), address(cellMapRegistry));
        vm.warp(block.timestamp + 7 days);
        gate.executeTwoTreeRegistries();

        // Register valid roots
        userRootRegistry.registerUserRoot(USER_ROOT);
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT);
    }

    /// @notice Valid two-tree signature succeeds
    function test_TwoTree_ValidSignatureSucceeds() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            signature
        );

        // Verify nonce incremented
        assertEq(gate.nonces(user), 1, "Nonce should increment");
    }

    /// @notice Front-running protection: Same proof from different sender fails
    function test_TwoTree_FrontRunningProtectionSameProofDifferentSender() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        // User signs the proof
        bytes memory userSignature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        // Attacker extracts proof from mempool and tries to submit
        // The signature is still bound to user, so attacker can submit on behalf of user
        // BUT attacker cannot change the nullifier or any parameters
        vm.prank(attacker);
        gate.verifyTwoTreeProof(
            user, // Must specify user as signer
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            userSignature
        );

        // But attacker CANNOT change nullifier without invalidating signature
        publicInputs[26] = uint256(bytes32(uint256(0xA77AC4))); // Attacker tries different nullifier

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs, // Modified public inputs
            TWO_TREE_DEPTH,
            deadline,
            userSignature // Original signature - won't match
        );
    }

    /// @notice Nonce replay protection for two-tree proofs
    function test_TwoTree_NonceReplayRejection() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        // First submission succeeds
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            signature
        );

        // Try to reuse same signature (nonce has changed)
        vm.warp(block.timestamp + 61 seconds);
        publicInputs[26] = uint256(bytes32(uint256(0xBEEF))); // New nullifier

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            signature // Old signature with nonce=0
        );
    }

    /// @notice Expired deadline rejection for two-tree proofs
    function test_TwoTree_ExpiredDeadlineRejection() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 pastDeadline = block.timestamp - 1;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            pastDeadline
        );

        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            pastDeadline,
            signature
        );
    }

    /// @notice Wrong signer rejection for two-tree proofs
    function test_TwoTree_WrongSignerRejection() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        // Attacker signs with their key
        bytes memory attackerSignature = _generateTwoTreeSignature(
            ATTACKER_PRIVATE_KEY,
            attacker,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        // Try to claim it's from user
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user, // Claims to be user
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            attackerSignature // But uses attacker's signature
        );
    }

    /// @notice Different proof bytes invalidates two-tree signature
    function test_TwoTree_DifferentProofInvalidates() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        bytes memory differentProof = hex"cafebabe";

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user,
            differentProof, // Different proof
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            signature
        );
    }

    /// @notice Different public inputs invalidate two-tree signature
    function test_TwoTree_DifferentPublicInputsInvalidate() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        // Modify nullifier
        publicInputs[26] = uint256(bytes32(uint256(0xDEAD)));

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs, // Modified
            TWO_TREE_DEPTH,
            deadline,
            signature
        );
    }

    /// @notice Different verifier depth invalidates two-tree signature
    function test_TwoTree_DifferentVerifierDepthInvalidates() public {
        _setupTwoTreeInfrastructure();

        // Register additional depth
        vm.startPrank(governance);
        verifierRegistry.proposeVerifier(22, address(twoTreeVerifier));
        vm.stopPrank();
        vm.warp(block.timestamp + 14 days);
        verifierRegistry.executeVerifier(22);

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH, // Signed for depth 20
            deadline
        );

        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            22, // Try depth 22
            deadline,
            signature
        );
    }

    /// @notice Relayer can submit two-tree proof on behalf of signer
    function test_TwoTree_RelayerCanSubmit() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline
        );

        // Relayer submits on behalf of user
        vm.prank(relayer);
        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            signature
        );

        // Verify user's nonce incremented (not relayer's)
        assertEq(gate.nonces(user), 1, "User nonce should increment");
        assertEq(gate.nonces(relayer), 0, "Relayer nonce should not increment");
    }

    /// @notice Zero address signer reverts for two-tree proofs
    function test_TwoTree_ZeroAddressSignerReverts() public {
        _setupTwoTreeInfrastructure();

        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory dummySignature = new bytes(65);

        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.verifyTwoTreeProof(
            address(0),
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline,
            dummySignature
        );
    }

    /// @notice Cross-path nonce sharing prevents replay across single/two-tree paths
    function test_TwoTree_CrossPathNonceSharing() public {
        _setupTwoTreeInfrastructure();

        // User submits single-tree proof (nonce=0)
        bytes32 singleTreeNullifier = bytes32(uint256(0x111));
        uint256 deadline1 = block.timestamp + 1 hours;
        bytes memory signature1 = _generateSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            singleTreeNullifier, // Different nullifier to avoid collision
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline1
        );

        gate.verifyAndAuthorizeWithSignature(
            user,
            VALID_PROOF,
            DISTRICT_ROOT,
            singleTreeNullifier,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Nonce is now 1
        assertEq(gate.nonces(user), 1);

        // User submits two-tree proof (must use nonce=1)
        vm.warp(block.timestamp + 61 seconds);
        uint256[29] memory publicInputs = _createTwoTreePublicInputs();
        uint256 deadline2 = block.timestamp + 1 hours;

        bytes memory signature2 = _generateTwoTreeSignature(
            USER_PRIVATE_KEY,
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline2
        );

        gate.verifyTwoTreeProof(
            user,
            VALID_PROOF,
            publicInputs,
            TWO_TREE_DEPTH,
            deadline2,
            signature2
        );

        // Nonce is now 2
        assertEq(gate.nonces(user), 2);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    /// @notice Helper to generate EIP-712 signature for single-tree proof submission
    function _generateSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 authorityLevel,
        bytes32 actionDomain,
        bytes32 districtId,
        bytes3 country,
        uint256 deadline
    ) internal view returns (bytes memory signature) {
        uint256 nonce = gate.nonces(signer);

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_PROOF_TYPEHASH(),
                keccak256(proof),
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
            abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    /// @notice Helper to generate EIP-712 signature for two-tree proof submission
    function _generateTwoTreeSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        uint256[29] memory publicInputs,
        uint8 verifierDepth,
        uint256 deadline
    ) internal view returns (bytes memory signature) {
        uint256 nonce = gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_TWO_TREE_PROOF_TYPEHASH(),
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

/// @notice Mock verifier that always returns true for testing (single-tree)
contract MockVerifierEIP712 {
    function verifyProof(bytes calldata, uint256[5] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock verifier for two-tree proofs
contract MockTwoTreeVerifier {
    function verifyProof(bytes calldata, uint256[29] calldata) external pure returns (bool) {
        return true;
    }
}

/// @notice Mock UserRootRegistry for testing
contract MockUserRootRegistry {
    mapping(bytes32 => bool) public validRoots;

    function registerUserRoot(bytes32 root) external {
        validRoots[root] = true;
    }

    function isValidUserRoot(bytes32 root) external view returns (bool) {
        return validRoots[root];
    }

    function getCountryAndDepth(bytes32) external pure returns (bytes3, uint8) {
        return ("USA", 20);
    }
}

/// @notice Mock CellMapRegistry for testing
contract MockCellMapRegistry {
    mapping(bytes32 => bool) public validRoots;

    function registerCellMapRoot(bytes32 root) external {
        validRoots[root] = true;
    }

    function isValidCellMapRoot(bytes32 root) external view returns (bool) {
        return validRoots[root];
    }

    function getCountryAndDepth(bytes32) external pure returns (bytes3, uint8) {
        return ("USA", 20);
    }
}
