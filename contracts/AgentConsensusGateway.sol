// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAgentConsensus.sol";

/**
 * @title AgentConsensusGateway
 * @dev Agent consensus with threshold
 */
contract AgentConsensusGateway is AccessControl, IAgentConsensus {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    mapping(bytes32 => uint256) public votes;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    
    uint256 public threshold = 2;

    event Voted(bytes32 indexed actionHash, address agent);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    function vote(bytes32 actionHash) external onlyRole(AGENT_ROLE) {
        require(!hasVoted[actionHash][msg.sender], "Already voted");
        hasVoted[actionHash][msg.sender] = true;
        votes[actionHash]++;
        emit Voted(actionHash, msg.sender);
    }

    function markVerified(bytes32 actionHash, bool) external onlyRole(AGENT_ROLE) {
        vote(actionHash);
    }

    function isVerified(bytes32 actionHash) external view override returns (bool) {
        return votes[actionHash] >= threshold;
    }
}


