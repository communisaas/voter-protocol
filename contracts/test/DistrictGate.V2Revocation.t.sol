// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/UserRootRegistry.sol";
import "../src/CellMapRegistry.sol";
import "../src/EngagementRootRegistry.sol";
import "../src/RevocationRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title DistrictGate V2 Revocation Tests
/// @notice Exercises the v2 verify path: 33 public inputs with
///         revocation_nullifier + revocation_registry_root cross-checked against
///         the on-chain RevocationRegistry.
contract DistrictGateV2RevocationTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    UserRootRegistry public userRootRegistry;
    CellMapRegistry public cellMapRegistry;
    EngagementRootRegistry public engagementRootRegistry;
    RevocationRegistry public revocationRegistry;

    MockThreeTreeV2Verifier public passingVerifier;
    MockThreeTreeV2Verifier public failingVerifier;

    address public governance = address(0x1);
    address public relayer = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant USER_ROOT_1 = bytes32(uint256(0xAAAA1111));
    bytes32 public constant CELL_MAP_ROOT_1 = bytes32(uint256(0xBBBB1111));
    bytes32 public constant ENGAGEMENT_ROOT_1 = bytes32(uint256(0xCCCC1111));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("election-2024");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant EMPTY_TREE_ROOT = bytes32(uint256(0xDEADBEEF));
    bytes32 public constant REVOKED_NULLIFIER = keccak256("revoked-credential-hash");
    bytes32 public constant FRESH_NULLIFIER = keccak256("fresh-credential-hash");

    bytes3 public constant USA = "USA";
    uint8 public constant VERIFIER_DEPTH = 20;

    function setUp() public {
        passingVerifier = new MockThreeTreeV2Verifier(true);
        failingVerifier = new MockThreeTreeV2Verifier(false);

        districtRegistry = new DistrictRegistry(governance, 7 days);
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        verifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);
        userRootRegistry = new UserRootRegistry(governance, 7 days);
        cellMapRegistry = new CellMapRegistry(governance, 7 days);
        engagementRootRegistry = new EngagementRootRegistry(governance, 7 days);
        revocationRegistry = new RevocationRegistry(
            governance,
            7 days,
            7 days,
            EMPTY_TREE_ROOT
        );

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

        vm.startPrank(governance);
        verifierRegistry.registerThreeTreeVerifier(VERIFIER_DEPTH, address(passingVerifier));
        verifierRegistry.sealGenesis();
        vm.stopPrank();

        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        vm.startPrank(governance);
        userRootRegistry.registerUserRoot(USER_ROOT_1, USA, 20);
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_1, USA, 20);
        engagementRootRegistry.registerEngagementRoot(ENGAGEMENT_ROOT_1, 20);
        vm.stopPrank();

        vm.startPrank(governance);
        gate.setRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        gate.setRevocationRegistryGenesis(address(revocationRegistry));
        gate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        gate.sealGenesis();
        vm.stopPrank();

        vm.startPrank(governance);
        revocationRegistry.authorizeRelayerGenesis(relayer);
        revocationRegistry.sealGenesis();
        vm.stopPrank();
    }

    // ========================================================================
    // HAPPY PATH
    // ========================================================================

    function test_V2_VerifyProof_NonRevokedCredential_Succeeds() public {
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            FRESH_NULLIFIER,
            EMPTY_TREE_ROOT
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ========================================================================
    // REVOCATION REJECTION
    // ========================================================================

    function test_V2_VerifyProof_RevokedCredential_Rejected() public {
        // Relayer emits a revocation for the REVOKED_NULLIFIER.
        bytes32 newRoot = bytes32(uint256(0xCAFE));
        vm.prank(relayer);
        revocationRegistry.emitRevocation(REVOKED_NULLIFIER, newRoot);

        // Attacker holds a pre-revocation proof with revocation_nullifier =
        // REVOKED_NULLIFIER and the *pre-revocation* root. Under the TTL
        // window the root is still acceptable, but the isRevoked mapping
        // returns true and the contract rejects.
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            REVOKED_NULLIFIER,
            EMPTY_TREE_ROOT  // Still in TTL window.
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.CredentialRevoked.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    function test_V2_VerifyProof_EmitsRevocationBlockedEvent() public {
        bytes32 newRoot = bytes32(uint256(0xCAFE));
        vm.prank(relayer);
        revocationRegistry.emitRevocation(REVOKED_NULLIFIER, newRoot);

        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            REVOKED_NULLIFIER,
            EMPTY_TREE_ROOT
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectEmit(true, true, false, false);
        emit DistrictGate.RevocationBlockedSubmission(REVOKED_NULLIFIER, address(this));
        vm.expectRevert(DistrictGate.CredentialRevoked.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // STALE ROOT REJECTION (TTL window expired)
    // ========================================================================

    function test_V2_VerifyProof_StaleRevocationRoot_Rejected() public {
        // Advance well beyond the TTL so EMPTY_TREE_ROOT is no longer
        // acceptable once a revocation advances the current root.
        bytes32 newRoot = bytes32(uint256(0xCAFE));
        vm.prank(relayer);
        revocationRegistry.emitRevocation(keccak256("some-other-revocation"), newRoot);

        // TTL = 1 hour; advance 2 hours.
        vm.warp(block.timestamp + 2 hours);

        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            FRESH_NULLIFIER,
            EMPTY_TREE_ROOT  // Now stale.
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.StaleRevocationRoot.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // UNKNOWN ROOT REJECTION
    // ========================================================================

    function test_V2_VerifyProof_UnknownRoot_Rejected() public {
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            FRESH_NULLIFIER,
            bytes32(uint256(0xBAD))  // Never-seen root.
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.StaleRevocationRoot.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // INVALID VERIFIER OUTPUT
    // ========================================================================

    function test_V2_VerifyProof_InvalidVerifier_Rejected() public {
        // Swap in a failing verifier via upgrade path (verifier already
        // registered in setUp so we must upgrade, not re-register).
        vm.prank(governance);
        verifierRegistry.proposeThreeTreeVerifierUpgrade(VERIFIER_DEPTH, address(failingVerifier));
        vm.warp(block.timestamp + 14 days);
        verifierRegistry.executeThreeTreeVerifierUpgrade(VERIFIER_DEPTH);

        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            FRESH_NULLIFIER,
            EMPTY_TREE_ROOT
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2Signature(
            proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.ThreeTreeVerificationFailed.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // REGISTRY NOT CONFIGURED
    // ========================================================================

    function test_V2_VerifyProof_RegistryNotConfigured_Rejected() public {
        // Deploy a fresh gate without revocationRegistry configured.
        DistrictGate freshGate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        vm.startPrank(governance);
        freshGate.setRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        freshGate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        freshGate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        freshGate.sealGenesis();
        vm.stopPrank();

        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(freshGate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(freshGate));

        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildV2PublicInputs(
            USER_ROOT_1,
            CELL_MAP_ROOT_1,
            NULLIFIER_1,
            ACTION_DOMAIN_1,
            AUTHORITY_LEVEL,
            ENGAGEMENT_ROOT_1,
            2,
            FRESH_NULLIFIER,
            EMPTY_TREE_ROOT
        );

        (address signer, bytes memory signature, uint256 deadline) = _generateV2SignatureForGate(
            freshGate, proof, publicInputs, VERIFIER_DEPTH
        );

        vm.expectRevert(DistrictGate.RevocationRegistryNotConfigured.selector);
        freshGate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // POST-GENESIS REGISTRY CHANGE (timelocked)
    // ========================================================================

    function test_V2_RevocationRegistry_TimelockedChange() public {
        RevocationRegistry newReg = new RevocationRegistry(
            governance,
            7 days,
            7 days,
            bytes32(uint256(0xBEEF))
        );
        vm.prank(governance);
        gate.proposeRevocationRegistry(address(newReg));

        assertEq(gate.pendingRevocationRegistry(), address(newReg));
        assertTrue(gate.pendingRevocationRegistryExecuteTime() > block.timestamp);

        vm.warp(block.timestamp + 7 days + 1);
        gate.executeRevocationRegistry();

        assertEq(address(gate.revocationRegistry()), address(newReg));
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    function _buildV2PublicInputs(
        bytes32 userRoot,
        bytes32 cellMapRoot,
        bytes32 nullifier,
        bytes32 actionDomain,
        bytes32 authorityLevel,
        bytes32 engagementRoot,
        uint256 engagementTier,
        bytes32 revocationNullifier,
        bytes32 revocationRoot
    ) internal pure returns (uint256[33] memory inputs) {
        inputs[0] = uint256(userRoot);
        inputs[1] = uint256(cellMapRoot);
        // inputs[2..25] default to 0 (empty district slots)
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(actionDomain);
        inputs[28] = uint256(authorityLevel);
        inputs[29] = uint256(engagementRoot);
        inputs[30] = engagementTier;
        inputs[31] = uint256(revocationNullifier);
        inputs[32] = uint256(revocationRoot);
    }

    function _generateV2Signature(
        bytes memory proof,
        uint256[33] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        return _generateV2SignatureForGate(gate, proof, publicInputs, verifierDepth);
    }

    function _generateV2SignatureForGate(
        DistrictGate _gate,
        bytes memory proof,
        uint256[33] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        uint256 privateKey = 0xB0B;
        signer = vm.addr(privateKey);
        deadline = block.timestamp + 1 hours;
        uint256 nonce = _gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                _gate.SUBMIT_THREE_TREE_PROOF_V2_TYPEHASH(),
                proofHash,
                publicInputsHash,
                verifierDepth,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _gate.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

/// @notice Mock 33-input verifier
contract MockThreeTreeV2Verifier {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}
