// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAgentConsensus.sol";

/**
 * @title AgentConsensusGateway
 * @dev Minimal proxy that the core contract can query; agents update verification status off-chain/on-chain
 */
contract AgentConsensusGateway is AccessControl, IAgentConsensus {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    mapping(bytes32 => bool) private verified;

    event ActionMarked(bytes32 indexed actionHash, bool verified);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    function markVerified(bytes32 actionHash, bool isVerified) external onlyRole(AGENT_ROLE) {
        verified[actionHash] = isVerified;
        emit ActionMarked(actionHash, isVerified);
    }

    function isVerified(bytes32 actionHash) external view override returns (bool) {
        return verified[actionHash];
    }
}


