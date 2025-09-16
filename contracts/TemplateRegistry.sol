// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title TemplateRegistry
 * @dev On-chain registry for message templates that track causation from creation to legislative impact
 * @notice This is the core infrastructure for proving "templates that change minds get funded"
 */
contract TemplateRegistry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");
    bytes32 public constant IMPACT_ORACLE_ROLE = keccak256("IMPACT_ORACLE_ROLE");
    
    struct Template {
        string ipfsHash;           // Content stored on IPFS
        address creator;           // Template creator
        uint256 creationBlock;     // When created
        uint256 usageCount;        // Times used in campaigns
        uint256 impactScore;       // Mind-changing potential (0-100)
        uint256 credibilityScore;  // From challenge market outcomes (0-100)
        bool deprecated;           // Lifecycle management
        uint256 totalStaked;       // Total VOTER staked on this template
    }
    
    struct TemplateChallenge {
        address challenger;
        address defender;
        uint256 challengerStake;
        uint256 supportStake;
        uint256 opposeStake;
        uint256 deadline;
        bool resolved;
        bool challengeSucceeded;
    }
    
    struct CampaignUsage {
        bytes32 templateId;
        uint256 participantCount;
        string district;
        uint256 timestamp;
        bytes32 campaignId;
    }
    
    struct LegislativeImpact {
        bytes32 templateId;
        string representative;
        bool directCitation;      // Template language appears verbatim
        bool positionChanged;      // Representative changed position
        uint256 confidenceScore;   // Causation confidence (0-100)
        uint256 timestamp;
    }
    
    struct CausalChain {
        bytes32 templateId;
        string legislatorId;
        uint256 citationTimestamp;    // When template language was cited
        string evidenceIPFS;           // IPFS hash of citation evidence
        uint256 confidenceScore;      // Causation confidence (0-100)
        bool voteChanged;              // Legislator changed vote after campaign
        uint256 treasuryAllocation;   // Funds allocated based on impact
        uint256 participantCount;     // Number of constituents who used template
        bool verified;                 // Verified by ImpactAgent
    }
    
    // State variables
    mapping(bytes32 => Template) public templates;
    mapping(bytes32 => TemplateChallenge) public challenges;
    mapping(bytes32 => CampaignUsage[]) public campaignHistory;
    mapping(bytes32 => LegislativeImpact[]) public impactHistory;
    mapping(address => bytes32[]) public creatorTemplates;
    mapping(bytes32 => mapping(address => uint256)) public userStakes;
    
    // Causal chain tracking
    mapping(bytes32 => CausalChain[]) public causalChains;
    mapping(bytes32 => uint256) public totalTreasuryAllocated; // templateId => total funds
    mapping(string => uint256) public legislatorResponsiveness; // legislatorId => responsiveness score
    
    bytes32[] public allTemplateIds;
    uint256 public templateCount;
    uint256 public minStakeAmount = 10 * 10**18; // 10 VOTER minimum
    uint256 public challengeDuration = 3 days;
    
    // Events
    event TemplateCreated(
        bytes32 indexed templateId,
        address indexed creator,
        string ipfsHash
    );
    
    event TemplateUsed(
        bytes32 indexed templateId,
        bytes32 indexed campaignId,
        uint256 participants
    );
    
    event ImpactRecorded(
        bytes32 indexed templateId,
        string representative,
        bool directCitation,
        uint256 confidence
    );
    
    event TemplateChallenged(
        bytes32 indexed templateId,
        address indexed challenger,
        uint256 stake
    );
    
    event ChallengeResolved(
        bytes32 indexed templateId,
        bool challengeSucceeded,
        uint256 redistributedStake
    );
    
    event CredibilityUpdated(
        bytes32 indexed templateId,
        uint256 oldScore,
        uint256 newScore
    );
    
    event CausalChainRecorded(
        bytes32 indexed templateId,
        string legislatorId,
        bool directCitation,
        bool voteChanged,
        uint256 confidenceScore
    );
    
    event TreasuryAllocated(
        bytes32 indexed templateId,
        string legislatorId,
        uint256 amount,
        string reason
    );
    
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CREATOR_ROLE, admin);
    }
    
    /**
     * @dev Create a new template
     * @param ipfsHash IPFS hash of template content
     * @return templateId Unique identifier for the template
     */
    function createTemplate(string memory ipfsHash) 
        external 
        whenNotPaused 
        returns (bytes32 templateId) 
    {
        require(bytes(ipfsHash).length > 0, "Empty IPFS hash");
        
        // Generate unique ID from content hash and creator
        templateId = keccak256(abi.encodePacked(ipfsHash, msg.sender, block.timestamp));
        
        require(templates[templateId].creationBlock == 0, "Template already exists");
        
        templates[templateId] = Template({
            ipfsHash: ipfsHash,
            creator: msg.sender,
            creationBlock: block.number,
            usageCount: 0,
            impactScore: 50, // Start neutral
            credibilityScore: 50, // Start neutral
            deprecated: false,
            totalStaked: 0
        });
        
        creatorTemplates[msg.sender].push(templateId);
        allTemplateIds.push(templateId);
        templateCount++;
        
        emit TemplateCreated(templateId, msg.sender, ipfsHash);
        
        return templateId;
    }
    
    /**
     * @dev Record template usage in a campaign
     * @param templateId Template being used
     * @param campaignId Unique campaign identifier
     * @param participantCount Number of participants
     * @param district Congressional district
     */
    function recordUsage(
        bytes32 templateId,
        bytes32 campaignId,
        uint256 participantCount,
        string memory district
    ) external onlyRole(IMPACT_ORACLE_ROLE) {
        require(templates[templateId].creationBlock > 0, "Template not found");
        require(!templates[templateId].deprecated, "Template deprecated");
        
        templates[templateId].usageCount += participantCount;
        
        campaignHistory[templateId].push(CampaignUsage({
            templateId: templateId,
            participantCount: participantCount,
            district: district,
            timestamp: block.timestamp,
            campaignId: campaignId
        }));
        
        emit TemplateUsed(templateId, campaignId, participantCount);
    }
    
    /**
     * @dev Record legislative impact of a template
     * @param templateId Template that caused impact
     * @param representative Representative who was influenced
     * @param directCitation Whether template language appears verbatim
     * @param positionChanged Whether representative changed position
     * @param confidenceScore Confidence in causation (0-100)
     */
    function recordImpact(
        bytes32 templateId,
        string memory representative,
        bool directCitation,
        bool positionChanged,
        uint256 confidenceScore
    ) external onlyRole(IMPACT_ORACLE_ROLE) {
        require(templates[templateId].creationBlock > 0, "Template not found");
        require(confidenceScore <= 100, "Invalid confidence score");
        
        impactHistory[templateId].push(LegislativeImpact({
            templateId: templateId,
            representative: representative,
            directCitation: directCitation,
            positionChanged: positionChanged,
            confidenceScore: confidenceScore,
            timestamp: block.timestamp
        }));
        
        // Update impact score based on evidence
        uint256 impactBoost = 0;
        if (directCitation) impactBoost += 30;
        if (positionChanged) impactBoost += 20;
        impactBoost = (impactBoost * confidenceScore) / 100;
        
        uint256 currentScore = templates[templateId].impactScore;
        uint256 newScore = currentScore + impactBoost;
        if (newScore > 100) newScore = 100;
        
        templates[templateId].impactScore = newScore;
        
        emit ImpactRecorded(templateId, representative, directCitation, confidenceScore);
    }
    
    /**
     * @dev Challenge a template's claims
     * @param templateId Template to challenge
     */
    function challengeTemplate(bytes32 templateId) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(templates[templateId].creationBlock > 0, "Template not found");
        require(!challenges[templateId].resolved, "Challenge already exists");
        require(msg.value >= minStakeAmount, "Insufficient stake");
        
        challenges[templateId] = TemplateChallenge({
            challenger: msg.sender,
            defender: templates[templateId].creator,
            challengerStake: msg.value,
            supportStake: 0,
            opposeStake: msg.value, // Challenger opposes
            deadline: block.timestamp + challengeDuration,
            resolved: false,
            challengeSucceeded: false
        });
        
        emit TemplateChallenged(templateId, msg.sender, msg.value);
    }
    
    /**
     * @dev Support or oppose a challenge
     * @param templateId Template under challenge
     * @param support True to support template, false to oppose
     */
    function stakeOnChallenge(bytes32 templateId, bool support) 
        external 
        payable 
        nonReentrant 
    {
        TemplateChallenge storage challenge = challenges[templateId];
        require(!challenge.resolved, "Challenge resolved");
        require(block.timestamp < challenge.deadline, "Challenge expired");
        require(msg.value > 0, "No stake provided");
        
        userStakes[templateId][msg.sender] += msg.value;
        
        if (support) {
            challenge.supportStake += msg.value;
        } else {
            challenge.opposeStake += msg.value;
        }
    }
    
    /**
     * @dev Resolve a challenge after deadline
     * @param templateId Template under challenge
     */
    function resolveChallenge(bytes32 templateId) external nonReentrant {
        TemplateChallenge storage challenge = challenges[templateId];
        require(!challenge.resolved, "Already resolved");
        require(block.timestamp >= challenge.deadline, "Challenge not expired");
        
        // Determine outcome based on stake weights
        bool challengeSucceeded = challenge.opposeStake > challenge.supportStake;
        challenge.resolved = true;
        challenge.challengeSucceeded = challengeSucceeded;
        
        // Update credibility based on outcome
        uint256 oldCredibility = templates[templateId].credibilityScore;
        uint256 newCredibility;
        
        if (challengeSucceeded) {
            // Challenge succeeded, reduce credibility
            newCredibility = oldCredibility > 20 ? oldCredibility - 20 : 0;
            templates[templateId].credibilityScore = newCredibility;
            
            // Challenger gets stake back plus portion of support stake
            uint256 winnerShare = challenge.challengerStake + (challenge.supportStake * 8 / 10);
            payable(challenge.challenger).transfer(winnerShare);
        } else {
            // Challenge failed, increase credibility
            newCredibility = oldCredibility < 80 ? oldCredibility + 20 : 100;
            templates[templateId].credibilityScore = newCredibility;
            
            // Defender and supporters win
            uint256 defenderShare = challenge.opposeStake * 5 / 10;
            payable(challenge.defender).transfer(defenderShare);
        }
        
        emit ChallengeResolved(templateId, challengeSucceeded, challenge.challengerStake + challenge.supportStake);
        emit CredibilityUpdated(templateId, oldCredibility, newCredibility);
    }
    
    /**
     * @dev Calculate total impact score for reputation tracking
     * @param templateId Template to evaluate
     * @return totalImpact Weighted impact score for reputation only
     */
    function calculateReputationImpact(bytes32 templateId) 
        external 
        view 
        returns (uint256 totalImpact) 
    {
        Template memory template = templates[templateId];
        
        // Weight factors: usage (20%), impact (40%), credibility (40%)
        // This score affects reputation, not financial rewards
        uint256 usageScore = template.usageCount > 10000 ? 100 : template.usageCount / 100;
        
        totalImpact = (usageScore * 20 + 
                      template.impactScore * 40 + 
                      template.credibilityScore * 40) / 100;
        
        return totalImpact;
    }
    
    /**
     * @dev Get all templates by creator
     * @param creator Address of template creator
     * @return Template IDs created by this address
     */
    function getCreatorTemplates(address creator) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return creatorTemplates[creator];
    }
    
    /**
     * @dev Get campaign history for a template
     * @param templateId Template to query
     * @return Array of campaign usage records
     */
    function getCampaignHistory(bytes32 templateId) 
        external 
        view 
        returns (CampaignUsage[] memory) 
    {
        return campaignHistory[templateId];
    }
    
    /**
     * @dev Get legislative impact history
     * @param templateId Template to query
     * @return Array of legislative impact records
     */
    function getImpactHistory(bytes32 templateId) 
        external 
        view 
        returns (LegislativeImpact[] memory) 
    {
        return impactHistory[templateId];
    }
    
    /**
     * @dev Deprecate a template (only creator or admin)
     * @param templateId Template to deprecate
     */
    function deprecateTemplate(bytes32 templateId) external {
        require(
            msg.sender == templates[templateId].creator || 
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        
        templates[templateId].deprecated = true;
    }
    
    /**
     * @dev Update minimum stake amount (admin only)
     * @param newMinStake New minimum stake in wei
     */
    function updateMinStake(uint256 newMinStake) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        minStakeAmount = newMinStake;
    }
    
    /**
     * @dev Emergency pause (admin only)
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause (admin only)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Enhanced recordImpact with causal chain tracking
     * @param templateId Template that had impact
     * @param representative Representative influenced
     * @param directCitation Template language appeared verbatim
     * @param positionChanged Representative changed position
     * @param confidenceScore Confidence in causation (0-100)
     * @param evidenceIPFS IPFS hash of evidence
     */
    function recordImpactWithEvidence(
        bytes32 templateId,
        string memory representative,
        bool directCitation,
        bool positionChanged,
        uint256 confidenceScore,
        string memory evidenceIPFS
    ) external onlyRole(IMPACT_ORACLE_ROLE) {
        // Call original recordImpact
        this.recordImpact(templateId, representative, directCitation, positionChanged, confidenceScore);
        
        // Add causal chain tracking
        uint256 participantCount = _getTotalParticipants(templateId);
        
        causalChains[templateId].push(CausalChain({
            templateId: templateId,
            legislatorId: representative,
            citationTimestamp: block.timestamp,
            evidenceIPFS: evidenceIPFS,
            confidenceScore: confidenceScore,
            voteChanged: positionChanged,
            treasuryAllocation: 0,
            participantCount: participantCount,
            verified: true
        }));
        
        // Update legislator responsiveness
        if (positionChanged) {
            legislatorResponsiveness[representative] += confidenceScore;
        }
        
        emit CausalChainRecorded(templateId, representative, directCitation, positionChanged, confidenceScore);
    }
    
    /**
     * @dev Allocate treasury funds based on verified impact
     * @param templateId Template that changed minds
     * @param legislatorId Legislator who learned
     * @param amount Amount to allocate
     * @param reason Reason for allocation
     */
    function allocateTreasuryFunds(
        bytes32 templateId,
        string memory legislatorId,
        uint256 amount,
        string memory reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(causalChains[templateId].length > 0, "No causal chain recorded");
        
        // Find the relevant causal chain
        bool found = false;
        for (uint256 i = 0; i < causalChains[templateId].length; i++) {
            if (keccak256(bytes(causalChains[templateId][i].legislatorId)) == 
                keccak256(bytes(legislatorId))) {
                causalChains[templateId][i].treasuryAllocation += amount;
                found = true;
                break;
            }
        }
        
        require(found, "Legislator not in causal chain");
        
        totalTreasuryAllocated[templateId] += amount;
        
        emit TreasuryAllocated(templateId, legislatorId, amount, reason);
    }
    
    /**
     * @dev Get total participants across all campaigns for a template
     */
    function _getTotalParticipants(bytes32 templateId) internal view returns (uint256) {
        uint256 total = 0;
        CampaignUsage[] memory campaigns = campaignHistory[templateId];
        for (uint256 i = 0; i < campaigns.length; i++) {
            total += campaigns[i].participantCount;
        }
        return total;
    }
    
    /**
     * @dev Get causal chains for a template
     */
    function getCausalChains(bytes32 templateId) external view returns (CausalChain[] memory) {
        return causalChains[templateId];
    }
    
    /**
     * @dev Get legislator responsiveness score
     */
    function getLegislatorResponsiveness(string memory legislatorId) external view returns (uint256) {
        return legislatorResponsiveness[legislatorId];
    }
    
    /**
     * @dev Get total treasury allocated for a template
     */
    function getTotalTreasuryAllocated(bytes32 templateId) external view returns (uint256) {
        return totalTreasuryAllocated[templateId];
    }
}