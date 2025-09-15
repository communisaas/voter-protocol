// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ReputationRegistry
 * @dev ERC-8004 compliant reputation registry for portable democratic credibility
 * @notice Implements reputation that follows participants across platforms
 * 
 * ERC-8004 was built for AI agents. We extend it to human civic participants,
 * creating infrastructure both humans and AI can use for authentic democratic coordination.
 */
contract ReputationRegistry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant REPUTATION_UPDATER_ROLE = keccak256("REPUTATION_UPDATER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    struct Reputation {
        uint256 overallScore;           // 0-1000 overall credibility score
        uint256 challengeWins;          // Successful challenge market wins
        uint256 challengeLosses;        // Failed challenges
        uint256 templateImpactScore;    // Cumulative template impact
        uint256 discourseQuality;       // Quality of contributions (0-100)
        uint256 verifiedActions;        // Number of verified civic actions
        uint256 lastUpdated;            // Last update timestamp
        bytes32 credibilityHash;        // Hash for cross-platform verification
    }
    
    struct DomainExpertise {
        bytes32 domain;                 // Domain identifier (healthcare, economy, etc.)
        uint256 expertiseScore;         // Domain-specific expertise (0-100)
        uint256 successfulChallenges;   // Domain-specific challenge wins
        uint256 citationCount;          // Times cited in this domain
    }
    
    // ERC-8004 compliant mappings
    mapping(address => Reputation) public reputations;
    mapping(address => DomainExpertise[]) public domainExpertise;
    mapping(address => mapping(bytes32 => uint256)) public domainScores; // Quick lookup
    
    // Cross-platform credibility
    mapping(bytes32 => address) public credibilityToAddress;
    mapping(address => bytes32[]) public historicalCredibility;
    
    // Reputation decay and growth parameters
    uint256 public constant DECAY_PERIOD = 90 days;
    uint256 public constant MAX_REPUTATION = 1000;
    uint256 public constant REPUTATION_PRECISION = 100;
    
    // Events for ERC-8004 compliance
    event ReputationUpdated(
        address indexed user,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );
    
    event DomainExpertiseUpdated(
        address indexed user,
        bytes32 indexed domain,
        uint256 newScore
    );
    
    event CredibilityHashUpdated(
        address indexed user,
        bytes32 oldHash,
        bytes32 newHash
    );
    
    event CrossPlatformVerification(
        address indexed user,
        bytes32 credibilityHash,
        address verifiedBy
    );
    
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(REPUTATION_UPDATER_ROLE, admin);
    }
    
    /**
     * @dev Get reputation score for a user (ERC-8004 compliant)
     * @param user Address to query
     * @return Overall reputation score (0-1000)
     */
    function getReputation(address user) external view returns (uint256) {
        return _getAdjustedReputation(user);
    }
    
    /**
     * @dev Get portable credibility hash for cross-platform verification
     * @param user Address to query
     * @return Credibility hash that can be verified on other platforms
     */
    function getPortableCredibility(address user) external view returns (bytes32) {
        return reputations[user].credibilityHash;
    }
    
    /**
     * @dev Update reputation based on civic action
     * @param user Address of the user
     * @param actionType Type of action (challenge, template, discourse)
     * @param impact Impact score of the action (0-100)
     * @param domain Domain of expertise (if applicable)
     */
    function updateReputation(
        address user,
        string memory actionType,
        uint256 impact,
        bytes32 domain
    ) external onlyRole(REPUTATION_UPDATER_ROLE) {
        require(impact <= 100, "Invalid impact score");
        
        Reputation storage rep = reputations[user];
        uint256 oldScore = rep.overallScore;
        
        // Update based on action type
        if (keccak256(bytes(actionType)) == keccak256("challenge_win")) {
            rep.challengeWins++;
            rep.overallScore += impact * 2; // Double weight for wins
        } else if (keccak256(bytes(actionType)) == keccak256("challenge_loss")) {
            rep.challengeLosses++;
            if (rep.overallScore > impact) {
                rep.overallScore -= impact;
            } else {
                rep.overallScore = 0;
            }
        } else if (keccak256(bytes(actionType)) == keccak256("template_impact")) {
            rep.templateImpactScore += impact;
            rep.overallScore += impact;
        } else if (keccak256(bytes(actionType)) == keccak256("discourse_quality")) {
            rep.discourseQuality = (rep.discourseQuality + impact) / 2;
            rep.overallScore += impact / 2;
        } else if (keccak256(bytes(actionType)) == keccak256("verified_action")) {
            rep.verifiedActions++;
            rep.overallScore += 10; // Fixed bonus for verified actions
        }
        
        // Cap at maximum
        if (rep.overallScore > MAX_REPUTATION) {
            rep.overallScore = MAX_REPUTATION;
        }
        
        // Update domain expertise if applicable
        if (domain != bytes32(0)) {
            _updateDomainExpertise(user, domain, impact);
        }
        
        rep.lastUpdated = block.timestamp;
        
        // Update credibility hash
        bytes32 newHash = _calculateCredibilityHash(user);
        bytes32 oldHash = rep.credibilityHash;
        rep.credibilityHash = newHash;
        
        emit ReputationUpdated(user, oldScore, rep.overallScore, actionType);
        if (oldHash != newHash) {
            emit CredibilityHashUpdated(user, oldHash, newHash);
        }
    }
    
    /**
     * @dev Update domain-specific expertise
     */
    function _updateDomainExpertise(
        address user,
        bytes32 domain,
        uint256 impact
    ) internal {
        uint256 currentScore = domainScores[user][domain];
        
        if (currentScore == 0) {
            // New domain for this user
            domainExpertise[user].push(DomainExpertise({
                domain: domain,
                expertiseScore: impact,
                successfulChallenges: 0,
                citationCount: 0
            }));
            domainScores[user][domain] = impact;
        } else {
            // Update existing domain
            domainScores[user][domain] = (currentScore + impact) / 2;
            
            // Update in array
            DomainExpertise[] storage expertise = domainExpertise[user];
            for (uint256 i = 0; i < expertise.length; i++) {
                if (expertise[i].domain == domain) {
                    expertise[i].expertiseScore = domainScores[user][domain];
                    break;
                }
            }
        }
        
        emit DomainExpertiseUpdated(user, domain, domainScores[user][domain]);
    }
    
    /**
     * @dev Calculate adjusted reputation with time decay
     */
    function _getAdjustedReputation(address user) internal view returns (uint256) {
        Reputation memory rep = reputations[user];
        
        if (rep.lastUpdated == 0) {
            return 0;
        }
        
        uint256 timeSinceUpdate = block.timestamp - rep.lastUpdated;
        
        // Apply decay if inactive for too long
        if (timeSinceUpdate > DECAY_PERIOD) {
            uint256 decayPeriods = timeSinceUpdate / DECAY_PERIOD;
            uint256 decayAmount = (rep.overallScore * decayPeriods * 10) / 100; // 10% per period
            
            if (decayAmount >= rep.overallScore) {
                return 0;
            }
            
            return rep.overallScore - decayAmount;
        }
        
        return rep.overallScore;
    }
    
    /**
     * @dev Calculate credibility hash for cross-platform verification
     */
    function _calculateCredibilityHash(address user) internal view returns (bytes32) {
        Reputation memory rep = reputations[user];
        
        return keccak256(abi.encodePacked(
            user,
            rep.overallScore,
            rep.challengeWins,
            rep.challengeLosses,
            rep.templateImpactScore,
            rep.discourseQuality,
            rep.verifiedActions,
            block.timestamp
        ));
    }
    
    /**
     * @dev Verify credibility from another platform
     * @param user Address claiming the credibility
     * @param credibilityHash Hash to verify
     * @param signature Signature proving ownership
     */
    function verifyCrossPlatformCredibility(
        address user,
        bytes32 credibilityHash,
        bytes memory signature
    ) external returns (bool) {
        // Verify signature (simplified - would use ECDSA in production)
        require(signature.length > 0, "Invalid signature");
        
        // Check if credibility hash exists
        address originalOwner = credibilityToAddress[credibilityHash];
        
        if (originalOwner == address(0)) {
            // New credibility claim
            credibilityToAddress[credibilityHash] = user;
            historicalCredibility[user].push(credibilityHash);
            
            emit CrossPlatformVerification(user, credibilityHash, msg.sender);
            return true;
        } else {
            // Verify ownership
            require(originalOwner == user, "Credibility belongs to another user");
            
            emit CrossPlatformVerification(user, credibilityHash, msg.sender);
            return true;
        }
    }
    
    /**
     * @dev Get comprehensive reputation data
     */
    function getFullReputation(address user) 
        external 
        view 
        returns (
            uint256 overallScore,
            uint256 challengeWins,
            uint256 challengeLosses,
            uint256 templateImpactScore,
            uint256 discourseQuality,
            uint256 verifiedActions,
            bytes32 credibilityHash
        ) 
    {
        Reputation memory rep = reputations[user];
        overallScore = _getAdjustedReputation(user);
        challengeWins = rep.challengeWins;
        challengeLosses = rep.challengeLosses;
        templateImpactScore = rep.templateImpactScore;
        discourseQuality = rep.discourseQuality;
        verifiedActions = rep.verifiedActions;
        credibilityHash = rep.credibilityHash;
    }
    
    /**
     * @dev Get domain expertise for a user
     */
    function getDomainExpertise(address user, bytes32 domain) 
        external 
        view 
        returns (uint256) 
    {
        return domainScores[user][domain];
    }
    
    /**
     * @dev Get all domains where user has expertise
     */
    function getUserDomains(address user) 
        external 
        view 
        returns (DomainExpertise[] memory) 
    {
        return domainExpertise[user];
    }
    
    /**
     * @dev Calculate reputation multiplier for rewards (used by other contracts)
     * @param user Address to calculate for
     * @return Multiplier in basis points (100 = 1x, 200 = 2x)
     */
    function getReputationMultiplier(address user) external view returns (uint256) {
        uint256 reputation = _getAdjustedReputation(user);
        
        if (reputation >= 800) {
            return 300; // 3x multiplier for top reputation
        } else if (reputation >= 500) {
            return 200; // 2x multiplier for good reputation
        } else if (reputation >= 200) {
            return 150; // 1.5x multiplier for decent reputation
        } else if (reputation >= 50) {
            return 110; // 1.1x multiplier for basic reputation
        } else {
            return 100; // No multiplier for low/no reputation
        }
    }
    
    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}