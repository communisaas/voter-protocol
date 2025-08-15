// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IVOTERPoints {
    /**
     * @dev Mint a non-transferable VOTER point (ERC-5192-style SBT) bound to a civic action.
     * The implementation should emit the ERC-5192 Locked event.
     */
    function mintRecordSBT(
        address to,
        uint256 tokenId,
        uint8 actionType,
        bytes32 actionHash,
        bytes32 districtHash,
        bytes32 metadataHash
    ) external;
}


