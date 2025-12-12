// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";

/// @title EIP-712 MEV Protection Tests
/// @notice Tests the MEV-resistant signature-based proof submission
/// @dev Validates CRITICAL #5 fix from adversarial security analysis
contract EIP712MEVTest is Test {
    DistrictGate gate;
    DistrictRegistry registry;
    NullifierRegistry nullifierRegistry;
    address verifier;
    address governance;
    address user;
    address mevBot;

    uint256 userPrivateKey;
    uint256 mevBotPrivateKey;

    bytes32 constant DISTRICT_ROOT = bytes32(uint256(0x123));
    bytes32 constant NULLIFIER = bytes32(uint256(0x456));
    bytes32 constant ACTION_ID = bytes32(uint256(0x789));
    bytes3 constant COUNTRY = "USA";

    function setUp() public {
        // Set up accounts
        governance = makeAddr("governance");
        userPrivateKey = 0x1234;
        user = vm.addr(userPrivateKey);
        mevBotPrivateKey = 0x5678;
        mevBot = vm.addr(mevBotPrivateKey);

        // Deploy mock verifier (always returns true)
        verifier = address(new MockVerifier());

        // Deploy registries
        registry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);

        // Deploy gate (Phase 1: no guardians)
        gate = new DistrictGate(verifier, address(registry), address(nullifierRegistry), governance);

        // Authorize gate as caller
        vm.prank(governance);
        nullifierRegistry.authorizeCaller(address(gate));

        // Register district (actions are permissionless - no authorization needed)
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, COUNTRY);
    }

    /// @notice Test that signature-based submission binds rewards to signer, not submitter
    function test_SignatureBindsRewardsToSigner() public {
        // User generates proof and signs it
        bytes memory proof = hex"deadbeef"; // Mock proof
        uint256 deadline = block.timestamp + 1 hours;

        // Get user's nonce
        uint256 nonce = gate.nonces(user);

        // Generate EIP-712 signature
        bytes32 digest = _getEIP712Digest(
            user,
            keccak256(proof),
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            nonce,
            deadline
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // MEV bot front-runs the transaction
        vm.startPrank(mevBot);

        // Record events
        vm.recordLogs();

        // MEV bot submits user's proof with higher gas
        gate.verifyAndAuthorizeWithSignature(
            user,  // Original signer
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            deadline,
            signature
        );

        // Check events were emitted (NullifierRegistry emits ActionCreated + ActionSubmitted, then DistrictGate emits ActionVerified)
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 3, "Should emit three events");

        // Decode ActionVerified event (last event, index 2)
        // event ActionVerified(address indexed user, address indexed submitter, ...)
        assertEq(entries[2].topics.length, 4, "Should have 4 indexed topics");

        // topics[0] = event signature
        // topics[1] = user (indexed)
        // topics[2] = submitter (indexed)
        // topics[3] = districtRoot (indexed)

        address eventUser = address(uint160(uint256(entries[2].topics[1])));
        address eventSubmitter = address(uint160(uint256(entries[2].topics[2])));

        // CRITICAL: Reward must go to 'user' (signer), not 'submitter' (MEV bot)
        assertEq(eventUser, user, "Event user must be original signer");
        assertEq(eventSubmitter, mevBot, "Event submitter must be MEV bot");

        vm.stopPrank();
    }

    /// @notice Test that signature verification prevents signature forgery
    function test_SignatureVerificationPreventsForgery() public {
        bytes memory proof = hex"deadbeef";
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(user);

        // MEV bot tries to sign on behalf of user
        bytes32 digest = _getEIP712Digest(
            user,
            keccak256(proof),
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            nonce,
            deadline
        );

        // MEV bot signs with their own key (not user's key)
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(mevBotPrivateKey, digest);
        bytes memory fakeSignature = abi.encodePacked(r, s, v);

        // Submission should fail
        vm.startPrank(mevBot);
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,  // Claims to be user
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            deadline,
            fakeSignature  // But signature is from MEV bot
        );
        vm.stopPrank();
    }

    /// @notice Test that deadline prevents signature from being replayed much later
    function test_DeadlinePreventsStalSignatures() public {
        bytes memory proof = hex"deadbeef";
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(user);

        // User signs
        bytes32 digest = _getEIP712Digest(
            user,
            keccak256(proof),
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            nonce,
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Fast forward past deadline
        vm.warp(deadline + 1);

        // Submission should fail
        vm.expectRevert(DistrictGate.SignatureExpired.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            deadline,
            signature
        );
    }

    /// @notice Test that nonce prevents signature replay
    function test_NoncePreventReplay() public {
        bytes memory proof = hex"deadbeef";
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(user);

        // User signs
        bytes32 digest = _getEIP712Digest(
            user,
            keccak256(proof),
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            nonce,
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // First submission succeeds
        gate.verifyAndAuthorizeWithSignature(
            user,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            COUNTRY,
            deadline,
            signature
        );

        // Nonce should have incremented
        assertEq(gate.nonces(user), nonce + 1, "Nonce should increment");

        // Second submission with same signature should fail (different nullifier to avoid nullifier reuse error)
        bytes32 newNullifier = bytes32(uint256(0x999));
        vm.expectRevert(DistrictGate.InvalidSignature.selector);
        gate.verifyAndAuthorizeWithSignature(
            user,
            proof,
            DISTRICT_ROOT,
            newNullifier,  // Different nullifier
            ACTION_ID,
            COUNTRY,
            deadline,
            signature  // Same signature (wrong nonce now)
        );
    }

    /// @notice Helper to compute EIP-712 digest
    function _getEIP712Digest(
        address signer,
        bytes32 proofHash,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
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
                actionId,
                country,
                nonce,
                deadline
            )
        );

        return keccak256(
            abi.encodePacked("\x19\x01", gate.DOMAIN_SEPARATOR(), structHash)
        );
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
