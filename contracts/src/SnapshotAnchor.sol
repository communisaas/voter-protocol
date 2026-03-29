// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./TimelockGovernance.sol";

/// @title SnapshotAnchor
/// @notice On-chain anchor for quarterly Shadow Atlas snapshot roots
/// @dev Stores the latest cell-map snapshot root, IPFS CID, and epoch.
///      Each snapshot is immutably recorded in history by epoch number.
///
/// DESIGN:
///   - Epochs are strictly monotonic (prevents replay of stale snapshots)
///   - Root and CID must be non-empty (prevents accidental empty anchoring)
///   - Only governance can update (initially founder, later multisig)
///   - Full history preserved via snapshotHistory mapping
///
/// SECURITY:
///   - All updates require governance authorization
///   - Governance transfer has configurable timelock (minimum 10 minutes)
///   - Append-only epoch history (cannot overwrite past snapshots)
///   - All changes emit events for community audit
contract SnapshotAnchor is TimelockGovernance {
    /// @notice Snapshot metadata structure
    struct Snapshot {
        bytes32 cellMapRoot;   // Poseidon2 SMT root of the cell-district mapping
        string ipfsCid;        // IPFS CID of the full snapshot data
        uint256 epoch;         // Strictly monotonic epoch counter
        uint32 updatedAt;      // Timestamp of the update (packed for gas efficiency)
    }

    /// @notice The most recent snapshot
    Snapshot public currentSnapshot;

    /// @notice Maps epoch number to snapshot (append-only history)
    mapping(uint256 => Snapshot) public snapshotHistory;

    // ============ Events ============

    /// @notice Emitted when a new snapshot is anchored
    event SnapshotUpdated(
        bytes32 indexed cellMapRoot,
        string ipfsCid,
        uint256 epoch,
        uint256 timestamp
    );

    // ============ Errors ============

    error EpochNotMonotonic();
    error EmptyRoot();
    error EmptyCid();

    // ============ Constructor ============

    /// @notice Deploy snapshot anchor with governance address
    /// @param _governance Multi-sig or founder address that controls snapshot updates
    /// @param _governanceTimelock Timelock for governance operations (minimum 10 minutes)
    constructor(address _governance, uint256 _governanceTimelock) TimelockGovernance(_governanceTimelock) {
        _initializeGovernance(_governance);
    }

    // ============ Snapshot Management ============

    /// @notice Anchor a new quarterly snapshot root on-chain
    /// @param cellMapRoot Poseidon2 SMT root of the cell-district mapping
    /// @param ipfsCid IPFS CID pointing to the full snapshot data
    /// @param epoch Strictly monotonic epoch number (must exceed current)
    /// @dev Only callable by governance. Epoch must be strictly greater than current.
    function updateSnapshot(bytes32 cellMapRoot, string calldata ipfsCid, uint256 epoch)
        external
        onlyGovernance
    {
        if (cellMapRoot == bytes32(0)) revert EmptyRoot();
        if (bytes(ipfsCid).length == 0) revert EmptyCid();
        if (epoch <= currentSnapshot.epoch) revert EpochNotMonotonic();

        Snapshot memory snap = Snapshot({
            cellMapRoot: cellMapRoot,
            ipfsCid: ipfsCid,
            epoch: epoch,
            updatedAt: uint32(block.timestamp)
        });

        currentSnapshot = snap;
        snapshotHistory[epoch] = snap;

        emit SnapshotUpdated(cellMapRoot, ipfsCid, epoch, block.timestamp);
    }

    // ============ View Functions ============

    /// @notice Get the current snapshot root, CID, and epoch
    /// @return cellMapRoot Current Poseidon2 SMT root
    /// @return ipfsCid Current IPFS CID
    /// @return epoch Current epoch number
    function getCurrentRoot()
        external
        view
        returns (bytes32 cellMapRoot, string memory ipfsCid, uint256 epoch)
    {
        Snapshot memory snap = currentSnapshot;
        return (snap.cellMapRoot, snap.ipfsCid, snap.epoch);
    }

    /// @notice Look up a historical snapshot by epoch number
    /// @param epoch Epoch number to query
    /// @return snapshot Full snapshot struct for the given epoch
    function getSnapshotByEpoch(uint256 epoch)
        external
        view
        returns (Snapshot memory snapshot)
    {
        return snapshotHistory[epoch];
    }
}
