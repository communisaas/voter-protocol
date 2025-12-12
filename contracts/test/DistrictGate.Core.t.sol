// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";

/// @title DistrictGate Core Tests
/// @notice Tests the core verification functions of DistrictGate
/// @dev Validates CRITICAL #2 and #3 fixes from adversarial security analysis
///      Actions are permissionless - any bytes32 actionId is valid
contract DistrictGateCoreTest is Test {
    DistrictGate public gate;
    DistrictRegistry public registry;
    NullifierRegistry public nullifierRegistry;
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

        // Deploy registries
        registry = new DistrictRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);

        // Deploy gate (Phase 1: no guardians)
        gate = new DistrictGate(verifier, address(registry), address(nullifierRegistry), governance);

        // Authorize gate as caller on NullifierRegistry
        vm.prank(governance);
        nullifierRegistry.authorizeCaller(address(gate));
    }

    // ============ CRITICAL #2: Unregistered District Bypass Tests ============

    function test_RevertWhen_DistrictNotRegistered() public {
        // CRITICAL: This test validates CRITICAL #2 fix
        // Attack: Prove membership in unregistered district
        // Before fix: bytes3(0) == bytes3(0) passes
        // After fix: Explicit check rejects unregistered districts

        bytes32 fakeDistrict = bytes32(uint256(0xDEADBEEF));

        // Generate mock proof
        bytes memory proof = hex"deadbeef";

        // Attempt verification without registering district (using signature-based function)
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            fakeDistrict,
            NULLIFIER,
            ACTION_ID,
            bytes3(0)
        );

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

    function test_RevertWhen_DistrictNotRegisteredWithValidCountry() public {
        // Even if attacker passes valid country code, unregistered district should fail
        bytes32 fakeDistrict = bytes32(uint256(0xBADDCAFE));

        bytes memory proof = hex"deadbeef";

        // Generate signature
        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            fakeDistrict,
            NULLIFIER,
            ACTION_ID,
            USA
        );

        // Try with valid country code but unregistered district
        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            fakeDistrict,
            NULLIFIER,
            ACTION_ID,
            USA,
            deadline,
            signature
        );
    }

    function test_RevertWhen_DistrictNotRegisteredWithSignature() public {
        // Test the signature-based function also rejects unregistered districts
        bytes32 fakeDistrict = bytes32(uint256(0xC0FFEE));

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

    /// @notice Helper to generate EIP-712 signature for proof submission
    function _generateSignature(
        uint256 privateKey,
        address signer,
        bytes memory proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 country
    ) internal view returns (bytes memory signature, uint256 deadline) {
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 digest = _getEIP712Digest(
            signer,
            keccak256(proof),
            districtRoot,
            nullifier,
            actionId,
            country,
            nonce,
            deadline
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function test_RevertWhen_BatchContainsUnregisteredDistrict() public {
        // Test batch verification rejects if any district is unregistered
        // NOTE: Batch functions are deprecated, so we test individual submission
        bytes32 goodDistrict = DISTRICT_ROOT;
        bytes32 badDistrict = bytes32(uint256(0xBADBEEF));

        // Register only the good district
        vm.prank(governance);
        registry.registerDistrict(goodDistrict, USA);

        // Try to submit proof for unregistered district
        bytes memory proof = hex"cafebabe";
        bytes32 nullifier = bytes32(uint256(0x999));

        uint256 userPrivateKey = 0x1234;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            badDistrict, // Unregistered!
            nullifier,
            ACTION_ID,
            USA
        );

        // Should fail on unregistered district
        vm.expectRevert(DistrictGate.DistrictNotRegistered.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            badDistrict,
            nullifier,
            ACTION_ID,
            USA,
            deadline,
            signature
        );
    }

    // ============ CRITICAL #3: verifyAndAuthorizeWithSignature() Core Tests ============

    function test_VerifyAndAuthorize_BasicFlow() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        // Generate proof (actions are permissionless - no authorization needed)
        bytes memory proof = hex"deadbeef";

        // Generate signature
        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA
        );

        // Verify action
        vm.expectEmit(true, true, true, true);
        emit ActionVerified(signer, address(this), DISTRICT_ROOT, USA, NULLIFIER, ACTION_ID);

        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA,
            deadline,
            signature
        );

        // Verify nullifier was marked as used
        assertTrue(gate.isNullifierUsed(ACTION_ID, NULLIFIER));
    }

    function test_RevertWhen_NullifierAlreadyUsed() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        bytes memory proof = hex"deadbeef";

        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA
        );

        // First verification succeeds
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA,
            deadline,
            signature
        );

        // Second verification with same nullifier fails (need new signature with new nonce)
        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA
        );

        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA,
            deadline2,
            signature2
        );
    }

    function test_RevertWhen_DistrictCountryMismatch() public {
        // Register district for USA
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        bytes memory proof = hex"deadbeef";

        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            bytes3("GBR")
        );

        // Try to verify with wrong country
        vm.expectRevert(DistrictGate.UnauthorizedDistrict.selector);
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            bytes3("GBR"),
            deadline,
            signature
        );
    }

    function test_NullifierMarkedUsedAfterSuccess() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        bytes memory proof = hex"deadbeef";

        // Nullifier not used before
        assertFalse(gate.isNullifierUsed(ACTION_ID, NULLIFIER));

        uint256 userPrivateKey = 0x2222;
        address signer = vm.addr(userPrivateKey);

        (bytes memory signature, uint256 deadline) = _generateSignature(
            userPrivateKey,
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA
        );

        // Verify action
        gate.verifyAndAuthorizeWithSignature(
            signer,
            proof,
            DISTRICT_ROOT,
            NULLIFIER,
            ACTION_ID,
            USA,
            deadline,
            signature
        );

        // Nullifier marked as used
        assertTrue(gate.isNullifierUsed(ACTION_ID, NULLIFIER));
    }

    function test_MultipleUsersCanVerifyWithDifferentNullifiers() public {
        // Register district
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT, USA);

        bytes memory proof = hex"deadbeef";

        // User 1 verifies
        uint256 user1PrivateKey = 0xAAA;
        address user1 = vm.addr(user1PrivateKey);
        bytes32 nullifier1 = bytes32(uint256(0x111));

        (bytes memory signature1, uint256 deadline1) = _generateSignature(
            user1PrivateKey,
            user1,
            proof,
            DISTRICT_ROOT,
            nullifier1,
            ACTION_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user1,
            proof,
            DISTRICT_ROOT,
            nullifier1,
            ACTION_ID,
            USA,
            deadline1,
            signature1
        );

        // User 2 verifies with different nullifier
        uint256 user2PrivateKey = 0xBBB;
        address user2 = vm.addr(user2PrivateKey);
        bytes32 nullifier2 = bytes32(uint256(0x222));

        (bytes memory signature2, uint256 deadline2) = _generateSignature(
            user2PrivateKey,
            user2,
            proof,
            DISTRICT_ROOT,
            nullifier2,
            ACTION_ID,
            USA
        );

        gate.verifyAndAuthorizeWithSignature(
            user2,
            proof,
            DISTRICT_ROOT,
            nullifier2,
            ACTION_ID,
            USA,
            deadline2,
            signature2
        );

        // Both nullifiers marked as used
        assertTrue(gate.isNullifierUsed(ACTION_ID, nullifier1));
        assertTrue(gate.isNullifierUsed(ACTION_ID, nullifier2));
    }

    function test_IsNullifierUsed() public view {
        // Initially not used
        assertFalse(gate.isNullifierUsed(ACTION_ID, NULLIFIER));
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
