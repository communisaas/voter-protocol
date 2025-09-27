// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title UnifiedRegistry
 * @dev Single source of truth consolidating 7 separate registries
 * @notice Eliminates registry anarchy and state synchronization hell
 */
contract UnifiedRegistry {
    
    // ============ UNIFIED CITIZEN PROFILE ============
    // Consolidates data from all 7 registries into single efficient structure
    
    struct CitizenProfile {
        // Identity data (from IdentityRegistry)
        uint256 participantId;          // Unique identifier
        bytes32 districtHash;           // Congressional district
        bool isVerified;                // KYC/identity verification status
        uint256 joinedTimestamp;        // When they joined
        
        // Action data (from VOTERRegistry + CivicActionRegistry)
        uint256 totalActions;           // Total civic actions taken
        uint256 cwcMessagesSent;        // CWC messages to representatives
        uint256 templatesCreated;       // Templates authored
        uint256 lastActionTime;         // Most recent action
        
        // Reputation data (from ReputationRegistry)
        uint256 reputationScore;        // Overall reputation (0-10000)
        uint256 challengeWins;          // Successful challenges
        uint256 challengeLosses;        // Failed challenges
        uint256 epistemicScore;         // Information quality score
        bytes32 credibilityHash;        // Portable ERC-8004 credential
        
        // Validation data (from ValidationRegistry)
        uint256 successfulValidations;  // Actions successfully validated
        uint256 failedValidations;      // Actions that failed validation
        uint256 validatorScore;         // Quality as a validator
        
        // Impact data (from ImpactRegistry)
        uint256 impactScore;            // Measured democratic impact
        uint256 citationsEarned;        // Times templates were cited
        uint256 legislativeWins;        // Correlated legislative changes
        
        // Economic data
        uint256 totalRewardsEarned;     // Lifetime VOTER rewards
        uint256 totalStaked;            // Currently staked in challenges
        uint256 slashEvents;            // Times slashed for violations
    }
    
    struct ActionRecord {
        bytes32 actionHash;             // Unique action identifier
        address citizen;                // Who performed action
        ActionType actionType;          // Type of civic action
        uint256 timestamp;              // When it occurred
        uint256 rewardAmount;           // Reward earned
        bytes32 validationProof;        // Proof of validation
        bool isValid;                   // Validation status
        string metadataURI;            // IPFS/external metadata
    }
    
    struct TemplateRecord {
        bytes32 templateHash;           // Unique template identifier
        address creator;                // Template author
        uint256 useCount;              // Times template was used
        uint256 impactScore;           // Measured impact
        uint256 createdAt;             // Creation timestamp
        bool isActive;                 // Still available for use
        string contentURI;             // IPFS hash of content
    }
    
    enum ActionType {
        CWC_MESSAGE,
        TEMPLATE_CREATION,
        CHALLENGE_PARTICIPATION,
        GOVERNANCE_VOTE,
        DIRECT_ACTION,
        VALIDATION
    }
    
    // ============ UNIFIED STATE STORAGE ============
    
    // Primary citizen mapping - single source of truth
    mapping(address => CitizenProfile) public citizens;
    
    // Action tracking
    mapping(bytes32 => ActionRecord) public actions;
    mapping(address => bytes32[]) public citizenActions;
    
    // Template tracking
    mapping(bytes32 => TemplateRecord) public templates;
    mapping(address => bytes32[]) public citizenTemplates;
    
    // District organization
    mapping(bytes32 => address[]) public districtCitizens;
    mapping(bytes32 => uint256) public districtActivityScore;
    
    // Validation tracking
    mapping(bytes32 => address[]) public actionValidators;
    mapping(address => mapping(bytes32 => bool)) public hasValidated;
    
    // Global statistics
    uint256 public totalCitizens;
    uint256 public totalActions;
    uint256 public totalTemplates;
    uint256 public totalRewardsDistributed;
    
    // Registry configuration (set once at deployment)
    address public immutable consensusEngine;
    uint256 public immutable registrationFee; // If any
    
    // Events
    event CitizenRegistered(address indexed citizen, uint256 participantId, bytes32 districtHash);
    event ActionRecorded(address indexed citizen, bytes32 actionHash, ActionType actionType);
    event TemplateCreated(address indexed creator, bytes32 templateHash);
    event ReputationUpdated(address indexed citizen, uint256 oldScore, uint256 newScore);
    event ValidationRecorded(bytes32 indexed actionHash, address validator, bool isValid);
    
    constructor(address _consensusEngine, uint256 _registrationFee) {
        consensusEngine = _consensusEngine;
        registrationFee = _registrationFee;
    }
    
    /**
     * @dev Register a new citizen
     * @param citizen Address to register
     * @param districtHash Their congressional district
     */
    function registerCitizen(
        address citizen,
        bytes32 districtHash
    ) external returns (uint256 participantId) {
        require(citizens[citizen].participantId == 0, "Already registered");
        require(districtHash != bytes32(0), "Invalid district");
        
        // Assign participant ID
        participantId = ++totalCitizens;
        
        // Initialize profile
        CitizenProfile storage profile = citizens[citizen];
        profile.participantId = participantId;
        profile.districtHash = districtHash;
        profile.isVerified = false; // Requires separate verification
        profile.joinedTimestamp = block.timestamp;
        profile.reputationScore = 100; // Starting reputation
        
        // Add to district
        districtCitizens[districtHash].push(citizen);
        
        emit CitizenRegistered(citizen, participantId, districtHash);
    }
    
    /**
     * @dev Record a civic action
     * @param citizen The citizen performing the action
     * @param actionType Type of action being recorded
     * @param validationProof Proof from consensus engine
     */
    function recordAction(
        address citizen,
        ActionType actionType,
        bytes32 validationProof,
        uint256 rewardAmount,
        string memory metadataURI
    ) external returns (bytes32 actionHash) {
        require(msg.sender == consensusEngine, "Only consensus engine");
        require(citizens[citizen].participantId > 0, "Citizen not registered");
        
        // Generate action hash
        actionHash = keccak256(abi.encodePacked(
            citizen,
            actionType,
            block.timestamp,
            totalActions++
        ));
        
        // Store action record
        actions[actionHash] = ActionRecord({
            actionHash: actionHash,
            citizen: citizen,
            actionType: actionType,
            timestamp: block.timestamp,
            rewardAmount: rewardAmount,
            validationProof: validationProof,
            isValid: true,
            metadataURI: metadataURI
        });
        
        // Update citizen profile
        CitizenProfile storage profile = citizens[citizen];
        profile.totalActions++;
        profile.lastActionTime = block.timestamp;
        profile.totalRewardsEarned += rewardAmount;
        
        if (actionType == ActionType.CWC_MESSAGE) {
            profile.cwcMessagesSent++;
        } else if (actionType == ActionType.TEMPLATE_CREATION) {
            profile.templatesCreated++;
        }
        
        // Track in citizen's action history
        citizenActions[citizen].push(actionHash);
        
        // Update district activity
        districtActivityScore[profile.districtHash]++;
        
        // Update global stats
        totalRewardsDistributed += rewardAmount;
        
        emit ActionRecorded(citizen, actionHash, actionType);
    }
    
    /**
     * @dev Create a new template
     * @param creator The template author
     * @param contentURI IPFS hash of template content
     */
    function createTemplate(
        address creator,
        string memory contentURI
    ) external returns (bytes32 templateHash) {
        require(citizens[creator].participantId > 0, "Creator not registered");
        
        // Generate template hash
        templateHash = keccak256(abi.encodePacked(
            creator,
            contentURI,
            block.timestamp,
            totalTemplates++
        ));
        
        // Store template
        templates[templateHash] = TemplateRecord({
            templateHash: templateHash,
            creator: creator,
            useCount: 0,
            impactScore: 0,
            createdAt: block.timestamp,
            isActive: true,
            contentURI: contentURI
        });
        
        // Track in creator's templates
        citizenTemplates[creator].push(templateHash);
        
        // Update creator profile
        citizens[creator].templatesCreated++;
        
        emit TemplateCreated(creator, templateHash);
    }
    
    /**
     * @dev Update citizen reputation
     * @param citizen The citizen to update
     * @param newScore New reputation score
     */
    function updateReputation(
        address citizen,
        uint256 newScore
    ) external {
        require(msg.sender == consensusEngine, "Only consensus engine");
        require(citizens[citizen].participantId > 0, "Citizen not registered");
        
        uint256 oldScore = citizens[citizen].reputationScore;
        citizens[citizen].reputationScore = newScore;
        
        emit ReputationUpdated(citizen, oldScore, newScore);
    }
    
    /**
     * @dev Update challenge outcomes
     * @param citizen The participant
     * @param won Whether they won the challenge
     * @param slashAmount Amount slashed if lost
     */
    function updateChallengeOutcome(
        address citizen,
        bool won,
        uint256 slashAmount
    ) external {
        require(msg.sender == consensusEngine, "Only consensus engine");
        
        CitizenProfile storage profile = citizens[citizen];
        
        if (won) {
            profile.challengeWins++;
            profile.reputationScore = (profile.reputationScore * 11) / 10; // 10% boost
        } else {
            profile.challengeLosses++;
            profile.slashEvents++;
            profile.totalStaked -= slashAmount;
            profile.reputationScore = (profile.reputationScore * 9) / 10; // 10% penalty
        }
    }
    
    /**
     * @dev Record validation activity
     * @param actionHash Action being validated
     * @param validator The validator
     * @param isValid Validation result
     */
    function recordValidation(
        bytes32 actionHash,
        address validator,
        bool isValid
    ) external {
        require(msg.sender == consensusEngine, "Only consensus engine");
        require(!hasValidated[validator][actionHash], "Already validated");
        
        hasValidated[validator][actionHash] = true;
        actionValidators[actionHash].push(validator);
        
        CitizenProfile storage profile = citizens[validator];
        if (isValid) {
            profile.successfulValidations++;
        } else {
            profile.failedValidations++;
        }
        
        // Update validator score
        uint256 totalValidations = profile.successfulValidations + profile.failedValidations;
        profile.validatorScore = (profile.successfulValidations * 1000) / totalValidations;
        
        emit ValidationRecorded(actionHash, validator, isValid);
    }
    
    /**
     * @dev Update impact scores
     * @param citizen The citizen
     * @param impactIncrease Amount to increase impact score
     * @param citationIncrease New citations earned
     */
    function updateImpact(
        address citizen,
        uint256 impactIncrease,
        uint256 citationIncrease
    ) external {
        require(msg.sender == consensusEngine, "Only consensus engine");
        
        CitizenProfile storage profile = citizens[citizen];
        profile.impactScore += impactIncrease;
        profile.citationsEarned += citationIncrease;
        
        // Bonus for high impact
        if (profile.impactScore > 1000) {
            profile.reputationScore += 100;
        }
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @dev Get complete citizen profile
     */
    function getCitizenProfile(address citizen) external view returns (CitizenProfile memory) {
        return citizens[citizen];
    }
    
    /**
     * @dev Get citizen's action history
     */
    function getCitizenActions(address citizen) external view returns (bytes32[] memory) {
        return citizenActions[citizen];
    }
    
    /**
     * @dev Get district citizens
     */
    function getDistrictCitizens(bytes32 districtHash) external view returns (address[] memory) {
        return districtCitizens[districtHash];
    }
    
    /**
     * @dev Check if citizen is registered
     */
    function isRegistered(address citizen) external view returns (bool) {
        return citizens[citizen].participantId > 0;
    }
    
    /**
     * @dev Get citizen's reputation score
     */
    function getReputation(address citizen) external view returns (uint256) {
        return citizens[citizen].reputationScore;
    }
    
    /**
     * @dev Get template details
     */
    function getTemplate(bytes32 templateHash) external view returns (TemplateRecord memory) {
        return templates[templateHash];
    }
}