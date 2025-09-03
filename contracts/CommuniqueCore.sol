// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./VOTERRegistry.sol";
import "./VOTERToken.sol";
import "./interfaces/IActionVerifier.sol";
import "./interfaces/IAgentConsensus.sol";
import "./AgentParameters.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "forge-std/console.sol";

/**
 * @title CommuniqueCore
 * @dev Core orchestration contract for the Communiqué platform
 * @notice Coordinates between VOTER registry and VOTER token systems
 */
contract CommuniqueCore is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    VOTERRegistry public immutable voterRegistry;
    VOTERToken public immutable voterToken;
    IActionVerifier public immutable verifier; // threshold EIP-712
    IAgentConsensus public consensus; // optional agent consensus override
    AgentParameters public immutable params;
    
    // Network analysis capability
    address public networkAnalyzer;
    
    struct ActionReward { VOTERRegistry.ActionType actionType; uint256 civicReward; bool active; }
    
    struct PlatformStats {
        uint256 totalUsers;
        uint256 totalActions;
        uint256 totalCivicMinted;
        uint256 avgActionsPerUser;
        uint256 activeUsersLast30Days;
    }
    
    struct LeaderboardEntry {
        address citizen;
        uint256 actionCount;
        uint256 civicEarned;
        bytes32 districtHash;
    }
    
    mapping(VOTERRegistry.ActionType => bool) public actionActive;
    mapping(address => uint256) public userLastActionTime;
    mapping(uint256 => uint256) public protocolDailyMinted;
    mapping(address => mapping(uint256 => uint256)) public userDailyMinted;
    mapping(bytes32 => address[]) public districtUsers;
    mapping(address => bool) public registeredUsers;
    
    // Dynamic rewards: configured by admin or external agent processes (no hardcoded constants)
    uint256 public minActionInterval = 1 hours; // default; can be overridden via params
    uint256 public totalCivicMinted;
    uint256 public totalRegisteredUsers;
    
    event UserRegistered(address indexed user, bytes32 districtHash);
    event ActionProcessed(
        address indexed user,
        VOTERRegistry.ActionType actionType,
        uint256 civicRewarded,
        bytes32 actionHash
    );
    event RewardFlagUpdated(VOTERRegistry.ActionType actionType, bool active);
    
    constructor(address _voterRegistry, address _voterToken, address _verifier, address _params) {
        voterRegistry = VOTERRegistry(_voterRegistry);
        voterToken = VOTERToken(_voterToken);
        verifier = IActionVerifier(_verifier);
        params = AgentParameters(_params);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        
        // Initialize default rewards
        actionActive[VOTERRegistry.ActionType.CWC_MESSAGE] = true;
        actionActive[VOTERRegistry.ActionType.DIRECT_ACTION] = true;
    }
    
    /**
     * @dev Register a new user in the system
     * @param user Address of the user
     * @param districtHash Hash of the user's congressional district
     */
    function registerUser(address user, bytes32 districtHash, bytes calldata selfProof) external {
        require(!registeredUsers[user], "User already registered");
        
        // Verify user in VOTER registry via Self Protocol proof
        voterRegistry.verifyCitizenWithSelf(user, districtHash, selfProof);
        
        registeredUsers[user] = true;
        districtUsers[districtHash].push(user);
        totalRegisteredUsers++;
        
        emit UserRegistered(user, districtHash);
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
        require(registeredUsers[user], "User not registered");
        require(actionActive[actionType], "Action type not supported");
        uint256 interval = _getMinActionInterval();
        require(userLastActionTime[user] == 0 || block.timestamp >= userLastActionTime[user] + interval, "Action too frequent");
        
        // Ensure off-chain/oracle verification exists
        require(_isVerified(actionHash), "Action not verified");
        // Create VOTER record (non-transferable proof) with credibility score
        voterRegistry.createVOTERRecord(user, actionType, actionHash, metadata, _credibilityScore); // Pass new score

        // Mint VOTER tokens (tradeable rewards)
        uint256 civicReward = _clampedReward(_getRewardFor(actionType));
        // Apply Epistemic Leverage bonus
        civicReward = _applyEpistemicLeverageBonus(user, civicReward, _credibilityScore); // New call
        _enforceDailyCaps(user, civicReward);
        if (civicReward > 0) {
            voterToken.mintForCivicAction(
                user,
                civicReward,
                _actionTypeToString(actionType)
            );
            totalCivicMinted += civicReward;
            uint256 day = _currentDay();
            userDailyMinted[user][day] += civicReward;
            protocolDailyMinted[day] += civicReward;
        }
        
        userLastActionTime[user] = block.timestamp;
        
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
            if (!registeredUsers[users[i]] ||
                (userLastActionTime[users[i]] != 0 && block.timestamp < userLastActionTime[users[i]] + _getMinActionInterval())) {
                continue;
            }
            
            if (actionActive[actionTypes[i]]) {
                require(_isVerified(actionHashes[i]), "Action not verified");
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
                    voterToken.mintForCivicAction(
                        users[i],
                        civicReward,
                        _actionTypeToString(actionTypes[i])
                    );
                    totalCivicMinted += civicReward;
                    uint256 day = _currentDay();
                    userDailyMinted[users[i]][day] += civicReward;
                    protocolDailyMinted[day] += civicReward;
                }
                
                userLastActionTime[users[i]] = block.timestamp;
                
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
            activeUsersLast30Days: _getActiveUsers30Days()
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
        address[] memory users = districtUsers[districtHash];
        uint256 actualLimit = limit > users.length ? users.length : limit;
        
        LeaderboardEntry[] memory leaderboard = new LeaderboardEntry[](actualLimit);
        
        // Simple sampling - use only required fields to avoid stack depth
        for (uint256 i = 0; i < actualLimit && i < users.length; i++) {
            address user = users[i];
            (, , uint256 totalActions, , , , , ) = voterRegistry.citizenProfiles(user);
            leaderboard[i] = LeaderboardEntry({
                citizen: user,
                actionCount: totalActions,
                civicEarned: 0,
                districtHash: districtHash
            });
        }
        
        return leaderboard;
    }

    function setConsensus(address newConsensus) external onlyRole(ADMIN_ROLE) {
        consensus = IAgentConsensus(newConsensus);
    }
    
    function setNetworkAnalyzer(address _analyzer) external onlyRole(ADMIN_ROLE) {
        networkAnalyzer = _analyzer;
    }

    function _isVerified(bytes32 actionHash) internal view returns (bool) {
        if (address(consensus) != address(0)) {
            return consensus.isVerified(actionHash);
        }
        return verifier.isVerifiedAction(actionHash);
    }
    
    /**
     * @dev Enable/disable support for an action type
     * @param actionType Type of civic action
     * @param active Whether this action type is currently supported
     */
    function setActionActive(VOTERRegistry.ActionType actionType, bool active) external onlyRole(ADMIN_ROLE) {
        actionActive[actionType] = active;
        emit RewardFlagUpdated(actionType, active);
    }

    function _enforceDailyCaps(address user, uint256 amount) internal view {
        if (amount == 0) return;
        uint256 day = _currentDay();
        uint256 maxUser = params.getUint(keccak256("maxDailyMintPerUser"));
        uint256 maxProtocol = params.getUint(keccak256("maxDailyMintProtocol"));
        
        if (maxUser > 0) {
            uint256 nextUserTotal = userDailyMinted[user][day] + amount;
            require(nextUserTotal <= maxUser, "User daily cap exceeded");
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
        bytes32 key = actionType == VOTERRegistry.ActionType.CWC_MESSAGE
            ? keccak256("reward:CWC_MESSAGE")
            : keccak256("reward:DIRECT_ACTION");
        return params.getUint(key);
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
    function _getActiveUsers30Days() internal view returns (uint256) {
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
     * @dev Emergency functions
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function updateCitizenEpistemicReputation(address citizen, uint256 newScore) external onlyRole(ADMIN_ROLE) { // ADMIN_ROLE for now, could be a new specific role
        voterRegistry.updateEpistemicReputation(citizen, newScore);
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

    function _applyEpistemicLeverageBonus(
        address user, // User who performed the action
        uint256 baseReward,
        uint256 credibilityScore // Credibility of the action's content
    ) internal view returns (uint256) {
        // Get epistemic leverage multiplier from AgentParameters
        uint256 epistemicLeverageMultiplier = params.getUint(keccak256("epistemicLeverageMultiplier"));
        // Get minimum credibility score for bonus eligibility
        uint256 minCredibilityForBonus = params.getUint(keccak256("minCredibilityForBonus"));

        if (epistemicLeverageMultiplier == 0 || credibilityScore < minCredibilityForBonus) {
            return baseReward; // No bonus if multiplier is zero or score is too low
        }

        // Example calculation: bonus scales with credibility score
        // This logic can be refined by the MarketAgent off-chain and configured via params
        uint256 bonusAmount = (baseReward * credibilityScore * epistemicLeverageMultiplier) / 10000; // Scale by 10000 for percentage

        return baseReward + bonusAmount;
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}