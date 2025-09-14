// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/TemplateRegistry.sol";

contract TemplateRegistryTest is Test {
    TemplateRegistry public registry;
    
    address admin = address(this);
    address creator1 = address(0x101);  // Avoid precompile addresses
    address creator2 = address(0x102);
    address challenger = address(0x103);
    address impactOracle = address(0x104);
    
    bytes32 templateId1;
    bytes32 templateId2;
    
    event TemplateCreated(
        bytes32 indexed templateId,
        address indexed creator,
        string ipfsHash
    );
    
    event ImpactRecorded(
        bytes32 indexed templateId,
        string representative,
        bool directCitation,
        uint256 confidence
    );
    
    function setUp() public {
        registry = new TemplateRegistry(admin);
        registry.grantRole(registry.IMPACT_ORACLE_ROLE(), impactOracle);
        
        // Create test templates
        vm.prank(creator1);
        templateId1 = registry.createTemplate("QmTemplate1Hash");
        
        vm.prank(creator2);
        templateId2 = registry.createTemplate("QmTemplate2Hash");
    }
    
    // ============ TEMPLATE CREATION TESTS ============
    
    function test_CreateTemplate() public {
        vm.prank(creator1);
        bytes32 templateId = registry.createTemplate("QmNewTemplateHash");
        
        (
            string memory ipfsHash,
            address creator,
            uint256 creationBlock,
            uint256 usageCount,
            uint256 impactScore,
            uint256 credibilityScore,
            bool deprecated,
            uint256 totalStaked
        ) = registry.templates(templateId);
        
        assertEq(ipfsHash, "QmNewTemplateHash");
        assertEq(creator, creator1);
        assertEq(creationBlock, block.number);
        assertEq(usageCount, 0);
        assertEq(impactScore, 50); // Starts neutral
        assertEq(credibilityScore, 50);
        assertFalse(deprecated);
        assertEq(totalStaked, 0);
    }
    
    function test_CannotCreateEmptyTemplate() public {
        vm.prank(creator1);
        vm.expectRevert("Empty IPFS hash");
        registry.createTemplate("");
    }
    
    function test_CreateTemplateEmitsEvent() public {
        vm.prank(creator1);
        vm.expectEmit(true, true, false, true);
        emit TemplateCreated(
            keccak256(abi.encodePacked("QmEventTest", creator1, block.timestamp)),
            creator1,
            "QmEventTest"
        );
        registry.createTemplate("QmEventTest");
    }
    
    // ============ USAGE TRACKING TESTS ============
    
    function test_RecordUsage() public {
        bytes32 campaignId = keccak256("campaign_001");
        
        vm.prank(impactOracle);
        registry.recordUsage(templateId1, campaignId, 100, "CA-12");
        
        (,,, uint256 usageCount,,,, ) = registry.templates(templateId1);
        assertEq(usageCount, 100);
        
        // Check campaign history
        TemplateRegistry.CampaignUsage[] memory history = registry.getCampaignHistory(templateId1);
        assertEq(history.length, 1);
        assertEq(history[0].participantCount, 100);
        assertEq(history[0].district, "CA-12");
    }
    
    function test_OnlyOracleCanRecordUsage() public {
        vm.prank(creator1); // Not oracle
        vm.expectRevert();
        registry.recordUsage(templateId1, keccak256("test"), 100, "CA-12");
    }
    
    function test_CannotRecordUsageForNonexistentTemplate() public {
        bytes32 fakeId = keccak256("fake");
        
        vm.prank(impactOracle);
        vm.expectRevert("Template not found");
        registry.recordUsage(fakeId, keccak256("test"), 100, "CA-12");
    }
    
    // ============ IMPACT RECORDING TESTS ============
    
    function test_RecordDirectCitationImpact() public {
        vm.prank(impactOracle);
        registry.recordImpact(templateId1, "Rep. Smith", true, true, 95);
        
        // Should boost impact score significantly
        (,,,, uint256 impactScore,,,) = registry.templates(templateId1);
        assertGt(impactScore, 80); // Should be high with direct citation + position change
        
        // Check impact history
        TemplateRegistry.LegislativeImpact[] memory history = registry.getImpactHistory(templateId1);
        assertEq(history.length, 1);
        assertTrue(history[0].directCitation);
        assertTrue(history[0].positionChanged);
        assertEq(history[0].confidenceScore, 95);
    }
    
    function test_RecordCorrelationImpact() public {
        vm.prank(impactOracle);
        registry.recordImpact(templateId1, "Rep. Jones", false, false, 60);
        
        // Should have modest impact on score
        (,,,, uint256 impactScore,,,) = registry.templates(templateId1);
        assertLt(impactScore, 70); // Should be moderate
        assertGt(impactScore, 45); // But still positive
    }
    
    function test_ImpactScoreCapAt100() public {
        // Record multiple high-impact events
        vm.startPrank(impactOracle);
        registry.recordImpact(templateId1, "Rep. A", true, true, 100);
        registry.recordImpact(templateId1, "Rep. B", true, true, 100);
        registry.recordImpact(templateId1, "Rep. C", true, true, 100);
        vm.stopPrank();
        
        (,,,, uint256 impactScore,,,) = registry.templates(templateId1);
        assertEq(impactScore, 100); // Should cap at 100
    }
    
    function test_InvalidConfidenceScoreReverts() public {
        vm.prank(impactOracle);
        vm.expectRevert("Invalid confidence score");
        registry.recordImpact(templateId1, "Rep. Smith", true, true, 101);
    }
    
    // ============ CHALLENGE SYSTEM TESTS ============
    
    function test_ChallengeTemplate() public {
        uint256 stakeAmount = 50 ether;
        
        vm.deal(challenger, stakeAmount);
        vm.prank(challenger);
        registry.challengeTemplate{value: stakeAmount}(templateId1);
        
        (
            address challengerAddr,
            address defender,
            uint256 challengerStake,
            uint256 supportStake,
            uint256 opposeStake,
            uint256 deadline,
            bool resolved,
            bool challengeSucceeded
        ) = registry.challenges(templateId1);
        
        assertEq(challengerAddr, challenger);
        assertEq(defender, creator1);
        assertEq(challengerStake, stakeAmount);
        assertEq(supportStake, 0);
        assertEq(opposeStake, stakeAmount);
        assertGt(deadline, block.timestamp);
        assertFalse(resolved);
        assertFalse(challengeSucceeded);
    }
    
    function test_StakeOnChallenge() public {
        // Create challenge first
        vm.deal(challenger, 50 ether);
        vm.prank(challenger);
        registry.challengeTemplate{value: 50 ether}(templateId1);
        
        // Stake in support
        vm.deal(creator2, 30 ether);
        vm.prank(creator2);
        registry.stakeOnChallenge{value: 30 ether}(templateId1, true);
        
        (,,, uint256 supportStake,,,, ) = registry.challenges(templateId1);
        assertEq(supportStake, 30 ether);
    }
    
    function test_ResolveSuccessfulChallenge() public {
        uint256 challengerStake = 40 ether;
        uint256 supportStake = 10 ether; // Less than challenger
        
        // Create challenge
        vm.deal(challenger, challengerStake);
        vm.prank(challenger);
        registry.challengeTemplate{value: challengerStake}(templateId1);
        
        // Add some support (but not enough)
        vm.deal(creator2, supportStake);
        vm.prank(creator2);
        registry.stakeOnChallenge{value: supportStake}(templateId1, true);
        
        // Fast forward past deadline
        vm.warp(block.timestamp + 4 days);
        
        uint256 initialCredibility = 50;
        uint256 challengerBalanceBefore = challenger.balance;
        
        // Resolve challenge
        registry.resolveChallenge(templateId1);
        
        // Check credibility reduced
        (,,,,, uint256 credibilityScore,,) = registry.templates(templateId1);
        assertLt(credibilityScore, initialCredibility);
        
        // Check challenger got paid
        assertGt(challenger.balance, challengerBalanceBefore);
        
        (,,,,,, bool resolved, bool challengeSucceeded) = registry.challenges(templateId1);
        assertTrue(resolved);
        assertTrue(challengeSucceeded);
    }
    
    function test_ResolveFailedChallenge() public {
        uint256 challengerStake = 20 ether;
        uint256 supportStake = 40 ether; // More than challenger
        
        // Create challenge
        vm.deal(challenger, challengerStake);
        vm.prank(challenger);
        registry.challengeTemplate{value: challengerStake}(templateId1);
        
        // Add more support than opposition
        vm.deal(creator2, supportStake);
        vm.prank(creator2);
        registry.stakeOnChallenge{value: supportStake}(templateId1, true);
        
        // Fast forward past deadline
        vm.warp(block.timestamp + 4 days);
        
        uint256 initialCredibility = 50;
        uint256 creatorBalanceBefore = creator1.balance;
        
        // Resolve challenge
        registry.resolveChallenge(templateId1);
        
        // Check credibility increased
        (,,,,, uint256 credibilityScore,,) = registry.templates(templateId1);
        assertGt(credibilityScore, initialCredibility);
        
        // Check defender got paid
        assertGt(creator1.balance, creatorBalanceBefore);
        
        (,,,,,, bool resolved, bool challengeSucceeded) = registry.challenges(templateId1);
        assertTrue(resolved);
        assertFalse(challengeSucceeded);
    }
    
    function test_CannotChallengeWithInsufficientStake() public {
        uint256 lowStake = registry.minStakeAmount() - 1;
        
        vm.deal(challenger, lowStake);
        vm.prank(challenger);
        vm.expectRevert("Insufficient stake");
        registry.challengeTemplate{value: lowStake}(templateId1);
    }
    
    // ============ FUNDING IMPACT CALCULATION ============
    
    function test_CalculateFundingImpact() public {
        // Set up template with high impact and credibility
        vm.startPrank(impactOracle);
        
        // Record multiple usages
        for (uint256 i = 0; i < 50; i++) {
            registry.recordUsage(templateId1, keccak256(abi.encode(i)), 100, "CA-12");
        }
        
        // Record high impact
        registry.recordImpact(templateId1, "Rep. Smith", true, true, 90);
        vm.stopPrank();
        
        // Challenge and resolve in favor (increases credibility)
        vm.deal(challenger, 50 ether);
        vm.prank(challenger);
        registry.challengeTemplate{value: 50 ether}(templateId1);
        
        vm.deal(creator2, 100 ether);
        vm.prank(creator2);
        registry.stakeOnChallenge{value: 100 ether}(templateId1, true);
        
        vm.warp(block.timestamp + 4 days);
        registry.resolveChallenge(templateId1);
        
        // Calculate funding impact
        uint256 fundingImpact = registry.calculateFundingImpact(templateId1);
        assertGt(fundingImpact, 70); // Should be high
    }
    
    function test_LowUsageLowFundingImpact() public {
        // Template with minimal usage and impact
        uint256 fundingImpact = registry.calculateFundingImpact(templateId2);
        assertLt(fundingImpact, 60); // Should be moderate
    }
    
    // ============ ADMINISTRATIVE FUNCTIONS ============
    
    function test_DeprecateTemplate() public {
        // Creator can deprecate their own template
        vm.prank(creator1);
        registry.deprecateTemplate(templateId1);
        
        (,,,,,,bool deprecated,) = registry.templates(templateId1);
        assertTrue(deprecated);
    }
    
    function test_AdminCanDeprecateAnyTemplate() public {
        // Admin can deprecate any template
        vm.prank(admin);
        registry.deprecateTemplate(templateId1);
        
        (,,,,,,bool deprecated,) = registry.templates(templateId1);
        assertTrue(deprecated);
    }
    
    function test_NonOwnerCannotDeprecate() public {
        vm.prank(creator2); // Not creator or admin
        vm.expectRevert("Not authorized");
        registry.deprecateTemplate(templateId1);
    }
    
    function test_UpdateMinStake() public {
        uint256 newMinStake = 20 * 10**18;
        
        vm.prank(admin);
        registry.updateMinStake(newMinStake);
        
        assertEq(registry.minStakeAmount(), newMinStake);
    }
    
    function test_PauseUnpause() public {
        // Pause
        vm.prank(admin);
        registry.pause();
        assertTrue(registry.paused());
        
        // Cannot create template when paused
        vm.prank(creator1);
        vm.expectRevert("Pausable: paused");
        registry.createTemplate("QmPausedTest");
        
        // Unpause
        vm.prank(admin);
        registry.unpause();
        assertFalse(registry.paused());
        
        // Can create template when unpaused
        vm.prank(creator1);
        registry.createTemplate("QmUnpausedTest");
    }
    
    // ============ VIEW FUNCTIONS ============
    
    function test_GetCreatorTemplates() public {
        bytes32[] memory templates = registry.getCreatorTemplates(creator1);
        assertEq(templates.length, 1);
        assertEq(templates[0], templateId1);
    }
    
    function test_GetCampaignHistory() public {
        vm.prank(impactOracle);
        registry.recordUsage(templateId1, keccak256("camp1"), 50, "NY-10");
        
        TemplateRegistry.CampaignUsage[] memory history = registry.getCampaignHistory(templateId1);
        assertEq(history.length, 1);
        assertEq(history[0].participantCount, 50);
        assertEq(history[0].district, "NY-10");
    }
    
    function test_GetImpactHistory() public {
        vm.prank(impactOracle);
        registry.recordImpact(templateId1, "Sen. Wilson", true, false, 75);
        
        TemplateRegistry.LegislativeImpact[] memory history = registry.getImpactHistory(templateId1);
        assertEq(history.length, 1);
        assertEq(history[0].representative, "Sen. Wilson");
        assertTrue(history[0].directCitation);
        assertFalse(history[0].positionChanged);
        assertEq(history[0].confidenceScore, 75);
    }
}