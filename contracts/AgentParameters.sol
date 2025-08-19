// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AgentParameters
 * @dev Parameter store with basic bounds checking
 */
contract AgentParameters is AccessControl {
    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");

    mapping(bytes32 => uint256) private uintParams;
    mapping(bytes32 => uint256) public maxValues;
    
    event UintParamSet(bytes32 indexed key, uint256 value);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_SETTER_ROLE, admin);
        
        // Set max bounds only
        maxValues[keccak256("reward:CWC_MESSAGE")] = 100e18;
        maxValues[keccak256("reward:DIRECT_ACTION")] = 100e18;
        maxValues[keccak256("maxDailyMintPerUser")] = 10000e18;
        maxValues[keccak256("maxDailyMintProtocol")] = 1000000e18;
    }

    function setUint(bytes32 key, uint256 value) external onlyRole(PARAM_SETTER_ROLE) {
        if (maxValues[key] > 0) {
            require(value <= maxValues[key], "Exceeds maximum");
        }
        uintParams[key] = value;
        emit UintParamSet(key, value);
    }

    function getUint(bytes32 key) external view returns (uint256) {
        return uintParams[key];
    }
}


