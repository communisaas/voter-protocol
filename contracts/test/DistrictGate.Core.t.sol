// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";

/// @title DistrictGate Core Tests
/// @notice Tests the core verification functions of DistrictGate
/// @dev Validates CRITICAL #2 and #3 fixes from adversarial security analysis
contract DistrictGateCoreTest is Test {
    DistrictGate public gate;
    DistrictRegistry public registry;
    address public verifier;

    address public governance = address(0x1);
    address public user = address(0x2);

    bytes32 public constant DISTRICT_ROOT = bytes32(uint256(0x123));
    bytes32 public constant NULLIFIER = bytes32(uint256(0x456));
    bytes32 public constant ACTION_ID = bytes32(uint256(0x789));
    bytes3 public constant USA = "USA";

    event ActionVerified(
        address indexed user,
        address indexed submitter,
        bytes32 indexed districtRoot,
        bytes3 country,
        bytes32 nullifier,
        bytes32 actionId
    );

    function setUp() public {
        // Deploy mock verifier
        verifier = address(new MockVerifier());

        // Deploy registry
        registry = new DistrictRegistry(governance);

        // Deploy gate
        gate = new DistrictGate(verifier, address(registry), governance);
    }

    // ============ CRITICAL #2: Unregistered District Bypass Tests ============

    function test_RevertWhen_DistrictNotRegistered() public {
        // CRITICAL: This test validates CRITICAL #2 fix
        // Attack: Prove membership in unregistered district
        // Before fix: bytes3(0) == bytes3(0) passes
        // After fix: Explicit check rejects unregistered districts

        bytes32 fakeDistrict = bytes32(uint256(0xDEADBEEF));

        // Authorize the action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        // Generate mock proof
        bytes memory proof = hex"deadbeef";

        // Attempt verification without registering district
        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorize(proof, fakeDistrict, NULLIFIER, ACTION_ID, bytes3(0));
    }

    function test_RevertWhen_DistrictNotRegisteredWithValidCountry() public {
        // Even if attacker passes valid country code, unregistered district should fail
        bytes32 fakeDistrict = bytes32(uint256(0xBADDCAFE));

        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";

        // Try with valid country code but unregistered district
        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorize(proof, fakeDistrict, NULLIFIER, ACTION_ID, USA);
    }

    function test_RevertWhen_DistrictNotRegisteredWithSignature() public {
        // Test the signature-based function also rejects unregistered districts
        bytes32 fakeDistrict = bytes32(uint256(0xC0FFEE));

        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";
        uint256 deadline = block.timestamp + 1 hours;

        // Generate valid signature
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);
        uint256 nonce = gate.nonces(signer);

        bytes32 digest = _getEIP712Digest(
            signer,
            keccak256(proof),
            fakeDistrict,
            NULLIFIER,
            ACTION_ID,
            bytes3(0),
            nonce,
            deadline
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            fakeDistrict,
            NULLIFIER,
            ACTION_ID,
            bytes3(0),
            deadline,
            signature
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

    function test_RevertWhen_BatchContainsUnregisteredDistrict() public {
        // Test batch verification rejects if any district is unregistered
        bytes32 goodDistrict = DISTRICT_ROOT;
        bytes32 badDistrict = bytes32(uint256(0xBADBEEF));

        // Register only the good district
        vm.startPrank(governance);
        registry.registerDistrict(goodDistrict, USA);
        gate.authorizeAction(ACTION_ID);
        vm.stopPrank();

        // Create batch with one good and one bad district
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = goodDistrict;
        districtRoots[1] = badDistrict; // Unregistered!

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = NULLIFIER;
        nullifiers[1] = bytes32(uint256(0x999));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        // Should fail on second district
        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    // ============ CRITICAL #3: verifyAndAuthorize() Core Tests ============

    function test_VerifyAndAuthorize_BasicFlow() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Authorize action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        // Generate proof
        bytes memory proof = hex"deadbeef";

        // Verify action
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(user, user, DISTRICT_ROOT, USA, NULLIFIER, ACTION_ID);

        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, ACTION_ID, USA);

        // Verify nullifier was marked as used
        assertTrue(gate.isNullifierUsed(NULLIFIER));
    }

    function test_RevertWhen_ActionNotAuthorized() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // DON'T authorize action
        bytes32 unauthorizedAction = bytes32(uint256(0xBAD));

        bytes memory proof = hex"deadbeef";

        vm.expectRevert(DistrictGate.ActionNotAuthorized.selector);
        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, unauthorizedAction, USA);
    }

    function test_RevertWhen_NullifierAlreadyUsed() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Authorize action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";

        // First verification succeeds
        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, ACTION_ID, USA);

        // Second verification with same nullifier fails
        vm.expectRevert(DistrictGate.NullifierAlreadyUsed.selector);
        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, ACTION_ID, USA);
    }

    function test_RevertWhen_DistrictCountryMismatch() public {
        // Register district for USA
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Authorize action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";

        // Try to verify with wrong country
        vm.expectRevert(DistrictGate.UnauthorizedDistrict.selector);
        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, ACTION_ID, bytes3("GBR"));
    }

    function test_NullifierMarkedUsedAfterSuccess() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Authorize action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";

        // Nullifier not used before
        assertFalse(gate.isNullifierUsed(NULLIFIER));

        // Verify action
        vm.prank(user);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, NULLIFIER, ACTION_ID, USA);

        // Nullifier marked as used
        assertTrue(gate.isNullifierUsed(NULLIFIER));
    }

    function test_MultipleUsersCanVerifyWithDifferentNullifiers() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Authorize action
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        bytes memory proof = hex"deadbeef";

        // User 1 verifies
        address user1 = address(0xA);
        bytes32 nullifier1 = bytes32(uint256(0x111));
        vm.prank(user1);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, nullifier1, ACTION_ID, USA);

        // User 2 verifies with different nullifier
        address user2 = address(0xB);
        bytes32 nullifier2 = bytes32(uint256(0x222));
        vm.prank(user2);
        gate.verifyAndAuthorize(proof, DISTRICT_ROOT, nullifier2, ACTION_ID, USA);

        // Both nullifiers marked as used
        assertTrue(gate.isNullifierUsed(nullifier1));
        assertTrue(gate.isNullifierUsed(nullifier2));
    }

    function test_IsActionAuthorized() public view {
        // Initially not authorized
        assertFalse(gate.isActionAuthorized(ACTION_ID));
    }

    function test_IsNullifierUsed() public view {
        // Initially not used
        assertFalse(gate.isNullifierUsed(NULLIFIER));
    }

    // ============ Action Authorization Tests ============

    function test_AuthorizeAction() public {
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        assertTrue(gate.isActionAuthorized(ACTION_ID));
    }

    function test_RevertWhen_AuthorizeActionUnauthorized() public {
        vm.prank(user);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.authorizeAction(ACTION_ID);
    }

    function test_DeauthorizeAction() public {
        // First authorize
        vm.startPrank(governance);
        gate.authorizeAction(ACTION_ID);
        assertTrue(gate.isActionAuthorized(ACTION_ID));

        // Then deauthorize
        gate.deauthorizeAction(ACTION_ID);
        assertFalse(gate.isActionAuthorized(ACTION_ID));
        vm.stopPrank();
    }

    function test_RevertWhen_DeauthorizeActionUnauthorized() public {
        vm.prank(governance);
        gate.authorizeAction(ACTION_ID);

        vm.prank(user);
        vm.expectRevert(DistrictGate.UnauthorizedCaller.selector);
        gate.deauthorizeAction(ACTION_ID);
    }

    function test_BatchAuthorizeActions() public {
        bytes32[] memory actionIds = new bytes32[](3);
        actionIds[0] = bytes32(uint256(0x1));
        actionIds[1] = bytes32(uint256(0x2));
        actionIds[2] = bytes32(uint256(0x3));

        vm.prank(governance);
        gate.batchAuthorizeActions(actionIds);

        assertTrue(gate.isActionAuthorized(actionIds[0]));
        assertTrue(gate.isActionAuthorized(actionIds[1]));
        assertTrue(gate.isActionAuthorized(actionIds[2]));
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
