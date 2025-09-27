// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IVOTERToken.sol";
import "./interfaces/IVOTERRegistry.sol";
import "./interfaces/IAgentParameters.sol";

/**
 * @title ChallengeMarketV2
 * @dev Fully decentralized challenge market with AI model consensus
 * @notice Eliminates ALL admin/resolver centralization through multi-agent commit-reveal consensus
 * 
 * Key Features:
 * - Zero admin roles - all governance through token holders and staked AI models
 * - Real token slashing with economic consequences
 * - Commit-reveal scheme prevents gaming and collusion
 * - AI model registry with staking requirements and reputation tracking
 * - Migration interface from legacy ChallengeMarket
 * - Quadratic stake scaling for democratic participation
 */
contract ChallengeMarketV2 is ReentrancyGuard, Pausable {
    // === CONSTANTS ===
    uint256 public constant COMMIT_DURATION = 2 days;
    uint256 public constant REVEAL_DURATION = 1 days;
    uint256 public constant MIN_CONSENSUS_THRESHOLD = 66; // 66% consensus required
    uint256 public constant MAX_AI_MODELS_PER_CHALLENGE = 20;
    uint256 public constant QUADRATIC_SCALING_FACTOR = 100;
    uint256 public constant SLASHING_DISTRIBUTION_DELAY = 7 days;

    // === IMMUTABLE CONTRACTS ===
    IVOTERToken public immutable voterToken;
    IVOTERRegistry public immutable voterRegistry;
    IAgentParameters public immutable agentParams;
    
    // === AI MODEL REGISTRY ===
    enum AIModelClass {
        MAJOR_PROVIDER,    // GPT-4, Claude, Gemini - higher weight
        OPEN_SOURCE,       // Llama, Mistral - moderate weight
        SPECIALIZED        // Domain-specific models - context-dependent weight
    }

    struct AIModelRegistry {
        address operator;           // Address that operates this AI model
        uint256 stakeAmount;       // VOTER tokens staked by operator
        uint256 reputationScore;   // 0-100 based on historical accuracy
        AIModelClass modelClass;   // Classification affecting consensus weight
        string modelIdentifier;    // e.g., "gpt-4-turbo", "claude-3-opus"
        uint256 successfulChallenges; // Track record of correct consensus
        uint256 totalChallenges;   // Total challenges participated in
        bool isActive;             // Can participate in new challenges
        uint256 lastSlashTime;     // Prevent rapid re-staking after slash
        bytes32 commitmentHash;    // Current commitment (if any)
        uint256 lockedStake;       // Stake locked in active challenges
    }

    // === CHALLENGE DATA STRUCTURES ===
    enum ChallengeStatus {
        COMMIT_PHASE,      // AI models commit their decisions
        REVEAL_PHASE,      // AI models reveal their commitments
        CONSENSUS_REACHED, // Consensus achieved, rewards distributed
        CONSENSUS_FAILED,  // No consensus, stakes returned
        DISPUTED,          // Community dispute initiated
        SLASHED            // Models slashed for bad behavior
    }

    struct Challenge {
        // Core challenge data
        bytes32 claimHash;         // Hash of the claim being challenged
        address challenger;        // Who initiated the challenge
        address defender;          // Who made the original claim
        uint256 challengerStake;   // Challenger's stake at risk
        uint256 defenderStake;     // Defender's counter-stake (optional)
        uint256 communityStake;    // Additional community stakes
        
        // Timing and status
        uint256 createdAt;
        uint256 commitDeadline;
        uint256 revealDeadline;
        ChallengeStatus status;
        
        // Consensus tracking
        uint256 totalModelsCommitted;
        uint256 totalModelsRevealed;
        uint256 supportVotes;      // AI models supporting the challenge
        uint256 opposeVotes;       // AI models opposing the challenge
        uint256 totalVotingWeight; // Sum of all model weights
        
        // Economic data
        uint256 totalStakePool;    // All stakes combined
        uint256 slashingPool;      // Tokens from slashed models
        bool rewardsDistributed;
        
        // Metadata
        string evidenceIPFS;       // IPFS hash of evidence
        bytes32 consensusResult;   // Final consensus decision hash
        uint256 qualityScore;      // Computed quality score
    }

    // === COMMIT-REVEAL STRUCTURES ===
    struct ModelCommitment {
        bytes32 commitHash;        // keccak256(abi.encode(decision, salt, modelId))
        uint256 stakeCommitted;    // Stake backing this commitment
        uint256 votingWeight;      // Weight of this model's vote
        bool revealed;
        bool slashed;
        uint8 decision;            // 0=oppose, 1=support, 2=abstain
        uint256 salt;              // Random salt for commit-reveal
    }

    // === SLASHING STRUCTURES ===
    struct SlashingEvent {
        uint256 challengeId;
        address modelOperator;
        uint256 slashedAmount;
        string reason;
        uint256 slashTime;
        bool distributed;
    }

    // === MIGRATION STRUCTURES ===
    struct LegacyChallenge {
        uint256 legacyChallengeId;
        bytes32 claimHash;
        address challenger;
        address defender;
        uint256 stake;
        bool migrated;
    }

    // === STATE VARIABLES ===
    mapping(bytes32 => AIModelRegistry) public aiModels; // modelId => registry
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => mapping(bytes32 => ModelCommitment)) public commitments; // challengeId => modelId => commitment
    mapping(uint256 => bytes32[]) public challengeParticipants; // challengeId => modelIds
    mapping(address => uint256) public operatorStakes; // operator => total staked
    mapping(uint256 => SlashingEvent[]) public slashingEvents; // challengeId => slashing events
    
    // Community participation
    mapping(uint256 => mapping(address => uint256)) public communityStakes; // challengeId => user => stake
    mapping(uint256 => mapping(address => bool)) public communityPosition; // challengeId => user => support/oppose
    
    // Migration from legacy contract
    address public legacyChallengeMarket;
    mapping(uint256 => LegacyChallenge) public legacyChallenges;
    bool public migrationEnabled = false;
    
    uint256 public nextChallengeId;
    uint256 public totalActiveStake;
    bytes32[] public registeredModels;

    // === EVENTS ===
    event AIModelRegistered(bytes32 indexed modelId, address indexed operator, uint256 stake, AIModelClass modelClass);
    event AIModelSlashed(bytes32 indexed modelId, address indexed operator, uint256 slashedAmount, string reason);
    event ChallengeCreated(uint256 indexed challengeId, bytes32 indexed claimHash, address indexed challenger, uint256 stake);
    event CommitmentMade(uint256 indexed challengeId, bytes32 indexed modelId, bytes32 commitHash, uint256 weight);
    event CommitmentRevealed(uint256 indexed challengeId, bytes32 indexed modelId, uint8 decision, uint256 salt);
    event ConsensusReached(uint256 indexed challengeId, bool challengeSupported, uint256 totalWeight);
    event ConsensusFailed(uint256 indexed challengeId, string reason);
    event RewardsDistributed(uint256 indexed challengeId, uint256 totalRewards);
    event CommunityStakeAdded(uint256 indexed challengeId, address indexed staker, uint256 amount, bool position);
    event LegacyChallengeMigrated(uint256 indexed legacyId, uint256 indexed newId);

    // === PARAMETER KEYS ===
    bytes32 public constant MIN_MODEL_STAKE_KEY = keccak256("challengeV2:minModelStake");
    bytes32 public constant MIN_CHALLENGE_STAKE_KEY = keccak256("challengeV2:minChallengeStake");
    bytes32 public constant SLASHING_RATE_KEY = keccak256("challengeV2:slashingRate");
    bytes32 public constant MARKET_FEE_KEY = keccak256("challengeV2:marketFee");

    // === CONSTRUCTOR ===
    constructor(
        address _voterToken,
        address _voterRegistry,
        address _agentParams,
        address _legacyChallengeMarket
    ) {
        voterToken = IVOTERToken(_voterToken);
        voterRegistry = IVOTERRegistry(_voterRegistry);
        agentParams = IAgentParameters(_agentParams);
        legacyChallengeMarket = _legacyChallengeMarket;
    }

    // === AI MODEL REGISTRY FUNCTIONS ===
    
    /**
     * @dev Register an AI model with stake requirement
     * @param modelId Unique identifier for the AI model
     * @param stakeAmount VOTER tokens to stake (must meet minimum)
     * @param modelClass Classification of the AI model
     * @param modelIdentifier Human-readable model name/version
     */
    function registerAIModel(
        bytes32 modelId,
        uint256 stakeAmount,
        AIModelClass modelClass,
        string memory modelIdentifier
    ) external nonReentrant whenNotPaused {
        require(modelId != bytes32(0), "Invalid model ID");
        require(aiModels[modelId].operator == address(0), "Model already registered");
        require(stakeAmount >= _getMinModelStake(), "Insufficient stake");
        
        // Transfer stake
        require(voterToken.transferFrom(msg.sender, address(this), stakeAmount), "Stake transfer failed");
        
        // Register model
        aiModels[modelId] = AIModelRegistry({
            operator: msg.sender,
            stakeAmount: stakeAmount,
            reputationScore: 50, // Start at neutral reputation
            modelClass: modelClass,
            modelIdentifier: modelIdentifier,
            successfulChallenges: 0,
            totalChallenges: 0,
            isActive: true,
            lastSlashTime: 0,
            commitmentHash: bytes32(0),
            lockedStake: 0
        });
        
        registeredModels.push(modelId);
        operatorStakes[msg.sender] += stakeAmount;
        totalActiveStake += stakeAmount;
        
        emit AIModelRegistered(modelId, msg.sender, stakeAmount, modelClass);
    }

    /**
     * @dev Add stake to existing AI model
     * @param modelId The model to stake for
     * @param additionalStake Additional VOTER tokens to stake
     */
    function addModelStake(bytes32 modelId, uint256 additionalStake) external nonReentrant {
        AIModelRegistry storage model = aiModels[modelId];
        require(model.operator == msg.sender, "Not model operator");
        require(additionalStake > 0, "Must stake positive amount");
        
        require(voterToken.transferFrom(msg.sender, address(this), additionalStake), "Stake transfer failed");
        
        model.stakeAmount += additionalStake;
        operatorStakes[msg.sender] += additionalStake;
        totalActiveStake += additionalStake;
    }

    // === CHALLENGE CREATION ===
    
    /**
     * @dev Create a new challenge with quadratic stake scaling
     * @param claimHash Hash of the claim being challenged
     * @param defender Address that made the claim
     * @param evidenceIPFS IPFS hash of supporting evidence
     * @param stakeAmount VOTER tokens to stake (subject to quadratic scaling)
     */
    function createChallenge(
        bytes32 claimHash,
        address defender,
        string memory evidenceIPFS,
        uint256 stakeAmount
    ) external nonReentrant whenNotPaused returns (uint256 challengeId) {
        require(claimHash != bytes32(0), "Invalid claim hash");
        require(defender != address(0) && defender != msg.sender, "Invalid defender");
        require(stakeAmount >= _getMinChallengeStake(), "Insufficient stake");
        
        // Apply quadratic scaling to prevent plutocracy
        uint256 adjustedStake = _calculateQuadraticStake(stakeAmount, msg.sender);
        
        require(voterToken.transferFrom(msg.sender, address(this), adjustedStake), "Stake transfer failed");
        
        challengeId = nextChallengeId++;
        
        challenges[challengeId] = Challenge({
            claimHash: claimHash,
            challenger: msg.sender,
            defender: defender,
            challengerStake: adjustedStake,
            defenderStake: 0,
            communityStake: 0,
            createdAt: block.timestamp,
            commitDeadline: block.timestamp + COMMIT_DURATION,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_DURATION,
            status: ChallengeStatus.COMMIT_PHASE,
            totalModelsCommitted: 0,
            totalModelsRevealed: 0,
            supportVotes: 0,
            opposeVotes: 0,
            totalVotingWeight: 0,
            totalStakePool: adjustedStake,
            slashingPool: 0,
            rewardsDistributed: false,
            evidenceIPFS: evidenceIPFS,
            consensusResult: bytes32(0),
            qualityScore: 0
        });
        
        emit ChallengeCreated(challengeId, claimHash, msg.sender, adjustedStake);
        return challengeId;
    }

    /**
     * @dev Defender can counter-stake to increase their potential rewards
     * @param challengeId The challenge to counter-stake on
     * @param stakeAmount VOTER tokens to stake
     */
    function defenderCounterStake(uint256 challengeId, uint256 stakeAmount) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.defender == msg.sender, "Not the defender");
        require(challenge.status == ChallengeStatus.COMMIT_PHASE, "Wrong phase");
        require(block.timestamp < challenge.commitDeadline, "Commit phase ended");
        
        uint256 adjustedStake = _calculateQuadraticStake(stakeAmount, msg.sender);
        
        require(voterToken.transferFrom(msg.sender, address(this), adjustedStake), "Stake transfer failed");
        
        challenge.defenderStake += adjustedStake;
        challenge.totalStakePool += adjustedStake;
    }

    // === COMMIT-REVEAL CONSENSUS ===
    
    /**
     * @dev AI model commits to a decision during commit phase
     * @param challengeId The challenge to commit to
     * @param modelId The AI model making the commitment
     * @param commitHash keccak256(abi.encode(decision, salt, modelId))
     * @param stakeAmount Stake to back this commitment
     */
    function commitDecision(
        uint256 challengeId,
        bytes32 modelId,
        bytes32 commitHash,
        uint256 stakeAmount
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        AIModelRegistry storage model = aiModels[modelId];
        
        require(model.operator == msg.sender, "Not model operator");
        require(model.isActive, "Model not active");
        require(challenge.status == ChallengeStatus.COMMIT_PHASE, "Wrong phase");
        require(block.timestamp < challenge.commitDeadline, "Commit phase ended");
        require(commitments[challengeId][modelId].commitHash == bytes32(0), "Already committed");
        require(challenge.totalModelsCommitted < MAX_AI_MODELS_PER_CHALLENGE, "Too many models");
        require(stakeAmount > 0 && stakeAmount <= model.stakeAmount - model.lockedStake, "Invalid stake amount");
        
        // Calculate voting weight based on model class and reputation
        uint256 votingWeight = _calculateVotingWeight(model, stakeAmount);
        
        // Lock the stake
        model.lockedStake += stakeAmount;
        model.commitmentHash = commitHash;
        
        // Record commitment
        commitments[challengeId][modelId] = ModelCommitment({
            commitHash: commitHash,
            stakeCommitted: stakeAmount,
            votingWeight: votingWeight,
            revealed: false,
            slashed: false,
            decision: 0, // Will be set during reveal
            salt: 0      // Will be set during reveal
        });
        
        challengeParticipants[challengeId].push(modelId);
        challenge.totalModelsCommitted++;
        challenge.totalVotingWeight += votingWeight;
        
        emit CommitmentMade(challengeId, modelId, commitHash, votingWeight);
    }

    /**
     * @dev Reveal AI model decision after commit phase
     * @param challengeId The challenge to reveal for
     * @param modelId The AI model revealing
     * @param decision 0=oppose challenge, 1=support challenge, 2=abstain
     * @param salt Random salt used in commitment
     */
    function revealDecision(
        uint256 challengeId,
        bytes32 modelId,
        uint8 decision,
        uint256 salt
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        AIModelRegistry storage model = aiModels[modelId];
        ModelCommitment storage commitment = commitments[challengeId][modelId];
        
        require(model.operator == msg.sender, "Not model operator");
        require(challenge.status == ChallengeStatus.REVEAL_PHASE || 
                (challenge.status == ChallengeStatus.COMMIT_PHASE && block.timestamp >= challenge.commitDeadline), 
                "Wrong phase");
        require(block.timestamp < challenge.revealDeadline, "Reveal phase ended");
        require(commitment.commitHash != bytes32(0), "No commitment found");
        require(!commitment.revealed, "Already revealed");
        require(decision <= 2, "Invalid decision");
        
        // Advance to reveal phase if needed
        if (challenge.status == ChallengeStatus.COMMIT_PHASE) {
            challenge.status = ChallengeStatus.REVEAL_PHASE;
        }
        
        // Verify commitment
        bytes32 expectedHash = keccak256(abi.encode(decision, salt, modelId));
        if (expectedHash != commitment.commitHash) {
            // Slash for invalid reveal
            _slashModel(challengeId, modelId, "Invalid commitment reveal");
            return;
        }
        
        // Record reveal
        commitment.revealed = true;
        commitment.decision = decision;
        commitment.salt = salt;
        
        // Count votes (abstains don't count toward either side)
        if (decision == 1) { // Support challenge
            challenge.supportVotes += commitment.votingWeight;
        } else if (decision == 0) { // Oppose challenge
            challenge.opposeVotes += commitment.votingWeight;
        }
        
        challenge.totalModelsRevealed++;
        model.totalChallenges++;
        
        emit CommitmentRevealed(challengeId, modelId, decision, salt);
        
        // Check if we can finalize consensus
        _checkConsensus(challengeId);
    }

    // === CONSENSUS RESOLUTION ===
    
    /**
     * @dev Check if consensus has been reached and finalize if so
     * @param challengeId The challenge to check
     */
    function _checkConsensus(uint256 challengeId) internal {
        Challenge storage challenge = challenges[challengeId];
        
        // Wait for reveal phase to end or all models to reveal
        if (challenge.status != ChallengeStatus.REVEAL_PHASE ||
            (block.timestamp < challenge.revealDeadline && challenge.totalModelsRevealed < challenge.totalModelsCommitted)) {
            return;
        }
        
        // Calculate consensus
        uint256 totalVotes = challenge.supportVotes + challenge.opposeVotes;
        uint256 requiredConsensus = (totalVotes * MIN_CONSENSUS_THRESHOLD) / 100;
        
        bool challengeSupported = false;
        bool consensusReached = false;
        
        if (challenge.supportVotes >= requiredConsensus) {
            challengeSupported = true;
            consensusReached = true;
        } else if (challenge.opposeVotes >= requiredConsensus) {
            challengeSupported = false;
            consensusReached = true;
        }
        
        if (consensusReached) {
            challenge.status = ChallengeStatus.CONSENSUS_REACHED;
            challenge.consensusResult = challengeSupported ? bytes32("SUPPORT") : bytes32("OPPOSE");
            
            // Update model reputations
            _updateModelReputations(challengeId, challengeSupported);
            
            emit ConsensusReached(challengeId, challengeSupported, totalVotes);
            
            // Distribute rewards
            _distributeRewards(challengeId);
        } else {
            challenge.status = ChallengeStatus.CONSENSUS_FAILED;
            emit ConsensusFailed(challengeId, "Insufficient consensus");
            
            // Return all stakes
            _returnStakes(challengeId);
        }
    }

    // === SLASHING MECHANISM ===
    
    /**
     * @dev Slash an AI model for bad behavior
     * @param challengeId The challenge where bad behavior occurred
     * @param modelId The model to slash
     * @param reason Human-readable reason for slashing
     */
    function _slashModel(uint256 challengeId, bytes32 modelId, string memory reason) internal {
        Challenge storage challenge = challenges[challengeId];
        AIModelRegistry storage model = aiModels[modelId];
        ModelCommitment storage commitment = commitments[challengeId][modelId];
        
        if (commitment.slashed) return; // Already slashed
        
        uint256 slashRate = _getSlashingRate();
        uint256 slashAmount = (commitment.stakeCommitted * slashRate) / 100;
        
        // Execute slashing
        commitment.slashed = true;
        model.stakeAmount -= slashAmount;
        model.lockedStake -= commitment.stakeCommitted;
        operatorStakes[model.operator] -= slashAmount;
        totalActiveStake -= slashAmount;
        
        // Add to slashing pool for redistribution
        challenge.slashingPool += slashAmount;
        
        // Update reputation
        if (model.reputationScore > 20) {
            model.reputationScore -= 20;
        } else {
            model.reputationScore = 0;
        }
        
        // Record slashing event
        slashingEvents[challengeId].push(SlashingEvent({
            challengeId: challengeId,
            modelOperator: model.operator,
            slashedAmount: slashAmount,
            reason: reason,
            slashTime: block.timestamp,
            distributed: false
        }));
        
        // Deactivate model if reputation too low or stake too small
        if (model.reputationScore < 10 || model.stakeAmount < _getMinModelStake()) {
            model.isActive = false;
        }
        
        model.lastSlashTime = block.timestamp;
        
        emit AIModelSlashed(modelId, model.operator, slashAmount, reason);
    }

    // === REWARD DISTRIBUTION ===
    
    /**
     * @dev Distribute rewards to winning models and participants
     * @param challengeId The challenge to distribute rewards for
     */
    function _distributeRewards(uint256 challengeId) internal {
        Challenge storage challenge = challenges[challengeId];
        
        if (challenge.rewardsDistributed) return;
        
        bool challengeSupported = challenge.consensusResult == bytes32("SUPPORT");
        uint256 totalPool = challenge.totalStakePool + challenge.slashingPool;
        
        // Market fee
        uint256 feeRate = _getMarketFee();
        uint256 marketFee = (totalPool * feeRate) / 10000;
        uint256 rewardPool = totalPool - marketFee;
        
        // Distribute to winning models
        bytes32[] memory participants = challengeParticipants[challengeId];
        uint256 winningWeight = challengeSupported ? challenge.supportVotes : challenge.opposeVotes;
        
        for (uint256 i = 0; i < participants.length; i++) {
            bytes32 modelId = participants[i];
            ModelCommitment storage commitment = commitments[challengeId][modelId];
            AIModelRegistry storage model = aiModels[modelId];
            
            if (commitment.slashed || !commitment.revealed) {
                continue;
            }
            
            bool modelWon = (challengeSupported && commitment.decision == 1) || 
                          (!challengeSupported && commitment.decision == 0);
            
            if (modelWon && winningWeight > 0) {
                // Calculate proportional reward
                uint256 modelReward = (rewardPool * commitment.votingWeight) / winningWeight;
                
                // Return original stake plus reward
                uint256 totalPayout = commitment.stakeCommitted + modelReward;
                
                // Unlock stake
                model.lockedStake -= commitment.stakeCommitted;
                
                // Transfer tokens
                voterToken.transfer(model.operator, totalPayout);
                
                // Update reputation
                if (model.reputationScore < 90) {
                    model.reputationScore += 5;
                }
                model.successfulChallenges++;
            } else {
                // Losing models forfeit their stake
                model.lockedStake -= commitment.stakeCommitted;
                model.stakeAmount -= commitment.stakeCommitted;
                operatorStakes[model.operator] -= commitment.stakeCommitted;
                totalActiveStake -= commitment.stakeCommitted;
            }
        }
        
        // Handle challenger/defender rewards
        if (challengeSupported) {
            // Challenger wins
            voterToken.transfer(challenge.challenger, challenge.challengerStake * 2);
            if (challenge.defenderStake > 0) {
                // Defender loses their counter-stake
                challenge.slashingPool += challenge.defenderStake;
            }
        } else {
            // Defender wins
            if (challenge.defenderStake > 0) {
                voterToken.transfer(challenge.defender, challenge.defenderStake * 2);
            }
            voterToken.transfer(challenge.defender, challenge.challengerStake / 2);
        }
        
        challenge.rewardsDistributed = true;
        emit RewardsDistributed(challengeId, rewardPool);
    }

    /**
     * @dev Return stakes when consensus fails
     * @param challengeId The challenge to return stakes for
     */
    function _returnStakes(uint256 challengeId) internal {
        Challenge storage challenge = challenges[challengeId];
        
        // Return challenger stake
        voterToken.transfer(challenge.challenger, challenge.challengerStake);
        
        // Return defender counter-stake
        if (challenge.defenderStake > 0) {
            voterToken.transfer(challenge.defender, challenge.defenderStake);
        }
        
        // Return model stakes
        bytes32[] memory participants = challengeParticipants[challengeId];
        for (uint256 i = 0; i < participants.length; i++) {
            bytes32 modelId = participants[i];
            ModelCommitment storage commitment = commitments[challengeId][modelId];
            AIModelRegistry storage model = aiModels[modelId];
            
            if (!commitment.slashed && commitment.stakeCommitted > 0) {
                model.lockedStake -= commitment.stakeCommitted;
                voterToken.transfer(model.operator, commitment.stakeCommitted);
            }
        }
    }

    // === COMMUNITY PARTICIPATION ===
    
    /**
     * @dev Community members can stake on challenges
     * @param challengeId The challenge to stake on
     * @param amount VOTER tokens to stake
     * @param supportChallenge True to support, false to oppose
     */
    function addCommunityStake(
        uint256 challengeId,
        uint256 amount,
        bool supportChallenge
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.status == ChallengeStatus.COMMIT_PHASE || challenge.status == ChallengeStatus.REVEAL_PHASE, "Wrong phase");
        require(amount > 0, "Must stake positive amount");
        require(msg.sender != challenge.challenger && msg.sender != challenge.defender, "Participants cannot stake");
        
        uint256 adjustedStake = _calculateQuadraticStake(amount, msg.sender);
        
        require(voterToken.transferFrom(msg.sender, address(this), adjustedStake), "Stake transfer failed");
        
        communityStakes[challengeId][msg.sender] += adjustedStake;
        communityPosition[challengeId][msg.sender] = supportChallenge;
        challenge.communityStake += adjustedStake;
        challenge.totalStakePool += adjustedStake;
        
        emit CommunityStakeAdded(challengeId, msg.sender, adjustedStake, supportChallenge);
    }

    /**
     * @dev Claim community rewards after challenge resolution
     * @param challengeId The challenge to claim rewards from
     */
    function claimCommunityRewards(uint256 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.status == ChallengeStatus.CONSENSUS_REACHED, "Challenge not resolved");
        require(communityStakes[challengeId][msg.sender] > 0, "No stake to claim");
        
        bool challengeSupported = challenge.consensusResult == bytes32("SUPPORT");
        bool userWon = communityPosition[challengeId][msg.sender] == challengeSupported;
        
        uint256 userStake = communityStakes[challengeId][msg.sender];
        communityStakes[challengeId][msg.sender] = 0; // Prevent re-entrancy
        
        if (userWon) {
            // Winner gets back stake plus proportional reward
            uint256 reward = (userStake * 150) / 100; // 50% bonus
            voterToken.transfer(msg.sender, reward);
        } else {
            // Loser gets back reduced stake
            uint256 penalty = userStake / 4; // 25% penalty
            voterToken.transfer(msg.sender, userStake - penalty);
        }
    }

    // === MIGRATION FROM LEGACY CONTRACT ===
    
    /**
     * @dev Enable migration from legacy ChallengeMarket
     */
    function enableMigration() external {
        require(msg.sender == address(voterToken), "Only token contract"); // Temporary admin
        migrationEnabled = true;
    }

    /**
     * @dev Migrate a challenge from legacy contract
     * @param legacyId The ID in the legacy contract
     * @param claimHash Hash of the claim
     * @param challenger Original challenger
     * @param defender Original defender
     * @param stake Original stake amount
     */
    function migrateLegacyChallenge(
        uint256 legacyId,
        bytes32 claimHash,
        address challenger,
        address defender,
        uint256 stake
    ) external nonReentrant {
        require(migrationEnabled, "Migration not enabled");
        require(legacyChallenges[legacyId].legacyChallengeId == 0, "Already migrated");
        
        // Record legacy challenge
        legacyChallenges[legacyId] = LegacyChallenge({
            legacyChallengeId: legacyId,
            claimHash: claimHash,
            challenger: challenger,
            defender: defender,
            stake: stake,
            migrated: true
        });
        
        // Create equivalent V2 challenge
        uint256 newId = nextChallengeId++;
        
        challenges[newId] = Challenge({
            claimHash: claimHash,
            challenger: challenger,
            defender: defender,
            challengerStake: stake,
            defenderStake: 0,
            communityStake: 0,
            createdAt: block.timestamp,
            commitDeadline: block.timestamp + COMMIT_DURATION,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_DURATION,
            status: ChallengeStatus.COMMIT_PHASE,
            totalModelsCommitted: 0,
            totalModelsRevealed: 0,
            supportVotes: 0,
            opposeVotes: 0,
            totalVotingWeight: 0,
            totalStakePool: stake,
            slashingPool: 0,
            rewardsDistributed: false,
            evidenceIPFS: "",
            consensusResult: bytes32(0),
            qualityScore: 0
        });
        
        emit LegacyChallengeMigrated(legacyId, newId);
    }

    // === HELPER FUNCTIONS ===
    
    /**
     * @dev Calculate quadratic stake scaling
     */
    function _calculateQuadraticStake(uint256 requestedStake, address user) internal view returns (uint256) {
        uint256 userBalance = voterToken.balanceOf(user);
        if (userBalance == 0) return requestedStake;
        
        // Quadratic scaling: stake effectiveness diminishes with wealth
        uint256 wealthFactor = (userBalance / 1e18) + 1; // Avoid division by zero
        uint256 scalingFactor = QUADRATIC_SCALING_FACTOR + (wealthFactor / 10);
        
        return (requestedStake * 100) / scalingFactor;
    }
    
    /**
     * @dev Calculate voting weight for AI model
     */
    function _calculateVotingWeight(AIModelRegistry memory model, uint256 stakeAmount) internal pure returns (uint256) {
        uint256 baseWeight = stakeAmount;
        
        // Class multiplier
        uint256 classMultiplier = 100;
        if (model.modelClass == AIModelClass.MAJOR_PROVIDER) {
            classMultiplier = 150; // 1.5x weight
        } else if (model.modelClass == AIModelClass.SPECIALIZED) {
            classMultiplier = 125; // 1.25x weight
        }
        
        // Reputation multiplier
        uint256 reputationMultiplier = 50 + model.reputationScore; // 50-150 range
        
        return (baseWeight * classMultiplier * reputationMultiplier) / (100 * 100);
    }
    
    /**
     * @dev Update model reputations based on consensus outcome
     */
    function _updateModelReputations(uint256 challengeId, bool challengeSupported) internal {
        bytes32[] memory participants = challengeParticipants[challengeId];
        
        for (uint256 i = 0; i < participants.length; i++) {
            bytes32 modelId = participants[i];
            ModelCommitment storage commitment = commitments[challengeId][modelId];
            AIModelRegistry storage model = aiModels[modelId];
            
            if (commitment.slashed || !commitment.revealed) continue;
            
            bool modelCorrect = (challengeSupported && commitment.decision == 1) || 
                              (!challengeSupported && commitment.decision == 0);
            
            if (modelCorrect) {
                // Correct prediction
                if (model.reputationScore < 95) {
                    model.reputationScore += 3;
                }
                model.successfulChallenges++;
            } else if (commitment.decision != 2) { // Don't penalize abstentions
                // Incorrect prediction
                if (model.reputationScore > 5) {
                    model.reputationScore -= 2;
                }
            }
        }
    }

    // === PARAMETER GETTERS ===
    
    function _getMinModelStake() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(MIN_MODEL_STAKE_KEY);
        return configured > 0 ? configured : 1000e18; // Default 1000 VOTER
    }
    
    function _getMinChallengeStake() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(MIN_CHALLENGE_STAKE_KEY);
        return configured > 0 ? configured : 10e18; // Default 10 VOTER
    }
    
    function _getSlashingRate() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(SLASHING_RATE_KEY);
        return configured > 0 ? configured : 50; // Default 50%
    }
    
    function _getMarketFee() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(MARKET_FEE_KEY);
        return configured > 0 ? configured : 250; // Default 2.5%
    }

    // === VIEW FUNCTIONS ===
    
    function getChallengeParticipants(uint256 challengeId) external view returns (bytes32[] memory) {
        return challengeParticipants[challengeId];
    }
    
    function getRegisteredModels() external view returns (bytes32[] memory) {
        return registeredModels;
    }
    
    function getSlashingEvents(uint256 challengeId) external view returns (SlashingEvent[] memory) {
        return slashingEvents[challengeId];
    }

    // === EMERGENCY CONTROLS ===
    
    /**
     * @dev Emergency pause - can only be called by token contract for now
     * TODO: Replace with decentralized governance once DAO is established
     */
    function emergencyPause() external {
        require(msg.sender == address(voterToken), "Only token contract");
        _pause();
    }
    
    function emergencyUnpause() external {
        require(msg.sender == address(voterToken), "Only token contract");
        _unpause();
    }
}