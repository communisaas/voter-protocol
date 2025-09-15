// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./IdentityRegistry.sol";

/**
 * @title CivicActionRegistry
 * @dev Adapted from ERC-8004 Reputation Registry for human civic actions
 * @notice Lightweight event emission for civic participation tracking
 * 
 * ERC-8004 Reputation Registry → VOTER CivicActionRegistry mapping:
 * - AcceptFeedback() → recordCivicAction()
 * - AgentClientID/AgentServerID → participantId/verifierId
 * - FeedbackDataURI → actionDataHash (on-chain hash, off-chain data)
 * - AuthFeedback event → CivicActionRecorded event
 * 
 * KEY DESIGN DECISION: Following ERC-8004's pattern of minimal on-chain storage
 * Most data lives in events for off-chain indexing (The Graph, etc.)
 * 
 * What we implement:
 * - Lightweight civic action recording
 * - Pre-authorization for sensitive actions
 * - Event-based data model
 * 
 * What we STUB:
 * - Complex feedback scoring (done off-chain)
 * - Validation mechanisms (see ValidationRegistry)
 * - Reputation aggregation (computed off-chain from events)
 */
contract CivicActionRegistry is AccessControl, Pausable {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    
    // Reference to IdentityRegistry for participant validation
    IdentityRegistry public immutable identityRegistry;
    
    // Action types for civic participation
    enum ActionType {
        CWC_MESSAGE,        // Contacted representative via CWC
        TOWN_HALL,          // Attended town hall
        PUBLIC_COMMENT,     // Submitted public comment
        PETITION,           // Signed/created petition
        VOLUNTEER,          // Volunteered for civic cause
        RESEARCH,           // Contributed research/analysis
        MOBILIZATION,       // Organized community action
        OTHER              // Catch-all for edge cases
    }
    
    // Minimal on-chain storage (ERC-8004 pattern)
    uint256 private _nextActionId = 1;
    
    // Authorization storage (following ERC-8004's pre-authorization pattern)
    // Hash of (participantId, actionType, verifierId) → authorized
    mapping(bytes32 => bool) public actionAuthorizations;
    
    // Basic action tracking (minimal storage)
    mapping(uint256 => uint256) public actionToParticipant;
    mapping(uint256 => uint256[]) public participantActions;
    
    // Statistics
    uint256 public totalActions;
    mapping(ActionType => uint256) public actionTypeCounts;
    
    // Events (primary data storage following ERC-8004)
    event CivicActionRecorded(
        uint256 indexed actionId,
        uint256 indexed participantId,
        ActionType indexed actionType,
        bytes32 actionDataHash,      // Hash of off-chain data
        uint256 timestamp,
        address verifier
    );
    
    event ActionAuthorized(
        uint256 indexed participantId,
        ActionType actionType,
        address indexed authorizedBy,
        uint256 expiryTime
    );
    
    event ActionChallenged(
        uint256 indexed actionId,
        address indexed challenger,
        string reason
    );
    
    constructor(address _identityRegistry, address admin) {
        identityRegistry = IdentityRegistry(_identityRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        _grantRole(RECORDER_ROLE, admin);
    }
    
    /**
     * @dev Record a civic action (adapted from ERC-8004's AcceptFeedback)
     * @param participantId ID from IdentityRegistry
     * @param actionType Type of civic action
     * @param actionDataHash Hash of off-chain evidence/details
     * @return actionId Unique action identifier
     * 
     * NOTE: In ERC-8004, Server Agent pre-authorizes Client Agent
     * Here, participants can pre-authorize verifiers for sensitive actions
     */
    function recordCivicAction(
        uint256 participantId,
        ActionType actionType,
        bytes32 actionDataHash
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused returns (uint256) {
        // Validate participant exists and is active
        (address participantAddress,,, bool isActive) = identityRegistry.getParticipant(participantId);
        require(participantAddress != address(0), "Invalid participant");
        require(isActive, "Participant not active");
        require(actionDataHash != bytes32(0), "Invalid data hash");
        
        // Check if action requires pre-authorization
        bytes32 authKey = keccak256(abi.encodePacked(
            participantId,
            actionType,
            msg.sender
        ));
        
        // For sensitive actions, check authorization
        if (actionType == ActionType.PETITION || actionType == ActionType.MOBILIZATION) {
            require(actionAuthorizations[authKey], "Action not authorized");
            // Consume authorization (one-time use)
            actionAuthorizations[authKey] = false;
        }
        
        uint256 actionId = _nextActionId++;
        
        // Minimal on-chain storage
        actionToParticipant[actionId] = participantId;
        participantActions[participantId].push(actionId);
        
        // Update statistics
        totalActions++;
        actionTypeCounts[actionType]++;
        
        // Emit event (primary data storage)
        emit CivicActionRecorded(
            actionId,
            participantId,
            actionType,
            actionDataHash,
            block.timestamp,
            msg.sender
        );
        
        return actionId;
    }
    
    /**
     * @dev Pre-authorize a verifier to record specific action
     * @param actionType Type of action to authorize
     * @param verifier Address allowed to record this action
     * 
     * Follows ERC-8004's pre-authorization pattern
     * Participants control who can attest to their actions
     */
    function authorizeAction(
        ActionType actionType,
        address verifier
    ) external whenNotPaused {
        // Get participant ID from sender
        (uint256 participantId,,,) = identityRegistry.resolveByAddress(msg.sender);
        require(participantId != 0, "Not registered");
        
        bytes32 authKey = keccak256(abi.encodePacked(
            participantId,
            actionType,
            verifier
        ));
        
        actionAuthorizations[authKey] = true;
        
        emit ActionAuthorized(
            participantId,
            actionType,
            verifier,
            block.timestamp + 30 days // Default expiry
        );
    }
    
    /**
     * @dev Record multiple actions in batch (gas optimization)
     * Not in ERC-8004 but useful for civic context
     */
    function batchRecordActions(
        uint256[] memory participantIds,
        ActionType[] memory actionTypes,
        bytes32[] memory actionDataHashes
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused returns (uint256[] memory) {
        require(
            participantIds.length == actionTypes.length && 
            actionTypes.length == actionDataHashes.length,
            "Array length mismatch"
        );
        
        uint256[] memory actionIds = new uint256[](participantIds.length);
        
        for (uint i = 0; i < participantIds.length; i++) {
            actionIds[i] = this.recordCivicAction(
                participantIds[i],
                actionTypes[i],
                actionDataHashes[i]
            );
        }
        
        return actionIds;
    }
    
    /**
     * @dev Get all actions for a participant
     * NOTE: This is expensive on-chain, prefer off-chain indexing
     */
    function getParticipantActions(uint256 participantId) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return participantActions[participantId];
    }
    
    /**
     * @dev Challenge an action (stub for ValidationRegistry integration)
     * @param actionId Action to challenge
     * @param reason Off-chain reason/evidence
     * 
     * STUB: Full implementation requires ValidationRegistry
     */
    function challengeAction(
        uint256 actionId,
        string memory reason
    ) external whenNotPaused {
        require(actionToParticipant[actionId] != 0, "Invalid action");
        
        emit ActionChallenged(actionId, msg.sender, reason);
        
        // STUB: Would trigger ValidationRegistry.requestValidation()
        // For MVP, just emit event for off-chain handling
    }
    
    /**
     * @dev Check if action is authorized
     */
    function isActionAuthorized(
        uint256 participantId,
        ActionType actionType,
        address verifier
    ) external view returns (bool) {
        bytes32 authKey = keccak256(abi.encodePacked(
            participantId,
            actionType,
            verifier
        ));
        return actionAuthorizations[authKey];
    }
    
    // Admin functions
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * OFF-CHAIN DATA STRUCTURE (for documentation):
     * 
     * The actionDataHash points to JSON with:
     * {
     *   "actionId": "uint256",
     *   "participantId": "uint256", 
     *   "actionType": "string",
     *   "timestamp": "uint256",
     *   "evidence": {
     *     "type": "cwc_confirmation|photo|signature|attestation",
     *     "uri": "ipfs://...",
     *     "hash": "0x..."
     *   },
     *   "metadata": {
     *     "location": "optional",
     *     "duration": "optional", 
     *     "impact": "optional description"
     *   },
     *   "verifier": {
     *     "address": "0x...",
     *     "signature": "0x...",
     *     "timestamp": "uint256"
     *   }
     * }
     * 
     * This follows ERC-8004's pattern of rich off-chain data
     * with minimal on-chain footprint
     */
    
    /**
     * FUTURE ADDITIONS:
     * 
     * 1. Reputation Scoring:
     *    - Off-chain aggregation of action quality
     *    - ML models for impact assessment
     * 
     * 2. Integration with ValidationRegistry:
     *    - Automatic validation triggers
     *    - Slashing for false actions
     * 
     * 3. Incentive Mechanisms:
     *    - Rewards for high-quality actions
     *    - Penalties for spam/abuse
     * 
     * 4. Privacy Enhancements:
     *    - ZK proofs for action verification
     *    - Selective disclosure of action types
     */
}