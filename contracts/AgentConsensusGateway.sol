// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAgentConsensus.sol";
import "forge-std/console.sol";

/**
 * @title AgentConsensusGateway
 * @dev Agent consensus with threshold
 */
contract AgentConsensusGateway is AccessControl, IAgentConsensus {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant EXPERT_AGENT_ROLE = keccak256("EXPERT_AGENT_ROLE");

    mapping(bytes32 => uint256) public votes;
    mapping(bytes32 => uint256) public weightedVotes;  // Weighted vote total
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(address => uint256) public agentWeights;  // Voting weight per agent
    mapping(bytes32 => uint256) public contextualThresholds;  // Dynamic thresholds
    
    uint256 public defaultThreshold = 2;
    uint256 public defaultWeight = 100;  // Base weight = 100
    uint256 public expertWeight = 200;   // Expert agents get 2x weight

    event Voted(bytes32 indexed actionHash, address agent);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        _grantRole(AGENT_ROLE, address(this)); // Grant AGENT_ROLE to the contract itself
        
        // Set default weight for admin
        agentWeights[admin] = defaultWeight;
    }

    function vote(bytes32 actionHash) external onlyRole(AGENT_ROLE) {
        require(!hasVoted[actionHash][msg.sender], "Already voted");
        hasVoted[actionHash][msg.sender] = true;
        votes[actionHash]++;
        
        // Apply weighted voting
        uint256 weight = _getAgentWeight(msg.sender);
        weightedVotes[actionHash] += weight;
        
        emit Voted(actionHash, msg.sender);
    }

    function markVerified(bytes32 actionHash, bool) external onlyRole(AGENT_ROLE) {
        this.vote(actionHash);
    }

    function isVerified(bytes32 actionHash) external view override returns (bool) {
        uint256 requiredThreshold = _getThreshold(actionHash);
        
        // Use weighted votes for consensus
        return weightedVotes[actionHash] >= requiredThreshold;
    }

    function setDefaultThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultThreshold = _threshold;
    }
    
    /**
     * @dev Set contextual threshold for specific action types
     * @param actionType Hash representing the type of action
     * @param threshold Required weighted votes for this action type
     */
    function setContextualThreshold(
        bytes32 actionType,
        uint256 threshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        contextualThresholds[actionType] = threshold;
    }
    
    /**
     * @dev Set weight for a specific agent
     * @param agent Address of the agent
     * @param weight Voting weight (100 = 1x, 200 = 2x, etc.)
     */
    function setAgentWeight(
        address agent,
        uint256 weight
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(weight > 0 && weight <= 1000, "Invalid weight"); // Max 10x
        agentWeights[agent] = weight;
    }
    
    /**
     * @dev Grant expert role to an agent for increased weight
     * @param agent Address to grant expert status
     */
    function grantExpertStatus(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(EXPERT_AGENT_ROLE, agent);
        agentWeights[agent] = expertWeight;
    }
    
    /**
     * @dev Get the weight for an agent
     */
    function _getAgentWeight(address agent) internal view returns (uint256) {
        uint256 weight = agentWeights[agent];
        if (weight == 0) {
            // If no specific weight set, use role-based weight
            if (hasRole(EXPERT_AGENT_ROLE, agent)) {
                return expertWeight;
            }
            return defaultWeight;
        }
        return weight;
    }
    
    /**
     * @dev Get threshold for a specific action
     */
    function _getThreshold(bytes32 actionHash) internal view returns (uint256) {
        // Extract action type from hash (first 8 bytes could encode type)
        bytes32 actionType = actionHash & bytes32(uint256(0xFFFFFFFFFFFFFFFF) << 192);
        
        uint256 contextualThreshold = contextualThresholds[actionType];
        if (contextualThreshold > 0) {
            return contextualThreshold;
        }
        
        // Default: 2 regular agents or 1 expert agent
        return defaultThreshold * defaultWeight;
    }
    
    /**
     * @dev Get current consensus status for an action
     */
    function getConsensusStatus(bytes32 actionHash) external view returns (
        uint256 voteCount,
        uint256 weightedVoteTotal,
        uint256 requiredThreshold,
        bool verified
    ) {
        voteCount = votes[actionHash];
        weightedVoteTotal = weightedVotes[actionHash];
        requiredThreshold = _getThreshold(actionHash);
        verified = weightedVoteTotal >= requiredThreshold;
    }
}


