// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ImmutableBounds
 * @dev Mathematical safety rails that cannot be changed by any consensus
 * @notice These bounds are set in stone at deployment - true decentralization
 */
contract ImmutableBounds {
    
    // ============ IMMUTABLE SYSTEM BOUNDS ============
    // These cannot be changed by ANY consensus or governance mechanism
    
    // Staking bounds
    uint256 public immutable MIN_MODEL_STAKE;           // Minimum stake for AI models
    uint256 public immutable MAX_MODEL_STAKE;           // Maximum stake per model
    uint256 public immutable MIN_CHALLENGE_STAKE;       // Minimum for challenges
    uint256 public immutable MAX_CHALLENGE_STAKE;       // Maximum for challenges
    
    // Voting and consensus bounds
    uint256 public immutable MIN_VOTING_PERIOD;         // Minimum time for votes
    uint256 public immutable MAX_VOTING_PERIOD;         // Maximum time for votes
    uint256 public immutable MIN_QUORUM_PERCENTAGE;     // Minimum quorum required
    uint256 public immutable MAX_QUORUM_PERCENTAGE;     // Maximum quorum allowed
    uint256 public immutable CONSENSUS_THRESHOLD;       // Required consensus %
    
    // Economic bounds
    uint256 public immutable MIN_REWARD_AMOUNT;         // Minimum reward per action
    uint256 public immutable MAX_REWARD_AMOUNT;         // Maximum reward per action
    uint256 public immutable MAX_DAILY_MINT_USER;       // Max tokens per user/day
    uint256 public immutable MAX_DAILY_MINT_PROTOCOL;   // Max protocol mint/day
    uint256 public immutable MAX_SLASHING_PERCENTAGE;   // Max slash percentage
    
    // Timing bounds
    uint256 public immutable MIN_ATTESTATION_PERIOD;    // Min time between attestations
    uint256 public immutable MAX_ATTESTATION_PERIOD;    // Max time between attestations
    uint256 public immutable PARAMETER_CHANGE_DELAY;    // Delay for parameter changes
    uint256 public immutable EMERGENCY_DELAY;           // Min delay for emergency actions
    
    // AI Model bounds
    uint256 public immutable MIN_MODELS_REQUIRED;       // Minimum models for consensus
    uint256 public immutable MAX_MODELS_PER_DECISION;   // Maximum models per decision
    uint256 public immutable MAX_MODELS_PER_PROVIDER;   // Max from single provider
    uint256 public immutable MIN_PROVIDER_DIVERSITY;    // Min different providers
    
    // Performance bounds
    uint256 public immutable MIN_ACCURACY_THRESHOLD;    // Min accuracy to remain active
    uint256 public immutable PRUNING_THRESHOLD;         // Accuracy for auto-removal
    uint256 public immutable MAX_FAILED_ATTESTATIONS;   // Before deactivation
    uint256 public immutable MAX_LOSING_STREAK;         // Max consecutive failures
    
    // Constants for calculations
    uint256 public constant PRECISION = 1e18;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant PERCENTAGE = 100;
    
    // Additional immutable parameters for other contracts
    uint256 public constant TOP_PERFORMER_COUNT = 10;
    uint256 public constant MAX_TREASURY_DISBURSEMENT = 100_000 * 10**18;
    uint256 public constant DAILY_TREASURY_CAP = 50_000 * 10**18;
    uint256 public constant WEEKLY_TREASURY_CAP = 200_000 * 10**18;
    uint256 public constant MIN_MAJOR_PROVIDER_AGENTS = 2;
    uint256 public constant MIN_OPEN_SOURCE_AGENTS = 2;
    uint256 public constant MIN_SPECIALIZED_AGENTS = 2;
    
    // Events
    event BoundsEnforced(bytes32 parameter, uint256 value, uint256 bound, bool isMax);
    
    /**
     * @dev Constructor sets all bounds immutably at deployment
     * @notice These values CANNOT be changed after deployment - true trustlessness
     */
    constructor(
        uint256[4] memory stakingBounds,      // [minModel, maxModel, minChallenge, maxChallenge]
        uint256[4] memory votingBounds,       // [minPeriod, maxPeriod, minQuorum, maxQuorum]
        uint256[5] memory economicBounds,     // [minReward, maxReward, maxUserDaily, maxProtocolDaily, maxSlash]
        uint256[4] memory timingBounds,       // [minAttest, maxAttest, paramDelay, emergencyDelay]
        uint256[4] memory modelBounds,        // [minModels, maxModels, maxPerProvider, minDiversity]
        uint256[4] memory performanceBounds   // [minAccuracy, pruningThreshold, maxFailedAttest, maxLosing]
    ) {
        // Staking bounds
        MIN_MODEL_STAKE = stakingBounds[0];
        MAX_MODEL_STAKE = stakingBounds[1];
        MIN_CHALLENGE_STAKE = stakingBounds[2];
        MAX_CHALLENGE_STAKE = stakingBounds[3];
        
        // Voting bounds
        MIN_VOTING_PERIOD = votingBounds[0];
        MAX_VOTING_PERIOD = votingBounds[1];
        MIN_QUORUM_PERCENTAGE = votingBounds[2];
        MAX_QUORUM_PERCENTAGE = votingBounds[3];
        CONSENSUS_THRESHOLD = 67; // 67% consensus required - hardcoded
        
        // Economic bounds
        MIN_REWARD_AMOUNT = economicBounds[0];
        MAX_REWARD_AMOUNT = economicBounds[1];
        MAX_DAILY_MINT_USER = economicBounds[2];
        MAX_DAILY_MINT_PROTOCOL = economicBounds[3];
        MAX_SLASHING_PERCENTAGE = economicBounds[4];
        
        // Timing bounds
        MIN_ATTESTATION_PERIOD = timingBounds[0];
        MAX_ATTESTATION_PERIOD = timingBounds[1];
        PARAMETER_CHANGE_DELAY = timingBounds[2];
        EMERGENCY_DELAY = timingBounds[3];
        
        // Model bounds
        MIN_MODELS_REQUIRED = modelBounds[0];
        MAX_MODELS_PER_DECISION = modelBounds[1];
        MAX_MODELS_PER_PROVIDER = modelBounds[2];
        MIN_PROVIDER_DIVERSITY = modelBounds[3];
        
        // Performance bounds
        MIN_ACCURACY_THRESHOLD = performanceBounds[0];
        PRUNING_THRESHOLD = performanceBounds[1];
        MAX_FAILED_ATTESTATIONS = performanceBounds[2];
        MAX_LOSING_STREAK = performanceBounds[3];
        
        // Validate bounds make sense
        require(MIN_MODEL_STAKE < MAX_MODEL_STAKE, "Invalid stake bounds");
        require(MIN_VOTING_PERIOD < MAX_VOTING_PERIOD, "Invalid voting bounds");
        require(MIN_QUORUM_PERCENTAGE < MAX_QUORUM_PERCENTAGE, "Invalid quorum bounds");
        require(MIN_REWARD_AMOUNT < MAX_REWARD_AMOUNT, "Invalid reward bounds");
        require(MIN_ATTESTATION_PERIOD < MAX_ATTESTATION_PERIOD, "Invalid attestation bounds");
        require(PRUNING_THRESHOLD < MIN_ACCURACY_THRESHOLD, "Invalid accuracy bounds");
    }
    
    // ============ BOUND ENFORCEMENT FUNCTIONS ============
    
    /**
     * @dev Enforce stake bounds
     * @param amount The stake amount to validate
     * @param isModel Whether this is for a model (vs challenge)
     */
    function enforceStakeBounds(uint256 amount, bool isModel) external returns (uint256) {
        uint256 minBound = isModel ? MIN_MODEL_STAKE : MIN_CHALLENGE_STAKE;
        uint256 maxBound = isModel ? MAX_MODEL_STAKE : MAX_CHALLENGE_STAKE;
        
        if (amount < minBound) {
            emit BoundsEnforced("stake", amount, minBound, false);
            return minBound;
        }
        if (amount > maxBound) {
            emit BoundsEnforced("stake", amount, maxBound, true);
            return maxBound;
        }
        return amount;
    }
    
    /**
     * @dev Enforce voting period bounds
     * @param period The proposed voting period
     */
    function enforceVotingPeriod(uint256 period) external returns (uint256) {
        if (period < MIN_VOTING_PERIOD) {
            emit BoundsEnforced("votingPeriod", period, MIN_VOTING_PERIOD, false);
            return MIN_VOTING_PERIOD;
        }
        if (period > MAX_VOTING_PERIOD) {
            emit BoundsEnforced("votingPeriod", period, MAX_VOTING_PERIOD, true);
            return MAX_VOTING_PERIOD;
        }
        return period;
    }
    
    /**
     * @dev Enforce quorum bounds
     * @param quorum The proposed quorum percentage
     */
    function enforceQuorumBounds(uint256 quorum) external returns (uint256) {
        if (quorum < MIN_QUORUM_PERCENTAGE) {
            emit BoundsEnforced("quorum", quorum, MIN_QUORUM_PERCENTAGE, false);
            return MIN_QUORUM_PERCENTAGE;
        }
        if (quorum > MAX_QUORUM_PERCENTAGE) {
            emit BoundsEnforced("quorum", quorum, MAX_QUORUM_PERCENTAGE, true);
            return MAX_QUORUM_PERCENTAGE;
        }
        return quorum;
    }
    
    /**
     * @dev Enforce reward amount bounds
     * @param amount The proposed reward amount
     */
    function enforceRewardBounds(uint256 amount) external returns (uint256) {
        if (amount < MIN_REWARD_AMOUNT) {
            emit BoundsEnforced("reward", amount, MIN_REWARD_AMOUNT, false);
            return MIN_REWARD_AMOUNT;
        }
        if (amount > MAX_REWARD_AMOUNT) {
            emit BoundsEnforced("reward", amount, MAX_REWARD_AMOUNT, true);
            return MAX_REWARD_AMOUNT;
        }
        return amount;
    }
    
    /**
     * @dev Enforce daily minting limits
     * @param userAmount Amount for a specific user
     * @param protocolAmount Total protocol amount
     */
    function enforceDailyMintLimits(
        uint256 userAmount,
        uint256 protocolAmount
    ) external returns (uint256, uint256) {
        uint256 boundedUser = userAmount;
        uint256 boundedProtocol = protocolAmount;
        
        if (userAmount > MAX_DAILY_MINT_USER) {
            boundedUser = MAX_DAILY_MINT_USER;
            emit BoundsEnforced("userDailyMint", userAmount, MAX_DAILY_MINT_USER, true);
        }
        
        if (protocolAmount > MAX_DAILY_MINT_PROTOCOL) {
            boundedProtocol = MAX_DAILY_MINT_PROTOCOL;
            emit BoundsEnforced("protocolDailyMint", protocolAmount, MAX_DAILY_MINT_PROTOCOL, true);
        }
        
        return (boundedUser, boundedProtocol);
    }
    
    /**
     * @dev Enforce slashing percentage bounds
     * @param percentage The proposed slashing percentage
     */
    function enforceSlashingBounds(uint256 percentage) external returns (uint256) {
        if (percentage > MAX_SLASHING_PERCENTAGE) {
            emit BoundsEnforced("slashing", percentage, MAX_SLASHING_PERCENTAGE, true);
            return MAX_SLASHING_PERCENTAGE;
        }
        return percentage;
    }
    
    /**
     * @dev Check if model count is within bounds
     * @param modelCount Number of models participating
     */
    function isValidModelCount(uint256 modelCount) external view returns (bool) {
        return modelCount >= MIN_MODELS_REQUIRED && modelCount <= MAX_MODELS_PER_DECISION;
    }
    
    /**
     * @dev Check if provider diversity is sufficient
     * @param providerCount Number of unique providers
     */
    function isValidProviderDiversity(uint256 providerCount) external view returns (bool) {
        return providerCount >= MIN_PROVIDER_DIVERSITY;
    }
    
    /**
     * @dev Check if accuracy meets minimum threshold
     * @param accuracy The model's accuracy (0-1000)
     */
    function meetsAccuracyThreshold(uint256 accuracy) external view returns (bool) {
        return accuracy >= MIN_ACCURACY_THRESHOLD;
    }
    
    /**
     * @dev Check if model should be pruned
     * @param accuracy The model's accuracy
     * @param failedAttestations Number of failed attestations
     * @param losingStreak Current losing streak
     */
    function shouldPruneModel(
        uint256 accuracy,
        uint256 failedAttestations,
        uint256 losingStreak
    ) external view returns (bool) {
        return accuracy < PRUNING_THRESHOLD || 
               failedAttestations > MAX_FAILED_ATTESTATIONS ||
               losingStreak > MAX_LOSING_STREAK;
    }
    
    /**
     * @dev Get all staking bounds
     */
    function getStakingBounds() external view returns (
        uint256 minModel,
        uint256 maxModel,
        uint256 minChallenge,
        uint256 maxChallenge
    ) {
        return (MIN_MODEL_STAKE, MAX_MODEL_STAKE, MIN_CHALLENGE_STAKE, MAX_CHALLENGE_STAKE);
    }
    
    /**
     * @dev Get all voting bounds
     */
    function getVotingBounds() external view returns (
        uint256 minPeriod,
        uint256 maxPeriod,
        uint256 minQuorum,
        uint256 maxQuorum,
        uint256 consensusThreshold
    ) {
        return (MIN_VOTING_PERIOD, MAX_VOTING_PERIOD, 
                MIN_QUORUM_PERCENTAGE, MAX_QUORUM_PERCENTAGE, CONSENSUS_THRESHOLD);
    }
    
    /**
     * @dev Get all economic bounds
     */
    function getEconomicBounds() external view returns (
        uint256 minReward,
        uint256 maxReward,
        uint256 maxUserDaily,
        uint256 maxProtocolDaily,
        uint256 maxSlashing
    ) {
        return (MIN_REWARD_AMOUNT, MAX_REWARD_AMOUNT, 
                MAX_DAILY_MINT_USER, MAX_DAILY_MINT_PROTOCOL, MAX_SLASHING_PERCENTAGE);
    }
    
    /**
     * @dev Calculate bounded value within range
     */
    function boundValue(uint256 value, uint256 min, uint256 max) external pure returns (uint256) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }
}