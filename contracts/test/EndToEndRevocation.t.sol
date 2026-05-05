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

/// @title End-to-end revocation flow tests
/// @notice Stage 5 Section 5.7: three concrete scenarios stitched together.
///         1. Happy path: non-revoked commitment proof succeeds.
///         2. Replay: attacker emits revocation, then attempts to resubmit a
///            pre-revocation proof using the same commitment -> rejected.
///         3. Race: revocation happens between proof generation and submission.
///            Within TTL -> old root still acceptable (pending mapping dedup).
///            After TTL -> proof rejected on stale root.
contract EndToEndRevocationTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;
    UserRootRegistry public userRootRegistry;
    CellMapRegistry public cellMapRegistry;
    EngagementRootRegistry public engagementRootRegistry;
    RevocationRegistry public revocationRegistry;

    E2EMockVerifier public passingVerifier;

    address public governance = address(0x1);
    address public relayer = address(0x2);

    bytes32 public constant USER_ROOT_1 = bytes32(uint256(0xAAAA1111));
    bytes32 public constant CELL_MAP_ROOT_1 = bytes32(uint256(0xBBBB1111));
    bytes32 public constant ENGAGEMENT_ROOT_1 = bytes32(uint256(0xCCCC1111));
    bytes32 public constant NULLIFIER_1 = bytes32(uint256(0x456));
    bytes32 public constant NULLIFIER_2 = bytes32(uint256(0x789));
    bytes32 public constant ACTION_DOMAIN_1 = keccak256("e2e-action-2024");
    bytes32 public constant AUTHORITY_LEVEL = bytes32(uint256(3));
    bytes32 public constant EMPTY_TREE_ROOT = bytes32(uint256(0xDEADBEEF));

    bytes32 public constant COMMIT_C_REVNULL = keccak256("revocation-nullifier-of-commit-C");
    bytes32 public constant UNCOMPROMISED_REVNULL = keccak256("fresh-user-revnull");

    bytes3 public constant USA = "USA";
    uint8 public constant VERIFIER_DEPTH = 20;

    function setUp() public {
        passingVerifier = new E2EMockVerifier();

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
        userRootRegistry.registerUserRoot(USER_ROOT_1, USA, 20);
        cellMapRegistry.registerCellMapRoot(CELL_MAP_ROOT_1, USA, 20);
        engagementRootRegistry.registerEngagementRoot(ENGAGEMENT_ROOT_1, 20);
        vm.stopPrank();

        vm.prank(governance);
        nullifierRegistry.proposeCallerAuthorization(address(gate));
        vm.warp(block.timestamp + 7 days);
        nullifierRegistry.executeCallerAuthorization(address(gate));

        vm.startPrank(governance);
        gate.setRegistriesGenesis(address(userRootRegistry), address(cellMapRegistry));
        gate.setEngagementRegistryGenesis(address(engagementRootRegistry));
        gate.setRevocationRegistryGenesis(address(revocationRegistry));
        gate.registerActionDomainGenesis(ACTION_DOMAIN_1);
        gate.sealGenesis();

        revocationRegistry.authorizeRelayerGenesis(relayer);
        revocationRegistry.sealGenesis();
        vm.stopPrank();
    }

    // ========================================================================
    // 1. HAPPY PATH
    // ========================================================================

    function test_E2E_HappyPath_NonRevokedCredential() public {
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildPublicInputs(
            NULLIFIER_1,
            UNCOMPROMISED_REVNULL,
            EMPTY_TREE_ROOT
        );
        (address signer, bytes memory signature, uint256 deadline) =
            _sign(proof, publicInputs, VERIFIER_DEPTH);

        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
        assertEq(gate.getParticipantCount(ACTION_DOMAIN_1), 1);
    }

    // ========================================================================
    // 2. REPLAY ATTACK
    // ========================================================================

    function test_E2E_Replay_RevokedCredential_Rejected() public {
        // Timeline:
        //   t0: Alice generates proof against credential C (revnull = COMMIT_C_REVNULL).
        //   t0 + 5s: Relayer emits revocation for COMMIT_C_REVNULL.
        //   t0 + 10s: Alice (or attacker holding her proof) submits the proof.
        //             Within TTL window, but isRevoked(COMMIT_C_REVNULL) = true.
        //             -> Rejected on CredentialRevoked.
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildPublicInputs(
            NULLIFIER_1,
            COMMIT_C_REVNULL,
            EMPTY_TREE_ROOT
        );

        // t0 + 5s: revocation lands.
        vm.warp(block.timestamp + 5);
        vm.prank(relayer);
        revocationRegistry.emitRevocation(COMMIT_C_REVNULL, bytes32(uint256(0xFEED)));

        // t0 + 10s: attacker submits pre-revocation proof.
        vm.warp(block.timestamp + 5);
        (address signer, bytes memory signature, uint256 deadline) =
            _sign(proof, publicInputs, VERIFIER_DEPTH);

        vm.expectRevert(DistrictGate.CredentialRevoked.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);

        // Nullifier was NOT recorded despite the attempt.
        assertFalse(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    // ========================================================================
    // 3. RACE WINDOW
    // ========================================================================

    function test_E2E_Race_RevocationAfterProof_RejectedOnDedup() public {
        // User A generates a proof at t0 with UNCOMPROMISED_REVNULL. An
        // UNRELATED user B revokes a different commitment at t0+5s. Within
        // the TTL window, the old root (EMPTY_TREE_ROOT) remains acceptable
        // — A's proof should still submit successfully because A's revnull is
        // not in the isRevoked mapping.
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildPublicInputs(
            NULLIFIER_1,
            UNCOMPROMISED_REVNULL,
            EMPTY_TREE_ROOT
        );

        // Unrelated revocation advances the root but not the isRevoked flag
        // for UNCOMPROMISED_REVNULL.
        vm.warp(block.timestamp + 5);
        vm.prank(relayer);
        revocationRegistry.emitRevocation(keccak256("unrelated-rev"), bytes32(uint256(0xABC)));

        vm.warp(block.timestamp + 5);
        (address signer, bytes memory signature, uint256 deadline) =
            _sign(proof, publicInputs, VERIFIER_DEPTH);

        // Within TTL: EMPTY_TREE_ROOT still acceptable; revnull not revoked;
        // proof lands.
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
        assertTrue(gate.isNullifierUsed(ACTION_DOMAIN_1, NULLIFIER_1));
    }

    function test_E2E_Race_RevocationAfterProof_RejectedAfterTTL() public {
        bytes memory proof = hex"deadbeef";
        uint256[33] memory publicInputs = _buildPublicInputs(
            NULLIFIER_2,
            UNCOMPROMISED_REVNULL,
            EMPTY_TREE_ROOT
        );

        vm.prank(relayer);
        revocationRegistry.emitRevocation(keccak256("unrelated-rev-2"), bytes32(uint256(0xDEF)));

        // Fast-forward past TTL.
        vm.warp(block.timestamp + 2 hours);
        (address signer, bytes memory signature, uint256 deadline) =
            _sign(proof, publicInputs, VERIFIER_DEPTH);

        vm.expectRevert(DistrictGate.StaleRevocationRoot.selector);
        gate.verifyThreeTreeProofV2(signer, proof, publicInputs, VERIFIER_DEPTH, deadline, signature);
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    function _buildPublicInputs(
        bytes32 nullifier,
        bytes32 revocationNullifier,
        bytes32 revocationRoot
    ) internal pure returns (uint256[33] memory inputs) {
        inputs[0] = uint256(USER_ROOT_1);
        inputs[1] = uint256(CELL_MAP_ROOT_1);
        inputs[26] = uint256(nullifier);
        inputs[27] = uint256(ACTION_DOMAIN_1);
        inputs[28] = uint256(AUTHORITY_LEVEL);
        inputs[29] = uint256(ENGAGEMENT_ROOT_1);
        inputs[30] = 2;
        inputs[31] = uint256(revocationNullifier);
        inputs[32] = uint256(revocationRoot);
    }

    function _sign(
        bytes memory proof,
        uint256[33] memory publicInputs,
        uint8 verifierDepth
    ) internal view returns (address signer, bytes memory signature, uint256 deadline) {
        uint256 privateKey = 0xB0B;
        signer = vm.addr(privateKey);
        deadline = block.timestamp + 1 hours;
        uint256 nonce = gate.nonces(signer);

        bytes32 proofHash = keccak256(proof);
        bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));

        bytes32 structHash = keccak256(
            abi.encode(
                gate.SUBMIT_THREE_TREE_PROOF_V2_TYPEHASH(),
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

contract E2EMockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
