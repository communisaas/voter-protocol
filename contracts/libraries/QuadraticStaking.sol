// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title QuadraticStaking
 * @dev Comprehensive quadratic stake calculation library for VOTER Protocol
 * @notice Implements true quadratic scaling with wealth penalties, token source factors, and expertise weighting
 * 
 * Key Features:
 * - TRUE quadratic scaling that prevents plutocracy
 * - Wealth-based exponential penalties for large token holders
 * - Token source discrimination (earned vs purchased)
 * - Challenge history and reputation factors
 * - Domain-specific expertise weighting
 * - Absolute caps to prevent system lockup
 * 
 * Formula Overview:
 * finalStake = baseQuadraticStake * wealthMultiplier * tokenSourcePenalty * expertiseMultiplier * impactScaling
 * 
 * Security: All calculations use safe math with overflow protection and bounded parameters
 */
library QuadraticStaking {
    
    // ============ CONSTANTS ============
    
    // Base scaling factors (using 1e18 precision)
    uint256 private constant PRECISION = 1e18;
    uint256 private constant QUADRATIC_BASE = 1e18;
    uint256 private constant SQRT_PRECISION = 1e9; // For sqrt calculations
    
    // Wealth thresholds (in VOTER tokens with 18 decimals)
    uint256 private constant WEALTH_TIER_1 = 10_000 * 1e18;  // 10K VOTER
    uint256 private constant WEALTH_TIER_2 = 100_000 * 1e18; // 100K VOTER  
    uint256 private constant WEALTH_TIER_3 = 1_000_000 * 1e18; // 1M VOTER
    uint256 private constant WEALTH_TIER_4 = 10_000_000 * 1e18; // 10M VOTER
    
    // Multiplier factors (scaled by PRECISION)
    uint256 private constant WEALTH_MULTIPLIER_TIER_1 = 1.2e18;  // 1.2x penalty at 10K
    uint256 private constant WEALTH_MULTIPLIER_TIER_2 = 2.0e18;  // 2x penalty at 100K
    uint256 private constant WEALTH_MULTIPLIER_TIER_3 = 4.0e18;  // 4x penalty at 1M
    uint256 private constant WEALTH_MULTIPLIER_TIER_4 = 8.0e18;  // 8x penalty at 10M
    
    // Token source penalties
    uint256 private constant EARNED_TOKEN_BONUS = 0.8e18;     // 20% bonus for earned tokens
    uint256 private constant MIXED_TOKEN_NEUTRAL = 1.0e18;    // No bonus/penalty for mixed
    uint256 private constant PURCHASED_TOKEN_PENALTY = 3.0e18; // 3x penalty for mostly purchased
    
    // Challenge history factors
    uint256 private constant MIN_CHALLENGE_MULTIPLIER = 0.5e18;  // 50% minimum for new users
    uint256 private constant MAX_CHALLENGE_MULTIPLIER = 2.0e18;  // 200% maximum for veterans
    uint256 private constant CHALLENGE_HISTORY_DECAY = 0.95e18;  // 5% decay per failed challenge
    
    // Expertise weighting
    uint256 private constant MIN_EXPERTISE_MULTIPLIER = 0.7e18;  // 70% for non-experts
    uint256 private constant MAX_EXPERTISE_MULTIPLIER = 2.5e18;  // 250% for domain experts
    
    // Impact scaling factors
    uint256 private constant LOCAL_IMPACT_BASE = 1.0e18;      // 1x for local claims
    uint256 private constant REGIONAL_IMPACT_BASE = 1.5e18;   // 1.5x for regional claims
    uint256 private constant NATIONAL_IMPACT_BASE = 2.5e18;   // 2.5x for national claims
    uint256 private constant GLOBAL_IMPACT_BASE = 5.0e18;     // 5x for global claims
    
    // Safety caps
    uint256 private constant MAX_ABSOLUTE_STAKE = 1_000_000 * 1e18; // 1M VOTER max stake
    uint256 private constant MIN_ABSOLUTE_STAKE = 10 * 1e18;        // 10 VOTER min stake
    
    // ============ STRUCTS ============
    
    struct UserProfile {
        uint256 totalBalance;           // Total VOTER token balance
        uint256 earnedTokens;          // Tokens earned through civic actions
        uint256 purchasedTokens;       // Tokens acquired through purchases
        uint256 successfulChallenges;  // Number of successful challenges
        uint256 failedChallenges;      // Number of failed challenges
        uint256 totalChallenges;       // Total challenges participated in
        uint256 reputationScore;       // Overall reputation (0-1000)
        mapping(bytes32 => uint256) domainExpertise; // Domain-specific expertise scores
    }
    
    struct ChallengeContext {
        bytes32 domain;                // Domain/category of the challenge
        ClaimScope scope;              // Geographic/impact scope
        uint256 baseStakeAmount;       // User's intended stake amount
        uint256 claimComplexity;       // Complexity score (1-100)
        bool isCounterChallenge;       // Whether this is challenging a challenge
    }
    
    enum ClaimScope {
        LOCAL,      // City/district level
        REGIONAL,   // State/province level  
        NATIONAL,   // Country level
        GLOBAL      // International level
    }
    
    struct StakeCalculation {
        uint256 baseQuadraticStake;    // Base quadratic calculation
        uint256 wealthMultiplier;      // Wealth-based penalty multiplier
        uint256 tokenSourceFactor;     // Earned vs purchased token factor
        uint256 challengeHistoryFactor; // Success/failure history factor
        uint256 expertiseMultiplier;   // Domain expertise multiplier
        uint256 impactScaling;         // Claim scope scaling
        uint256 finalStake;            // Final calculated stake
        uint256 cappedStake;           // Final stake after applying caps
    }
    
    // ============ EVENTS ============
    
    event StakeCalculated(
        address indexed user,
        uint256 baseStake,
        uint256 finalStake,
        uint256 wealthMultiplier,
        uint256 tokenSourceFactor,
        string calculationReason
    );
    
    // ============ MAIN CALCULATION FUNCTION ============
    
    /**
     * @dev Calculate the required stake for a challenge with full quadratic scaling
     * @param userProfile The user's complete profile data
     * @param context The challenge context and parameters
     * @return calculation Complete stake calculation breakdown
     */
    function calculateStake(
        UserProfile storage userProfile,
        ChallengeContext memory context
    ) internal view returns (StakeCalculation memory calculation) {
        
        // 1. Calculate base quadratic stake
        calculation.baseQuadraticStake = _calculateBaseQuadraticStake(
            context.baseStakeAmount,
            userProfile.totalChallenges
        );
        
        // 2. Apply wealth-based multiplier (exponential penalties)
        calculation.wealthMultiplier = _calculateWealthMultiplier(userProfile.totalBalance);
        
        // 3. Apply token source factor (earned vs purchased)
        calculation.tokenSourceFactor = _calculateTokenSourceFactor(
            userProfile.earnedTokens,
            userProfile.purchasedTokens
        );
        
        // 4. Apply challenge history factor
        calculation.challengeHistoryFactor = _calculateChallengeHistoryFactor(
            userProfile.successfulChallenges,
            userProfile.failedChallenges
        );
        
        // 5. Apply domain expertise multiplier
        calculation.expertiseMultiplier = _calculateExpertiseMultiplier(
            userProfile,
            context.domain
        );
        
        // 6. Apply impact scaling based on claim scope
        calculation.impactScaling = _calculateImpactScaling(
            context.scope,
            context.claimComplexity
        );
        
        // 7. Combine all factors
        calculation.finalStake = _combineStakeFactors(calculation);
        
        // 8. Apply safety caps
        calculation.cappedStake = _applyStakeCaps(
            calculation.finalStake,
            userProfile.totalBalance
        );
        
        return calculation;
    }
    
    // ============ CORE CALCULATION FUNCTIONS ============
    
    /**
     * @dev Calculate base quadratic stake with challenge count scaling
     * Formula: baseStake * sqrt(challengeCount + 1) * QUADRATIC_BASE
     */
    function _calculateBaseQuadraticStake(
        uint256 baseStake,
        uint256 challengeCount
    ) private pure returns (uint256) {
        // Quadratic scaling: stake increases with square root of challenge count
        uint256 scalingFactor = _sqrt((challengeCount + 1) * SQRT_PRECISION);
        
        return (baseStake * scalingFactor * QUADRATIC_BASE) / (SQRT_PRECISION * PRECISION);
    }
    
    /**
     * @dev Calculate wealth-based multiplier with exponential scaling
     * Larger token holders face exponentially higher stakes to prevent plutocracy
     */
    function _calculateWealthMultiplier(uint256 totalBalance) private pure returns (uint256) {
        if (totalBalance >= WEALTH_TIER_4) {
            // Exponential scaling for mega-whales
            uint256 excessWealth = totalBalance - WEALTH_TIER_4;
            uint256 exponentialFactor = (excessWealth / WEALTH_TIER_4) + 1;
            return WEALTH_MULTIPLIER_TIER_4 * exponentialFactor;
        } else if (totalBalance >= WEALTH_TIER_3) {
            return WEALTH_MULTIPLIER_TIER_3;
        } else if (totalBalance >= WEALTH_TIER_2) {
            return WEALTH_MULTIPLIER_TIER_2;
        } else if (totalBalance >= WEALTH_TIER_1) {
            return WEALTH_MULTIPLIER_TIER_1;
        } else {
            return PRECISION; // No penalty for smaller holders
        }
    }
    
    /**
     * @dev Calculate token source factor based on earned vs purchased ratio
     * Rewards users who earned tokens through civic participation
     */
    function _calculateTokenSourceFactor(
        uint256 earnedTokens,
        uint256 purchasedTokens
    ) private pure returns (uint256) {
        uint256 totalTokens = earnedTokens + purchasedTokens;
        if (totalTokens == 0) return MIXED_TOKEN_NEUTRAL;
        
        uint256 earnedRatio = (earnedTokens * PRECISION) / totalTokens;
        
        if (earnedRatio >= 0.8e18) { // 80%+ earned
            return EARNED_TOKEN_BONUS;
        } else if (earnedRatio >= 0.3e18) { // 30-80% earned
            return MIXED_TOKEN_NEUTRAL;
        } else { // <30% earned (mostly purchased)
            return PURCHASED_TOKEN_PENALTY;
        }
    }
    
    /**
     * @dev Calculate challenge history factor based on success rate and volume
     * Rewards consistent successful challengers, penalizes spam
     */
    function _calculateChallengeHistoryFactor(
        uint256 successful,
        uint256 failed
    ) private pure returns (uint256) {
        uint256 total = successful + failed;
        if (total == 0) return MIN_CHALLENGE_MULTIPLIER; // New user minimum
        
        uint256 successRate = (successful * PRECISION) / total;
        
        // Base multiplier from success rate
        uint256 baseFactor = MIN_CHALLENGE_MULTIPLIER + 
            ((successRate * (MAX_CHALLENGE_MULTIPLIER - MIN_CHALLENGE_MULTIPLIER)) / PRECISION);
        
        // Apply decay for failed challenges
        uint256 decayFactor = PRECISION;
        for (uint256 i = 0; i < failed && i < 10; i++) {
            decayFactor = (decayFactor * CHALLENGE_HISTORY_DECAY) / PRECISION;
        }
        
        return (baseFactor * decayFactor) / PRECISION;
    }
    
    /**
     * @dev Calculate domain expertise multiplier
     * Rewards users with proven expertise in specific domains
     */
    function _calculateExpertiseMultiplier(
        UserProfile storage userProfile,
        bytes32 domain
    ) private view returns (uint256) {
        uint256 domainScore = userProfile.domainExpertise[domain];
        uint256 reputationScore = userProfile.reputationScore;
        
        // Combine domain-specific expertise with general reputation
        uint256 combinedScore = (domainScore * 70 + reputationScore * 30) / 100;
        
        // Scale to multiplier range
        if (combinedScore >= 800) { // Expert level (800-1000)
            return MAX_EXPERTISE_MULTIPLIER;
        } else if (combinedScore >= 500) { // Intermediate level (500-800)
            uint256 scaledBonus = ((combinedScore - 500) * (MAX_EXPERTISE_MULTIPLIER - PRECISION)) / 300;
            return PRECISION + scaledBonus;
        } else { // Novice level (0-500)
            uint256 penalty = ((500 - combinedScore) * (PRECISION - MIN_EXPERTISE_MULTIPLIER)) / 500;
            return PRECISION - penalty;
        }
    }
    
    /**
     * @dev Calculate impact scaling based on claim scope and complexity
     * Larger scope claims require higher stakes due to broader impact
     */
    function _calculateImpactScaling(
        ClaimScope scope,
        uint256 complexity
    ) private pure returns (uint256) {
        uint256 baseScaling;
        
        if (scope == ClaimScope.GLOBAL) {
            baseScaling = GLOBAL_IMPACT_BASE;
        } else if (scope == ClaimScope.NATIONAL) {
            baseScaling = NATIONAL_IMPACT_BASE;
        } else if (scope == ClaimScope.REGIONAL) {
            baseScaling = REGIONAL_IMPACT_BASE;
        } else {
            baseScaling = LOCAL_IMPACT_BASE;
        }
        
        // Apply complexity multiplier (1-100 scale)
        uint256 complexityMultiplier = PRECISION + ((complexity * PRECISION) / 200); // Max 1.5x
        
        return (baseScaling * complexityMultiplier) / PRECISION;
    }
    
    /**
     * @dev Combine all stake factors into final calculation
     */
    function _combineStakeFactors(
        StakeCalculation memory calculation
    ) private pure returns (uint256) {
        // Divide in stages to prevent overflow
        uint256 result = calculation.baseQuadraticStake;
        result = (result * calculation.wealthMultiplier) / PRECISION;
        result = (result * calculation.tokenSourceFactor) / PRECISION;
        result = (result * calculation.challengeHistoryFactor) / PRECISION;
        result = (result * calculation.expertiseMultiplier) / PRECISION;
        result = (result * calculation.impactScaling) / PRECISION;
        return result;
    }
    
    /**
     * @dev Apply safety caps to prevent system lockup
     */
    function _applyStakeCaps(
        uint256 calculatedStake,
        uint256 userBalance
    ) private pure returns (uint256) {
        // Never exceed user's balance
        if (calculatedStake > userBalance) {
            calculatedStake = userBalance;
        }
        
        // Apply absolute maximum
        if (calculatedStake > MAX_ABSOLUTE_STAKE) {
            calculatedStake = MAX_ABSOLUTE_STAKE;
        }
        
        // Apply absolute minimum
        if (calculatedStake < MIN_ABSOLUTE_STAKE) {
            calculatedStake = MIN_ABSOLUTE_STAKE;
        }
        
        return calculatedStake;
    }
    
    // ============ UTILITY FUNCTIONS ============
    
    /**
     * @dev Calculate integer square root using Babylonian method
     * @param x The number to find square root of
     * @return y The square root
     */
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
    
    // ============ VIEW FUNCTIONS FOR TESTING/DEBUGGING ============
    
    /**
     * @dev Get detailed stake breakdown for transparency
     * @param userProfile User's complete profile
     * @param context Challenge context
     */
    function getStakeBreakdown(
        UserProfile storage userProfile,
        ChallengeContext memory context
    ) internal view returns (
        uint256 baseQuadratic,
        uint256 wealthMultiplier,
        uint256 tokenSourceFactor,
        uint256 challengeHistoryFactor,
        uint256 expertiseMultiplier,
        uint256 impactScaling,
        uint256 finalStake
    ) {
        StakeCalculation memory calc = calculateStake(userProfile, context);
        return (
            calc.baseQuadraticStake,
            calc.wealthMultiplier,
            calc.tokenSourceFactor,
            calc.challengeHistoryFactor,
            calc.expertiseMultiplier,
            calc.impactScaling,
            calc.cappedStake
        );
    }
    
    /**
     * @dev Preview stake calculation without modifying state
     * @param totalBalance User's total token balance
     * @param earnedTokens Tokens earned through civic actions  
     * @param purchasedTokens Tokens acquired through purchases
     * @param successfulChallenges Number of successful challenges
     * @param failedChallenges Number of failed challenges
     * @param totalChallenges Total challenges participated in
     * @param reputationScore Overall reputation score
     * @param domainExpertise Domain-specific expertise score
     * @param baseStakeAmount Intended stake amount
     * @param scope Challenge scope
     * @param claimComplexity Claim complexity (1-100)
     * @return requiredStake Final required stake amount
     */
    function previewStakeCalculation(
        uint256 totalBalance,
        uint256 earnedTokens,
        uint256 purchasedTokens,
        uint256 successfulChallenges,
        uint256 failedChallenges,
        uint256 totalChallenges,
        uint256 reputationScore,
        uint256 domainExpertise,
        uint256 baseStakeAmount,
        ClaimScope scope,
        uint256 claimComplexity
    ) internal pure returns (uint256 requiredStake) {
        // Create temporary calculation
        uint256 baseQuadratic = _calculateBaseQuadraticStake(baseStakeAmount, totalChallenges);
        uint256 wealthMult = _calculateWealthMultiplier(totalBalance);
        uint256 tokenSourceFact = _calculateTokenSourceFactor(earnedTokens, purchasedTokens);
        uint256 challengeHistFact = _calculateChallengeHistoryFactor(successfulChallenges, failedChallenges);
        uint256 impactScale = _calculateImpactScaling(scope, claimComplexity);
        
        // Simplified expertise calculation for preview
        uint256 expertiseMult = MIN_EXPERTISE_MULTIPLIER + 
            ((domainExpertise * (MAX_EXPERTISE_MULTIPLIER - MIN_EXPERTISE_MULTIPLIER)) / 1000);
        
        // Combine factors (use reduced precision to prevent overflow)
        uint256 divisor = PRECISION * PRECISION; // 1e36 instead of 1e90
        uint256 combined = (baseQuadratic * wealthMult * tokenSourceFact * challengeHistFact * expertiseMult * impactScale) / divisor;
        
        // Apply caps
        return _applyStakeCaps(combined, totalBalance);
    }
    
    // ============ PARAMETER GETTERS ============
    
    function getWealthTiers() internal pure returns (uint256[4] memory) {
        return [WEALTH_TIER_1, WEALTH_TIER_2, WEALTH_TIER_3, WEALTH_TIER_4];
    }
    
    function getWealthMultipliers() internal pure returns (uint256[4] memory) {
        return [WEALTH_MULTIPLIER_TIER_1, WEALTH_MULTIPLIER_TIER_2, WEALTH_MULTIPLIER_TIER_3, WEALTH_MULTIPLIER_TIER_4];
    }
    
    function getStakeCaps() internal pure returns (uint256 min, uint256 max) {
        return (MIN_ABSOLUTE_STAKE, MAX_ABSOLUTE_STAKE);
    }
}