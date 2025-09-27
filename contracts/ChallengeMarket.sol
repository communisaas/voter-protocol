// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IVOTERToken.sol";
import "./interfaces/IVOTERRegistry.sol";
import "./interfaces/IAgentParameters.sol";

/**
 * @title ChallengeMarket
 * @dev Carroll Mechanisms for information quality through decentralized AI consensus
 * @notice Evaluates discourse quality through multi-agent consensus with real token slashing
 */
contract ChallengeMarket is ReentrancyGuard {
    using ECDSA for bytes32;
    
    // AI Model registry and consensus parameters
    uint256 public constant CONSENSUS_THRESHOLD = 67; // 67% consensus required
    uint256 public constant COMMIT_PHASE_DURATION = 1 days;
    uint256 public constant REVEAL_PHASE_DURATION = 1 days;
    uint256 public constant MIN_AI_MODEL_STAKE = 1000e18; // 1000 VOTER minimum stake
    uint256 public constant MAX_AI_MODELS = 21; // Maximum registered models for gas efficiency
    
    IVOTERToken public immutable voterToken;
    IVOTERRegistry public immutable voterRegistry;
    
    enum ChallengeStatus {
        ACTIVE,
        COMMIT_PHASE,
        REVEAL_PHASE,
        RESOLVED_SUPPORT,
        RESOLVED_OPPOSE,
        RESOLVED_INSUFFICIENT_CONSENSUS,
        CANCELLED
    }
    
    enum ModelDecision {
        ABSTAIN,
        SUPPORT_CHALLENGE,
        OPPOSE_CHALLENGE
    }
    
    struct AIModel {
        address operator;
        string modelName;
        uint256 stake;
        uint256 successfulVotes;
        uint256 totalVotes;
        bool active;
        uint256 registrationTime;
    }
    
    struct Challenge {
        address challenger;
        address defender;
        bytes32 claimHash;
        uint256 challengerStake;
        uint256 defenderStake;
        uint256 supportStake;
        uint256 opposeStake;
        uint256 createdAt;
        uint256 commitPhaseEnd;
        uint256 revealPhaseEnd;
        ChallengeStatus status;
        string evidenceIPFS;
        uint256 supportVotes;
        uint256 opposeVotes;
        uint256 totalModelVotes;
        uint256 slashedAmount; // Total tokens slashed from losing side
    }
    
    struct ModelCommitment {
        bytes32 commitHash; // Hash of (decision + nonce)
        bool revealed;
        ModelDecision decision;
        uint256 confidence; // 0-100
    }
    
    struct ParticipantStake {
        uint256 amount;
        bool isSupport;
        bool claimed;
    }
    
    // Core mappings
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => mapping(address => ParticipantStake)) public stakes;
    mapping(address => uint256) public reputationScores;
    mapping(bytes32 => uint256) public claimToChallengeId;
    
    // AI Model registry and voting
    mapping(address => AIModel) public aiModels;
    mapping(uint256 => mapping(address => ModelCommitment)) public modelCommitments;
    address[] public registeredModels;
    
    // Slashing and treasury
    mapping(address => uint256) public slashableStakes; // User stakes that can be slashed
    uint256 public treasuryPool; // Accumulated slashed tokens
    
    uint256 public nextChallengeId;
    uint256 public feePool;
    
    // Agent-determined parameters interface
    IAgentParameters public immutable agentParams;
    
    // Parameter keys for agent configuration
    bytes32 public constant MIN_STAKE_KEY = keccak256("challenge:minStake");
    bytes32 public constant DURATION_KEY = keccak256("challenge:duration");
    bytes32 public constant QUALITY_THRESHOLD_KEY = keccak256("challenge:qualityThreshold");
    bytes32 public constant MARKET_FEE_KEY = keccak256("challenge:marketFeeRate");
    
    // Contextual intelligence parameters
    bytes32 public constant EXPERTISE_MULTIPLIER_KEY = keccak256("challenge:expertiseMultiplier");
    bytes32 public constant TRACK_RECORD_MULTIPLIER_KEY = keccak256("challenge:trackRecordMultiplier");
    bytes32 public constant NATIONAL_ISSUE_MULTIPLIER_KEY = keccak256("challenge:nationalIssueMultiplier");
    bytes32 public constant EARNED_TOKEN_WEIGHT_KEY = keccak256("challenge:earnedTokenWeight");
    
    // Track earned vs purchased tokens for contextual pricing
    mapping(address => uint256) public earnedTokens;
    mapping(address => uint256) public purchasedTokens;
    
    // Track expertise domains for domain-specific stake calculation
    mapping(address => mapping(bytes32 => uint256)) public expertiseScores; // user => domain => score
    mapping(address => uint256) public creatorTrackRecords; // successful challenges/templates
    
    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed challenger,
        address indexed defender,
        bytes32 claimHash,
        uint256 challengerStake,
        uint256 defenderStake
    );
    
    event AIModelRegistered(
        address indexed operator,
        string modelName,
        uint256 stake
    );
    
    event ModelCommitted(
        uint256 indexed challengeId,
        address indexed model,
        bytes32 commitHash
    );
    
    event ModelRevealed(
        uint256 indexed challengeId,
        address indexed model,
        ModelDecision decision,
        uint256 confidence
    );
    
    event TokensSlashed(
        uint256 indexed challengeId,
        address indexed user,
        uint256 amount,
        string reason
    );
    
    event StakeAdded(
        uint256 indexed challengeId,
        address indexed staker,
        uint256 amount,
        bool isSupport
    );
    
    event ChallengeResolved(
        uint256 indexed challengeId,
        ChallengeStatus status,
        uint256 qualityScore
    );
    
    event RewardsDistributed(
        uint256 indexed challengeId,
        uint256 totalRewards
    );
    
    constructor(address _voterToken, address _voterRegistry, address _agentParams) {
        voterToken = IVOTERToken(_voterToken);
        voterRegistry = IVOTERRegistry(_voterRegistry);
        agentParams = IAgentParameters(_agentParams);
    }
    
    /**
     * @dev Register an AI model for consensus voting
     * @param modelName Name/identifier of the AI model
     * @param stakeAmount Amount to stake (minimum MIN_AI_MODEL_STAKE)
     */
    function registerAIModel(
        string memory modelName,
        uint256 stakeAmount
    ) external nonReentrant {
        require(bytes(modelName).length > 0, "Invalid model name");
        require(stakeAmount >= MIN_AI_MODEL_STAKE, "Insufficient stake");
        require(aiModels[msg.sender].operator == address(0), "Model already registered");
        require(registeredModels.length < MAX_AI_MODELS, "Maximum models reached");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), stakeAmount),
            "Stake transfer failed"
        );
        
        aiModels[msg.sender] = AIModel({
            operator: msg.sender,
            modelName: modelName,
            stake: stakeAmount,
            successfulVotes: 0,
            totalVotes: 0,
            active: true,
            registrationTime: block.timestamp
        });
        
        registeredModels.push(msg.sender);
        slashableStakes[msg.sender] += stakeAmount;
        
        emit AIModelRegistered(msg.sender, modelName, stakeAmount);
    }
    
    /**
     * @dev Create a challenge against a claim with symmetric staking
     * @param claimHash Hash of the claim being challenged
     * @param defender Address that made the original claim  
     * @param evidenceIPFS IPFS hash containing challenge evidence
     * @param claimDomain Domain of the claim (e.g., healthcare, environment, economy)
     * @param impactScope Scope of impact (local=0, state=1, national=2)
     */
    function createChallenge(
        bytes32 claimHash,
        address defender,
        string memory evidenceIPFS,
        bytes32 claimDomain,
        uint8 impactScope
    ) external nonReentrant returns (uint256) {
        require(claimHash != bytes32(0), "Invalid claim hash");
        require(defender != address(0), "Invalid defender");
        require(defender != msg.sender, "Cannot challenge yourself");
        require(claimToChallengeId[claimHash] == 0, "Claim already challenged");
        require(impactScope <= 2, "Invalid impact scope");
        require(registeredModels.length >= 3, "Insufficient AI models for consensus");
        
        // Calculate symmetric stakes for both parties
        uint256 challengerStake = _calculateContextualStake(
            msg.sender,
            defender,
            claimDomain,
            impactScope
        );
        
        uint256 defenderStake = _calculateDefenderStake(
            defender,
            msg.sender,
            claimDomain,
            impactScope
        );
        
        // Both parties must stake tokens
        require(
            voterToken.transferFrom(msg.sender, address(this), challengerStake),
            "Challenger stake transfer failed"
        );
        
        require(
            voterToken.transferFrom(defender, address(this), defenderStake),
            "Defender stake transfer failed"
        );
        
        uint256 challengeId = nextChallengeId++;
        
        challenges[challengeId] = Challenge({
            challenger: msg.sender,
            defender: defender,
            claimHash: claimHash,
            challengerStake: challengerStake,
            defenderStake: defenderStake,
            supportStake: 0,
            opposeStake: 0,
            createdAt: block.timestamp,
            commitPhaseEnd: block.timestamp + COMMIT_PHASE_DURATION,
            revealPhaseEnd: block.timestamp + COMMIT_PHASE_DURATION + REVEAL_PHASE_DURATION,
            status: ChallengeStatus.ACTIVE,
            evidenceIPFS: evidenceIPFS,
            supportVotes: 0,
            opposeVotes: 0,
            totalModelVotes: 0,
            slashedAmount: 0
        });
        
        claimToChallengeId[claimHash] = challengeId;
        
        // Add stakes to slashable pools
        slashableStakes[msg.sender] += challengerStake;
        slashableStakes[defender] += defenderStake;
        
        emit ChallengeCreated(challengeId, msg.sender, defender, claimHash, challengerStake, defenderStake);
        return challengeId;
    }
    
    /**
     * @dev Create challenge with default parameters (backward compatibility)
     * @param claimHash Hash of the claim being challenged
     * @param defender Address that made the original claim
     * @param evidenceIPFS IPFS hash containing challenge evidence
     */
    function createChallenge(
        bytes32 claimHash,
        address defender,
        string memory evidenceIPFS
    ) external nonReentrant returns (uint256) {
        // Default to general domain and local scope for backward compatibility
        return this.createChallenge(
            claimHash,
            defender,
            evidenceIPFS,
            keccak256("general"),
            0 // local scope
        );
    }
    
    /**
     * @dev Commit-phase voting for AI models
     * @param challengeId ID of the challenge
     * @param commitHash Keccak256 hash of (decision, confidence, nonce)
     */
    function commitModelVote(
        uint256 challengeId,
        bytes32 commitHash
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.status == ChallengeStatus.ACTIVE, "Challenge not in active state");
        require(block.timestamp < challenge.commitPhaseEnd, "Commit phase ended");
        require(aiModels[msg.sender].active, "AI model not registered or inactive");
        require(commitHash != bytes32(0), "Invalid commit hash");
        require(
            modelCommitments[challengeId][msg.sender].commitHash == bytes32(0),
            "Model already committed"
        );
        
        modelCommitments[challengeId][msg.sender] = ModelCommitment({
            commitHash: commitHash,
            revealed: false,
            decision: ModelDecision.ABSTAIN, // Will be set during reveal
            confidence: 0 // Will be set during reveal
        });
        
        emit ModelCommitted(challengeId, msg.sender, commitHash);
    }
    
    /**
     * @dev Reveal-phase voting for AI models
     * @param challengeId ID of the challenge
     * @param decision The model's decision (0=ABSTAIN, 1=SUPPORT_CHALLENGE, 2=OPPOSE_CHALLENGE)
     * @param confidence Confidence level (0-100)
     * @param nonce Random nonce used in commit hash
     */
    function revealModelVote(
        uint256 challengeId,
        ModelDecision decision,
        uint256 confidence,
        uint256 nonce
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            challenge.status == ChallengeStatus.ACTIVE || challenge.status == ChallengeStatus.COMMIT_PHASE,
            "Challenge not in reveal phase"
        );
        require(
            block.timestamp >= challenge.commitPhaseEnd && 
            block.timestamp < challenge.revealPhaseEnd,
            "Not in reveal phase"
        );
        require(confidence <= 100, "Invalid confidence level");
        require(aiModels[msg.sender].active, "AI model not active");
        
        ModelCommitment storage commitment = modelCommitments[challengeId][msg.sender];
        require(commitment.commitHash != bytes32(0), "No commitment found");
        require(!commitment.revealed, "Vote already revealed");
        
        // Verify commit hash
        bytes32 expectedHash = keccak256(abi.encodePacked(uint8(decision), confidence, nonce));
        require(commitment.commitHash == expectedHash, "Invalid reveal");
        
        // Record the vote
        commitment.revealed = true;
        commitment.decision = decision;
        commitment.confidence = confidence;
        
        // Update vote counts
        aiModels[msg.sender].totalVotes++;
        challenge.totalModelVotes++;
        
        if (decision == ModelDecision.SUPPORT_CHALLENGE) {
            challenge.supportVotes++;
        } else if (decision == ModelDecision.OPPOSE_CHALLENGE) {
            challenge.opposeVotes++;
        }
        
        // Update challenge status if this is the first reveal
        if (challenge.status == ChallengeStatus.ACTIVE) {
            challenge.status = ChallengeStatus.REVEAL_PHASE;
        }
        
        emit ModelRevealed(challengeId, msg.sender, decision, confidence);
    }
    
    /**
     * @dev Add stake to support or oppose a challenge
     * @param challengeId ID of the challenge
     * @param amount Amount to stake
     * @param isSupport True to support challenge, false to oppose
     */
    function addStake(
        uint256 challengeId,
        uint256 amount,
        bool isSupport
    ) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            challenge.status == ChallengeStatus.ACTIVE || 
            challenge.status == ChallengeStatus.COMMIT_PHASE,
            "Challenge not accepting stakes"
        );
        require(block.timestamp < challenge.commitPhaseEnd, "Staking period ended");
        uint256 minStake = _getMinStake();
        require(amount >= minStake / 10, "Stake too small");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Stake transfer failed"
        );
        
        if (isSupport) {
            challenge.supportStake += amount;
        } else {
            challenge.opposeStake += amount;
        }
        
        stakes[challengeId][msg.sender].amount += amount;
        stakes[challengeId][msg.sender].isSupport = isSupport;
        slashableStakes[msg.sender] += amount;
        
        emit StakeAdded(challengeId, msg.sender, amount, isSupport);
    }
    
    /**
     * @dev Resolve a challenge based on AI consensus (anyone can call after reveal phase)
     * @param challengeId ID of the challenge to resolve
     */
    function resolveChallenge(uint256 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            challenge.status == ChallengeStatus.REVEAL_PHASE,
            "Challenge not in reveal phase"
        );
        require(block.timestamp >= challenge.revealPhaseEnd, "Reveal phase not ended");
        require(challenge.totalModelVotes > 0, "No model votes recorded");
        
        // Calculate consensus percentage
        uint256 totalDecisiveVotes = challenge.supportVotes + challenge.opposeVotes;
        require(totalDecisiveVotes > 0, "No decisive votes");
        
        uint256 supportPercentage = (challenge.supportVotes * 100) / totalDecisiveVotes;
        uint256 opposePercentage = (challenge.opposeVotes * 100) / totalDecisiveVotes;
        
        bool challengeSupported;
        bool consensusReached = false;
        
        if (supportPercentage >= CONSENSUS_THRESHOLD) {
            challengeSupported = true;
            consensusReached = true;
        } else if (opposePercentage >= CONSENSUS_THRESHOLD) {
            challengeSupported = false;
            consensusReached = true;
        }
        
        if (consensusReached) {
            if (challengeSupported) {
                challenge.status = ChallengeStatus.RESOLVED_SUPPORT;
                
                // Slash defender and supporters of defender
                uint256 defenderSlash = _slashTokens(
                    challenge.defender,
                    challenge.defenderStake,
                    "Consensus rejected defended claim"
                );
                challenge.slashedAmount += defenderSlash;
                
                // Slash oppose stakers
                _slashOpposingStakers(challengeId, false); // false = slash oppose side
                
                // Update reputations - challenger wins
                reputationScores[challenge.challenger] += 15;
                if (reputationScores[challenge.defender] > 10) {
                    reputationScores[challenge.defender] -= 10;
                }
                
                // Update expertise scores based on domain
                bytes32 domain = keccak256(abi.encodePacked(challenge.evidenceIPFS, "domain"));
                _updateExpertiseScore(challenge.challenger, domain, 10); // Successful challenger
                _updateExpertiseScore(challenge.defender, domain, -5);    // Failed defender
                
                // Update AI model success rates
                _updateModelSuccessRates(challengeId, true);
                
            } else {
                challenge.status = ChallengeStatus.RESOLVED_OPPOSE;
                
                // Slash challenger and supporters of challenger
                uint256 challengerSlash = _slashTokens(
                    challenge.challenger,
                    challenge.challengerStake,
                    "Consensus rejected challenge"
                );
                challenge.slashedAmount += challengerSlash;
                
                // Slash support stakers
                _slashOpposingStakers(challengeId, true); // true = slash support side
                
                // Update reputations - defender wins
                reputationScores[challenge.defender] += 10;
                if (reputationScores[challenge.challenger] > 15) {
                    reputationScores[challenge.challenger] -= 15;
                }
                
                // Update expertise scores based on domain
                bytes32 domain = keccak256(abi.encodePacked(challenge.evidenceIPFS, "domain"));
                _updateExpertiseScore(challenge.defender, domain, 8);    // Successful defender
                _updateExpertiseScore(challenge.challenger, domain, -10); // Failed challenger
                
                // Update AI model success rates
                _updateModelSuccessRates(challengeId, false);
            }
        } else {
            // Insufficient consensus - return stakes, no slashing
            challenge.status = ChallengeStatus.RESOLVED_INSUFFICIENT_CONSENSUS;
            // Small reputation penalty for inconclusive evidence
            if (reputationScores[challenge.challenger] > 5) {
                reputationScores[challenge.challenger] -= 5;
            }
        }
        
        // Update registry with credibility scores
        voterRegistry.updateEpistemicReputation(
            challenge.challenger,
            reputationScores[challenge.challenger]
        );
        voterRegistry.updateEpistemicReputation(
            challenge.defender,
            reputationScores[challenge.defender]
        );
        
        emit ChallengeResolved(challengeId, challenge.status, supportPercentage);
        
        _distributeRewards(challengeId);
    }
    
    /**
     * @dev Slash tokens from a user and add to treasury
     * @param user Address to slash tokens from
     * @param amount Amount to slash
     * @param reason Reason for slashing
     * @return actualSlashed Amount actually slashed
     */
    function _slashTokens(
        address user,
        uint256 amount,
        string memory reason
    ) internal returns (uint256) {
        uint256 available = slashableStakes[user];
        uint256 actualSlashed = amount > available ? available : amount;
        
        if (actualSlashed > 0) {
            slashableStakes[user] -= actualSlashed;
            treasuryPool += actualSlashed;
            emit TokensSlashed(0, user, actualSlashed, "Invalid reveal");
        }
        
        return actualSlashed;
    }
    
    /**
     * @dev Slash tokens from stakers on the losing side
     * @param challengeId Challenge ID
     * @param slashSupport True to slash support side, false for oppose side
     */
    function _slashOpposingStakers(uint256 challengeId, bool slashSupport) internal {
        // Note: This would need to be implemented with a way to iterate over stakers
        // For now, individual stakers will lose their stakes when they try to claim
        // In a production system, you'd need to track stakers in an array or use events
        Challenge storage challenge = challenges[challengeId];
        uint256 losingStake = slashSupport ? challenge.supportStake : challenge.opposeStake;
        challenge.slashedAmount += losingStake;
        treasuryPool += losingStake;
    }
    
    /**
     * @dev Update success rates for AI models based on consensus outcome
     * @param challengeId Challenge ID
     * @param challengeSupported Whether challenge was supported by consensus
     */
    function _updateModelSuccessRates(uint256 challengeId, bool challengeSupported) internal {
        for (uint256 i = 0; i < registeredModels.length; i++) {
            address modelAddr = registeredModels[i];
            ModelCommitment storage commitment = modelCommitments[challengeId][modelAddr];
            
            if (commitment.revealed) {
                bool modelWasCorrect = false;
                
                if (challengeSupported && commitment.decision == ModelDecision.SUPPORT_CHALLENGE) {
                    modelWasCorrect = true;
                } else if (!challengeSupported && commitment.decision == ModelDecision.OPPOSE_CHALLENGE) {
                    modelWasCorrect = true;
                }
                
                if (modelWasCorrect) {
                    aiModels[modelAddr].successfulVotes++;
                } else if (commitment.decision != ModelDecision.ABSTAIN) {
                    // Incorrect non-abstain votes incur slashing
                    uint256 slashAmount = aiModels[modelAddr].stake / 20; // 5% slash
                    _slashTokens(modelAddr, slashAmount, "Incorrect model prediction");
                }
            }
        }
    }
    
    /**
     * @dev Distribute rewards to winning side with slashed tokens
     * @param challengeId ID of the resolved challenge
     */
    function _distributeRewards(uint256 challengeId) internal {
        Challenge storage challenge = challenges[challengeId];
        
        if (challenge.status == ChallengeStatus.RESOLVED_INSUFFICIENT_CONSENSUS) {
            // Return all stakes when no consensus reached
            return; // Stakes returned during claimRewards
        }
        
        uint256 basePool = challenge.challengerStake + challenge.defenderStake + 
                          challenge.supportStake + challenge.opposeStake;
        uint256 totalRewardPool = basePool + challenge.slashedAmount;
        
        uint256 feeRate = _getMarketFeeRate();
        uint256 marketFee = (totalRewardPool * feeRate) / 10000;
        uint256 distributionPool = totalRewardPool - marketFee;
        
        feePool += marketFee;
        
        bool supportWon = challenge.status == ChallengeStatus.RESOLVED_SUPPORT;
        
        // Primary stakeholder gets larger share
        if (supportWon) {
            // Challenger gets their stake back plus bonus from slashed tokens
            uint256 challengerReward = challenge.challengerStake + (challenge.slashedAmount * 60) / 100;
            if (challengerReward <= distributionPool) {
                voterToken.transfer(challenge.challenger, challengerReward);
                distributionPool -= challengerReward;
            }
        } else {
            // Defender gets their stake back plus bonus from slashed tokens  
            uint256 defenderReward = challenge.defenderStake + (challenge.slashedAmount * 60) / 100;
            if (defenderReward <= distributionPool) {
                voterToken.transfer(challenge.defender, defenderReward);
                distributionPool -= defenderReward;
            }
        }
        
        // Remaining pool distributed to correct AI models
        _rewardCorrectModels(challengeId, distributionPool, supportWon);
        
        emit RewardsDistributed(challengeId, totalRewardPool);
    }
    
    /**
     * @dev Reward AI models that voted correctly
     * @param challengeId Challenge ID
     * @param rewardPool Available reward pool
     * @param challengeSupported Whether challenge was supported
     */
    function _rewardCorrectModels(
        uint256 challengeId,
        uint256 rewardPool,
        bool challengeSupported
    ) internal {
        uint256 correctModels = 0;
        
        // Count correct models
        for (uint256 i = 0; i < registeredModels.length; i++) {
            address modelAddr = registeredModels[i];
            ModelCommitment storage commitment = modelCommitments[challengeId][modelAddr];
            
            if (commitment.revealed) {
                if ((challengeSupported && commitment.decision == ModelDecision.SUPPORT_CHALLENGE) ||
                    (!challengeSupported && commitment.decision == ModelDecision.OPPOSE_CHALLENGE)) {
                    correctModels++;
                }
            }
        }
        
        if (correctModels > 0 && rewardPool > 0) {
            uint256 rewardPerModel = rewardPool / correctModels;
            
            // Distribute rewards to correct models
            for (uint256 i = 0; i < registeredModels.length; i++) {
                address modelAddr = registeredModels[i];
                ModelCommitment storage commitment = modelCommitments[challengeId][modelAddr];
                
                if (commitment.revealed) {
                    if ((challengeSupported && commitment.decision == ModelDecision.SUPPORT_CHALLENGE) ||
                        (!challengeSupported && commitment.decision == ModelDecision.OPPOSE_CHALLENGE)) {
                        voterToken.transfer(modelAddr, rewardPerModel);
                    }
                }
            }
        }
    }
    
    /**
     * @dev Claim rewards from a resolved challenge
     * @param challengeId ID of the challenge
     */
    function claimRewards(uint256 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            challenge.status == ChallengeStatus.RESOLVED_SUPPORT || 
            challenge.status == ChallengeStatus.RESOLVED_OPPOSE ||
            challenge.status == ChallengeStatus.RESOLVED_INSUFFICIENT_CONSENSUS,
            "Challenge not resolved"
        );
        
        ParticipantStake storage stake = stakes[challengeId][msg.sender];
        require(stake.amount > 0, "No stake to claim");
        require(!stake.claimed, "Already claimed");
        
        stake.claimed = true;
        slashableStakes[msg.sender] -= stake.amount;
        
        if (challenge.status == ChallengeStatus.RESOLVED_INSUFFICIENT_CONSENSUS) {
            // Return original stake when no consensus reached
            voterToken.transfer(msg.sender, stake.amount);
            return;
        }
        
        bool supportWon = challenge.status == ChallengeStatus.RESOLVED_SUPPORT;
        bool isWinner = stake.isSupport == supportWon;
        
        if (isWinner) {
            // Winner gets their stake back plus proportional share of slashed tokens
            uint256 winningStake = supportWon ? challenge.supportStake : challenge.opposeStake;
            uint256 bonusPool = challenge.slashedAmount * 40 / 100; // 40% of slashed tokens go to stakers
            uint256 proportionalBonus = (stake.amount * bonusPool) / winningStake;
            uint256 totalReward = stake.amount + proportionalBonus;
            
            voterToken.transfer(msg.sender, totalReward);
        } else {
            // Losing side gets nothing - tokens already slashed
            // stake.claimed already set to true above
        }
    }
    
    /**
     * @dev Calculate contextual stake for challenger
     * @param challenger Address creating the challenge
     * @param defender Address being challenged
     * @param claimDomain Domain of expertise for the claim
     * @param impactScope Local(0), State(1), or National(2)
     */
    function _calculateContextualStake(
        address challenger,
        address defender,
        bytes32 claimDomain,
        uint8 impactScope
    ) internal view returns (uint256) {
        uint256 baseStake = _getMinStake();
        
        // 1. Apply expertise multiplier (domain experts stake less)
        uint256 expertiseScore = expertiseScores[challenger][claimDomain];
        uint256 expertiseMultiplier = 100;
        if (expertiseScore > 80) {
            expertiseMultiplier = 50; // 50% stake for domain experts
        } else if (expertiseScore > 40) {
            expertiseMultiplier = 75; // 75% stake for knowledgeable users
        }
        
        // 2. Apply defender track record (proven creators require higher stakes to challenge)
        uint256 defenderRecord = creatorTrackRecords[defender];
        uint256 trackRecordMultiplier = 100;
        if (defenderRecord > 10) {
            trackRecordMultiplier = 200; // 2x stake to challenge proven creators
        } else if (defenderRecord > 5) {
            trackRecordMultiplier = 150; // 1.5x stake for established creators
        }
        
        // 3. Apply impact scope multiplier 
        uint256 scopeMultiplier = 100;
        if (impactScope == 2) { // National
            scopeMultiplier = 300; // 3x for national issues
        } else if (impactScope == 1) { // State
            scopeMultiplier = 150; // 1.5x for state-level issues
        }
        
        // 4. Apply earned vs purchased token ratio
        uint256 earnedRatio = _getEarnedTokenRatio(challenger);
        uint256 tokenSourceMultiplier = 100;
        if (earnedRatio < 30) { // Less than 30% earned
            tokenSourceMultiplier = 200; // Double stake for market buyers
        } else if (earnedRatio > 70) { // More than 70% earned
            tokenSourceMultiplier = 75; // Discount for civic participants
        }
        
        // 5. Apply reputation discount
        uint256 reputation = reputationScores[challenger];
        uint256 reputationDiscount = 100;
        if (reputation > 80) {
            reputationDiscount = 30; // 70% discount for high reputation
        } else if (reputation > 50) {
            reputationDiscount = 60; // 40% discount for good reputation
        }
        
        // Calculate final stake with all multipliers
        uint256 finalStake = baseStake
            * expertiseMultiplier
            * trackRecordMultiplier
            * scopeMultiplier
            * tokenSourceMultiplier
            * reputationDiscount
            / (100 ** 5); // Normalize for all percentage multipliers
        
        // Ensure minimum viable stake
        uint256 absoluteMin = _getMinStake() / 10;
        return finalStake > absoluteMin ? finalStake : absoluteMin;
    }
    
    /**
     * @dev Calculate symmetric stake for defender
     * @param defender Address being challenged
     * @param challenger Address creating the challenge
     * @param claimDomain Domain of expertise for the claim
     * @param impactScope Local(0), State(1), or National(2)
     */
    function _calculateDefenderStake(
        address defender,
        address challenger,
        bytes32 claimDomain,
        uint8 impactScope
    ) internal view returns (uint256) {
        uint256 baseStake = _getMinStake();
        
        // Defender stake is typically lower but still meaningful
        uint256 defenderMultiplier = 75; // 75% of base stake
        
        // Apply same factors as challenger but with different weights
        uint256 expertiseScore = expertiseScores[defender][claimDomain];
        if (expertiseScore > 80) {
            defenderMultiplier = 40; // Expert defenders stake less
        } else if (expertiseScore > 40) {
            defenderMultiplier = 60; 
        }
        
        // Reputation discount for defenders
        uint256 reputation = reputationScores[defender];
        uint256 reputationMultiplier = 100;
        if (reputation > 80) {
            reputationMultiplier = 50; // High rep defenders stake less
        } else if (reputation > 50) {
            reputationMultiplier = 75;
        }
        
        // Impact scope affects defender stake too
        uint256 scopeMultiplier = 100;
        if (impactScope == 2) {
            scopeMultiplier = 200; // 2x for national (less than challenger's 3x)
        } else if (impactScope == 1) {
            scopeMultiplier = 130; // 1.3x for state
        }
        
        uint256 finalStake = baseStake
            * defenderMultiplier
            * reputationMultiplier
            * scopeMultiplier
            / (100 ** 3);
            
        uint256 absoluteMin = _getMinStake() / 20; // Even lower minimum for defenders
        return finalStake > absoluteMin ? finalStake : absoluteMin;
    }
    
    /**
     * @dev Calculate ratio of earned vs purchased tokens
     */
    function _getEarnedTokenRatio(address user) internal view returns (uint256) {
        uint256 earned = earnedTokens[user];
        uint256 purchased = purchasedTokens[user];
        uint256 total = earned + purchased;
        
        if (total == 0) return 0;
        return (earned * 100) / total;
    }
    
    /**
     * @dev Update expertise score for a user (based on successful challenges/defenses)
     * @param user Address of the user
     * @param domain Domain of expertise
     * @param scoreChange Change in expertise score (+/-)
     */
    function _updateExpertiseScore(
        address user,
        bytes32 domain,
        int256 scoreChange
    ) internal {
        uint256 currentScore = expertiseScores[user][domain];
        
        if (scoreChange >= 0) {
            uint256 newScore = currentScore + uint256(scoreChange);
            expertiseScores[user][domain] = newScore > 100 ? 100 : newScore;
        } else {
            uint256 decrease = uint256(-scoreChange);
            expertiseScores[user][domain] = currentScore > decrease ? currentScore - decrease : 0;
        }
    }
    
    /**
     * @dev Track token earnings (called by VOTER token contract)
     * @param user Address of the user
     * @param amount Amount of tokens earned
     */
    function trackEarnedTokens(address user, uint256 amount) external {
        require(msg.sender == address(voterToken), "Only VOTER token can call");
        earnedTokens[user] += amount;
    }
    
    /**
     * @dev Track token purchases (called by VOTER token contract or DEX)
     * @param user Address of the user  
     * @param amount Amount of tokens purchased
     */
    function trackPurchasedTokens(address user, uint256 amount) external {
        require(msg.sender == address(voterToken), "Only VOTER token can call");
        purchasedTokens[user] += amount;
    }
    
    /**
     * @dev Deactivate poorly performing AI model (community-driven)
     * @param modelAddr Address of the AI model to deactivate
     */
    function deactivateAIModel(address modelAddr) external nonReentrant {
        AIModel storage model = aiModels[modelAddr];
        require(model.active, "Model already inactive");
        require(model.totalVotes >= 10, "Insufficient voting history");
        
        // Require <30% success rate to deactivate
        uint256 successRate = (model.successfulVotes * 100) / model.totalVotes;
        require(successRate < 30, "Model performance above deactivation threshold");
        
        model.active = false;
        
        // Slash remaining stake for poor performance
        uint256 remainingStake = slashableStakes[modelAddr];
        if (remainingStake > 0) {
            _slashTokens(modelAddr, remainingStake, "Deactivated for poor performance");
        }
    }
    
    /**
     * @dev Get user's reputation score
     * @param user Address of the user
     * @return Reputation score
     */
    function getReputation(address user) external view returns (uint256) {
        return reputationScores[user];
    }
    
    /**
     * @dev Get AI model information
     * @param modelAddr Address of the AI model
     * @return Model details
     */
    function getAIModel(address modelAddr) external view returns (AIModel memory) {
        return aiModels[modelAddr];
    }
    
    /**
     * @dev Get challenge details with consensus info
     * @param challengeId Challenge ID
     * @return Challenge details
     */
    function getChallengeDetails(uint256 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }
    
    /**
     * @dev Get user's slashable stake balance
     * @param user Address of the user
     * @return Slashable stake amount
     */
    function getSlashableStake(address user) external view returns (uint256) {
        return slashableStakes[user];
    }
    
    /**
     * @dev Get number of registered AI models
     * @return Count of registered models
     */
    function getModelCount() external view returns (uint256) {
        return registeredModels.length;
    }
    
    /**
     * @dev Check if minimum models are registered for consensus
     * @return Whether enough models are registered
     */
    function hasMinimumModels() external view returns (bool) {
        return registeredModels.length >= 3;
    }
    
    /**
     * @dev Advance challenge to next phase if time has passed
     * @param challengeId Challenge ID to advance
     */
    function advanceChallenge(uint256 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        
        if (challenge.status == ChallengeStatus.ACTIVE && 
            block.timestamp >= challenge.commitPhaseEnd) {
            challenge.status = ChallengeStatus.COMMIT_PHASE;
        }
        
        if (challenge.status == ChallengeStatus.COMMIT_PHASE && 
            block.timestamp >= challenge.revealPhaseEnd) {
            challenge.status = ChallengeStatus.REVEAL_PHASE;
        }
    }
    
    /**
     * @dev Emergency recovery for stuck funds (only if challenge is very old)
     * @param challengeId Challenge ID
     */
    function emergencyRecovery(uint256 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            block.timestamp > challenge.revealPhaseEnd + 30 days,
            "Emergency recovery too early"
        );
        require(
            challenge.status == ChallengeStatus.ACTIVE || 
            challenge.status == ChallengeStatus.COMMIT_PHASE ||
            challenge.status == ChallengeStatus.REVEAL_PHASE,
            "Challenge already resolved"
        );
        
        // Cancel stuck challenge and return stakes
        challenge.status = ChallengeStatus.CANCELLED;
        
        // Return challenger and defender stakes
        voterToken.transfer(challenge.challenger, challenge.challengerStake);
        voterToken.transfer(challenge.defender, challenge.defenderStake);
        
        // Mark stakes as no longer slashable
        slashableStakes[challenge.challenger] -= challenge.challengerStake;
        slashableStakes[challenge.defender] -= challenge.defenderStake;
    }
    
    /**
     * @dev Get minimum stake from agent parameters
     */
    function _getMinStake() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(MIN_STAKE_KEY);
        return configured > 0 ? configured : 10e18; // Fallback to 10 VOTER if not set
    }
    
    /**
     * @dev Get challenge duration from agent parameters
     */
    function _getChallengeDuration() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(DURATION_KEY);
        return configured > 0 ? configured : 3 days; // Fallback to 3 days if not set
    }
    
    /**
     * @dev Get quality threshold from agent parameters
     */
    function _getQualityThreshold() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(QUALITY_THRESHOLD_KEY);
        return configured > 0 ? configured : 60; // Fallback to 60 if not set
    }
    
    /**
     * @dev Get market fee rate from agent parameters
     */
    function _getMarketFeeRate() internal view returns (uint256) {
        uint256 configured = agentParams.getUint(MARKET_FEE_KEY);
        return configured > 0 ? configured : 250; // Fallback to 2.5% if not set
    }
}