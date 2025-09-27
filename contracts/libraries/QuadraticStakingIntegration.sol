// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./QuadraticStaking.sol";
import "../interfaces/IVOTERTokenExtended.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title QuadraticStakingIntegration
 * @dev Integration contract demonstrating how to use QuadraticStaking library
 * @notice Provides complete user profile management and stake calculation services
 * 
 * This contract shows how ChallengeMarket and other contracts can integrate
 * the QuadraticStaking library for sophisticated stake calculations.
 */
contract QuadraticStakingIntegration is ReentrancyGuard, AccessControl {
    using QuadraticStaking for QuadraticStaking.UserProfile;
    
    // ============ ROLES ============
    
    bytes32 public constant CHALLENGE_MARKET_ROLE = keccak256("CHALLENGE_MARKET_ROLE");
    bytes32 public constant REPUTATION_MANAGER_ROLE = keccak256("REPUTATION_MANAGER_ROLE");
    
    // ============ STORAGE ============
    
    IVOTERTokenExtended public immutable voterToken;
    
    // User profiles for quadratic staking
    mapping(address => QuadraticStaking.UserProfile) public userProfiles;
    
    // Domain registrations (hash of domain name -> domain info)
    mapping(bytes32 => DomainInfo) public registeredDomains;
    bytes32[] public domainList;
    
    // Challenge tracking
    mapping(address => uint256) public userChallengeCount;
    mapping(address => uint256) public userSuccessfulChallenges;
    mapping(address => uint256) public userFailedChallenges;
    
    struct DomainInfo {
        string name;
        string description;
        bool active;
        uint256 totalExperts;
        uint256 minExpertiseThreshold;
    }
    
    // ============ EVENTS ============
    
    event UserProfileUpdated(
        address indexed user,
        uint256 newBalance,
        uint256 earnedTokens,
        uint256 purchasedTokens,
        uint256 reputationScore
    );
    
    event DomainRegistered(
        bytes32 indexed domainHash,
        string domainName,
        uint256 minExpertiseThreshold
    );
    
    event ExpertiseUpdated(
        address indexed user,
        bytes32 indexed domain,
        uint256 oldScore,
        uint256 newScore
    );
    
    event ChallengeResultRecorded(
        address indexed user,
        bool successful,
        bytes32 indexed domain
    );
    
    event StakeCalculationRequested(
        address indexed user,
        bytes32 indexed domain,
        uint256 baseStake,
        uint256 finalStake,
        QuadraticStaking.ClaimScope scope
    );
    
    // ============ CONSTRUCTOR ============
    
    constructor(address _voterToken, address[] memory reputationManagers, address[] memory challengeMarkets) {
        require(_voterToken != address(0), "Invalid token address");
        voterToken = IVOTERTokenExtended(_voterToken);
        
        // Grant REPUTATION_MANAGER_ROLE to initial reputation managers (no admin role)
        for (uint256 i = 0; i < reputationManagers.length; i++) {
            _grantRole(REPUTATION_MANAGER_ROLE, reputationManagers[i]);
        }
        
        // Grant CHALLENGE_MARKET_ROLE to initial challenge markets
        for (uint256 i = 0; i < challengeMarkets.length; i++) {
            _grantRole(CHALLENGE_MARKET_ROLE, challengeMarkets[i]);
        }
    }
    
    // ============ PROFILE MANAGEMENT ============
    
    /**
     * @dev Update user profile with latest token and reputation data
     * @param user Address of the user
     * @param reputationScore New reputation score (0-1000)
     */
    function updateUserProfile(
        address user,
        uint256 reputationScore
    ) external onlyRole(REPUTATION_MANAGER_ROLE) {
        require(user != address(0), "Invalid user address");
        require(reputationScore <= 1000, "Invalid reputation score");
        
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        
        // Update token balances from VOTERToken
        profile.totalBalance = voterToken.balanceOf(user);
        (profile.earnedTokens, profile.purchasedTokens) = voterToken.getTokenSources(user);
        
        // Update challenge statistics
        profile.successfulChallenges = userSuccessfulChallenges[user];
        profile.failedChallenges = userFailedChallenges[user];
        profile.totalChallenges = userChallengeCount[user];
        
        // Update reputation
        profile.reputationScore = reputationScore;
        
        emit UserProfileUpdated(
            user,
            profile.totalBalance,
            profile.earnedTokens,
            profile.purchasedTokens,
            reputationScore
        );
    }
    
    /**
     * @dev Update user's domain-specific expertise
     * @param user Address of the user
     * @param domain Domain hash
     * @param expertiseScore New expertise score (0-1000)
     */
    function updateDomainExpertise(
        address user,
        bytes32 domain,
        uint256 expertiseScore
    ) external onlyRole(REPUTATION_MANAGER_ROLE) {
        require(user != address(0), "Invalid user address");
        require(expertiseScore <= 1000, "Invalid expertise score");
        require(registeredDomains[domain].active, "Domain not registered");
        
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        uint256 oldScore = profile.domainExpertise[domain];
        
        profile.domainExpertise[domain] = expertiseScore;
        
        emit ExpertiseUpdated(user, domain, oldScore, expertiseScore);
    }
    
    /**
     * @dev Record the result of a challenge for reputation tracking
     * @param user Address of the challenger
     * @param successful Whether the challenge was successful
     * @param domain Domain of the challenge
     */
    function recordChallengeResult(
        address user,
        bool successful,
        bytes32 domain
    ) external onlyRole(CHALLENGE_MARKET_ROLE) {
        require(user != address(0), "Invalid user address");
        
        userChallengeCount[user]++;
        
        if (successful) {
            userSuccessfulChallenges[user]++;
        } else {
            userFailedChallenges[user]++;
        }
        
        emit ChallengeResultRecorded(user, successful, domain);
    }
    
    // ============ DOMAIN MANAGEMENT ============
    
    // REMOVED: Admin domain registration function eliminated
    // Domain registration should be handled by external governance mechanisms
    
    // ============ STAKE CALCULATION ============
    
    /**
     * @dev Calculate required stake for a challenge using quadratic formula
     * @param user Address of the challenger
     * @param domain Domain of the challenge
     * @param baseStakeAmount Base stake amount intended by user
     * @param scope Geographic/impact scope of the claim
     * @param claimComplexity Complexity score (1-100)
     * @return stakeCalculation Complete breakdown of stake calculation
     */
    function calculateRequiredStake(
        address user,
        bytes32 domain,
        uint256 baseStakeAmount,
        QuadraticStaking.ClaimScope scope,
        uint256 claimComplexity
    ) external view returns (QuadraticStaking.StakeCalculation memory stakeCalculation) {
        require(user != address(0), "Invalid user address");
        require(baseStakeAmount > 0, "Invalid base stake");
        require(claimComplexity >= 1 && claimComplexity <= 100, "Invalid complexity");
        
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        
        QuadraticStaking.ChallengeContext memory context = QuadraticStaking.ChallengeContext({
            domain: domain,
            scope: scope,
            baseStakeAmount: baseStakeAmount,
            claimComplexity: claimComplexity,
            isCounterChallenge: false
        });
        
        return QuadraticStaking.calculateStake(profile, context);
    }
    
    /**
     * @dev Get detailed stake breakdown for transparency
     * @param user Address of the challenger
     * @param domain Domain of the challenge
     * @param baseStakeAmount Base stake amount
     * @param scope Geographic/impact scope
     * @param claimComplexity Complexity score (1-100)
     */
    function getStakeBreakdown(
        address user,
        bytes32 domain,
        uint256 baseStakeAmount,
        QuadraticStaking.ClaimScope scope,
        uint256 claimComplexity
    ) external view returns (
        uint256 baseQuadratic,
        uint256 wealthMultiplier,
        uint256 tokenSourceFactor,
        uint256 challengeHistoryFactor,
        uint256 expertiseMultiplier,
        uint256 impactScaling,
        uint256 finalStake
    ) {
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        
        QuadraticStaking.ChallengeContext memory context = QuadraticStaking.ChallengeContext({
            domain: domain,
            scope: scope,
            baseStakeAmount: baseStakeAmount,
            claimComplexity: claimComplexity,
            isCounterChallenge: false
        });
        
        return QuadraticStaking.getStakeBreakdown(profile, context);
    }
    
    /**
     * @dev Preview stake calculation for a potential challenge
     * @param user Address of the potential challenger
     * @param domain Domain hash
     * @param baseStakeAmount Intended base stake
     * @param scope Claim scope
     * @param claimComplexity Complexity (1-100)
     * @return requiredStake Final calculated stake requirement
     */
    function previewStakeRequirement(
        address user,
        bytes32 domain,
        uint256 baseStakeAmount,
        QuadraticStaking.ClaimScope scope,
        uint256 claimComplexity
    ) external view returns (uint256 requiredStake) {
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        
        return QuadraticStaking.previewStakeCalculation(
            profile.totalBalance,
            profile.earnedTokens,
            profile.purchasedTokens,
            profile.successfulChallenges,
            profile.failedChallenges,
            profile.totalChallenges,
            profile.reputationScore,
            profile.domainExpertise[domain],
            baseStakeAmount,
            scope,
            claimComplexity
        );
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @dev Get complete user profile
     * @param user Address of the user
     */
    function getUserProfile(address user) external view returns (
        uint256 totalBalance,
        uint256 earnedTokens,
        uint256 purchasedTokens,
        uint256 successfulChallenges,
        uint256 failedChallenges,
        uint256 totalChallenges,
        uint256 reputationScore
    ) {
        QuadraticStaking.UserProfile storage profile = userProfiles[user];
        return (
            profile.totalBalance,
            profile.earnedTokens,
            profile.purchasedTokens,
            profile.successfulChallenges,
            profile.failedChallenges,
            profile.totalChallenges,
            profile.reputationScore
        );
    }
    
    /**
     * @dev Get user's expertise in a specific domain
     * @param user Address of the user
     * @param domain Domain hash
     * @return expertiseScore Score from 0-1000
     */
    function getUserDomainExpertise(address user, bytes32 domain) external view returns (uint256 expertiseScore) {
        return userProfiles[user].domainExpertise[domain];
    }
    
    /**
     * @dev Get all registered domains
     * @return domainHashes Array of domain hashes
     */
    function getAllDomains() external view returns (bytes32[] memory domainHashes) {
        return domainList;
    }
    
    /**
     * @dev Get domain information
     * @param domainHash Hash of the domain
     * @return info Domain information
     */
    function getDomainInfo(bytes32 domainHash) external view returns (DomainInfo memory info) {
        return registeredDomains[domainHash];
    }
    
    /**
     * @dev Check if user qualifies as expert in domain
     * @param user Address of the user
     * @param domain Domain hash
     * @return isExpert Whether user meets expertise threshold
     */
    function isUserExpertInDomain(address user, bytes32 domain) external view returns (bool isExpert) {
        DomainInfo storage domainInfo = registeredDomains[domain];
        if (!domainInfo.active) return false;
        
        uint256 userExpertise = userProfiles[user].domainExpertise[domain];
        return userExpertise >= domainInfo.minExpertiseThreshold;
    }
    
    // ============ UTILITY FUNCTIONS ============
    
    /**
     * @dev Hash a domain name to get domain identifier
     * @param domainName Human-readable domain name
     * @return domainHash Hash identifier for the domain
     */
    function hashDomain(string memory domainName) external pure returns (bytes32 domainHash) {
        return keccak256(abi.encodePacked(domainName));
    }
    
    /**
     * @dev Get quadratic staking parameters for transparency
     * @return wealthTiers Wealth tier thresholds
     * @return wealthMultipliers Multipliers for each tier
     * @return minStake Minimum stake amount
     * @return maxStake Maximum stake amount
     */
    function getStakingParameters() external pure returns (
        uint256[4] memory wealthTiers,
        uint256[4] memory wealthMultipliers,
        uint256 minStake,
        uint256 maxStake
    ) {
        wealthTiers = QuadraticStaking.getWealthTiers();
        wealthMultipliers = QuadraticStaking.getWealthMultipliers();
        (minStake, maxStake) = QuadraticStaking.getStakeCaps();
    }
}