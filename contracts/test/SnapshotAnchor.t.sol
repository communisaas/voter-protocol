// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/SnapshotAnchor.sol";
import "../src/TimelockGovernance.sol";

contract SnapshotAnchorTest is Test {
    SnapshotAnchor public anchor;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant ROOT_1 = keccak256("SNAPSHOT_ROOT_1");
    bytes32 public constant ROOT_2 = keccak256("SNAPSHOT_ROOT_2");
    bytes32 public constant ROOT_3 = keccak256("SNAPSHOT_ROOT_3");
    string public constant CID_1 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    string public constant CID_2 = "QmZTR5bcpQD7cFgTorqxZDYaew1Wqgfbd2ud9QqGPAkK2V";
    string public constant CID_3 = "QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB";

    event SnapshotUpdated(bytes32 indexed cellMapRoot, string ipfsCid, uint256 epoch, uint256 timestamp);
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    function setUp() public {
        anchor = new SnapshotAnchor(governance, 7 days);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(anchor.governance(), governance);
        assertEq(anchor.GOVERNANCE_TIMELOCK(), 7 days);
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        new SnapshotAnchor(address(0), 7 days);
    }

    function test_RevertWhen_ConstructorTimelockTooShort() public {
        vm.expectRevert(TimelockGovernance.TimelockTooShort.selector);
        new SnapshotAnchor(governance, 1 minutes);
    }

    // ============ updateSnapshot Tests ============

    function test_UpdateSnapshot() public {
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit SnapshotUpdated(ROOT_1, CID_1, 1, block.timestamp);

        anchor.updateSnapshot(ROOT_1, CID_1, 1);

        (bytes32 root, string memory cid, uint256 epoch) = anchor.getCurrentRoot();
        assertEq(root, ROOT_1);
        assertEq(cid, CID_1);
        assertEq(epoch, 1);
    }

    function test_RevertWhen_UpdateSnapshotUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        anchor.updateSnapshot(ROOT_1, CID_1, 1);
    }

    function test_RevertWhen_UpdateSnapshotNonMonotonicEpochSame() public {
        vm.startPrank(governance);
        anchor.updateSnapshot(ROOT_1, CID_1, 5);

        vm.expectRevert(SnapshotAnchor.EpochNotMonotonic.selector);
        anchor.updateSnapshot(ROOT_2, CID_2, 5);
        vm.stopPrank();
    }

    function test_RevertWhen_UpdateSnapshotNonMonotonicEpochLower() public {
        vm.startPrank(governance);
        anchor.updateSnapshot(ROOT_1, CID_1, 5);

        vm.expectRevert(SnapshotAnchor.EpochNotMonotonic.selector);
        anchor.updateSnapshot(ROOT_2, CID_2, 3);
        vm.stopPrank();
    }

    function test_RevertWhen_UpdateSnapshotZeroRoot() public {
        vm.prank(governance);
        vm.expectRevert(SnapshotAnchor.EmptyRoot.selector);
        anchor.updateSnapshot(bytes32(0), CID_1, 1);
    }

    function test_RevertWhen_UpdateSnapshotEmptyCid() public {
        vm.prank(governance);
        vm.expectRevert(SnapshotAnchor.EmptyCid.selector);
        anchor.updateSnapshot(ROOT_1, "", 1);
    }

    // ============ getCurrentRoot Tests ============

    function test_GetCurrentRootReturnsLatest() public {
        vm.startPrank(governance);
        anchor.updateSnapshot(ROOT_1, CID_1, 1);
        anchor.updateSnapshot(ROOT_2, CID_2, 2);
        vm.stopPrank();

        (bytes32 root, string memory cid, uint256 epoch) = anchor.getCurrentRoot();
        assertEq(root, ROOT_2);
        assertEq(cid, CID_2);
        assertEq(epoch, 2);
    }

    function test_GetCurrentRootReturnsZeroWhenEmpty() public view {
        (bytes32 root, string memory cid, uint256 epoch) = anchor.getCurrentRoot();
        assertEq(root, bytes32(0));
        assertEq(bytes(cid).length, 0);
        assertEq(epoch, 0);
    }

    // ============ getSnapshotByEpoch Tests ============

    function test_GetSnapshotByEpoch() public {
        vm.startPrank(governance);
        anchor.updateSnapshot(ROOT_1, CID_1, 1);
        anchor.updateSnapshot(ROOT_2, CID_2, 2);
        vm.stopPrank();

        SnapshotAnchor.Snapshot memory snap1 = anchor.getSnapshotByEpoch(1);
        assertEq(snap1.cellMapRoot, ROOT_1);
        assertEq(snap1.ipfsCid, CID_1);
        assertEq(snap1.epoch, 1);

        SnapshotAnchor.Snapshot memory snap2 = anchor.getSnapshotByEpoch(2);
        assertEq(snap2.cellMapRoot, ROOT_2);
        assertEq(snap2.ipfsCid, CID_2);
        assertEq(snap2.epoch, 2);
    }

    function test_GetSnapshotByEpochReturnsEmptyForUnknown() public view {
        SnapshotAnchor.Snapshot memory snap = anchor.getSnapshotByEpoch(999);
        assertEq(snap.cellMapRoot, bytes32(0));
        assertEq(bytes(snap.ipfsCid).length, 0);
        assertEq(snap.epoch, 0);
        assertEq(snap.updatedAt, 0);
    }

    // ============ History Preservation Tests ============

    function test_MultipleUpdatesPreserveHistory() public {
        vm.startPrank(governance);

        vm.warp(1000);
        anchor.updateSnapshot(ROOT_1, CID_1, 1);

        vm.warp(2000);
        anchor.updateSnapshot(ROOT_2, CID_2, 2);

        vm.warp(3000);
        anchor.updateSnapshot(ROOT_3, CID_3, 3);

        vm.stopPrank();

        // Current should be the latest
        (bytes32 root, string memory cid, uint256 epoch) = anchor.getCurrentRoot();
        assertEq(root, ROOT_3);
        assertEq(cid, CID_3);
        assertEq(epoch, 3);

        // All historical snapshots should be intact
        SnapshotAnchor.Snapshot memory snap1 = anchor.getSnapshotByEpoch(1);
        assertEq(snap1.cellMapRoot, ROOT_1);
        assertEq(snap1.ipfsCid, CID_1);
        assertEq(snap1.epoch, 1);
        assertEq(snap1.updatedAt, 1000);

        SnapshotAnchor.Snapshot memory snap2 = anchor.getSnapshotByEpoch(2);
        assertEq(snap2.cellMapRoot, ROOT_2);
        assertEq(snap2.ipfsCid, CID_2);
        assertEq(snap2.epoch, 2);
        assertEq(snap2.updatedAt, 2000);

        SnapshotAnchor.Snapshot memory snap3 = anchor.getSnapshotByEpoch(3);
        assertEq(snap3.cellMapRoot, ROOT_3);
        assertEq(snap3.ipfsCid, CID_3);
        assertEq(snap3.epoch, 3);
        assertEq(snap3.updatedAt, 3000);
    }

    // ============ Governance Transfer Tests ============

    function test_GovernanceTransferWorks() public {
        // Initiate transfer
        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit GovernanceTransferInitiated(newGovernance, block.timestamp + 7 days);
        anchor.initiateGovernanceTransfer(newGovernance);

        // Fast forward past timelock
        vm.warp(block.timestamp + 7 days);

        // Execute transfer
        vm.expectEmit(true, true, false, false);
        emit GovernanceTransferred(governance, newGovernance);
        anchor.executeGovernanceTransfer(newGovernance);

        assertEq(anchor.governance(), newGovernance);

        // New governance can update snapshots
        vm.prank(newGovernance);
        anchor.updateSnapshot(ROOT_1, CID_1, 1);

        (bytes32 root,,) = anchor.getCurrentRoot();
        assertEq(root, ROOT_1);

        // Old governance cannot
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        anchor.updateSnapshot(ROOT_2, CID_2, 2);
    }

    // ============ Fuzz Tests ============

    function testFuzz_UpdateSnapshot(bytes32 root, uint256 epoch) public {
        vm.assume(root != bytes32(0));
        vm.assume(epoch > 0);

        vm.prank(governance);
        anchor.updateSnapshot(root, CID_1, epoch);

        (bytes32 currentRoot, string memory currentCid, uint256 currentEpoch) = anchor.getCurrentRoot();
        assertEq(currentRoot, root);
        assertEq(currentCid, CID_1);
        assertEq(currentEpoch, epoch);
    }

    function testFuzz_EpochMonotonicity(uint256 firstEpoch, uint256 secondEpoch) public {
        vm.assume(firstEpoch > 0 && firstEpoch < type(uint256).max);
        vm.assume(secondEpoch <= firstEpoch);

        vm.startPrank(governance);
        anchor.updateSnapshot(ROOT_1, CID_1, firstEpoch);

        vm.expectRevert(SnapshotAnchor.EpochNotMonotonic.selector);
        anchor.updateSnapshot(ROOT_2, CID_2, secondEpoch);
        vm.stopPrank();
    }
}
