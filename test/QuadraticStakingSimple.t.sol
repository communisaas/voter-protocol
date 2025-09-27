// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";

// Import only our library to test it independently
import "../contracts/libraries/QuadraticStaking.sol";

/**
 * @title QuadraticStakingSimpleTest
 * @dev Simple test for QuadraticStaking library without external dependencies
 */
contract QuadraticStakingSimpleTest is Test {
    using QuadraticStaking for QuadraticStaking.UserProfile;
    
    // Test storage for user profiles
    mapping(address => QuadraticStaking.UserProfile) private profiles;
    
    address public testUser = address(0x1);
    bytes32 public constant TEST_DOMAIN = keccak256("test");
    
    function setUp() public {
        // Setup a test user profile
        QuadraticStaking.UserProfile storage profile = profiles[testUser];
        profile.totalBalance = 100_000 * 1e18; // 100K VOTER
        profile.earnedTokens = 60_000 * 1e18;  // 60% earned
        profile.purchasedTokens = 40_000 * 1e18; // 40% purchased
        profile.successfulChallenges = 5;
        profile.failedChallenges = 1;
        profile.totalChallenges = 6;
        profile.reputationScore = 700;
        profile.domainExpertise[TEST_DOMAIN] = 600;
    }
    
    function testBasicCalculation() public {
        QuadraticStaking.ChallengeContext memory context = QuadraticStaking.ChallengeContext({
            domain: TEST_DOMAIN,
            scope: QuadraticStaking.ClaimScope.LOCAL,
            baseStakeAmount: 100 * 1e18,
            claimComplexity: 50,
            isCounterChallenge: false
        });
        
        QuadraticStaking.StakeCalculation memory calc = QuadraticStaking.calculateStake(
            profiles[testUser], 
            context
        );
        
        assertTrue(calc.finalStake > 0, "Final stake should be positive");
        assertTrue(calc.cappedStake >= 10 * 1e18, "Should respect minimum stake");
        assertTrue(calc.cappedStake <= 1_000_000 * 1e18, "Should respect maximum stake");
        
        console.log("Base Quadratic Stake:", calc.baseQuadraticStake / 1e18);
        console.log("Wealth Multiplier:", calc.wealthMultiplier / 1e18);
        console.log("Token Source Factor:", calc.tokenSourceFactor / 1e18);
        console.log("Challenge History Factor:", calc.challengeHistoryFactor / 1e18);
        console.log("Expertise Multiplier:", calc.expertiseMultiplier / 1e18);
        console.log("Impact Scaling:", calc.impactScaling / 1e18);
        console.log("Final Stake:", calc.cappedStake / 1e18);
    }
    
    function testWealthTiers() public {
        uint256[4] memory tiers = QuadraticStaking.getWealthTiers();
        uint256[4] memory multipliers = QuadraticStaking.getWealthMultipliers();
        
        assertTrue(tiers[0] == 10_000 * 1e18, "Tier 1 should be 10K VOTER");
        assertTrue(tiers[1] == 100_000 * 1e18, "Tier 2 should be 100K VOTER");
        assertTrue(tiers[2] == 1_000_000 * 1e18, "Tier 3 should be 1M VOTER");
        assertTrue(tiers[3] == 10_000_000 * 1e18, "Tier 4 should be 10M VOTER");
        
        assertTrue(multipliers[0] >= 1e18, "All multipliers should be >= 1");
        assertTrue(multipliers[1] > multipliers[0], "Higher tiers should have higher multipliers");
        assertTrue(multipliers[2] > multipliers[1], "Higher tiers should have higher multipliers");
        assertTrue(multipliers[3] > multipliers[2], "Higher tiers should have higher multipliers");
    }
    
    function testStakeCaps() public {
        (uint256 minStake, uint256 maxStake) = QuadraticStaking.getStakeCaps();
        
        assertTrue(minStake == 10 * 1e18, "Min stake should be 10 VOTER");
        assertTrue(maxStake == 1_000_000 * 1e18, "Max stake should be 1M VOTER");
        assertTrue(minStake < maxStake, "Min should be less than max");
    }
    
    function testPreviewCalculation() public {
        uint256 preview = QuadraticStaking.previewStakeCalculation(
            100_000 * 1e18, // totalBalance
            60_000 * 1e18,  // earnedTokens  
            40_000 * 1e18,  // purchasedTokens
            5,              // successfulChallenges
            1,              // failedChallenges
            6,              // totalChallenges
            700,            // reputationScore
            600,            // domainExpertise
            100 * 1e18,     // baseStakeAmount
            QuadraticStaking.ClaimScope.LOCAL, // scope
            50              // claimComplexity
        );
        
        assertTrue(preview > 0, "Preview should return positive stake");
        console.log("Preview Stake:", preview / 1e18);
    }
    
    function testDifferentScopes() public {
        QuadraticStaking.UserProfile storage profile = profiles[testUser];
        
        uint256 localStake = QuadraticStaking.previewStakeCalculation(
            profile.totalBalance, profile.earnedTokens, profile.purchasedTokens,
            profile.successfulChallenges, profile.failedChallenges, profile.totalChallenges,
            profile.reputationScore, 600, 100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        uint256 regionalStake = QuadraticStaking.previewStakeCalculation(
            profile.totalBalance, profile.earnedTokens, profile.purchasedTokens,
            profile.successfulChallenges, profile.failedChallenges, profile.totalChallenges,
            profile.reputationScore, 600, 100 * 1e18,
            QuadraticStaking.ClaimScope.REGIONAL, 50
        );
        
        uint256 nationalStake = QuadraticStaking.previewStakeCalculation(
            profile.totalBalance, profile.earnedTokens, profile.purchasedTokens,
            profile.successfulChallenges, profile.failedChallenges, profile.totalChallenges,
            profile.reputationScore, 600, 100 * 1e18,
            QuadraticStaking.ClaimScope.NATIONAL, 50
        );
        
        uint256 globalStake = QuadraticStaking.previewStakeCalculation(
            profile.totalBalance, profile.earnedTokens, profile.purchasedTokens,
            profile.successfulChallenges, profile.failedChallenges, profile.totalChallenges,
            profile.reputationScore, 600, 100 * 1e18,
            QuadraticStaking.ClaimScope.GLOBAL, 50
        );
        
        assertTrue(regionalStake > localStake, "Regional should cost more than local");
        assertTrue(nationalStake > regionalStake, "National should cost more than regional");  
        assertTrue(globalStake > nationalStake, "Global should cost more than national");
        
        console.log("Local Stake:", localStake / 1e18);
        console.log("Regional Stake:", regionalStake / 1e18);
        console.log("National Stake:", nationalStake / 1e18);
        console.log("Global Stake:", globalStake / 1e18);
    }
    
    function testWealthImpact() public {
        // Test small holder
        uint256 smallStake = QuadraticStaking.previewStakeCalculation(
            5_000 * 1e18,   // 5K VOTER - below tier 1
            4_000 * 1e18,   // 80% earned
            1_000 * 1e18,   // 20% purchased
            2, 0, 2, 500, 500,
            100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        // Test medium holder  
        uint256 mediumStake = QuadraticStaking.previewStakeCalculation(
            50_000 * 1e18,  // 50K VOTER - tier 2
            30_000 * 1e18,  // 60% earned
            20_000 * 1e18,  // 40% purchased
            2, 0, 2, 500, 500,
            100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        // Test whale
        uint256 whaleStake = QuadraticStaking.previewStakeCalculation(
            2_000_000 * 1e18, // 2M VOTER - tier 3
            800_000 * 1e18,   // 40% earned
            1_200_000 * 1e18, // 60% purchased
            2, 0, 2, 500, 500,
            100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        assertTrue(mediumStake > smallStake, "Medium holder should pay more");
        assertTrue(whaleStake > mediumStake, "Whale should pay much more");
        
        console.log("Small Holder Stake:", smallStake / 1e18);
        console.log("Medium Holder Stake:", mediumStake / 1e18);
        console.log("Whale Stake:", whaleStake / 1e18);
    }
    
    function testTokenSourceImpact() public {
        uint256 baseBalance = 50_000 * 1e18;
        
        // Mostly earned (80%)
        uint256 earnedStake = QuadraticStaking.previewStakeCalculation(
            baseBalance, baseBalance * 8 / 10, baseBalance * 2 / 10,
            2, 0, 2, 500, 500, 100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        // Mixed (50/50)
        uint256 mixedStake = QuadraticStaking.previewStakeCalculation(
            baseBalance, baseBalance / 2, baseBalance / 2,
            2, 0, 2, 500, 500, 100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        // Mostly purchased (20% earned)
        uint256 purchasedStake = QuadraticStaking.previewStakeCalculation(
            baseBalance, baseBalance * 2 / 10, baseBalance * 8 / 10,
            2, 0, 2, 500, 500, 100 * 1e18,
            QuadraticStaking.ClaimScope.LOCAL, 50
        );
        
        assertTrue(earnedStake < mixedStake, "Earned tokens should get bonus");
        assertTrue(mixedStake < purchasedStake, "Purchased tokens should get penalty");
        
        console.log("Earned Token Stake:", earnedStake / 1e18);
        console.log("Mixed Token Stake:", mixedStake / 1e18);
        console.log("Purchased Token Stake:", purchasedStake / 1e18);
    }
}