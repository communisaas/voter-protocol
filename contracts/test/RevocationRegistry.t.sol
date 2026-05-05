// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/RevocationRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title RevocationRegistry Tests
/// @notice Covers emit flow, idempotency, access control, root archive TTL,
///         and gas benchmarking per Stage 5 spec.
contract RevocationRegistryTest is Test {
    RevocationRegistry public registry;

    address public governance = address(0x1);
    address public relayer = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant EMPTY_TREE_ROOT = bytes32(uint256(0xDEADBEEF));
    bytes32 public constant NULL_1 = keccak256("revocation-nullifier-1");
    bytes32 public constant NULL_2 = keccak256("revocation-nullifier-2");
    bytes32 public constant ROOT_1 = bytes32(uint256(0xBEEF0001));
    bytes32 public constant ROOT_2 = bytes32(uint256(0xBEEF0002));

    function setUp() public {
        registry = new RevocationRegistry(
            governance,
            7 days,
            7 days,
            EMPTY_TREE_ROOT
        );

        vm.startPrank(governance);
        registry.authorizeRelayerGenesis(relayer);
        registry.sealGenesis();
        vm.stopPrank();
    }

    // ========================================================================
    // CONSTRUCTION
    // ========================================================================

    function test_EmptyTreeRootInitialized() public {
        assertEq(registry.EMPTY_TREE_ROOT(), EMPTY_TREE_ROOT);
        assertEq(registry.getCurrentRoot(), EMPTY_TREE_ROOT);
    }

    function test_RevertOnZeroEmptyRoot() public {
        vm.expectRevert(RevocationRegistry.InvalidRoot.selector);
        new RevocationRegistry(governance, 7 days, 7 days, bytes32(0));
    }

    // ========================================================================
    // EMIT — HAPPY PATH
    // ========================================================================

    function test_EmitRevocation_HappyPath() public {
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        assertTrue(registry.isRevoked(NULL_1));
        assertEq(registry.getCurrentRoot(), ROOT_1);
        assertEq(registry.revokedAtBlock(NULL_1), block.timestamp);
    }

    function test_EmitRevocation_EmitsEvent() public {
        vm.expectEmit(true, false, true, true);
        emit RevocationRegistry.RevocationEmitted(NULL_1, ROOT_1, block.number);
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);
    }

    function test_EmitRevocation_ArchivesPriorRoot() public {
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        // EMPTY_TREE_ROOT should have been archived.
        assertTrue(registry.isRootAcceptable(EMPTY_TREE_ROOT));
        // New root is current.
        assertTrue(registry.isRootAcceptable(ROOT_1));
    }

    // ========================================================================
    // EMIT — IDEMPOTENCY / DUPLICATE
    // ========================================================================

    function test_RevertOnDuplicateRevocation() public {
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        vm.expectRevert(RevocationRegistry.AlreadyRevoked.selector);
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_2);
    }

    function test_RevertOnZeroNewRoot() public {
        vm.expectRevert(RevocationRegistry.InvalidRoot.selector);
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, bytes32(0));
    }

    // ========================================================================
    // ACCESS CONTROL
    // ========================================================================

    function test_RevertOnUnauthorizedRelayer() public {
        vm.expectRevert(RevocationRegistry.UnauthorizedRelayer.selector);
        vm.prank(attacker);
        registry.emitRevocation(NULL_1, ROOT_1);
    }

    function test_GovernanceTimelockForNewRelayer() public {
        address newRelayer = address(0x4);
        vm.prank(governance);
        registry.proposeRelayerAuthorization(newRelayer);

        // Not yet authorized before timelock.
        vm.expectRevert(RevocationRegistry.UnauthorizedRelayer.selector);
        vm.prank(newRelayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        // Execute after timelock.
        vm.warp(block.timestamp + 7 days + 1);
        registry.executeRelayerAuthorization(newRelayer);

        vm.prank(newRelayer);
        registry.emitRevocation(NULL_1, ROOT_1);
        assertTrue(registry.isRevoked(NULL_1));
    }

    function test_RelayerRevocationTimelock() public {
        // Propose revocation of the existing relayer.
        vm.prank(governance);
        registry.proposeRelayerRevocation(relayer);

        // Still authorized pre-timelock.
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        vm.warp(block.timestamp + 7 days + 1);
        registry.executeRelayerRevocation(relayer);

        // No longer authorized.
        vm.expectRevert(RevocationRegistry.UnauthorizedRelayer.selector);
        vm.prank(relayer);
        registry.emitRevocation(NULL_2, ROOT_2);
    }

    // ========================================================================
    // ROOT ARCHIVE TTL
    // ========================================================================

    function test_RootTtl_AcceptsFreshArchivedRoot() public {
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);
        // EMPTY_TREE_ROOT archived.

        // Still within TTL.
        vm.warp(block.timestamp + 30 minutes);
        assertTrue(registry.isRootAcceptable(EMPTY_TREE_ROOT));
    }

    function test_RootTtl_RejectsStaleArchivedRoot() public {
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        // Beyond TTL (1 hour).
        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(registry.isRootAcceptable(EMPTY_TREE_ROOT));
        // Current root still acceptable.
        assertTrue(registry.isRootAcceptable(ROOT_1));
    }

    function test_RootTtl_UnknownRootRejected() public {
        assertFalse(registry.isRootAcceptable(bytes32(uint256(0xBAD))));
    }

    // ========================================================================
    // PAUSE
    // ========================================================================

    function test_PauseBlocksEmit() public {
        vm.prank(governance);
        registry.pause();

        vm.expectRevert("Pausable: paused");
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);
    }

    // ========================================================================
    // GAS BENCHMARK
    // ========================================================================

    function test_Gas_SingleEmitUnderTarget() public {
        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        registry.emitRevocation(NULL_1, ROOT_1);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("emitRevocation gas used (L1, cold)", gasUsed);
        // Observed L1-gas cost: ~135K for the first emit (fresh storage slots
        // for isRevoked mapping entry, revokedAtBlock entry, currentRoot
        // update, ring-buffer archive entry, and two events). On Scroll L2
        // this translates to ~1-2K gas of effective cost per emit because
        // SSTORE-cold drops from 22.1K to ~200 gas.
        //
        // Budget: 150K L1-gas ceiling — comfortably above the measured 135K
        // with room for future Solidity/opcode-pricing drift.
        assertLt(gasUsed, 150_000, "first emit exceeded 150K gas budget");
    }

    function test_Gas_WarmSecondEmit() public {
        // First emit warms the currentRoot slot; second emit measures the
        // steady-state cost (ring buffer slot still cold for the N+1th entry).
        vm.prank(relayer);
        registry.emitRevocation(NULL_1, ROOT_1);

        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        registry.emitRevocation(NULL_2, ROOT_2);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("warm emitRevocation gas used (L1)", gasUsed);
        // Observed: ~98K L1-gas for the warm path. Ring-buffer slot is still
        // cold for each fresh archive entry. Budget: 110K.
        assertLt(gasUsed, 110_000, "warm emit exceeded 110K budget");
    }
}
