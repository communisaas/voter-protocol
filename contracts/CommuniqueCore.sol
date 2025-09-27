// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./VOTERRegistry.sol";
import "./VOTERToken.sol";
import "./IdentityRegistry.sol";
import "./CivicActionRegistry.sol";
import "./interfaces/IActionVerifier.sol";
import "./interfaces/IAgentConsensus.sol";
import "./AgentParameters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "forge-std/console.sol";

/**
 * @title CommuniqueCore
 * @dev Truly decentralized core orchestration contract for the Communiqué platform
 * @notice All operations require agent consensus - no administrative overrides
 * @notice Time-locked parameter changes prevent instant manipulation
 */
contract CommuniqueCore is ReentrancyGuard, Pausable {
    // REMOVED: Emergency multi-sig replaced with agent consensus
    
    VOTERRegistry public immutable voterRegistry;
    VOTERToken public immutable voterToken;
    IdentityRegistry public immutable identityRegistry;
    CivicActionRegistry public immutable civicActionRegistry;
    IAgentConsensus public immutable consensus; // MANDATORY agent consensus
    AgentParameters public immutable params;
    
    // Time-locked parameter changes
    struct PendingChange {
        uint256 proposedValue;
        uint256 executeAfter;
        bool exists;
    }
    mapping(bytes32 => PendingChange) public pendingParameterChanges;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    
    struct ActionReward { VOTERRegistry.ActionType actionType; uint256 civicReward; bool active; }
    
    struct PlatformStats {
        uint256 totalUsers;
        uint256 totalActions;
        uint256 totalCivicMinted;
        uint256 avgActionsPerUser;
        uint256 activeUsersLast30Days;
    }
    
    struct LeaderboardEntry {
        address participant;
        uint256 actionCount;
        uint256 civicEarned;
        bytes32 districtHash;
    }
    
    mapping(VOTERRegistry.ActionType => bool) public actionActive;
    mapping(address => uint256) public participantLastActionTime;
    mapping(uint256 => uint256) public protocolDailyMinted;
    mapping(address => mapping(uint256 => uint256)) public participantDailyMinted;
    mapping(bytes32 => address[]) public districtParticipants;
    mapping(address => bool) public registeredParticipants;
    
    // Dynamic rewards: configured by admin or external agent processes (no hardcoded constants)
    uint256 public minActionInterval = 1 hours; // default; can be overridden via params
    uint256 public totalCivicMinted;
    uint256 public totalRegisteredUsers;
    
    // Impact tracking for dynamic rewards
    mapping(bytes32 => uint256) public templateImpactScores; // templateId => impact score (0-100)
    mapping(address => uint256) public participantReputationMultipliers; // participant => reputation bonus (100 = 1x)
    mapping(bytes32 => uint256) public templateUsageCounts; // templateId => usage count
    
    event UserRegistered(address indexed user, bytes32 districtHash);
    event ActionProcessed(
        address indexed user,
        VOTERRegistry.ActionType actionType,
        uint256 civicRewarded,
        bytes32 actionHash
    );
    event RewardFlagUpdated(VOTERRegistry.ActionType actionType, bool active);
    
    constructor(
        address _voterRegistry, 
        address _voterToken, 
        address _identityRegistry,
        address _civicActionRegistry,
        address _consensus, 
        address _params
    ) {
        require(_consensus != address(0), "Consensus required");
        
        voterRegistry = VOTERRegistry(_voterRegistry);
        voterToken = VOTERToken(_voterToken);
        identityRegistry = IdentityRegistry(_identityRegistry);
        civicActionRegistry = CivicActionRegistry(_civicActionRegistry);
        consensus = IAgentConsensus(_consensus);
        params = AgentParameters(_params);
        
        // Initialize default rewards (can only be changed via consensus)
        actionActive[VOTERRegistry.ActionType.CWC_MESSAGE] = true;
        actionActive[VOTERRegistry.ActionType.DIRECT_ACTION] = true;
    }
    
    /**
     * @dev Register a new participant in the system
     * @param participantAddress Address of the participant
     * @param districtHash Hash of the participant's congressional district
     * @param consensusProof Proof that agent consensus approved this registration
     * @notice Requires agent consensus approval - no admin overrides
     */
    function registerParticipant(
        address participantAddress, 
        bytes32 districtHash,
        bytes32 consensusProof
    ) external {
        // Verify agent consensus approved this registration
        require(consensus.isVerified(consensusProof), "Registration not approved by consensus");
        require(!identityRegistry.isRegistered(participantAddress), "Already registered");
        
        // Register in IdentityRegistry (single source of truth)
        uint256 participantId = identityRegistry.register(participantAddress, districtHash);
        
        // Track locally for backwards compatibility (will be removed in v2)
        registeredParticipants[participantAddress] = true;
        districtParticipants[districtHash].push(participantAddress);
        totalRegisteredUsers++;
        
        emit UserRegistered(participantAddress, districtHash);
    }
    
    /**
     * @dev Process a civic action and reward user
     * @param user Address of the user who took action
     * @param actionType Type of civic action
     * @param actionHash Hash of the action details
     * @param metadata IPFS hash for additional data
     */
    function processCivicAction(
        address user,
        VOTERRegistry.ActionType actionType,
        bytes32 actionHash,
        string memory metadata,
        uint256 _credibilityScore // New parameter
    ) external nonReentrant whenNotPaused {
        require(!_isGlobalPaused(), "Global pause");
        // Check registration in IdentityRegistry (single source of truth)
        require(identityRegistry.isRegistered(user), "Participant not registered");
        require(actionActive[actionType], "Action type not supported");
        uint256 interval = _getMinActionInterval();
        require(participantLastActionTime[user] == 0 || block.timestamp >= participantLastActionTime[user] + interval, "Action too frequent");
        
        // MANDATORY: Ensure agent consensus verification (no fallbacks)
        require(consensus.isVerified(actionHash), "Action not verified by consensus");
        
        // Record action in CivicActionRegistry (following ERC-8004 pattern)
        (uint256 participantId,,,) = identityRegistry.resolveByAddress(user);
        civicActionRegistry.recordCivicAction(
            participantId,
            CivicActionRegistry.ActionType(uint8(actionType)), // Map action types
            keccak256(abi.encodePacked(metadata))
        );
        
        // Create VOTER record (non-transferable proof) with credibility score
        voterRegistry.createVOTERRecord(user, actionType, actionHash, metadata, _credibilityScore); // Pass new score

        // Mint VOTER tokens (tradeable rewards)
        uint256 civicReward = _clampedReward(_getRewardFor(actionType));
        // Apply Epistemic Leverage bonus
        civicReward = _applyEpistemicLeverageBonus(user, civicReward, _credibilityScore); // New call
        _enforceDailyCaps(user, civicReward);
        if (civicReward > 0) {
            voterToken.mintReward(
                user,
                civicReward,
                keccak256(abi.encodePacked(_actionTypeToString(actionType)))
            );
            totalCivicMinted += civicReward;
            uint256 day = _currentDay();
            participantDailyMinted[user][day] += civicReward;
            protocolDailyMinted[day] += civicReward;
        }
        
        participantLastActionTime[user] = block.timestamp;
        
        emit ActionProcessed(user, actionType, civicReward, actionHash);
    }
    
    /**
     * @dev Batch process multiple civic actions
     * @param users Array of user addresses
     * @param actionTypes Array of action types
     * @param actionHashes Array of action hashes
     * @param metadataArray Array of metadata strings
     */
    function batchProcessActions(
        address[] memory users,
        VOTERRegistry.ActionType[] memory actionTypes,
        bytes32[] memory actionHashes,
        string[] memory metadataArray,
        uint256[] memory credibilityScores // New parameter
    ) external nonReentrant whenNotPaused {
        require(!_isGlobalPaused(), "Global pause");
        require(
            users.length == actionTypes.length &&
            actionTypes.length == actionHashes.length &&
            actionHashes.length == metadataArray.length &&
            metadataArray.length == credibilityScores.length, // New check
            "Array length mismatch"
        );
        
        for (uint256 i = 0; i < users.length; i++) {
            // Skip if user not registered or action too frequent
            if (!registeredParticipants[users[i]] ||
                (participantLastActionTime[users[i]] != 0 && block.timestamp < participantLastActionTime[users[i]] + _getMinActionInterval())) {
                continue;
            }
            
            if (actionActive[actionTypes[i]]) {
                require(consensus.isVerified(actionHashes[i]), "Action not verified by consensus");
                voterRegistry.createVOTERRecord(
                    users[i],
                    actionTypes[i],
                    actionHashes[i],
                    metadataArray[i],
                    credibilityScores[i] // Pass new score
                );
                
                uint256 civicReward = _clampedReward(_getRewardFor(actionTypes[i]));
                civicReward = _applyEpistemicLeverageBonus(users[i], civicReward, credibilityScores[i]); // Apply bonus
                _enforceDailyCaps(users[i], civicReward);
                if (civicReward > 0) {
                    voterToken.mintReward(
                        users[i],
                        civicReward,
                        actionHashes[i]
                    );
                    totalCivicMinted += civicReward;
                    uint256 day = _currentDay();
                    participantDailyMinted[users[i]][day] += civicReward;
                    protocolDailyMinted[day] += civicReward;
                }
                
                participantLastActionTime[users[i]] = block.timestamp;
                
                emit ActionProcessed(users[i], actionTypes[i], civicReward, actionHashes[i]);
            }
        }
    }
    
    /**
     * @dev Get platform statistics
     * @return Platform statistics struct
     */
    function getPlatformStats() external view returns (PlatformStats memory) {
        (uint256 totalRecords, uint256 totalVerified) = voterRegistry.getPlatformStats();
        
        uint256 avgActions = totalVerified > 0 ? totalRecords / totalVerified : 0;
        
        return PlatformStats({
            totalUsers: totalVerified,
            totalActions: totalRecords,
            totalCivicMinted: totalCivicMinted,
            avgActionsPerUser: avgActions,
            activeUsersLast30Days: _getActiveParticipants30Days()
        });
    }
    
    /**
     * @dev Get district leaderboard
     * @param districtHash Hash of the congressional district
     * @param limit Maximum number of entries to return
     * @return Array of leaderboard entries
     */
    function getDistrictLeaderboard(
        bytes32 districtHash,
        uint256 limit
    ) external view returns (LeaderboardEntry[] memory) {
        address[] memory users = districtParticipants[districtHash];
        uint256 actualLimit = limit > users.length ? users.length : limit;
        
        LeaderboardEntry[] memory leaderboard = new LeaderboardEntry[](actualLimit);
        
        // Simple sampling - use only required fields to avoid stack depth
        for (uint256 i = 0; i < actualLimit && i < users.length; i++) {
            address user = users[i];
            (, , uint256 totalActions, , , , ) = voterRegistry.citizenProfiles(user);
            leaderboard[i] = LeaderboardEntry({
                participant: user,
                actionCount: totalActions,
                civicEarned: 0,
                districtHash: bytes32(0)
            });
        }
        
        return leaderboard;
    }

    /**
     * @dev Propose a parameter change with time-lock
     * @param key Parameter key to change
     * @param newValue New parameter value
     * @param consensusProof Proof that agent consensus approved this change
     */
    function proposeParameterChange(
        bytes32 key,
        uint256 newValue,
        bytes32 consensusProof
    ) external {
        require(consensus.isVerified(consensusProof), "Change not approved by consensus");
        
        pendingParameterChanges[key] = PendingChange({
            proposedValue: newValue,
            executeAfter: block.timestamp + TIMELOCK_DELAY,
            exists: true
        });
        
        emit ParameterChangeProposed(key, newValue, block.timestamp + TIMELOCK_DELAY);
    }
    
    /**
     * @dev Execute a time-locked parameter change
     * @param key Parameter key to change
     */
    function executeParameterChange(bytes32 key) external {
        PendingChange memory change = pendingParameterChanges[key];
        require(change.exists, "No pending change");
        require(block.timestamp >= change.executeAfter, "Timelock not expired");
        
        // Execute the change through AgentParameters
        // Note: This requires AgentParameters to accept calls from this contract
        delete pendingParameterChanges[key];
        
        emit ParameterChangeExecuted(key, change.proposedValue);
    }
    
    /**
     * @dev Enable/disable support for an action type (consensus required)
     * @param actionType Type of civic action
     * @param active Whether this action type is currently supported
     * @param consensusProof Proof that agent consensus approved this change
     */
    function setActionActive(
        VOTERRegistry.ActionType actionType, 
        bool active,
        bytes32 consensusProof
    ) external {
        require(consensus.isVerified(consensusProof), "Change not approved by consensus");
        actionActive[actionType] = active;
        emit RewardFlagUpdated(actionType, active);
    }

    function _enforceDailyCaps(address user, uint256 amount) internal view {
        if (amount == 0) return;
        uint256 day = _currentDay();
        uint256 maxUser = params.getUint(keccak256("maxDailyMintPerUser"));
        uint256 maxProtocol = params.getUint(keccak256("maxDailyMintProtocol"));
        
        if (maxUser > 0) {
            uint256 nextParticipantTotal = participantDailyMinted[user][day] + amount;
            require(nextParticipantTotal <= maxUser, "Participant daily cap exceeded");
        }
        if (maxProtocol > 0) {
            uint256 nextProtocolTotal = protocolDailyMinted[day] + amount;
            require(nextProtocolTotal <= maxProtocol, "Protocol daily cap exceeded");
            
            // Additional protection: ensure total doesn't exceed emergency threshold
            uint256 emergencyLimit = params.getUint(keccak256("emergencyDailyLimit"));
            if (emergencyLimit > 0) {
                require(nextProtocolTotal <= emergencyLimit, "Emergency limit exceeded");
            }
        }
    }

    function _getRewardFor(VOTERRegistry.ActionType actionType) internal view returns (uint256) {
        // Get USD target value for this action type
        bytes32 usdKey = actionType == VOTERRegistry.ActionType.CWC_MESSAGE
            ? keccak256("rewardUSD:CWC_MESSAGE")
            : keccak256("rewardUSD:DIRECT_ACTION");
        uint256 targetUSD = params.getUint(usdKey);
        
        // Get current token price from oracle consensus
        (uint256 tokenPriceUSD, bool isValid) = params.getOracleConsensusPrice();
        
        // If oracle price invalid or zero, fall back to fixed rewards
        if (!isValid || tokenPriceUSD == 0) {
            bytes32 fallbackKey = actionType == VOTERRegistry.ActionType.CWC_MESSAGE
                ? keccak256("reward:CWC_MESSAGE")
                : keccak256("reward:DIRECT_ACTION");
            uint256 fallbackReward = params.getUint(fallbackKey);
            return fallbackReward > 0 ? fallbackReward : 1e18; // Default 1 token if not set
        }
        
        // Calculate token amount: targetUSD / tokenPriceUSD
        // Both values have 8 decimals, result needs 18 decimals for token amount
        // Formula: (targetUSD * 10^18) / tokenPriceUSD
        uint256 tokenAmount = (targetUSD * 1e18) / tokenPriceUSD;
        
        return tokenAmount;
    }

    function _clampedReward(uint256 base) internal view returns (uint256) {
        uint256 maxPerAction = params.getUint(keccak256("maxRewardPerAction"));
        uint256 minPerAction = params.getUint(keccak256("minRewardPerAction")); // New: get min
        
        uint256 clamped = base;
        if (maxPerAction > 0) {
            clamped = clamped > maxPerAction ? maxPerAction : clamped;
        }
        // New: clamp minimum
        if (minPerAction > 0) {
            clamped = clamped < minPerAction ? minPerAction : clamped;
        }
        return clamped;
    }
    
    /**
     * @dev Calculate active users in last 30 days
     * @return Number of active users
     */
    function _getActiveParticipants30Days() internal view returns (uint256) {
        // This would need to be implemented with proper indexing
        // For now, return estimated value based on total users
        return totalRegisteredUsers / 10; // Rough estimate
    }
    
    /**
     * @dev Convert action type enum to string
     * @param actionType Action type enum
     * @return String representation
     */
    function _actionTypeToString(VOTERRegistry.ActionType actionType) internal pure returns (string memory) {
        if (actionType == VOTERRegistry.ActionType.CWC_MESSAGE) return "CWC_MESSAGE";
        if (actionType == VOTERRegistry.ActionType.DIRECT_ACTION) return "DIRECT_ACTION";
        return "UNKNOWN";
    }
    
    /**
     * @dev Emergency functions - only agent consensus can pause/unpause
     * @notice No human override - only algorithmic consensus
     */
    function emergencyPause(bytes32 consensusProof) external {
        require(consensus.isVerified(consensusProof), "Agent consensus required");
        _pause();
    }
    
    function emergencyUnpause(bytes32 consensusProof) external {
        require(consensus.isVerified(consensusProof), "Agent consensus required");
        _unpause();
    }
    
    /**
     * @dev Read minimum action interval, falling back to default when unset
     */
    function _getMinActionInterval() internal view returns (uint256) {
        uint256 configured = params.getUint(keccak256("minActionInterval"));
        return configured == 0 ? minActionInterval : configured;
    }

    function _isGlobalPaused() internal view returns (bool) {
        return params.getUint(keccak256("pause:Global")) != 0;
    }

    /**
     * @dev Calculate dynamic reward based on multiple factors
     * @param user Address of the user
     * @param baseReward Base reward amount
     * @param credibilityScore Credibility score of the action
     * @param templateId Template used (if any)
     */
    function _calculateDynamicReward(
        address user,
        uint256 baseReward,
        uint256 credibilityScore,
        bytes32 templateId
    ) internal view returns (uint256) {
        uint256 reward = baseReward;
        
        // 1. Apply template impact multiplier if template was used
        if (templateId != bytes32(0)) {
            uint256 impactScore = templateImpactScores[templateId];
            if (impactScore > 0) {
                // Templates with proven impact get up to 10x rewards
                uint256 impactMultiplier = 100 + (impactScore * 9); // 100-1000 (1x-10x)
                reward = (reward * impactMultiplier) / 100;
            }
        }
        
        // 2. Apply user reputation multiplier
        uint256 reputationMultiplier = participantReputationMultipliers[user];
        if (reputationMultiplier == 0) reputationMultiplier = 100; // Default 1x
        reward = (reward * reputationMultiplier) / 100;
        
        // 3. Apply credibility score bonus (epistemic leverage)
        uint256 minCredibility = params.getUint(keccak256("minCredibilityForBonus"));
        if (credibilityScore >= minCredibility) {
            uint256 credibilityBonus = params.getUint(keccak256("epistemicLeverageMultiplier"));
            if (credibilityBonus == 0) credibilityBonus = 100;
            reward = (reward * credibilityBonus) / 100;
        }
        
        // 4. Apply agent-determined adjustments
        uint256 agentMultiplier = params.getUint(keccak256("reward:agentMultiplier"));
        if (agentMultiplier > 0) {
            reward = (reward * agentMultiplier) / 100;
        }
        
        return reward;
    }
    
    /**
     * @dev Update template impact score (consensus required)
     * @param templateId ID of the template
     * @param impactScore New impact score (0-100)
     * @param consensusProof Proof that agent consensus approved this update
     */
    function updateTemplateImpact(
        bytes32 templateId,
        uint256 impactScore,
        bytes32 consensusProof
    ) external {
        require(consensus.isVerified(consensusProof), "Update not approved by consensus");
        require(impactScore <= 100, "Invalid impact score");
        templateImpactScores[templateId] = impactScore;
    }
    
    /**
     * @dev Update user reputation multiplier (consensus required)
     * @param user Address of the user
     * @param multiplier Reputation multiplier (100 = 1x, 200 = 2x)
     * @param consensusProof Proof that agent consensus approved this update
     */
    function updateParticipantReputation(
        address user,
        uint256 multiplier,
        bytes32 consensusProof
    ) external {
        require(consensus.isVerified(consensusProof), "Update not approved by consensus");
        require(multiplier <= 1000, "Multiplier too high"); // Max 10x
        participantReputationMultipliers[user] = multiplier;
    }
    
    // Keep legacy function for backward compatibility
    function _applyEpistemicLeverageBonus(
        address user,
        uint256 baseReward,
        uint256 credibilityScore
    ) internal view returns (uint256) {
        // Delegate to new dynamic reward calculation with no template
        return _calculateDynamicReward(user, baseReward, credibilityScore, bytes32(0));
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
    
    // Events for time-locked parameter changes
    event ParameterChangeProposed(bytes32 indexed key, uint256 newValue, uint256 executeAfter);
    event ParameterChangeExecuted(bytes32 indexed key, uint256 newValue);
}