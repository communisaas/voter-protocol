// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import "./TimelockGovernance.sol";

/// @title CampaignRegistry
/// @notice On-chain coordination primitive for civic campaigns
/// @dev Phase 1.5 implementation - bridges off-chain templates to on-chain verification
///
/// ARCHITECTURE:
/// - Campaigns group related templates (actions) under unified coordination
/// - Templates are identified by actionId = Poseidon2(templateId) from Communique
/// - Participant counts aggregated from DistrictGate verifications
/// - Append-only design: campaigns cannot be deleted or modified after creation
///
/// PHASE 1 SECURITY MODEL (Honest):
/// - Single point of failure: Founder key compromise = governance compromise
/// - Mitigation: 24h flag timelock gives community visibility before action
/// - Rate limiting prevents spam (1 campaign per address per hour)
/// - Templates locked at creation (no post-hoc manipulation)
/// - NO nation-state resistance until Phase 2 (requires real multi-jurisdiction guardians)
///
/// SYBIL RESISTANCE:
/// - Tracks both participant count and unique district count
/// - Harder to inflate metrics across geographic boundaries
/// - Integrates with Phase 2 verified creator status
///
/// GAS OPTIMIZATION:
/// - Struct packing: Campaign fits in 4 storage slots
/// - Immutable templates: no array modifications after creation
/// - View functions for off-chain queries (zero gas)
///
/// UPGRADE PATH (Phase 2+):
/// - Add GuardianShield for campaign flag veto power
/// - Guardians must be humans in different legal jurisdictions
contract CampaignRegistry is Pausable, ReentrancyGuard, TimelockGovernance {
    // ============================================================================
    // Types
    // ============================================================================

    enum CampaignStatus {
        Active,     // 0: Accepting new participation
        Paused,     // 1: Temporarily suspended (governance action)
        Completed   // 2: Campaign ended (creator action)
    }

    /// @notice Campaign data structure (4 storage slots)
    /// @dev Packed for gas efficiency
    struct Campaign {
        address creator;              // 20 bytes - slot 1
        bytes3 country;               // 3 bytes  - slot 1 (packed)
        uint64 createdAt;             // 8 bytes  - slot 1 (packed)
        CampaignStatus status;        // 1 byte   - slot 1 (packed)
        bytes32 ipfsMetadataHash;     // 32 bytes - slot 2
        uint256 participantCount;     // 32 bytes - slot 3
        uint256 districtCount;        // 32 bytes - slot 4
    }

    /// @notice Pending flag data for timelocked flagging
    struct PendingFlag {
        uint256 executeTime;
        string reason;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice Campaign storage: campaignId => Campaign
    mapping(bytes32 => Campaign) public campaigns;

    /// @notice Templates for each campaign: campaignId => actionIds[]
    /// @dev Set once at creation, immutable thereafter
    mapping(bytes32 => bytes32[]) internal _campaignTemplates;

    /// @notice Reverse lookup: actionId => campaignId
    /// @dev Enables DistrictGate to find campaign from action
    mapping(bytes32 => bytes32) public actionToCampaign;

    /// @notice Track unique districts per campaign: campaignId => districtRoot => seen
    mapping(bytes32 => mapping(bytes32 => bool)) public campaignDistrictSeen;

    /// @notice Rate limiting: address => last campaign creation timestamp
    mapping(address => uint256) public lastCampaignTime;

    /// @notice Whitelisted creators (exempt from rate limiting)
    mapping(address => bool) public whitelistedCreators;

    /// @notice Verified creators (Phase 2 identity integration)
    mapping(address => bool) public verifiedCreators;

    /// @notice Flagged campaigns (visible but marked)
    mapping(bytes32 => bool) public flaggedCampaigns;

    /// @notice Flag reasons
    mapping(bytes32 => string) public flagReasons;

    /// @notice Pending flags (24h timelock)
    mapping(bytes32 => PendingFlag) public pendingFlags;

    /// @notice Authorized callers (DistrictGate)
    mapping(address => bool) public authorizedCallers;

    /// @notice Total campaign counts
    uint256 public totalCampaigns;
    uint256 public verifiedCreatorCampaigns;

    // ============================================================================
    // Constants
    // ============================================================================

    /// @notice Rate limit: 1 campaign per hour per address
    uint256 public constant CAMPAIGN_COOLDOWN = 1 hours;

    /// @notice Flag timelock (community can see and respond)
    uint256 public constant FLAG_TIMELOCK = 24 hours;

    /// @notice Maximum templates per campaign (gas limit protection)
    uint256 public constant MAX_TEMPLATES_PER_CAMPAIGN = 50;

    // ============================================================================
    // Events
    // ============================================================================

    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed creator,
        bytes3 indexed country,
        bytes32 ipfsMetadataHash,
        uint256 templateCount
    );

    event CampaignStatusChanged(
        bytes32 indexed campaignId,
        CampaignStatus previousStatus,
        CampaignStatus newStatus
    );

    event ParticipantRecorded(
        bytes32 indexed campaignId,
        bytes32 indexed actionId,
        bytes32 indexed districtRoot,
        bool newDistrict
    );

    event FlagInitiated(
        bytes32 indexed campaignId,
        string reason,
        uint256 executeTime
    );

    event CampaignFlagged(
        bytes32 indexed campaignId,
        string reason
    );

    event FlagCancelled(bytes32 indexed campaignId);

    event CreatorWhitelisted(address indexed creator, bool status);
    event CreatorVerified(address indexed creator, bool status);
    event CallerAuthorized(address indexed caller, bool status);

    // ============================================================================
    // Errors
    // ============================================================================

    // Note: UnauthorizedCaller inherited from TimelockGovernance
    error CampaignAlreadyExists();
    error CampaignNotFound();
    error InvalidCountryCode();
    error InvalidMetadataHash();
    error NoTemplatesProvided();
    error TooManyTemplates();
    error TemplateAlreadyLinked();
    error RateLimitExceeded();
    error NotCampaignCreator();
    error CampaignNotActive();
    error FlagNotInitiated();
    error AlreadyFlagged();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyAuthorizedCaller() {
        if (!authorizedCallers[msg.sender]) revert UnauthorizedCaller();
        _;
    }

    modifier onlyCampaignCreator(bytes32 campaignId) {
        if (campaigns[campaignId].creator != msg.sender) revert NotCampaignCreator();
        _;
    }

    modifier campaignExists(bytes32 campaignId) {
        if (campaigns[campaignId].createdAt == 0) revert CampaignNotFound();
        _;
    }

    modifier campaignActive(bytes32 campaignId) {
        if (campaigns[campaignId].status != CampaignStatus.Active) revert CampaignNotActive();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @notice Deploy CampaignRegistry with governance
    /// @param _governance Governance address (initially founder, later multisig)
    constructor(address _governance) {
        _initializeGovernance(_governance);
        authorizedCallers[_governance] = true;
    }

    // ============================================================================
    // Campaign Creation
    // ============================================================================

    /// @notice Create a new campaign with templates locked at creation
    /// @param ipfsMetadataHash IPFS CID of campaign metadata (title, description, etc.)
    /// @param country ISO 3166-1 alpha-3 country code
    /// @param templateActionIds Array of template action IDs (Poseidon2 hashes)
    /// @return campaignId Unique campaign identifier
    /// @dev Templates are immutable after creation - no post-hoc manipulation
    function createCampaign(
        bytes32 ipfsMetadataHash,
        bytes3 country,
        bytes32[] calldata templateActionIds
    ) external whenNotPaused nonReentrant returns (bytes32 campaignId) {
        // Input validation
        if (ipfsMetadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (country == bytes3(0)) revert InvalidCountryCode();
        if (templateActionIds.length == 0) revert NoTemplatesProvided();
        if (templateActionIds.length > MAX_TEMPLATES_PER_CAMPAIGN) revert TooManyTemplates();

        // Rate limiting (whitelisted creators exempt)
        // Skip check if first campaign (lastCampaignTime == 0) or enough time has passed
        if (!whitelistedCreators[msg.sender]) {
            uint256 lastTime = lastCampaignTime[msg.sender];
            if (lastTime != 0 && block.timestamp < lastTime + CAMPAIGN_COOLDOWN) {
                revert RateLimitExceeded();
            }
        }
        lastCampaignTime[msg.sender] = block.timestamp;

        // Generate campaign ID (includes msg.sender to prevent front-running)
        campaignId = keccak256(abi.encodePacked(
            msg.sender,
            ipfsMetadataHash,
            country,
            block.timestamp
        ));

        // Ensure no collision (astronomically unlikely but check anyway)
        if (campaigns[campaignId].createdAt != 0) revert CampaignAlreadyExists();

        // Verify templates are not already linked to other campaigns
        for (uint256 i = 0; i < templateActionIds.length; ) {
            bytes32 actionId = templateActionIds[i];
            if (actionToCampaign[actionId] != bytes32(0)) revert TemplateAlreadyLinked();

            // Link template to this campaign
            actionToCampaign[actionId] = campaignId;
            _campaignTemplates[campaignId].push(actionId);

            unchecked { ++i; }
        }

        // Store campaign
        campaigns[campaignId] = Campaign({
            creator: msg.sender,
            country: country,
            createdAt: uint64(block.timestamp),
            status: CampaignStatus.Active,
            ipfsMetadataHash: ipfsMetadataHash,
            participantCount: 0,
            districtCount: 0
        });

        // Update counts
        totalCampaigns++;
        if (verifiedCreators[msg.sender]) {
            verifiedCreatorCampaigns++;
        }

        emit CampaignCreated(
            campaignId,
            msg.sender,
            country,
            ipfsMetadataHash,
            templateActionIds.length
        );
    }

    // ============================================================================
    // Participation Recording (Called by DistrictGate)
    // ============================================================================

    /// @notice Record a verified participation from DistrictGate
    /// @param actionId Template action ID from ZK proof
    /// @param districtRoot District Merkle root from proof
    /// @dev Only callable by authorized contracts (DistrictGate)
    ///      Tracks both participant count and unique district count
    function recordParticipation(
        bytes32 actionId,
        bytes32 districtRoot
    ) external onlyAuthorizedCaller whenNotPaused nonReentrant {
        bytes32 campaignId = actionToCampaign[actionId];

        // Action may not be linked to any campaign (permissionless actions still work)
        if (campaignId == bytes32(0)) return;

        // Only record for active campaigns
        if (campaigns[campaignId].status != CampaignStatus.Active) return;

        // Increment participant count
        campaigns[campaignId].participantCount++;

        // Track unique districts (Sybil resistance metric)
        bool newDistrict = false;
        if (!campaignDistrictSeen[campaignId][districtRoot]) {
            campaignDistrictSeen[campaignId][districtRoot] = true;
            campaigns[campaignId].districtCount++;
            newDistrict = true;
        }

        emit ParticipantRecorded(campaignId, actionId, districtRoot, newDistrict);
    }

    // ============================================================================
    // Campaign Management (Creator)
    // ============================================================================

    /// @notice Mark campaign as completed (creator only)
    /// @param campaignId Campaign to complete
    function completeCampaign(bytes32 campaignId)
        external
        campaignExists(campaignId)
        onlyCampaignCreator(campaignId)
    {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status == CampaignStatus.Completed) return;

        CampaignStatus previousStatus = campaign.status;
        campaign.status = CampaignStatus.Completed;

        emit CampaignStatusChanged(campaignId, previousStatus, CampaignStatus.Completed);
    }

    // ============================================================================
    // Governance Functions
    // ============================================================================

    /// @notice Pause a campaign (governance only, immediate)
    /// @param campaignId Campaign to pause
    /// @dev Use for emergency situations. Does not require timelock.
    function pauseCampaign(bytes32 campaignId)
        external
        onlyGovernance
        campaignExists(campaignId)
    {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Active) return;

        CampaignStatus previousStatus = campaign.status;
        campaign.status = CampaignStatus.Paused;

        emit CampaignStatusChanged(campaignId, previousStatus, CampaignStatus.Paused);
    }

    /// @notice Unpause a campaign (governance only)
    /// @param campaignId Campaign to unpause
    function unpauseCampaign(bytes32 campaignId)
        external
        onlyGovernance
        campaignExists(campaignId)
    {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Paused) return;

        campaign.status = CampaignStatus.Active;

        emit CampaignStatusChanged(campaignId, CampaignStatus.Paused, CampaignStatus.Active);
    }

    /// @notice Initiate campaign flagging (24h timelock)
    /// @param campaignId Campaign to flag
    /// @param reason Public reason for flagging
    /// @dev Community has 24h to see the pending flag before execution
    function initiateFlagCampaign(bytes32 campaignId, string calldata reason)
        external
        onlyGovernance
        campaignExists(campaignId)
    {
        if (flaggedCampaigns[campaignId]) revert AlreadyFlagged();

        uint256 executeTime = block.timestamp + FLAG_TIMELOCK;
        pendingFlags[campaignId] = PendingFlag({
            executeTime: executeTime,
            reason: reason
        });

        emit FlagInitiated(campaignId, reason, executeTime);
    }

    /// @notice Execute pending flag (after 24h timelock)
    /// @param campaignId Campaign to flag
    function executeFlagCampaign(bytes32 campaignId) external {
        PendingFlag storage pending = pendingFlags[campaignId];
        if (pending.executeTime == 0) revert FlagNotInitiated();
        if (block.timestamp < pending.executeTime) revert TimelockNotExpired();

        flaggedCampaigns[campaignId] = true;
        flagReasons[campaignId] = pending.reason;

        string memory reason = pending.reason;
        delete pendingFlags[campaignId];

        emit CampaignFlagged(campaignId, reason);
    }

    /// @notice Cancel pending flag
    /// @param campaignId Campaign with pending flag
    function cancelFlagCampaign(bytes32 campaignId) external onlyGovernance {
        if (pendingFlags[campaignId].executeTime == 0) revert FlagNotInitiated();

        delete pendingFlags[campaignId];

        emit FlagCancelled(campaignId);
    }

    /// @notice Whitelist a creator (exempt from rate limiting)
    /// @param creator Address to whitelist
    /// @param status Whitelist status
    function setCreatorWhitelist(address creator, bool status) external onlyGovernance {
        if (creator == address(0)) revert ZeroAddress();
        whitelistedCreators[creator] = status;
        emit CreatorWhitelisted(creator, status);
    }

    /// @notice Mark creator as verified (Phase 2 identity integration)
    /// @param creator Address to verify
    /// @param status Verification status
    function setCreatorVerified(address creator, bool status) external onlyGovernance {
        if (creator == address(0)) revert ZeroAddress();
        verifiedCreators[creator] = status;
        emit CreatorVerified(creator, status);
    }

    /// @notice Authorize a caller (e.g., DistrictGate)
    /// @param caller Address to authorize
    function authorizeCaller(address caller) external onlyGovernance {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller, true);
    }

    /// @notice Revoke caller authorization
    /// @param caller Address to revoke
    function revokeCaller(address caller) external onlyGovernance {
        authorizedCallers[caller] = false;
        emit CallerAuthorized(caller, false);
    }

    // ============================================================================
    // Pause Controls
    // ============================================================================

    /// @notice Pause contract (governance only)
    function pause() external onlyGovernance {
        _pause();
    }

    /// @notice Unpause contract (governance only)
    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Get campaign details
    /// @param campaignId Campaign identifier
    /// @return creator Campaign creator address
    /// @return country Country code
    /// @return createdAt Creation timestamp
    /// @return status Campaign status
    /// @return ipfsMetadataHash IPFS metadata hash
    /// @return participantCount Total participants
    /// @return districtCount Unique districts
    function getCampaign(bytes32 campaignId) external view returns (
        address creator,
        bytes3 country,
        uint64 createdAt,
        CampaignStatus status,
        bytes32 ipfsMetadataHash,
        uint256 participantCount,
        uint256 districtCount
    ) {
        Campaign storage c = campaigns[campaignId];
        return (
            c.creator,
            c.country,
            c.createdAt,
            c.status,
            c.ipfsMetadataHash,
            c.participantCount,
            c.districtCount
        );
    }

    /// @notice Get templates for a campaign
    /// @param campaignId Campaign identifier
    /// @return Array of template action IDs
    function getCampaignTemplates(bytes32 campaignId) external view returns (bytes32[] memory) {
        return _campaignTemplates[campaignId];
    }

    /// @notice Get template count for a campaign
    /// @param campaignId Campaign identifier
    /// @return Number of templates
    function getTemplateCount(bytes32 campaignId) external view returns (uint256) {
        return _campaignTemplates[campaignId].length;
    }

    /// @notice Get campaign for an action
    /// @param actionId Template action ID
    /// @return campaignId (bytes32(0) if not linked)
    function getCampaignForAction(bytes32 actionId) external view returns (bytes32) {
        return actionToCampaign[actionId];
    }

    /// @notice Check if campaign is flagged
    /// @param campaignId Campaign identifier
    /// @return flagged Whether campaign is flagged
    /// @return reason Flag reason (empty if not flagged)
    function isFlagged(bytes32 campaignId) external view returns (bool flagged, string memory reason) {
        return (flaggedCampaigns[campaignId], flagReasons[campaignId]);
    }

    /// @notice Check if address is authorized caller
    /// @param caller Address to check
    /// @return True if authorized
    function isAuthorizedCaller(address caller) external view returns (bool) {
        return authorizedCallers[caller];
    }

    /// @notice Get pending flag info
    /// @param campaignId Campaign identifier
    /// @return executeTime When flag can be executed (0 if none pending)
    /// @return reason Pending flag reason
    function getPendingFlag(bytes32 campaignId) external view returns (uint256 executeTime, string memory reason) {
        PendingFlag storage pending = pendingFlags[campaignId];
        return (pending.executeTime, pending.reason);
    }
}
