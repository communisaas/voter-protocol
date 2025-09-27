// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AIModelRegistry.sol";
import "./PerformanceTracker.sol";
import "./ImmutableBounds.sol";

/**
 * @title ConsensusEngine
 * @dev Multi-stage consensus process for AI agent governance
 * @notice Orchestrates proposal, research, commit, reveal, and execution stages
 */
contract ConsensusEngine {
    
    enum Stage {
        PROPOSAL,
        RESEARCH,
        COMMITMENT,
        REVEAL,
        EXECUTION,
        COMPLETED,
        FAILED
    }
    
    struct Consensus {
        bytes32 proposalHash;
        string description;
        bytes payload;              // Encoded function call
        address targetContract;     // Target for execution
        Stage currentStage;
        uint256 stageDeadline;
        uint256 totalParticipants;
        uint256 revealedCount;
        uint256 supportCount;
        uint256 opposeCount;
        uint256 createdAt;
        bool executed;
        mapping(address => ModelVote) votes;
        address[] participants;
    }
    
    struct ModelVote {
        bytes32 commitment;         // Hash of vote + nonce
        uint256 confidence;         // Model's confidence (0-1000)
        bool hasCommitted;
        bool hasRevealed;
        bool support;              // True = support, False = oppose
        uint256 votingWeight;       // From PerformanceTracker
        bytes researchData;         // IPFS hash or data
    }
    
    struct StageConfig {
        uint256 proposalDuration;
        uint256 researchDuration;
        uint256 commitDuration;
        uint256 revealDuration;
        uint256 executionDelay;
    }
    
    // Dependencies
    AIModelRegistry public immutable modelRegistry;
    PerformanceTracker public immutable performanceTracker;
    ImmutableBounds public immutable bounds;
    
    // State
    mapping(bytes32 => Consensus) public consensuses;
    mapping(address => uint256) public lastParticipation;
    StageConfig public stageConfig;
    
    // Constants
    uint256 public constant MIN_PARTICIPANTS = 5;
    uint256 public constant CONSENSUS_THRESHOLD = 67; // 67%
    uint256 public constant PRECISION = 1000;
    
    // Events
    event ConsensusInitiated(bytes32 indexed consensusId, string description);
    event StageAdvanced(bytes32 indexed consensusId, Stage from, Stage to);
    event ModelCommitted(bytes32 indexed consensusId, address model);
    event ModelRevealed(bytes32 indexed consensusId, address model, bool support);
    event ConsensusReached(bytes32 indexed consensusId, bool approved, uint256 support, uint256 oppose);
    event ExecutionCompleted(bytes32 indexed consensusId, bool success);
    
    constructor(
        address _modelRegistry,
        address _performanceTracker,
        address _bounds,
        StageConfig memory _stageConfig
    ) {
        modelRegistry = AIModelRegistry(_modelRegistry);
        performanceTracker = PerformanceTracker(_performanceTracker);
        bounds = ImmutableBounds(_bounds);
        stageConfig = _stageConfig;
    }
    
    /**
     * @dev Initiate a new consensus process
     * @param description Human-readable description
     * @param targetContract Contract to execute on
     * @param payload Encoded function call
     */
    function initiateConsensus(
        string memory description,
        address targetContract,
        bytes memory payload
    ) external returns (bytes32 consensusId) {
        // Only verified AI models can initiate
        require(
            modelRegistry.isAttestationCurrent(msg.sender),
            "Not a verified AI model"
        );
        
        consensusId = keccak256(abi.encodePacked(
            description,
            targetContract,
            payload,
            block.timestamp,
            msg.sender
        ));
        
        require(consensuses[consensusId].createdAt == 0, "Consensus already exists");
        
        Consensus storage consensus = consensuses[consensusId];
        consensus.proposalHash = consensusId;
        consensus.description = description;
        consensus.payload = payload;
        consensus.targetContract = targetContract;
        consensus.currentStage = Stage.PROPOSAL;
        consensus.stageDeadline = block.timestamp + stageConfig.proposalDuration;
        consensus.createdAt = block.timestamp;
        
        emit ConsensusInitiated(consensusId, description);
    }
    
    /**
     * @dev Advance consensus to next stage
     * @param consensusId The consensus to advance
     */
    function advanceStage(bytes32 consensusId) external {
        Consensus storage consensus = consensuses[consensusId];
        require(consensus.createdAt > 0, "Consensus doesn't exist");
        require(block.timestamp >= consensus.stageDeadline, "Stage not complete");
        
        Stage currentStage = consensus.currentStage;
        
        if (currentStage == Stage.PROPOSAL) {
            consensus.currentStage = Stage.RESEARCH;
            consensus.stageDeadline = block.timestamp + stageConfig.researchDuration;
        } else if (currentStage == Stage.RESEARCH) {
            consensus.currentStage = Stage.COMMITMENT;
            consensus.stageDeadline = block.timestamp + stageConfig.commitDuration;
        } else if (currentStage == Stage.COMMITMENT) {
            require(consensus.totalParticipants >= MIN_PARTICIPANTS, "Insufficient participants");
            consensus.currentStage = Stage.REVEAL;
            consensus.stageDeadline = block.timestamp + stageConfig.revealDuration;
        } else if (currentStage == Stage.REVEAL) {
            _tallyVotes(consensusId);
        } else {
            revert("Cannot advance from current stage");
        }
        
        emit StageAdvanced(consensusId, currentStage, consensus.currentStage);
    }
    
    /**
     * @dev Submit research during research phase
     * @param consensusId The consensus being researched
     * @param researchData IPFS hash or encoded research
     */
    function submitResearch(
        bytes32 consensusId,
        bytes memory researchData
    ) external {
        Consensus storage consensus = consensuses[consensusId];
        require(consensus.currentStage == Stage.RESEARCH, "Not in research stage");
        require(block.timestamp < consensus.stageDeadline, "Research period ended");
        
        // Verify model is active
        require(
            modelRegistry.isAttestationCurrent(msg.sender),
            "Model attestation expired"
        );
        
        ModelVote storage vote = consensus.votes[msg.sender];
        vote.researchData = researchData;
        
        // Track participation for reputation
        lastParticipation[msg.sender] = block.timestamp;
    }
    
    /**
     * @dev Commit vote during commitment phase
     * @param consensusId The consensus to vote on
     * @param commitment Hash of (vote + nonce + address)
     * @param confidence Model's confidence in decision (0-1000)
     */
    function commitVote(
        bytes32 consensusId,
        bytes32 commitment,
        uint256 confidence
    ) external {
        Consensus storage consensus = consensuses[consensusId];
        require(consensus.currentStage == Stage.COMMITMENT, "Not in commitment stage");
        require(block.timestamp < consensus.stageDeadline, "Commitment period ended");
        require(confidence <= PRECISION, "Invalid confidence");
        
        // Verify model is active and current
        require(
            modelRegistry.isAttestationCurrent(msg.sender),
            "Model attestation expired"
        );
        
        ModelVote storage vote = consensus.votes[msg.sender];
        require(!vote.hasCommitted, "Already committed");
        
        // Get voting weight from performance
        uint256 weight = performanceTracker.calculateVotingWeight(msg.sender);
        require(weight > 0, "No voting weight");
        
        vote.commitment = commitment;
        vote.confidence = confidence;
        vote.hasCommitted = true;
        vote.votingWeight = weight;
        
        if (consensus.votes[msg.sender].researchData.length == 0) {
            consensus.participants.push(msg.sender);
        }
        
        consensus.totalParticipants++;
        
        emit ModelCommitted(consensusId, msg.sender);
    }
    
    /**
     * @dev Reveal vote during reveal phase
     * @param consensusId The consensus being revealed
     * @param support True for support, false for oppose
     * @param nonce The nonce used in commitment
     */
    function revealVote(
        bytes32 consensusId,
        bool support,
        uint256 nonce
    ) external {
        Consensus storage consensus = consensuses[consensusId];
        require(consensus.currentStage == Stage.REVEAL, "Not in reveal stage");
        require(block.timestamp < consensus.stageDeadline, "Reveal period ended");
        
        ModelVote storage vote = consensus.votes[msg.sender];
        require(vote.hasCommitted, "No commitment found");
        require(!vote.hasRevealed, "Already revealed");
        
        // Verify the commitment
        bytes32 expectedCommitment = keccak256(abi.encodePacked(
            support,
            nonce,
            msg.sender,
            consensusId
        ));
        require(vote.commitment == expectedCommitment, "Invalid reveal");
        
        vote.hasRevealed = true;
        vote.support = support;
        consensus.revealedCount++;
        
        // Weight the vote
        if (support) {
            consensus.supportCount += vote.votingWeight;
        } else {
            consensus.opposeCount += vote.votingWeight;
        }
        
        // Update performance tracking
        performanceTracker.recordPrediction(
            msg.sender,
            PerformanceTracker.Domain.GOVERNANCE_DECISION,
            consensusId,
            vote.confidence,
            false, // Will be updated after execution
            vote.votingWeight
        );
        
        emit ModelRevealed(consensusId, msg.sender, support);
    }
    
    /**
     * @dev Tally votes and determine outcome
     */
    function _tallyVotes(bytes32 consensusId) private {
        Consensus storage consensus = consensuses[consensusId];
        
        // Check reveal rate
        uint256 revealRate = (consensus.revealedCount * 100) / consensus.totalParticipants;
        if (revealRate < 80) { // Require 80% reveal rate
            consensus.currentStage = Stage.FAILED;
            emit ConsensusReached(consensusId, false, consensus.supportCount, consensus.opposeCount);
            return;
        }
        
        // Calculate consensus
        uint256 totalWeight = consensus.supportCount + consensus.opposeCount;
        uint256 supportPercentage = (consensus.supportCount * 100) / totalWeight;
        
        bool approved = supportPercentage >= CONSENSUS_THRESHOLD;
        
        if (approved) {
            consensus.currentStage = Stage.EXECUTION;
            consensus.stageDeadline = block.timestamp + stageConfig.executionDelay;
        } else {
            consensus.currentStage = Stage.FAILED;
        }
        
        emit ConsensusReached(consensusId, approved, consensus.supportCount, consensus.opposeCount);
        
        // Update model performance based on consensus outcome
        _updateModelPerformance(consensusId, approved);
    }
    
    /**
     * @dev Execute approved consensus
     * @param consensusId The consensus to execute
     */
    function executeConsensus(bytes32 consensusId) external {
        Consensus storage consensus = consensuses[consensusId];
        require(consensus.currentStage == Stage.EXECUTION, "Not ready for execution");
        require(block.timestamp >= consensus.stageDeadline, "Execution delay not met");
        require(!consensus.executed, "Already executed");
        
        consensus.executed = true;
        consensus.currentStage = Stage.COMPLETED;
        
        // Execute the payload
        (bool success, ) = consensus.targetContract.call(consensus.payload);
        
        emit ExecutionCompleted(consensusId, success);
        
        // Final performance update based on execution result
        _finalizePerformance(consensusId, success);
    }
    
    /**
     * @dev Update model performance based on consensus outcome
     */
    function _updateModelPerformance(bytes32 consensusId, bool consensusApproved) private {
        Consensus storage consensus = consensuses[consensusId];
        
        for (uint256 i = 0; i < consensus.participants.length; i++) {
            address model = consensus.participants[i];
            ModelVote storage vote = consensus.votes[model];
            
            if (vote.hasRevealed) {
                // Model was correct if they voted with consensus
                bool wasCorrect = (vote.support == consensusApproved);
                
                performanceTracker.recordPrediction(
                    model,
                    PerformanceTracker.Domain.GOVERNANCE_DECISION,
                    keccak256(abi.encodePacked(consensusId, model, "consensus")),
                    vote.confidence,
                    wasCorrect,
                    vote.votingWeight
                );
            }
        }
    }
    
    /**
     * @dev Finalize performance based on execution result
     */
    function _finalizePerformance(bytes32 consensusId, bool executionSuccess) private {
        Consensus storage consensus = consensuses[consensusId];
        
        // Models that supported get additional score based on execution
        for (uint256 i = 0; i < consensus.participants.length; i++) {
            address model = consensus.participants[i];
            ModelVote storage vote = consensus.votes[model];
            
            if (vote.hasRevealed && vote.support) {
                performanceTracker.recordPrediction(
                    model,
                    PerformanceTracker.Domain.GOVERNANCE_DECISION,
                    keccak256(abi.encodePacked(consensusId, model, "execution")),
                    vote.confidence,
                    executionSuccess,
                    vote.votingWeight / 2 // Half weight for execution result
                );
            }
        }
    }
    
    /**
     * @dev Get consensus details
     */
    function getConsensus(bytes32 consensusId) external view returns (
        Stage stage,
        uint256 deadline,
        uint256 participants,
        uint256 revealed,
        uint256 supportWeight,
        uint256 opposeWeight,
        bool executed
    ) {
        Consensus storage consensus = consensuses[consensusId];
        return (
            consensus.currentStage,
            consensus.stageDeadline,
            consensus.totalParticipants,
            consensus.revealedCount,
            consensus.supportCount,
            consensus.opposeCount,
            consensus.executed
        );
    }
    
    /**
     * @dev Check if address can participate
     */
    function canParticipate(address model) external view returns (bool) {
        return modelRegistry.isAttestationCurrent(model) && 
               performanceTracker.calculateVotingWeight(model) > 0;
    }
}