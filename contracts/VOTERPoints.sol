// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IVOTERPoints.sol";

/**
 * @title VOTERPoints
 * @dev Minimal non-transferable SBT-like token for civic action records (ERC-5192 semantics)
 */
contract VOTERPoints is AccessControl, IVOTERPoints {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ERC-5192 Locked event
    event Locked(uint256 tokenId);

    struct PointData {
        address owner;
        uint8 actionType;
        bytes32 actionHash;
        bytes32 districtHash;
        bytes32 metadataHash;
        uint256 timestamp;
    }

    mapping(uint256 => PointData) private _points;

    event PointMinted(address indexed to, uint256 indexed tokenId, uint8 actionType, bytes32 actionHash);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _points[tokenId].owner;
        require(owner != address(0), "NOT_MINTED");
        return owner;
    }

    function pointData(uint256 tokenId) external view returns (PointData memory) {
        require(_points[tokenId].owner != address(0), "NOT_MINTED");
        return _points[tokenId];
    }

    function mintRecordSBT(
        address to,
        uint256 tokenId,
        uint8 actionType,
        bytes32 actionHash,
        bytes32 districtHash,
        bytes32 metadataHash
    ) external override onlyRole(MINTER_ROLE) {
        require(to != address(0), "INVALID_TO");
        require(_points[tokenId].owner == address(0), "ALREADY_MINTED");

        _points[tokenId] = PointData({
            owner: to,
            actionType: actionType,
            actionHash: actionHash,
            districtHash: districtHash,
            metadataHash: metadataHash,
            timestamp: block.timestamp
        });

        emit PointMinted(to, tokenId, actionType, actionHash);
        emit Locked(tokenId);
    }
}


