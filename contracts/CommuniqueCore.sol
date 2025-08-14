// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./VOTERRegistry.sol";
import "./CIVICToken.sol";
import "./ActionVerifierMultiSig.sol";
import "./interfaces/IActionVerifier.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title CommuniqueCore
 * @dev Core orchestration contract for the Communiqué platform
 * @notice Coordinates between VOTER registry and CIVIC token systems
 */
contract CommuniqueCore is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    VOTERRegistry public immutable voterRegistry;
    CIVICToken public immutable civicToken;
    IActionVerifier public immutable verifier; // threshold EIP-712
    
    struct ActionReward {
        VOTERRegistry.ActionType actionType;
        uint256 civicReward;
        bool active;
    }
    
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
    
    mapping(VOTERRegistry.ActionType => ActionReward) public actionRewards;
    mapping(address => uint256) public userLastActionTime;
    mapping(bytes32 => address[]) public districtUsers;
    mapping(address => bool) public registeredUsers;
    
    uint256 public constant CIVIC_PER_ACTION = 10 * 10**18; // 10 CIVIC per action
    uint256 public minActionInterval = 1 hours; // Anti-spam measure
    uint256 public totalCivicMinted;
    uint256 public totalRegisteredUsers;
    
    event UserRegistered(address indexed user, bytes32 districtHash);
    event ActionProcessed(
        address indexed user,
        VOTERRegistry.ActionType actionType,
        uint256 civicRewarded,
        bytes32 actionHash
    );
    event RewardUpdated(VOTERRegistry.ActionType actionType, uint256 newReward);
    
    modifier onlyOperator() {
        require(hasRole(OPERATOR_ROLE, msg.sender), "Not authorized operator");
        _;
    }
    
    constructor(address _voterRegistry, address _civicToken, address _verifier) {
        voterRegistry = VOTERRegistry(_voterRegistry);
        civicToken = CIVICToken(_civicToken);
        verifier = IActionVerifier(_verifier);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        
        // Initialize default rewards
        _setActionReward(VOTERRegistry.ActionType.CWC_MESSAGE, CIVIC_PER_ACTION, true);
        _setActionReward(VOTERRegistry.ActionType.DIRECT_ACTION, CIVIC_PER_ACTION / 2, true);
        _setActionReward(VOTERRegistry.ActionType.COMMUNITY_ORGANIZING, CIVIC_PER_ACTION * 2, true);
        _setActionReward(VOTERRegistry.ActionType.POLICY_ADVOCACY, CIVIC_PER_ACTION, true);
    }
    
    /**
     * @dev Register a new user in the system
     * @param user Address of the user
     * @param districtHash Hash of the user's congressional district
     */
    function registerUser(address user, bytes32 districtHash, bytes calldata selfProof) external onlyOperator {
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
        string memory metadata
    ) external onlyOperator nonReentrant whenNotPaused {
        require(registeredUsers[user], "User not registered");
        require(actionRewards[actionType].active, "Action type not supported");
        require(
            block.timestamp >= userLastActionTime[user] + minActionInterval,
            "Action too frequent"
        );
        
        // Ensure off-chain/oracle verification exists
        require(verifier.isVerifiedAction(actionHash), "Action not verified");
        // Create VOTER record (non-transferable proof)
        voterRegistry.createVOTERRecord(user, actionType, actionHash, metadata);
        
        // Mint CIVIC tokens (tradeable rewards)
        uint256 civicReward = actionRewards[actionType].civicReward;
        if (civicReward > 0) {
            civicToken.mintForCivicAction(
                user,
                civicReward,
                _actionTypeToString(actionType)
            );
            totalCivicMinted += civicReward;
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
        string[] memory metadataArray
    ) external onlyOperator nonReentrant whenNotPaused {
        require(
            users.length == actionTypes.length &&
            actionTypes.length == actionHashes.length &&
            actionHashes.length == metadataArray.length,
            "Array length mismatch"
        );
        
        for (uint256 i = 0; i < users.length; i++) {
            // Skip if user not registered or action too frequent
            if (!registeredUsers[users[i]] ||
                block.timestamp < userLastActionTime[users[i]] + minActionInterval) {
                continue;
            }
            
            if (actionRewards[actionTypes[i]].active) {
                require(verifier.isVerifiedAction(actionHashes[i]), "Action not verified");
                voterRegistry.createVOTERRecord(
                    users[i],
                    actionTypes[i],
                    actionHashes[i],
                    metadataArray[i]
                );
                
                uint256 civicReward = actionRewards[actionTypes[i]].civicReward;
                if (civicReward > 0) {
                    civicToken.mintForCivicAction(
                        users[i],
                        civicReward,
                        _actionTypeToString(actionTypes[i])
                    );
                    totalCivicMinted += civicReward;
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
            (, , uint256 totalActions, , , , ) = voterRegistry.citizenProfiles(user);
            leaderboard[i] = LeaderboardEntry({
                citizen: user,
                actionCount: totalActions,
                civicEarned: civicToken.civicActions(user) * CIVIC_PER_ACTION,
                districtHash: districtHash
            });
        }
        
        return leaderboard;
    }
    
    /**
     * @dev Set reward amount for action type
     * @param actionType Type of civic action
     * @param reward Amount of CIVIC tokens to reward
     * @param active Whether this action type is currently supported
     */
    function setActionReward(
        VOTERRegistry.ActionType actionType,
        uint256 reward,
        bool active
    ) external onlyRole(ADMIN_ROLE) {
        _setActionReward(actionType, reward, active);
    }
    
    function _setActionReward(
        VOTERRegistry.ActionType actionType,
        uint256 reward,
        bool active
    ) internal {
        actionRewards[actionType] = ActionReward({
            actionType: actionType,
            civicReward: reward,
            active: active
        });
        
        emit RewardUpdated(actionType, reward);
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
        if (actionType == VOTERRegistry.ActionType.COMMUNITY_ORGANIZING) return "COMMUNITY_ORGANIZING";
        if (actionType == VOTERRegistry.ActionType.POLICY_ADVOCACY) return "POLICY_ADVOCACY";
        return "UNKNOWN";
    }
    
    /**
     * @dev Emergency functions
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Update minimum action interval
     * @param newInterval New minimum interval in seconds
     */
    function updateActionInterval(uint256 newInterval) external onlyRole(ADMIN_ROLE) {
        require(newInterval >= 5 minutes && newInterval <= 7 days, "Invalid interval");
        minActionInterval = newInterval;
    }
}