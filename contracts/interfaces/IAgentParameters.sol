// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IAgentParameters
 * @dev Interface for agent-determined parameter storage
 */
interface IAgentParameters {
    function getUint(bytes32 key) external view returns (uint256);
    function setUint(bytes32 key, uint256 value) external;
}