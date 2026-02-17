// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";

/// @title DistrictGate Action Domain Whitelist Tests
/// @notice Tests for SA-001 fix: Action domain whitelist to prevent nullifier replay
/// @dev Validates that users cannot generate fresh nullifiers by choosing arbitrary actionDomains
///
/// VULNERABILITY CONTEXT (SA-001):
/// - Circuit produces: nullifier = hash(user_secret, actionDomain)
/// - Before fix: User signs proof with ANY actionDomain → fresh nullifier → vote multiple times
/// - After fix: Only governance-whitelisted actionDomains are accepted
///
/// TEST COVERAGE:
/// 1. Rejects proofs with unregistered action domains
/// 2. Accepts proofs with whitelisted action domains
/// 3. Enforces 7-day timelock on action domain registration
/// 4. Prevents double-voting with same actionDomain (nullifier works correctly)
/// 5. Governance can revoke action domains
contract DistrictGateActionDomainTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    address public verifier;

    address public governance = address(0x1);
    address public user = address(0x2);

    bytes32 public constant DISTRICT_ROOT = bytes32(uint256(0x123));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant ACTION_DOMAIN_APPROVED = keccak256("petition-123");
    bytes32 public constant ACTION_DOMAIN_UNAPPROVED = keccak256("malicious-vote");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3)); // Level 3 authority
    bytes32 public constant DISTRICT_ID = keccak256("CA-SD-01");
    bytes3 public constant USA = "USA";
    uint8 public constant DEPTH_18 = 18;

    event ActionDomainProposed(bytes32 indexed actionDomain, uint256 executeTime);
    event ActionDomainActivated(bytes32 indexed actionDomain);
    event ActionDomainRevoked(bytes32 indexed actionDomain);
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
        // Deploy mock verifier
        verifier = address(new MockVerifier());

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

        // Setup: Register verifier for depth 18 (genesis registration)
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(DEPTH_18, verifier);
        verifierRegistry.sealGenesis();

        // Setup: Register district (depth 18, USA, no timelock for initial registration)
        districtRegistry.registerDistrict(DISTRICT_ROOT, USA, DEPTH_18);

        // Setup: Authorize gate as caller on NullifierRegistry (with 7-day timelock)
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));
    }

    // ============================================================================
    // SA-001 FIX: Action Domain Whitelist Tests
    // ============================================================================

    /// @notice CRITICAL TEST: Reject proofs with unregistered action domains
    /// @dev This is the core security fix for SA-001
    function test_RevertWhen_ActionDomainNotAllowed() public {
        // Setup: Try to submit proof with unapproved action domain
        bytes memory proof = hex"deadbeef";

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_UNAPPROVED,
            DISTRICT_ID,
            USA
        );

        // Expect: Revert with ActionDomainNotAllowed
        vm.expectRevert(DistrictGate.ActionDomainNotAllowed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_UNAPPROVED,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test that approved action domains are accepted
    function test_SuccessWhen_ActionDomainAllowed() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_APPROVED);

        bytes memory proof = hex"deadbeef";

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        // Expect: Success with event emission
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(
            signer,
            address(this),
            DISTRICT_ROOT,
            USA,
            DEPTH_18,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );

        // Verify: Nullifier was recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_APPROVED, NULLIFIER_1));
    }

    /// @notice Test that 7-day timelock is enforced on action domain registration
    function test_ActionDomainTimelockEnforced() public {
        bytes32 newDomain = keccak256("future-petition");

        // Propose action domain
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit ActionDomainProposed(newDomain, block.timestamp + 7 days);
        gate.proposeActionDomain(newDomain);

        // Verify: Cannot execute immediately
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeActionDomain(newDomain);

        // Verify: Cannot execute before timelock expires
        uint256 t1 = block.timestamp + 6 days + 23 hours;
        vm.warp(t1);
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeActionDomain(newDomain);

        // Verify: Can execute after timelock
        vm.warp(t1 + 1 hours + 1);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainActivated(newDomain);
        gate.executeActionDomain(newDomain);

        // Verify: Domain is now whitelisted
        assertTrue(gate.allowedActionDomains(newDomain));
    }

    /// @notice CRITICAL TEST: Cannot double-vote with same actionDomain
    /// @dev Validates that nullifiers work correctly - same actionDomain = same nullifier scope
    function test_CannotDoubleVoteWithSameActionDomain() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_APPROVED);

        bytes memory proof = hex"deadbeef";

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        // First vote: Success
        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Advance time to avoid rate limit
        vm.warp(_lastWarpTime + 61 seconds);

        // Second vote with SAME nullifier: Should fail
        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );
    }

    /// @notice Test that governance can revoke action domains
    function test_GovernanceCanRevokeActionDomain() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_APPROVED);

        // Verify: Domain is whitelisted
        assertTrue(gate.allowedActionDomains(ACTION_DOMAIN_APPROVED));

        // Revoke domain
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainRevoked(ACTION_DOMAIN_APPROVED);
        gate.revokeActionDomain(ACTION_DOMAIN_APPROVED);

        // Verify: Domain is no longer whitelisted
        assertFalse(gate.allowedActionDomains(ACTION_DOMAIN_APPROVED));

        // Verify: Proofs with revoked domain are rejected
        bytes memory proof = hex"deadbeef";
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        vm.expectRevert(DistrictGate.ActionDomainNotAllowed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER_2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline,
            signature
        );
    }

    /// @notice Test governance can cancel pending action domain
    function test_GovernanceCanCancelPendingActionDomain() public {
        bytes32 newDomain = keccak256("future-petition");

        // Propose action domain
        vm.prank(governance);
        gate.proposeActionDomain(newDomain);

        // Verify: Proposal exists
        assertGt(gate.pendingActionDomains(newDomain), 0);

        // Cancel proposal
        vm.prank(governance);
        gate.cancelActionDomain(newDomain);

        // Verify: Proposal cancelled
        assertEq(gate.pendingActionDomains(newDomain), 0);

        // Verify: Cannot execute cancelled proposal
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.executeActionDomain(newDomain);
    }

    /// @notice Test that non-governance cannot cancel pending action domain
    function test_RevertWhen_NonGovernanceCancelsPendingActionDomain() public {
        bytes32 newDomain = keccak256("future-petition");

        // Propose action domain
        vm.prank(governance);
        gate.proposeActionDomain(newDomain);

        // Try to cancel as non-governance
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(TimelockGovernance.UnauthorizedCaller.selector));
        gate.cancelActionDomain(newDomain);
    }

    /// @notice Test that non-governance cannot revoke action domain
    function test_RevertWhen_NonGovernanceRevokesActionDomain() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_APPROVED);

        // Try to revoke as non-governance
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(TimelockGovernance.UnauthorizedCaller.selector));
        gate.revokeActionDomain(ACTION_DOMAIN_APPROVED);
    }

    /// @notice Test that cancelling non-existent proposal fails
    function test_RevertWhen_CancellingNonExistentProposal() public {
        bytes32 fakeDomain = keccak256("never-proposed");

        vm.prank(governance);
        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.cancelActionDomain(fakeDomain);
    }

    /// @notice Test that executing non-existent proposal fails
    function test_RevertWhen_ExecutingNonExistentProposal() public {
        bytes32 fakeDomain = keccak256("never-proposed");

        vm.expectRevert(DistrictGate.ActionDomainNotPending.selector);
        gate.executeActionDomain(fakeDomain);
    }

    /// @notice Test multiple users can vote on same action domain with different nullifiers
    function test_MultipleUsersCanVoteOnSameActionDomain() public {
        // Setup: Whitelist action domain
        _whitelistActionDomain(ACTION_DOMAIN_APPROVED);

        bytes memory proof = hex"deadbeef";

        // User 1 votes
        uint256 user1PrivateKey = 0xAAA;
        address user1 = vm.addr(user1PrivateKey);
        bytes32 nullifier1 = bytes32(uint256(0x111));

        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            user1PrivateKey,
            user1,
            proof,
            DISTRICT_ROOT,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user1,
            proof,
            DISTRICT_ROOT,
            nullifier1,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline1,
            signature1
        );

        // Advance time to avoid rate limit
        vm.warp(_lastWarpTime + 61 seconds);

        // User 2 votes with different nullifier
        uint256 user2PrivateKey = 0xBBB;
        address user2 = vm.addr(user2PrivateKey);
        bytes32 nullifier2 = bytes32(uint256(0x222));

        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            user2PrivateKey,
            user2,
            proof,
            DISTRICT_ROOT,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user2,
            proof,
            DISTRICT_ROOT,
            nullifier2,
            AUTHORITY_LEVEL,
            ACTION_DOMAIN_APPROVED,
            DISTRICT_ID,
            USA,
            deadline2,
            signature2
        );

        // Verify: Both nullifiers recorded
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_APPROVED, nullifier1));
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_APPROVED, nullifier2));

        // Verify: Participant count is 2
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_APPROVED), 2);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    uint256 internal _lastWarpTime;

    /// @notice Helper to whitelist an action domain (propose + execute)
    function _whitelistActionDomain(bytes32 actionDomain) internal {
        vm.prank(governance);
        gate.proposeActionDomain(actionDomain);

        _lastWarpTime = block.timestamp + 7 days + 1;
        vm.warp(_lastWarpTime);
        gate.executeActionDomain(actionDomain);
    }

    /// @notice Helper to compute EIP-712 digest for DistrictGate
    function _getEIP712Digest(
        address /* signer */,
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
                gate.SUBMIT_PROOF_TYPEHASH(),
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
            abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash)
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
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 digest = _getEIP712Digest(
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

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
