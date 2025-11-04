// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";

/// @title DistrictGate Batch Verification Tests
/// @notice Tests the batch verification functionality
/// @dev Validates HIGH #4 from adversarial security analysis (DoS vectors, gas limits)
contract DistrictGateBatchTest is Test {
    DistrictGate public gate;
    DistrictRegistry public registry;
    address public verifier;

    address public governance = address(0x1);
    address public user = address(0x2);

    bytes32 public constant DISTRICT_ROOT_1 = keccak256("DISTRICT_1");
    bytes32 public constant DISTRICT_ROOT_2 = keccak256("DISTRICT_2");
    bytes32 public constant ACTION_ID = bytes32(uint256(0x789));
    bytes3 public constant USA = "USA";

    function setUp() public {
        // Deploy mock verifier
        verifier = address(new MockVerifier());

        // Deploy registry
        registry = new DistrictRegistry(governance);

        // Deploy gate
        gate = new DistrictGate(verifier, address(registry), governance);

        // Register districts
        vm.startPrank(governance);
        registry.registerDistrict(DISTRICT_ROOT_1, USA);
        registry.registerDistrict(DISTRICT_ROOT_2, USA);
        gate.authorizeAction(ACTION_ID);
        vm.stopPrank();
    }

    // ============ Basic Batch Verification Tests ============

    function test_BatchVerification_SingleProof() public {
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = hex"deadbeef";

        bytes32[] memory districtRoots = new bytes32[](1);
        districtRoots[0] = DISTRICT_ROOT_1;

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0x111));

        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID;

        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        assertTrue(gate.isNullifierUsed(nullifiers[0]));
    }

    function test_BatchVerification_MultipleProofs() public {
        bytes[] memory proofs = new bytes[](3);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";
        proofs[2] = hex"baadf00d";

        bytes32[] memory districtRoots = new bytes32[](3);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;
        districtRoots[2] = DISTRICT_ROOT_1;

        bytes32[] memory nullifiers = new bytes32[](3);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));
        nullifiers[2] = bytes32(uint256(0x333));

        bytes32[] memory actionIds = new bytes32[](3);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;
        actionIds[2] = ACTION_ID;

        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        // All nullifiers marked as used
        assertTrue(gate.isNullifierUsed(nullifiers[0]));
        assertTrue(gate.isNullifierUsed(nullifiers[1]));
        assertTrue(gate.isNullifierUsed(nullifiers[2]));
    }

    function test_BatchVerification_EmitsEventsForEachProof() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        vm.recordLogs();
        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 2, "Should emit 2 events");
    }

    // ============ DoS Attack Scenarios ============

    function test_RevertWhen_BatchContainsDuplicateNullifier() public {
        // CRITICAL DoS vector: Attacker submits batch with duplicate nullifiers
        // Expected: Transaction reverts, no nullifiers marked (atomicity)

        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x111)); // DUPLICATE!

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        // Should revert on second proof (nullifier already used in same batch)
        vm.prank(user);
        vm.expectRevert(DistrictGate.NullifierAlreadyUsed.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        // Verify no nullifiers were marked (transaction reverted)
        assertFalse(gate.isNullifierUsed(nullifiers[0]));
    }

    function test_RevertWhen_BatchContainsUsedNullifier() public {
        // Test that batch fails if any nullifier was already used in previous transaction
        bytes32 usedNullifier = bytes32(uint256(0x999));

        // Use nullifier in separate transaction first
        bytes[] memory singleProof = new bytes[](1);
        singleProof[0] = hex"deadbeef";

        bytes32[] memory singleDistrict = new bytes32[](1);
        singleDistrict[0] = DISTRICT_ROOT_1;

        bytes32[] memory singleNullifier = new bytes32[](1);
        singleNullifier[0] = usedNullifier;

        bytes32[] memory singleAction = new bytes32[](1);
        singleAction[0] = ACTION_ID;

        vm.prank(user);
        gate.verifyBatch(singleProof, singleDistrict, singleNullifier, singleAction, USA);

        // Now try batch with already-used nullifier
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"cafebabe";
        proofs[1] = hex"baadf00d";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = usedNullifier; // Already used!
        nullifiers[1] = bytes32(uint256(0x777));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        vm.prank(user);
        vm.expectRevert(DistrictGate.NullifierAlreadyUsed.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    function test_RevertWhen_BatchContainsUnauthorizedAction() public {
        bytes32 unauthorizedAction = bytes32(uint256(0xBAD));

        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = unauthorizedAction; // NOT authorized!

        vm.prank(user);
        vm.expectRevert(DistrictGate.ActionNotAuthorized.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        // No nullifiers should be marked
        assertFalse(gate.isNullifierUsed(nullifiers[0]));
        assertFalse(gate.isNullifierUsed(nullifiers[1]));
    }

    function test_RevertWhen_BatchContainsWrongCountry() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        // Both districts are registered for USA, but we pass GBR
        vm.prank(user);
        vm.expectRevert(DistrictGate.UnauthorizedDistrict.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, bytes3("GBR"));
    }

    // ============ Array Length Mismatch Tests ============

    function test_RevertWhen_ProofsAndDistrictsMismatch() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](1); // WRONG LENGTH
        districtRoots[0] = DISTRICT_ROOT_1;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        vm.prank(user);
        vm.expectRevert("Length mismatch");
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    function test_RevertWhen_ProofsAndNullifiersMismatch() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](3); // WRONG LENGTH
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));
        nullifiers[2] = bytes32(uint256(0x333));

        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;

        vm.prank(user);
        vm.expectRevert("Length mismatch");
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    function test_RevertWhen_ProofsAndActionsMismatch() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";

        bytes32[] memory districtRoots = new bytes32[](2);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));

        bytes32[] memory actionIds = new bytes32[](1); // WRONG LENGTH
        actionIds[0] = ACTION_ID;

        vm.prank(user);
        vm.expectRevert("Length mismatch");
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    // ============ Gas Limit Tests ============

    function test_BatchVerification_GasLimit_Small() public {
        // Test batch of 5 proofs (reasonable size)
        uint256 batchSize = 5;

        bytes[] memory proofs = new bytes[](batchSize);
        bytes32[] memory districtRoots = new bytes32[](batchSize);
        bytes32[] memory nullifiers = new bytes32[](batchSize);
        bytes32[] memory actionIds = new bytes32[](batchSize);

        for (uint256 i = 0; i < batchSize; i++) {
            proofs[i] = abi.encodePacked(bytes32(i));
            districtRoots[i] = DISTRICT_ROOT_1;
            nullifiers[i] = bytes32(uint256(0x1000 + i));
            actionIds[i] = ACTION_ID;
        }

        uint256 gasBefore = gasleft();
        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
        uint256 gasUsed = gasBefore - gasleft();

        // Gas should scale linearly with batch size
        // Measured: ~33k per proof (includes verifier call, registry lookup, nullifier marking, event)
        // Expected for 5 proofs: ~165k gas
        assertLt(gasUsed, 200000, "Gas usage too high for small batch");
    }

    function test_BatchVerification_GasLimit_Medium() public {
        // Test batch of 10 proofs
        uint256 batchSize = 10;

        bytes[] memory proofs = new bytes[](batchSize);
        bytes32[] memory districtRoots = new bytes32[](batchSize);
        bytes32[] memory nullifiers = new bytes32[](batchSize);
        bytes32[] memory actionIds = new bytes32[](batchSize);

        for (uint256 i = 0; i < batchSize; i++) {
            proofs[i] = abi.encodePacked(bytes32(i));
            districtRoots[i] = DISTRICT_ROOT_1;
            nullifiers[i] = bytes32(uint256(0x2000 + i));
            actionIds[i] = ACTION_ID;
        }

        uint256 gasBefore = gasleft();
        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
        uint256 gasUsed = gasBefore - gasleft();

        // Gas should scale linearly: ~33k per proof
        // Expected for 10 proofs: ~330k gas
        assertLt(gasUsed, 400000, "Gas usage too high for medium batch");
    }

    function test_BatchVerification_EmptyBatch() public {
        // Define expected behavior for empty batch (should succeed with no-op)
        bytes[] memory proofs = new bytes[](0);
        bytes32[] memory districtRoots = new bytes32[](0);
        bytes32[] memory nullifiers = new bytes32[](0);
        bytes32[] memory actionIds = new bytes32[](0);

        // Should succeed without reverting (no-op)
        vm.prank(user);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);
    }

    // ============ Atomicity Tests ============

    function test_BatchVerification_AtomicityOnFailure() public {
        // CRITICAL: If batch fails, NO nullifiers should be marked
        // Solidity transaction reversion ensures atomicity

        bytes[] memory proofs = new bytes[](3);
        proofs[0] = hex"deadbeef";
        proofs[1] = hex"cafebabe";
        proofs[2] = hex"baadf00d";

        bytes32[] memory districtRoots = new bytes32[](3);
        districtRoots[0] = DISTRICT_ROOT_1;
        districtRoots[1] = DISTRICT_ROOT_2;
        districtRoots[2] = DISTRICT_ROOT_1;

        bytes32[] memory nullifiers = new bytes32[](3);
        nullifiers[0] = bytes32(uint256(0x111));
        nullifiers[1] = bytes32(uint256(0x222));
        nullifiers[2] = bytes32(uint256(0x111)); // DUPLICATE - will fail

        bytes32[] memory actionIds = new bytes32[](3);
        actionIds[0] = ACTION_ID;
        actionIds[1] = ACTION_ID;
        actionIds[2] = ACTION_ID;

        // Verify none are used before
        assertFalse(gate.isNullifierUsed(nullifiers[0]));
        assertFalse(gate.isNullifierUsed(nullifiers[1]));

        // Batch should fail on third proof
        vm.prank(user);
        vm.expectRevert(DistrictGate.NullifierAlreadyUsed.selector);
        gate.verifyBatch(proofs, districtRoots, nullifiers, actionIds, USA);

        // CRITICAL: Solidity reverts entire transaction
        // NO nullifiers should be marked after failure (atomic)
        assertFalse(gate.isNullifierUsed(nullifiers[0]), "No nullifiers marked after revert");
        assertFalse(gate.isNullifierUsed(nullifiers[1]), "No nullifiers marked after revert");
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifier {
    function verifyProof(bytes calldata, uint256[3] calldata) external pure returns (bool) {
        return true;
    }
}
