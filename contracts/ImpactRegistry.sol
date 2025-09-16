// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERRegistry.sol";

/**
 * @title ImpactRegistry
 * @dev Tracks civic impact without financial implications—pure information
 * @notice All data public for any observer to read and interpret independently
 */
contract ImpactRegistry is AccessControl, Pausable {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    
    struct TemplateImpact {
        uint256 usageCount;
        uint256 citationCount;
        uint256 verifiedAppearances; // In public records
        uint256 lastUpdated;
        mapping(string => bool) citations; // Prevent duplicates
    }
    
    struct RepresentativeResponse {
        string name;
        string district;
        uint256 messagesReceived;
        uint256 positionChanges;
        uint256 citedTemplates;
        uint256 responsivenessScore; // 0-100, calculated from observed behavior
        uint256 lastInteraction;
    }
    
    struct ParticipantImpact {
        address participant;
        uint256 messagesS

;
        uint256 templatesCreated;
        uint256 successfulChallenges;
        uint256 citationsEarned;
        uint256 impactScore; // 0-100, non-financial reputation
    }
    
    // Public readable state—no financial implications
    mapping(bytes32 => TemplateImpact) public templateImpacts;
    mapping(string => RepresentativeResponse) public representativeResponses;
    mapping(address => ParticipantImpact) public participantImpacts;
    
    // Track relationships without financial meaning
    mapping(bytes32 => string[]) public templateToRepresentatives;
    mapping(string => bytes32[]) public representativeToTemplates;
    mapping(address => bytes32[]) public participantTemplates;
    
    uint256 public totalTemplates;
    uint256 public totalCitations;
    uint256 public totalPositionChanges;
    
    // Events for transparency—all data public
    event TemplateUsageRecorded(
        bytes32 indexed templateId,
        address indexed user,
        string representative
    );
    
    event CitationRecorded(
        bytes32 indexed templateId,
        string source,
        string context,
        uint256 timestamp
    );
    
    event PositionChangeObserved(
        string representative,
        bytes32 templateId,
        string previousPosition,
        string newPosition,
        uint256 timestamp
    );
    
    event ImpactScoreUpdated(
        address indexed participant,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );
    
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RECORDER_ROLE, admin);
    }
    
    /**
     * @dev Record template usage in congressional communication
     * @param templateId Template that was used
     * @param user Address that used the template
     * @param representative Target representative
     */
    function recordTemplateUsage(
        bytes32 templateId,
        address user,
        string memory representative
    ) external onlyRole(RECORDER_ROLE) {
        TemplateImpact storage impact = templateImpacts[templateId];
        impact.usageCount++;
        impact.lastUpdated = block.timestamp;
        
        // Track relationships
        templateToRepresentatives[templateId].push(representative);
        representativeToTemplates[representative].push(templateId);
        
        // Update representative metrics
        RepresentativeResponse storage rep = representativeResponses[representative];
        rep.messagesReceived++;
        rep.lastInteraction = block.timestamp;
        
        // Update participant metrics (non-financial)
        ParticipantImpact storage participant = participantImpacts[user];
        participant.messagesSent++;
        
        emit TemplateUsageRecorded(templateId, user, representative);
    }
    
    /**
     * @dev Record citation of template language in public record
     * @param templateId Template that was cited
     * @param source Where citation appeared (e.g., "House Floor Speech")
     * @param context Context of citation
     * @param citationId Unique identifier to prevent duplicates
     */
    function recordCitation(
        bytes32 templateId,
        string memory source,
        string memory context,
        string memory citationId
    ) external onlyRole(RECORDER_ROLE) {
        TemplateImpact storage impact = templateImpacts[templateId];
        
        // Prevent duplicate citations
        require(!impact.citations[citationId], "Citation already recorded");
        
        impact.citations[citationId] = true;
        impact.citationCount++;
        impact.verifiedAppearances++;
        impact.lastUpdated = block.timestamp;
        
        totalCitations++;
        
        emit CitationRecorded(templateId, source, context, block.timestamp);
    }
    
    /**
     * @dev Record observed position change by representative
     * @param representative Name of representative
     * @param templateId Template that may have influenced change
     * @param previousPosition Previous stance
     * @param newPosition New stance
     */
    function recordPositionChange(
        string memory representative,
        bytes32 templateId,
        string memory previousPosition,
        string memory newPosition
    ) external onlyRole(RECORDER_ROLE) {
        RepresentativeResponse storage rep = representativeResponses[representative];
        rep.positionChanges++;
        rep.citedTemplates++;
        
        // Update template impact
        TemplateImpact storage impact = templateImpacts[templateId];
        impact.verifiedAppearances++;
        
        totalPositionChanges++;
        
        // Calculate new responsiveness score (simplified)
        rep.responsivenessScore = calculateResponsivenessScore(
            rep.messagesReceived,
            rep.positionChanges,
            rep.citedTemplates
        );
        
        emit PositionChangeObserved(
            representative,
            templateId,
            previousPosition,
            newPosition,
            block.timestamp
        );
    }
    
    /**
     * @dev Update participant impact score based on contributions
     * @param participant Address to update
     * @param reason Reason for update
     */
    function updateParticipantImpact(
        address participant,
        string memory reason
    ) external onlyRole(RECORDER_ROLE) {
        ParticipantImpact storage impact = participantImpacts[participant];
        
        uint256 oldScore = impact.impactScore;
        
        // Calculate new score based on various factors (non-financial)
        uint256 newScore = calculateImpactScore(
            impact.messagesSent,
            impact.templatesCreated,
            impact.successfulChallenges,
            impact.citationsEarned
        );
        
        impact.impactScore = newScore;
        
        emit ImpactScoreUpdated(participant, oldScore, newScore, reason);
    }
    
    /**
     * @dev Calculate responsiveness score for representative
     * @param messagesReceived Total messages received
     * @param positionChanges Number of position changes
     * @param citedTemplates Number of templates cited
     */
    function calculateResponsivenessScore(
        uint256 messagesReceived,
        uint256 positionChanges,
        uint256 citedTemplates
    ) internal pure returns (uint256) {
        if (messagesReceived == 0) return 50; // Neutral if no interaction
        
        // Weight position changes and citations
        uint256 score = 50; // Base score
        score += (positionChanges * 10); // Each position change adds value
        score += (citedTemplates * 5); // Each citation adds value
        
        // Cap at 100
        return score > 100 ? 100 : score;
    }
    
    /**
     * @dev Calculate impact score for participant
     * @param messagesSent Number of messages sent
     * @param templatesCreated Number of templates created
     * @param challenges Successful challenges
     * @param citations Citations earned
     */
    function calculateImpactScore(
        uint256 messagesSent,
        uint256 templatesCreated,
        uint256 challenges,
        uint256 citations
    ) internal pure returns (uint256) {
        uint256 score = 0;
        
        // Weight different contributions
        score += messagesSent / 10; // Participation
        score += templatesCreated * 5; // Creation
        score += challenges * 10; // Quality control
        score += citations * 20; // Verified impact
        
        // Cap at 100
        return score > 100 ? 100 : score;
    }
    
    /**
     * @dev Get template impact data
     * @param templateId Template to query
     */
    function getTemplateImpact(bytes32 templateId) 
        external 
        view 
        returns (
            uint256 usageCount,
            uint256 citationCount,
            uint256 verifiedAppearances,
            uint256 lastUpdated
        ) 
    {
        TemplateImpact storage impact = templateImpacts[templateId];
        return (
            impact.usageCount,
            impact.citationCount,
            impact.verifiedAppearances,
            impact.lastUpdated
        );
    }
    
    /**
     * @dev Get all representatives influenced by a template
     * @param templateId Template to query
     */
    function getTemplateRepresentatives(bytes32 templateId) 
        external 
        view 
        returns (string[] memory) 
    {
        return templateToRepresentatives[templateId];
    }
    
    /**
     * @dev Get all templates that influenced a representative
     * @param representative Representative to query
     */
    function getRepresentativeTemplates(string memory representative) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return representativeToTemplates[representative];
    }
    
    /**
     * @dev Pause registry
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause registry
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}