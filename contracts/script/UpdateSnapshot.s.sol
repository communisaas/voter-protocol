// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Script.sol";
import "../src/SnapshotAnchor.sol";

/// @title UpdateSnapshot — Anchor a new quarterly snapshot on-chain
/// @notice Foundry script to call SnapshotAnchor.updateSnapshot()
/// @dev Reads all parameters from environment variables.
///
/// ENVIRONMENT VARIABLES:
///   PRIVATE_KEY              — Governance key (must match SnapshotAnchor.governance())
///   SNAPSHOT_ANCHOR_ADDRESS  — Deployed SnapshotAnchor contract address
///   CELL_MAP_ROOT            — bytes32 Poseidon2 SMT root of the cell-district mapping
///   IPFS_CID                 — IPFS CID string pointing to the full snapshot data
///   EPOCH                    — Strictly monotonic epoch number (must exceed current)
///
/// USAGE:
///   forge script script/UpdateSnapshot.s.sol:UpdateSnapshot \
///     --rpc-url scroll_sepolia --broadcast --slow
contract UpdateSnapshot is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address anchorAddr = vm.envAddress("SNAPSHOT_ANCHOR_ADDRESS");
        bytes32 root = vm.envBytes32("CELL_MAP_ROOT");
        string memory cid = vm.envString("IPFS_CID");
        uint256 epoch = vm.envUint("EPOCH");

        console.log("============================================================");
        console.log("  UPDATE SNAPSHOT ANCHOR");
        console.log("============================================================");
        console.log("");
        console.log("Anchor address:", anchorAddr);
        console.log("Cell map root:", vm.toString(root));
        console.log("IPFS CID:", cid);
        console.log("Epoch:", epoch);
        console.log("");

        vm.startBroadcast(deployerKey);
        SnapshotAnchor(anchorAddr).updateSnapshot(root, cid, epoch);
        vm.stopBroadcast();

        console.log("==> Snapshot anchored successfully");
    }
}
