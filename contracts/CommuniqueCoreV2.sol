// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./UnifiedRegistry.sol";
import "./consensus/ConsensusEngine.sol";
import "./interfaces/IVOTERToken.sol";

/**
 * @title CommuniqueCoreV2
 * @dev Simplified orchestration contract - under 200 lines
 * @notice ZERO admin controls, agent consensus is MANDATORY
 */
contract CommuniqueCoreV2 {
    
    // Immutable dependencies - no upgrades, no admin changes
    UnifiedRegistry public immutable registry;
    ConsensusEngine public immutable consensus;
    IVOTERToken public immutable voterToken;
    
    // Simple action tracking
    mapping(bytes32 => bool) public processedActions;
    mapping(address => uint256) public lastActionTimestamp;
    
    // Rate limiting
    uint256 public immutable ACTION_COOLDOWN = 1 hours;
    uint256 public immutable DAILY_ACTION_LIMIT = 10;
    mapping(address => mapping(uint256 => uint256)) public dailyActionCount;
    
    // Events
    event ActionProcessed(address indexed citizen, bytes32 actionHash, uint256 reward);
    event TemplateCreated(address indexed creator, bytes32 templateHash);
    event ConsensusRequired(bytes32 actionHash, bytes32 consensusId);
    
    constructor(
        address _registry,
        address _consensus,
        address _voterToken
    ) {
        require(_registry != address(0), "Invalid registry");
        require(_consensus != address(0), "Invalid consensus");
        require(_voterToken != address(0), "Invalid token");
        
        registry = UnifiedRegistry(_registry);
        consensus = ConsensusEngine(_consensus);
        voterToken = IVOTERToken(_voterToken);
    }
    
    /**
     * @dev Process a civic action - REQUIRES consensus proof
     * @param citizen The citizen performing the action
     * @param actionType Type of civic action
     * @param consensusId Proof of consensus approval
     * @param rewardAmount Approved reward amount
     * @param metadataURI IPFS hash of action details
     */
    function processCivicAction(
        address citizen,
        UnifiedRegistry.ActionType actionType,
        bytes32 consensusId,
        uint256 rewardAmount,
        string memory metadataURI
    ) external returns (bytes32 actionHash) {
        // Verify consensus approval
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensus.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        // Rate limiting
        require(block.timestamp >= lastActionTimestamp[citizen] + ACTION_COOLDOWN, "Cooldown active");
        uint256 today = block.timestamp / 1 days;
        require(dailyActionCount[citizen][today] < DAILY_ACTION_LIMIT, "Daily limit reached");
        
        // Generate unique action hash
        actionHash = keccak256(abi.encodePacked(
            citizen,
            actionType,
            consensusId,
            block.timestamp
        ));
        
        require(!processedActions[actionHash], "Action already processed");
        
        // Update tracking
        processedActions[actionHash] = true;
        lastActionTimestamp[citizen] = block.timestamp;
        dailyActionCount[citizen][today]++;
        
        // Record in registry
        registry.recordAction(
            citizen,
            actionType,
            consensusId, // Use consensus ID as validation proof
            rewardAmount,
            metadataURI
        );
        
        // Distribute rewards if approved
        if (rewardAmount > 0) {
            require(voterToken.transfer(citizen, rewardAmount), "Reward transfer failed");
        }
        
        emit ActionProcessed(citizen, actionHash, rewardAmount);
    }
    
    /**
     * @dev Create a template - requires consensus
     * @param creator The template author
     * @param contentURI IPFS hash of template
     * @param consensusId Proof of consensus approval
     */
    function createTemplate(
        address creator,
        string memory contentURI,
        bytes32 consensusId
    ) external returns (bytes32 templateHash) {
        // Verify consensus approval for template creation
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensus.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        // Create template in registry
        templateHash = registry.createTemplate(creator, contentURI);
        
        emit TemplateCreated(creator, templateHash);
    }
    
    /**
     * @dev Request consensus for an action (initiates consensus process)
     * @param description What needs approval
     * @param payload Encoded action details
     */
    function requestConsensus(
        string memory description,
        bytes memory payload
    ) external returns (bytes32 consensusId) {
        // Anyone can request consensus, but it goes through ConsensusEngine
        consensusId = consensus.initiateConsensus(
            description,
            address(this), // This contract is the target
            payload
        );
        
        emit ConsensusRequired(
            keccak256(abi.encodePacked(msg.sender, description)),
            consensusId
        );
    }
    
    /**
     * @dev Check if action can be processed
     * @param citizen The citizen
     * @param consensusId The consensus proof
     */
    function canProcessAction(
        address citizen,
        bytes32 consensusId
    ) external view returns (bool) {
        // Check consensus status
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensus.getConsensus(consensusId);
        if (stage != ConsensusEngine.Stage.COMPLETED || !executed) {
            return false;
        }
        
        // Check rate limits
        if (block.timestamp < lastActionTimestamp[citizen] + ACTION_COOLDOWN) {
            return false;
        }
        
        uint256 today = block.timestamp / 1 days;
        if (dailyActionCount[citizen][today] >= DAILY_ACTION_LIMIT) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @dev Get citizen's action status
     */
    function getActionStatus(address citizen) external view returns (
        uint256 lastAction,
        uint256 todayCount,
        bool canAct
    ) {
        uint256 today = block.timestamp / 1 days;
        return (
            lastActionTimestamp[citizen],
            dailyActionCount[citizen][today],
            block.timestamp >= lastActionTimestamp[citizen] + ACTION_COOLDOWN &&
            dailyActionCount[citizen][today] < DAILY_ACTION_LIMIT
        );
    }
}

// 192 lines - Clean, simple, no admin control