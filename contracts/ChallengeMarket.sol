// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERToken.sol";
import "./interfaces/IVOTERRegistry.sol";

/**
 * @title ChallengeMarket
 * @dev Carroll Mechanisms for information quality through market consensus
 * @notice Evaluates discourse quality, not truth—community consensus on good faith engagement
 */
contract ChallengeMarket is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    
    IVOTERToken public immutable voterToken;
    IVOTERRegistry public immutable voterRegistry;
    
    enum ChallengeStatus {
        ACTIVE,
        RESOLVED_SUPPORT,
        RESOLVED_OPPOSE,
        CANCELLED
    }
    
    struct Challenge {
        address challenger;
        address defender;
        bytes32 claimHash;
        uint256 stake;
        uint256 supportStake;
        uint256 opposeStake;
        uint256 createdAt;
        uint256 resolveBy;
        ChallengeStatus status;
        string evidenceIPFS;
        uint256 qualityScore; // 0-100 based on sourcing standards
    }
    
    struct ParticipantStake {
        uint256 amount;
        bool isSupport;
        bool claimed;
    }
    
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => mapping(address => ParticipantStake)) public stakes;
    mapping(address => uint256) public reputationScores;
    mapping(bytes32 => uint256) public claimToChallengeId;
    
    uint256 public nextChallengeId;
    uint256 public constant MIN_STAKE = 10e18; // 10 VOTER minimum
    uint256 public constant CHALLENGE_DURATION = 3 days;
    uint256 public constant QUALITY_THRESHOLD = 60; // Min quality score for rewards
    uint256 public marketFeeRate = 250; // 2.5% in basis points
    uint256 public feePool;
    
    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed challenger,
        bytes32 claimHash,
        uint256 stake
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
    
    constructor(address _voterToken, address _voterRegistry) {
        voterToken = IVOTERToken(_voterToken);
        voterRegistry = IVOTERRegistry(_voterRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RESOLVER_ROLE, msg.sender);
    }
    
    /**
     * @dev Create a challenge against a claim
     * @param claimHash Hash of the claim being challenged
     * @param defender Address that made the original claim
     * @param evidenceIPFS IPFS hash containing challenge evidence
     */
    function createChallenge(
        bytes32 claimHash,
        address defender,
        string memory evidenceIPFS
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(claimHash != bytes32(0), "Invalid claim hash");
        require(defender != address(0), "Invalid defender");
        require(claimToChallengeId[claimHash] == 0, "Claim already challenged");
        
        // Higher reputation users need less stake
        uint256 requiredStake = _calculateRequiredStake(msg.sender);
        require(
            voterToken.transferFrom(msg.sender, address(this), requiredStake),
            "Stake transfer failed"
        );
        
        uint256 challengeId = nextChallengeId++;
        
        challenges[challengeId] = Challenge({
            challenger: msg.sender,
            defender: defender,
            claimHash: claimHash,
            stake: requiredStake,
            supportStake: 0,
            opposeStake: 0,
            createdAt: block.timestamp,
            resolveBy: block.timestamp + CHALLENGE_DURATION,
            status: ChallengeStatus.ACTIVE,
            evidenceIPFS: evidenceIPFS,
            qualityScore: 0
        });
        
        claimToChallengeId[claimHash] = challengeId;
        
        emit ChallengeCreated(challengeId, msg.sender, claimHash, requiredStake);
        return challengeId;
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
    ) external nonReentrant whenNotPaused {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.status == ChallengeStatus.ACTIVE, "Challenge not active");
        require(block.timestamp < challenge.resolveBy, "Challenge expired");
        require(amount >= MIN_STAKE / 10, "Stake too small");
        
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
        
        emit StakeAdded(challengeId, msg.sender, amount, isSupport);
    }
    
    /**
     * @dev Resolve a challenge based on quality metrics
     * @param challengeId ID of the challenge to resolve
     * @param qualityScore Quality score based on sourcing standards (0-100)
     */
    function resolveChallenge(
        uint256 challengeId,
        uint256 qualityScore
    ) external onlyRole(RESOLVER_ROLE) {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.status == ChallengeStatus.ACTIVE, "Challenge not active");
        require(qualityScore <= 100, "Invalid quality score");
        
        challenge.qualityScore = qualityScore;
        
        // Resolution based on stake weight AND quality threshold
        bool hasQuality = qualityScore >= QUALITY_THRESHOLD;
        bool supportWins = challenge.supportStake > challenge.opposeStake;
        
        if (hasQuality && supportWins) {
            challenge.status = ChallengeStatus.RESOLVED_SUPPORT;
            // Update reputation scores
            reputationScores[challenge.challenger] += 10;
            if (reputationScores[challenge.defender] > 5) {
                reputationScores[challenge.defender] -= 5;
            }
        } else {
            challenge.status = ChallengeStatus.RESOLVED_OPPOSE;
            // Update reputation scores
            reputationScores[challenge.defender] += 5;
            if (reputationScores[challenge.challenger] > 10) {
                reputationScores[challenge.challenger] -= 10;
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
        
        emit ChallengeResolved(challengeId, challenge.status, qualityScore);
        
        _distributeRewards(challengeId);
    }
    
    /**
     * @dev Distribute rewards to winning side
     * @param challengeId ID of the resolved challenge
     */
    function _distributeRewards(uint256 challengeId) internal {
        Challenge storage challenge = challenges[challengeId];
        
        uint256 totalPool = challenge.stake + challenge.supportStake + challenge.opposeStake;
        uint256 marketFee = (totalPool * marketFeeRate) / 10000;
        uint256 rewardPool = totalPool - marketFee;
        
        feePool += marketFee;
        
        bool supportWon = challenge.status == ChallengeStatus.RESOLVED_SUPPORT;
        uint256 winningStake = supportWon ? challenge.supportStake : challenge.opposeStake;
        
        // Quality bonus for high-quality discourse
        uint256 qualityBonus = (rewardPool * challenge.qualityScore) / 1000;
        rewardPool += qualityBonus;
        
        // Return stake to original challenger/defender based on outcome
        if (supportWon) {
            voterToken.transfer(challenge.challenger, challenge.stake + (challenge.stake * challenge.qualityScore / 100));
        } else {
            // Defender doesn't stake but gets reward if they win
            voterToken.transfer(challenge.defender, challenge.stake / 2);
        }
        
        emit RewardsDistributed(challengeId, rewardPool);
    }
    
    /**
     * @dev Claim rewards from a resolved challenge
     * @param challengeId ID of the challenge
     */
    function claimRewards(uint256 challengeId) external nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(
            challenge.status == ChallengeStatus.RESOLVED_SUPPORT || 
            challenge.status == ChallengeStatus.RESOLVED_OPPOSE,
            "Challenge not resolved"
        );
        
        ParticipantStake storage stake = stakes[challengeId][msg.sender];
        require(stake.amount > 0, "No stake to claim");
        require(!stake.claimed, "Already claimed");
        
        bool supportWon = challenge.status == ChallengeStatus.RESOLVED_SUPPORT;
        bool isWinner = stake.isSupport == supportWon;
        
        if (isWinner) {
            uint256 winningStake = supportWon ? challenge.supportStake : challenge.opposeStake;
            uint256 totalPool = challenge.stake + challenge.supportStake + challenge.opposeStake;
            uint256 marketFee = (totalPool * marketFeeRate) / 10000;
            uint256 rewardPool = totalPool - marketFee;
            
            // Calculate proportional reward
            uint256 reward = (stake.amount * rewardPool) / winningStake;
            
            stake.claimed = true;
            voterToken.transfer(msg.sender, reward);
        } else {
            // Losing side forfeits stake
            stake.claimed = true;
        }
    }
    
    /**
     * @dev Calculate required stake based on reputation
     * @param user Address of the user
     * @return Required stake amount
     */
    function _calculateRequiredStake(address user) internal view returns (uint256) {
        uint256 reputation = reputationScores[user];
        
        // Higher reputation = lower stake requirement
        if (reputation >= 100) {
            return MIN_STAKE / 2;
        } else if (reputation >= 50) {
            return (MIN_STAKE * 75) / 100;
        } else {
            return MIN_STAKE;
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
     * @dev Emergency pause
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}