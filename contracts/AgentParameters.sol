// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AgentParameters
 * @dev Minimal on-chain parameter store to be controlled by agent consensus.
 */
contract AgentParameters is AccessControl {
    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");

    mapping(bytes32 => uint256) private uintParams;

    event UintParamSet(bytes32 indexed key, uint256 value);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_SETTER_ROLE, admin);
    }

    function setUint(bytes32 key, uint256 value) external onlyRole(PARAM_SETTER_ROLE) {
        uintParams[key] = value;
        emit UintParamSet(key, value);
    }

    function getUint(bytes32 key) external view returns (uint256) {
        return uintParams[key];
    }
}


