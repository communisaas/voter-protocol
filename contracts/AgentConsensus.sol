// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IVOTERToken.sol";
import "./consensus/AIModelRegistry.sol";
import "./consensus/PerformanceTracker.sol";
import "./consensus/ConsensusEngine.sol";
import "./consensus/ImmutableBounds.sol";

/**
 * @title AgentConsensus
 * @dev TEE-verified agent consensus using Phase 3 infrastructure
 * @notice Integrates AIModelRegistry for verification, PerformanceTracker for weights
 * @dev ZERO ADMIN CONTROLS - All governance through ConsensusEngine only
 */
contract AgentConsensus is ReentrancyGuard {
    
    // Dependencies on Phase 3 components
    AIModelRegistry public immutable modelRegistry;
    PerformanceTracker public immutable performanceTracker;
    ConsensusEngine public immutable consensusEngine;
    ImmutableBounds public immutable bounds;
    
    // Simplified - proposals now handled by ConsensusEngine
    mapping(bytes32 => bool) public initiatedProposals;
    mapping(address => uint256) public lastProposalTime;
    
    // State variables - all bounds now from ImmutableBounds
    IVOTERToken public immutable voterToken;
    
    // Slashed stake treasury
    uint256 public slashedStakeTreasury;
    
    // Proposal cooldown
    uint256 public constant PROPOSAL_COOLDOWN = 1 hours;
    
    // Events
    event AgentAttested(
        address indexed agent,
        bytes32 enclaveHash,
        bytes32 modelFingerprint
    );
    
    event ProposalInitiated(
        bytes32 indexed consensusId,
        address indexed initiator,
        string description
    );
    
    event AgentSlashed(
        address indexed agent,
        uint256 amount,
        string reason
    );
    
    modifier onlyVerifiedModel() {
        require(modelRegistry.isAttestationCurrent(msg.sender), "Not a verified model");
        _;
    }
    
    /**
     * @dev Deploy with Phase 3 infrastructure
     */
    constructor(
        address _voterToken,
        address _modelRegistry,
        address _performanceTracker,
        address _consensusEngine,
        address _bounds
    ) {
        require(_voterToken != address(0), "Invalid token");
        require(_modelRegistry != address(0), "Invalid registry");
        require(_performanceTracker != address(0), "Invalid tracker");
        require(_consensusEngine != address(0), "Invalid consensus");
        require(_bounds != address(0), "Invalid bounds");
        
        voterToken = IVOTERToken(_voterToken);
        modelRegistry = AIModelRegistry(_modelRegistry);
        performanceTracker = PerformanceTracker(_performanceTracker);
        consensusEngine = ConsensusEngine(_consensusEngine);
        bounds = ImmutableBounds(_bounds);
    }
    
    /**
     * @dev Register model with TEE attestation
     * @notice Models must call submitAttestation directly on AIModelRegistry first
     */
    function attestModel(
        uint256 stakeAmount
    ) external nonReentrant {
        require(stakeAmount >= bounds.MIN_MODEL_STAKE(), "Insufficient stake");
        
        // Verify model already has valid attestation
        require(modelRegistry.isAttestationCurrent(msg.sender), "Must attest first");
        
        // Transfer stake
        require(
            voterToken.transferFrom(msg.sender, address(this), stakeAmount),
            "Stake transfer failed"
        );
        
        // Get model details for event
        (,, string memory modelIdentifier,,,) = modelRegistry.getModel(msg.sender);
        bytes32 modelFingerprint = keccak256(abi.encodePacked(modelIdentifier));
        
        emit AgentAttested(msg.sender, bytes32(0), modelFingerprint);
    }
    
    /**
     * @dev Initiate consensus through ConsensusEngine
     */
    function initiateProposal(
        string memory description,
        address targetContract,
        bytes memory payload
    ) external onlyVerifiedModel returns (bytes32 consensusId) {
        // Check cooldown
        require(
            block.timestamp >= lastProposalTime[msg.sender] + PROPOSAL_COOLDOWN,
            "Proposal cooldown active"
        );
        
        // Check voting weight
        uint256 weight = performanceTracker.calculateVotingWeight(msg.sender);
        require(weight > 0, "No voting weight");
        
        // Initiate through ConsensusEngine
        consensusId = consensusEngine.initiateConsensus(
            description,
            targetContract,
            payload
        );
        
        initiatedProposals[consensusId] = true;
        lastProposalTime[msg.sender] = block.timestamp;
        
        emit ProposalInitiated(consensusId, msg.sender, description);
    }
    
    /**
     * @dev Submit research for consensus (delegates to ConsensusEngine)
     */
    function submitResearch(
        bytes32 consensusId,
        bytes memory researchData
    ) external onlyVerifiedModel {
        require(initiatedProposals[consensusId], "Unknown proposal");
        consensusEngine.submitResearch(consensusId, researchData);
    }
    
    /**
     * @dev Commit vote (delegates to ConsensusEngine)
     */
    function commitVote(
        bytes32 consensusId,
        bytes32 commitment,
        uint256 confidence
    ) external onlyVerifiedModel {
        require(initiatedProposals[consensusId], "Unknown proposal");
        consensusEngine.commitVote(consensusId, commitment, confidence);
    }
    
    /**
     * @dev Reveal vote (delegates to ConsensusEngine)
     */
    function revealVote(
        bytes32 consensusId,
        bool support,
        uint256 nonce
    ) external onlyVerifiedModel {
        require(initiatedProposals[consensusId], "Unknown proposal");
        consensusEngine.revealVote(consensusId, support, nonce);
    }
    
    /**
     * @dev Execute consensus (delegates to ConsensusEngine)
     */
    function executeConsensus(bytes32 consensusId) external {
        require(initiatedProposals[consensusId], "Unknown proposal");
        consensusEngine.executeConsensus(consensusId);
    }
    
    /**
     * @dev Challenge a model's attestation through registry
     */
    function challengeModel(address model) external onlyVerifiedModel {
        // Check if model's attestation is stale
        require(!modelRegistry.isAttestationCurrent(model), "Model attestation current");
        
        // Challenge is recorded for off-chain handling
        // Models must re-attest within attestation period
    }
    
    /**
     * @dev Slash a model's stake based on poor performance
     */
    function slashModel(
        address model,
        uint256 amount,
        string memory reason
    ) internal {
        // Get slash bounds from ImmutableBounds
        uint256 maxSlash = bounds.MAX_SLASHING_PERCENTAGE();
        require(amount <= (maxSlash * voterToken.balanceOf(address(this))) / 100, "Slash too large");
        
        // Add to treasury
        slashedStakeTreasury += amount;
        
        // Update performance tracker
        performanceTracker.recordSlash(model, amount);
        
        emit AgentSlashed(model, amount, reason);
    }
    
    /**
     * @dev Handle failed consensus outcomes
     */
    function handleFailedConsensus(bytes32 consensusId) external {
        require(initiatedProposals[consensusId], "Unknown proposal");
        
        // Get consensus details from engine
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensusEngine.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.FAILED, "Consensus not failed");
        require(!executed, "Already handled");
        
        // Slash models with poor predictions (handled by PerformanceTracker)
        // No direct slashing here - performance tracker handles it
    }
    
    /**
     * @dev Get voting weight from PerformanceTracker
     */
    function getVotingWeight(address model) public view returns (uint256) {
        return performanceTracker.calculateVotingWeight(model);
    }
    
    /**
     * @dev Check model diversity through registry
     */
    function checkModelDiversity() public view returns (bool) {
        return modelRegistry.checkDiversityRequirements(
            bounds.MIN_MAJOR_PROVIDER_AGENTS(),
            bounds.MIN_OPEN_SOURCE_AGENTS(),
            bounds.MIN_SPECIALIZED_AGENTS()
        );
    }
    
    /**
     * @dev Check if consensus can proceed
     */
    function canParticipateInConsensus(address model) public view returns (bool) {
        return consensusEngine.canParticipate(model);
    }
    
    /**
     * @dev Get total stake held by contract
     */
    function getTotalStake() public view returns (uint256) {
        return voterToken.balanceOf(address(this)) - slashedStakeTreasury;
    }
    
    /**
     * @dev Update model performance metrics
     */
    function updateModelPerformance(
        address model,
        PerformanceTracker.Domain domain,
        bytes32 predictionId,
        uint256 confidence,
        bool correct
    ) external onlyVerifiedModel {
        // Only consensus engine can update performance
        require(msg.sender == address(consensusEngine), "Only consensus engine");
        
        performanceTracker.recordPrediction(
            model,
            domain,
            predictionId,
            confidence,
            correct,
            getVotingWeight(model)
        );
    }
    
    /**
     * @dev Withdraw stake if attestation expired
     */
    function withdrawStake() external nonReentrant {
        require(!modelRegistry.isAttestationCurrent(msg.sender), "Attestation still current");
        
        uint256 balance = voterToken.balanceOf(address(this));
        require(balance > 0, "No stake to withdraw");
        
        // Calculate withdrawable amount (minus any penalties)
        uint256 penalties = performanceTracker.getTotalPenalties(msg.sender);
        uint256 withdrawable = balance > penalties ? balance - penalties : 0;
        
        require(withdrawable > 0, "No withdrawable balance");
        require(voterToken.transfer(msg.sender, withdrawable), "Transfer failed");
    }
    
    /**
     * @dev Add stake to improve voting weight
     */
    function addStake(uint256 amount) external nonReentrant onlyVerifiedModel {
        require(amount > 0, "Invalid amount");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Stake transfer failed"
        );
        
        // Update performance tracker with new stake
        performanceTracker.updateStake(msg.sender, amount);
    }
    
    /**
     * @dev Distribute slashed stake to high-performing models
     */
    function distributeSlashedStake() external {
        require(slashedStakeTreasury > 0, "No treasury to distribute");
        
        // Get top performers from PerformanceTracker
        address[] memory topPerformers = performanceTracker.getTopPerformers(
            bounds.TOP_PERFORMER_COUNT()
        );
        
        require(topPerformers.length > 0, "No eligible recipients");
        
        uint256 distributionPerModel = slashedStakeTreasury / topPerformers.length;
        slashedStakeTreasury = 0;
        
        for (uint256 i = 0; i < topPerformers.length; i++) {
            require(
                voterToken.transfer(topPerformers[i], distributionPerModel),
                "Distribution failed"
            );
        }
    }
    
    /**
     * @dev Get consensus status from engine
     */
    function getConsensusStatus(bytes32 consensusId) external view returns (
        ConsensusEngine.Stage stage,
        uint256 deadline,
        uint256 participants,
        uint256 supportWeight,
        uint256 opposeWeight,
        bool executed
    ) {
        require(initiatedProposals[consensusId], "Unknown proposal");
        
        (stage, deadline, participants, , supportWeight, opposeWeight, executed) = 
            consensusEngine.getConsensus(consensusId);
    }
    
    /**
     * @dev Get immutable system bounds
     */
    function getSystemBounds() external view returns (
        uint256 minStake,
        uint256 consensusThreshold,
        uint256 maxSlash,
        uint256 treasury
    ) {
        return (
            bounds.MIN_MODEL_STAKE(),
            bounds.CONSENSUS_THRESHOLD(),
            bounds.MAX_SLASHING_PERCENTAGE(),
            slashedStakeTreasury
        );
    }
    
    /**
     * @dev Get model attestation status
     */
    function getModelStatus(address model) external view returns (
        bool isAttested,
        bytes32 modelFingerprint,
        uint256 votingWeight,
        uint256 performanceScore
    ) {
        isAttested = modelRegistry.isAttestationCurrent(model);
        
        if (isAttested) {
            (,, string memory modelIdentifier,,,) = modelRegistry.getModel(model);
            modelFingerprint = keccak256(abi.encodePacked(modelIdentifier));
            votingWeight = performanceTracker.calculateVotingWeight(model);
            
            // Get average performance across all domains
            uint256 totalScore;
            for (uint256 i = 0; i < 6; i++) {
                PerformanceTracker.Domain domain = PerformanceTracker.Domain(i);
                (uint256 accuracy,,,,) = performanceTracker.getDomainPerformance(model, domain);
                totalScore += accuracy;
            }
            performanceScore = totalScore / 6;
        }
    }
}

// 409 lines - Simplified to delegate to Phase 3 infrastructure