// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IdentityRegistry.sol";

/**
 * @title ReputationRegistry
 * @dev ERC-8004 Reputation Registry for portable democratic credibility
 * @notice Tracks reputation scores across challenge markets and civic engagement
 */
contract ReputationRegistry is AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    
    IdentityRegistry public immutable identityRegistry;
    
    struct ReputationScore {
        uint256 challengeMarketScore; // From Carroll Mechanisms
        uint256 civicEngagementScore; // From verified actions
        uint256 discourseQualityScore; // From information quality
        uint256 totalScore; // Weighted aggregate
        uint256 lastUpdate;
        uint256 updateCount;
    }
    
    struct ReputationHistory {
        uint256 timestamp;
        uint256 oldScore;
        uint256 newScore;
        string reason;
        address updater;
    }
    
    mapping(address => ReputationScore) public reputations;
    mapping(address => ReputationHistory[]) public reputationHistory;
    mapping(address => mapping(address => bool)) public trustedUpdaters; // User => updater => trusted
    
    // Reputation thresholds for different privileges
    uint256 public constant HIGH_REPUTATION_THRESHOLD = 80;
    uint256 public constant MEDIUM_REPUTATION_THRESHOLD = 50;
    uint256 public constant LOW_REPUTATION_THRESHOLD = 20;
    
    event ReputationUpdated(
        address indexed subject,
        uint256 oldScore,
        uint256 newScore,
        string category
    );
    
    event ReputationPortabilityEnabled(
        address indexed subject,
        address indexed platform
    );
    
    constructor(address _identityRegistry, address[] memory initialUpdaters) {
        identityRegistry = IdentityRegistry(_identityRegistry);
        
        // Grant UPDATER_ROLE to initial updaters (no admin role)
        for (uint256 i = 0; i < initialUpdaters.length; i++) {
            _grantRole(UPDATER_ROLE, initialUpdaters[i]);
            _grantRole(AGENT_ROLE, initialUpdaters[i]);
        }
    }
    
    /**
     * @dev Update challenge market reputation score
     * @param subject Address of the user
     * @param score New challenge market score
     * @param reason Reason for update
     */
    function updateChallengeScore(
        address subject,
        uint256 score,
        string memory reason
    ) external onlyRole(UPDATER_ROLE) {
        require(identityRegistry.isVerified(subject), "Subject not verified");
        require(score <= 100, "Score exceeds maximum");
        
        ReputationScore storage rep = reputations[subject];
        uint256 oldTotal = rep.totalScore;
        
        rep.challengeMarketScore = score;
        rep.totalScore = _calculateTotalScore(rep);
        rep.lastUpdate = block.timestamp;
        rep.updateCount++;
        
        _recordHistory(subject, oldTotal, rep.totalScore, reason);
        
        emit ReputationUpdated(subject, oldTotal, rep.totalScore, "challenge_market");
    }
    
    /**
     * @dev Update civic engagement reputation score
     * @param subject Address of the user
     * @param score New civic engagement score
     * @param reason Reason for update
     */
    function updateCivicScore(
        address subject,
        uint256 score,
        string memory reason
    ) external onlyRole(UPDATER_ROLE) {
        require(identityRegistry.isVerified(subject), "Subject not verified");
        require(score <= 100, "Score exceeds maximum");
        
        ReputationScore storage rep = reputations[subject];
        uint256 oldTotal = rep.totalScore;
        
        rep.civicEngagementScore = score;
        rep.totalScore = _calculateTotalScore(rep);
        rep.lastUpdate = block.timestamp;
        rep.updateCount++;
        
        _recordHistory(subject, oldTotal, rep.totalScore, reason);
        
        emit ReputationUpdated(subject, oldTotal, rep.totalScore, "civic_engagement");
    }
    
    /**
     * @dev Update discourse quality reputation score
     * @param subject Address of the user
     * @param score New discourse quality score
     * @param reason Reason for update
     */
    function updateDiscourseScore(
        address subject,
        uint256 score,
        string memory reason
    ) external onlyRole(UPDATER_ROLE) {
        require(identityRegistry.isVerified(subject), "Subject not verified");
        require(score <= 100, "Score exceeds maximum");
        
        ReputationScore storage rep = reputations[subject];
        uint256 oldTotal = rep.totalScore;
        
        rep.discourseQualityScore = score;
        rep.totalScore = _calculateTotalScore(rep);
        rep.lastUpdate = block.timestamp;
        rep.updateCount++;
        
        _recordHistory(subject, oldTotal, rep.totalScore, reason);
        
        emit ReputationUpdated(subject, oldTotal, rep.totalScore, "discourse_quality");
    }
    
    /**
     * @dev Calculate weighted total reputation score
     * @param rep ReputationScore struct
     * @return Weighted total score
     */
    function _calculateTotalScore(ReputationScore memory rep) internal pure returns (uint256) {
        // Weighted average: 40% challenge, 35% civic, 25% discourse
        uint256 weightedScore = 
            (rep.challengeMarketScore * 40) +
            (rep.civicEngagementScore * 35) +
            (rep.discourseQualityScore * 25);
        
        return weightedScore / 100;
    }
    
    /**
     * @dev Record reputation update history
     */
    function _recordHistory(
        address subject,
        uint256 oldScore,
        uint256 newScore,
        string memory reason
    ) internal {
        reputationHistory[subject].push(ReputationHistory({
            timestamp: block.timestamp,
            oldScore: oldScore,
            newScore: newScore,
            reason: reason,
            updater: msg.sender
        }));
    }
    
    /**
     * @dev Get full reputation details
     * @param subject Address to query
     * @return ReputationScore struct
     */
    function getReputation(address subject) external view returns (ReputationScore memory) {
        return reputations[subject];
    }
    
    /**
     * @dev Get reputation tier (high/medium/low/none)
     * @param subject Address to query
     * @return Reputation tier as string
     */
    function getReputationTier(address subject) external view returns (string memory) {
        uint256 score = reputations[subject].totalScore;
        
        if (score >= HIGH_REPUTATION_THRESHOLD) {
            return "high";
        } else if (score >= MEDIUM_REPUTATION_THRESHOLD) {
            return "medium";
        } else if (score >= LOW_REPUTATION_THRESHOLD) {
            return "low";
        } else {
            return "none";
        }
    }
    
    /**
     * @dev Check if user has minimum reputation for an action
     * @param subject Address to check
     * @param minScore Minimum score required
     * @return bool Whether user meets requirement
     */
    function hasMinimumReputation(
        address subject,
        uint256 minScore
    ) external view returns (bool) {
        return reputations[subject].totalScore >= minScore;
    }
    
    /**
     * @dev Get reputation history for a user
     * @param subject Address to query
     * @return Array of reputation history entries
     */
    function getReputationHistory(
        address subject
    ) external view returns (ReputationHistory[] memory) {
        return reputationHistory[subject];
    }
    
    /**
     * @dev Enable reputation portability to another platform
     * @param platform Address of the platform contract
     */
    function enablePortability(address platform) external {
        require(identityRegistry.isVerified(msg.sender), "Sender not verified");
        trustedUpdaters[msg.sender][platform] = true;
        emit ReputationPortabilityEnabled(msg.sender, platform);
    }
    
    /**
     * @dev Batch update reputation for agent-driven updates
     * @param subjects Array of addresses
     * @param scores Array of scores
     * @param category Score category
     */
    function batchUpdateScores(
        address[] calldata subjects,
        uint256[] calldata scores,
        string memory category
    ) external onlyRole(AGENT_ROLE) {
        require(subjects.length == scores.length, "Array length mismatch");
        
        for (uint256 i = 0; i < subjects.length; i++) {
            if (keccak256(bytes(category)) == keccak256(bytes("challenge_market"))) {
                this.updateChallengeScore(subjects[i], scores[i], "Batch agent update");
            } else if (keccak256(bytes(category)) == keccak256(bytes("civic_engagement"))) {
                this.updateCivicScore(subjects[i], scores[i], "Batch agent update");
            } else if (keccak256(bytes(category)) == keccak256(bytes("discourse_quality"))) {
                this.updateDiscourseScore(subjects[i], scores[i], "Batch agent update");
            }
        }
    }
}