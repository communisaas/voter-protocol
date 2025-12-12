// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/CampaignRegistry.sol";
import "../src/TimelockGovernance.sol";

/// @title CampaignRegistry Tests
/// @notice Comprehensive tests for Phase 1.5 CampaignRegistry
/// @dev Tests cover security model, attack vectors, and integration
///      Phase 1: TimelockGovernance (no GuardianShield)
contract CampaignRegistryTest is Test {
    CampaignRegistry public registry;

    address public governance = address(0x1);
    address public creator = address(0x2);
    address public attacker = address(0x3);
    address public districtGate = address(0x200);

    bytes32 constant IPFS_HASH = bytes32(uint256(0x123456));
    bytes3 constant USA = "USA";
    bytes32 constant ACTION_ID_1 = bytes32(uint256(0xAAA));
    bytes32 constant ACTION_ID_2 = bytes32(uint256(0xBBB));
    bytes32 constant DISTRICT_ROOT = bytes32(uint256(0xDDD));

    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed creator,
        bytes3 indexed country,
        bytes32 ipfsMetadataHash,
        uint256 templateCount
    );
    event ParticipantRecorded(
        bytes32 indexed campaignId,
        bytes32 indexed actionId,
        bytes32 indexed districtRoot,
        bool newDistrict
    );
    event FlagInitiated(bytes32 indexed campaignId, string reason, uint256 executeTime);
    event CampaignFlagged(bytes32 indexed campaignId, string reason);

    function setUp() public {
        // Phase 1: Simple governance (no guardians required)
        registry = new CampaignRegistry(governance);

        // Authorize DistrictGate as caller
        vm.prank(governance);
        registry.authorizeCaller(districtGate);
    }

    // ============================================================================
    // Constructor Tests
    // ============================================================================

    function test_Constructor() public view {
        assertEq(registry.governance(), governance);
        assertTrue(registry.authorizedCallers(governance));
    }

    function test_RevertWhen_ConstructorZeroGovernance() public {
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        new CampaignRegistry(address(0));
    }

    // ============================================================================
    // Campaign Creation Tests
    // ============================================================================

    function test_CreateCampaign() public {
        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID_1;
        actionIds[1] = ACTION_ID_2;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        assertTrue(campaignId != bytes32(0));

        (
            address _creator,
            bytes3 country,
            uint64 createdAt,
            CampaignRegistry.CampaignStatus status,
            bytes32 ipfsHash,
            uint256 participantCount,
            uint256 districtCount
        ) = registry.getCampaign(campaignId);

        assertEq(_creator, creator);
        assertEq(country, USA);
        assertTrue(createdAt > 0);
        assertEq(uint8(status), uint8(CampaignRegistry.CampaignStatus.Active));
        assertEq(ipfsHash, IPFS_HASH);
        assertEq(participantCount, 0);
        assertEq(districtCount, 0);
    }

    function test_CreateCampaignLinksTemplates() public {
        bytes32[] memory actionIds = new bytes32[](2);
        actionIds[0] = ACTION_ID_1;
        actionIds[1] = ACTION_ID_2;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        // Verify templates are linked
        assertEq(registry.actionToCampaign(ACTION_ID_1), campaignId);
        assertEq(registry.actionToCampaign(ACTION_ID_2), campaignId);

        bytes32[] memory templates = registry.getCampaignTemplates(campaignId);
        assertEq(templates.length, 2);
        assertEq(templates[0], ACTION_ID_1);
        assertEq(templates[1], ACTION_ID_2);
    }

    function test_RevertWhen_CreateCampaignZeroMetadataHash() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.InvalidMetadataHash.selector);
        registry.createCampaign(bytes32(0), USA, actionIds);
    }

    function test_RevertWhen_CreateCampaignZeroCountry() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.InvalidCountryCode.selector);
        registry.createCampaign(IPFS_HASH, bytes3(0), actionIds);
    }

    function test_RevertWhen_CreateCampaignNoTemplates() public {
        bytes32[] memory actionIds = new bytes32[](0);

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.NoTemplatesProvided.selector);
        registry.createCampaign(IPFS_HASH, USA, actionIds);
    }

    function test_RevertWhen_CreateCampaignTooManyTemplates() public {
        bytes32[] memory actionIds = new bytes32[](51);
        for (uint256 i = 0; i < 51; i++) {
            actionIds[i] = bytes32(i);
        }

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.TooManyTemplates.selector);
        registry.createCampaign(IPFS_HASH, USA, actionIds);
    }

    function test_RevertWhen_TemplateAlreadyLinked() public {
        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        bytes32[] memory actionIds2 = new bytes32[](1);
        actionIds2[0] = ACTION_ID_1; // Same template

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);

        // Wait for rate limit
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.TemplateAlreadyLinked.selector);
        registry.createCampaign(bytes32(uint256(0x999)), USA, actionIds2);
    }

    // ============================================================================
    // Rate Limiting Tests (Spam Prevention)
    // ============================================================================

    function test_RateLimitEnforced() public {
        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        bytes32[] memory actionIds2 = new bytes32[](1);
        actionIds2[0] = ACTION_ID_2;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);

        // Try to create another immediately
        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.RateLimitExceeded.selector);
        registry.createCampaign(bytes32(uint256(0x999)), USA, actionIds2);
    }

    function test_RateLimitExpires() public {
        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        bytes32[] memory actionIds2 = new bytes32[](1);
        actionIds2[0] = ACTION_ID_2;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);

        // Wait for cooldown
        vm.warp(block.timestamp + 1 hours + 1);

        // Should succeed now
        vm.prank(creator);
        registry.createCampaign(bytes32(uint256(0x999)), USA, actionIds2);
    }

    function test_WhitelistedCreatorBypassesRateLimit() public {
        // Whitelist creator
        vm.prank(governance);
        registry.setCreatorWhitelist(creator, true);

        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        bytes32[] memory actionIds2 = new bytes32[](1);
        actionIds2[0] = ACTION_ID_2;

        vm.startPrank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);
        // Should succeed immediately for whitelisted creator
        registry.createCampaign(bytes32(uint256(0x999)), USA, actionIds2);
        vm.stopPrank();
    }

    // ============================================================================
    // Participation Recording Tests
    // ============================================================================

    function test_RecordParticipation() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        // Record participation
        vm.prank(districtGate);
        registry.recordParticipation(ACTION_ID_1, DISTRICT_ROOT);

        (, , , , , uint256 participantCount, uint256 districtCount) = registry.getCampaign(campaignId);
        assertEq(participantCount, 1);
        assertEq(districtCount, 1);
    }

    function test_RecordParticipationTracksUniqueDistricts() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        bytes32 district1 = bytes32(uint256(0xD1));
        bytes32 district2 = bytes32(uint256(0xD2));

        // Record from district1
        vm.prank(districtGate);
        registry.recordParticipation(ACTION_ID_1, district1);

        // Record from district1 again (same district)
        vm.prank(districtGate);
        registry.recordParticipation(ACTION_ID_1, district1);

        // Record from district2 (different district)
        vm.prank(districtGate);
        registry.recordParticipation(ACTION_ID_1, district2);

        (, , , , , uint256 participantCount, uint256 districtCount) = registry.getCampaign(campaignId);
        assertEq(participantCount, 3); // 3 total participants
        assertEq(districtCount, 2);    // Only 2 unique districts
    }

    function test_RecordParticipationIgnoresUnlinkedAction() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds);

        // Try to record for unlinked action (should not revert, just ignored)
        vm.prank(districtGate);
        registry.recordParticipation(bytes32(uint256(0xFEED)), DISTRICT_ROOT);
        // No assertion needed - just checking it doesn't revert
    }

    function test_RevertWhen_UnauthorizedCallerRecordsParticipation() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        registry.recordParticipation(ACTION_ID_1, DISTRICT_ROOT);
    }

    // ============================================================================
    // Campaign Status Tests
    // ============================================================================

    function test_CreatorCanCompleteCampaign() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(creator);
        registry.completeCampaign(campaignId);

        (, , , CampaignRegistry.CampaignStatus status, , , ) = registry.getCampaign(campaignId);
        assertEq(uint8(status), uint8(CampaignRegistry.CampaignStatus.Completed));
    }

    function test_RevertWhen_NonCreatorCompletesCampaign() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(attacker);
        vm.expectRevert(CampaignRegistry.NotCampaignCreator.selector);
        registry.completeCampaign(campaignId);
    }

    function test_GovernanceCanPauseCampaign() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        registry.pauseCampaign(campaignId);

        (, , , CampaignRegistry.CampaignStatus status, , , ) = registry.getCampaign(campaignId);
        assertEq(uint8(status), uint8(CampaignRegistry.CampaignStatus.Paused));
    }

    function test_PausedCampaignDoesNotRecordParticipation() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        // Pause the campaign
        vm.prank(governance);
        registry.pauseCampaign(campaignId);

        // Try to record participation (should not revert, but should not record)
        vm.prank(districtGate);
        registry.recordParticipation(ACTION_ID_1, DISTRICT_ROOT);

        (, , , , , uint256 participantCount, ) = registry.getCampaign(campaignId);
        assertEq(participantCount, 0); // No participation recorded
    }

    // ============================================================================
    // Flag Mechanism Tests (Governance)
    // ============================================================================

    function test_InitiateFlagCampaign() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit FlagInitiated(campaignId, "Terms violation", block.timestamp + 24 hours);
        registry.initiateFlagCampaign(campaignId, "Terms violation");

        (uint256 executeTime, string memory reason) = registry.getPendingFlag(campaignId);
        assertEq(executeTime, block.timestamp + 24 hours);
        assertEq(reason, "Terms violation");
    }

    function test_ExecuteFlagAfterTimelock() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        registry.initiateFlagCampaign(campaignId, "Terms violation");

        // Wait for timelock
        vm.warp(block.timestamp + 24 hours);

        registry.executeFlagCampaign(campaignId);

        (bool flagged, string memory reason) = registry.isFlagged(campaignId);
        assertTrue(flagged);
        assertEq(reason, "Terms violation");
    }

    function test_RevertWhen_ExecuteFlagBeforeTimelock() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        registry.initiateFlagCampaign(campaignId, "Terms violation");

        // Try to execute immediately
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeFlagCampaign(campaignId);
    }

    function test_CancelFlag() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        registry.initiateFlagCampaign(campaignId, "Terms violation");

        // Governance cancels
        vm.prank(governance);
        registry.cancelFlagCampaign(campaignId);

        (uint256 executeTime, ) = registry.getPendingFlag(campaignId);
        assertEq(executeTime, 0);
    }

    // ============================================================================
    // Governance Transfer Tests (7-day timelock)
    // ============================================================================

    function test_GovernanceTransferWithTimelock() public {
        address newGovernance = address(0x999);

        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Wait for timelock
        vm.warp(block.timestamp + 7 days);

        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);
    }

    function test_RevertWhen_GovernanceTransferBeforeTimelock() public {
        address newGovernance = address(0x999);

        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Try to execute immediately
        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    // ============================================================================
    // MEV Resistance Tests
    // ============================================================================

    function test_CampaignIdIncludesMsgSender() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        // Creator creates campaign
        vm.prank(creator);
        bytes32 campaignId1 = registry.createCampaign(IPFS_HASH, USA, actionIds);

        // Different user trying same parameters at same time gets different ID
        // (can't front-run because msg.sender is included in ID)
        bytes32 expectedId = keccak256(abi.encodePacked(
            creator,
            IPFS_HASH,
            USA,
            block.timestamp
        ));

        assertEq(campaignId1, expectedId);
    }

    // ============================================================================
    // View Function Tests
    // ============================================================================

    function test_GetCampaignForAction() public {
        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        assertEq(registry.getCampaignForAction(ACTION_ID_1), campaignId);
        assertEq(registry.getCampaignForAction(bytes32(uint256(0xDEAD))), bytes32(0));
    }

    function test_GetTemplateCount() public {
        bytes32[] memory actionIds = new bytes32[](3);
        actionIds[0] = ACTION_ID_1;
        actionIds[1] = ACTION_ID_2;
        actionIds[2] = bytes32(uint256(0xCCC));

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        assertEq(registry.getTemplateCount(campaignId), 3);
    }

    function test_TotalCampaignCounts() public {
        // Mark creator as verified
        vm.prank(governance);
        registry.setCreatorVerified(creator, true);

        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);

        assertEq(registry.totalCampaigns(), 1);
        assertEq(registry.verifiedCreatorCampaigns(), 1);
    }

    // ============================================================================
    // Fuzz Tests
    // ============================================================================

    function testFuzz_RateLimitEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 1 hours);

        bytes32[] memory actionIds1 = new bytes32[](1);
        actionIds1[0] = ACTION_ID_1;

        bytes32[] memory actionIds2 = new bytes32[](1);
        actionIds2[0] = ACTION_ID_2;

        vm.prank(creator);
        registry.createCampaign(IPFS_HASH, USA, actionIds1);

        vm.warp(block.timestamp + timeElapsed);

        vm.prank(creator);
        vm.expectRevert(CampaignRegistry.RateLimitExceeded.selector);
        registry.createCampaign(bytes32(uint256(0x999)), USA, actionIds2);
    }

    function testFuzz_FlagTimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 24 hours);

        bytes32[] memory actionIds = new bytes32[](1);
        actionIds[0] = ACTION_ID_1;

        vm.prank(creator);
        bytes32 campaignId = registry.createCampaign(IPFS_HASH, USA, actionIds);

        vm.prank(governance);
        registry.initiateFlagCampaign(campaignId, "Test");

        vm.warp(block.timestamp + timeElapsed);

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeFlagCampaign(campaignId);
    }
}
