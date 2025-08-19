// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAgentConsensus.sol";

/**
 * @title AgentConsensusThreshold
 * @dev On-chain M-of-N approvals for action verification. Governed operator set and threshold.
 */
contract AgentConsensusThreshold is AccessControl, IAgentConsensus {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    uint256 public signerThreshold;

    // actionHash => approver => approved
    mapping(bytes32 => mapping(address => bool)) public approvals;
    // actionHash => count
    mapping(bytes32 => uint256) public approvalCounts;

    event ThresholdUpdated(uint256 newThreshold);
    event AgentApproved(bytes32 indexed actionHash, address indexed agent);
    event AgentRevoked(bytes32 indexed actionHash, address indexed agent);

    constructor(address admin, uint256 initialThreshold) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        require(initialThreshold > 0, "threshold=0");
        signerThreshold = initialThreshold;
    }

    function setSignerThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold > 0, "threshold=0");
        signerThreshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    function approve(bytes32 actionHash) external onlyRole(AGENT_ROLE) {
        require(actionHash != bytes32(0), "invalid hash");
        if (!approvals[actionHash][msg.sender]) {
            approvals[actionHash][msg.sender] = true;
            approvalCounts[actionHash] += 1;
            emit AgentApproved(actionHash, msg.sender);
        }
    }

    function revoke(bytes32 actionHash) external onlyRole(AGENT_ROLE) {
        require(actionHash != bytes32(0), "invalid hash");
        if (approvals[actionHash][msg.sender]) {
            approvals[actionHash][msg.sender] = false;
            approvalCounts[actionHash] -= 1;
            emit AgentRevoked(actionHash, msg.sender);
        }
    }

    function isVerified(bytes32 actionHash) external view override returns (bool) {
        return approvalCounts[actionHash] >= signerThreshold;
    }
}


