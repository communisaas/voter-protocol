// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";

/// @title NullifierRegistry
/// @notice Action-scoped nullifier registry using external nullifier pattern
/// @dev External nullifier = action_id allows same user to participate in 
///      different actions while preventing double-submission within same action.
///
/// SECURITY PROPERTIES:
/// - Same user CAN participate in multiple actions (different action_ids)
/// - Same user CANNOT participate twice in same action (same action_id)
/// - Nullifiers are domain-separated by action_id
///
/// GAS OPTIMIZATION (Scroll L2):
/// - ~20k gas per SSTORE on L1 → ~200 gas on Scroll L2
/// - Total submission: ~222k gas L1 → ~2.2k gas L2 equivalent
///
/// RELATIONSHIP TO DistrictGate:
/// - This contract provides the nullifier registry layer
/// - DistrictGate handles proof verification + calls this registry
/// - Separation allows upgrading registry without changing verifier
contract NullifierRegistry is Pausable, ReentrancyGuard {
    /// @notice Nested mapping: actionId => userNullifier => used
    /// @dev Action ID serves as the external nullifier (domain separator)
    ///      User nullifier = H(user_secret, action_id, authority_hash, epoch_id) from circuit
    mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

    /// @notice Tracks first submission timestamp per action
    mapping(bytes32 => uint256) public actionCreatedAt;

    /// @notice Count of unique participants per action
    mapping(bytes32 => uint256) public actionParticipantCount;

    /// @notice Authorized contracts that can mark nullifiers as used
    mapping(address => bool) public authorizedCallers;

    /// @notice Governance address
    address public governance;

    /// @notice Rate limit: minimum time between actions for same user nullifier
    uint256 public constant RATE_LIMIT_SECONDS = 60; // 1 minute

    /// @notice Last action timestamp per user nullifier (rate limiting across actions)
    mapping(bytes32 => uint256) public lastActionTime;

    // Events
    event ActionSubmitted(
        bytes32 indexed actionId,
        bytes32 indexed nullifier,
        bytes32 merkleRoot,
        uint256 timestamp
    );
    
    event ActionCreated(
        bytes32 indexed actionId,
        uint256 timestamp
    );

    event CallerAuthorized(address indexed caller, bool authorized);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    // Errors
    error NullifierAlreadyUsed();
    error RateLimitExceeded();
    error UnauthorizedCaller();
    error ZeroAddress();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller();
        _;
    }

    modifier onlyAuthorizedCaller() {
        if (!authorizedCallers[msg.sender]) revert UnauthorizedCaller();
        _;
    }

    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        // Governance is always authorized
        authorizedCallers[_governance] = true;
    }

    /// @notice Record a nullifier as used (called by DistrictGate or authorized contract)
    /// @param actionId Action identifier (serves as external nullifier)
    /// @param nullifier User's nullifier from ZK proof
    /// @param merkleRoot District Merkle root (for logging)
    function recordNullifier(
        bytes32 actionId,
        bytes32 nullifier,
        bytes32 merkleRoot
    ) external onlyAuthorizedCaller whenNotPaused nonReentrant {
        // Check: Nullifier not already used for this action
        if (nullifierUsed[actionId][nullifier]) {
            revert NullifierAlreadyUsed();
        }

        // Check: Rate limit (prevent spam across actions)
        // Skip rate limit for first-time submissions (lastActionTime == 0)
        uint256 lastTime = lastActionTime[nullifier];
        if (lastTime != 0 && block.timestamp < lastTime + RATE_LIMIT_SECONDS) {
            revert RateLimitExceeded();
        }

        // Effects: Mark nullifier as used
        nullifierUsed[actionId][nullifier] = true;
        lastActionTime[nullifier] = block.timestamp;
        actionParticipantCount[actionId]++;

        // Create action record if first submission
        if (actionCreatedAt[actionId] == 0) {
            actionCreatedAt[actionId] = block.timestamp;
            emit ActionCreated(actionId, block.timestamp);
        }

        emit ActionSubmitted(actionId, nullifier, merkleRoot, block.timestamp);
    }

    /// @notice Check if a nullifier has been used for an action
    /// @param actionId Action identifier
    /// @param nullifier User's nullifier
    /// @return True if nullifier has been used for this action
    function isNullifierUsed(
        bytes32 actionId,
        bytes32 nullifier
    ) external view returns (bool) {
        return nullifierUsed[actionId][nullifier];
    }

    /// @notice Get participant count for an action
    /// @param actionId Action identifier
    /// @return Number of unique participants
    function getParticipantCount(bytes32 actionId) external view returns (uint256) {
        return actionParticipantCount[actionId];
    }

    /// @notice Check when action was first created
    /// @param actionId Action identifier
    /// @return Timestamp of first submission (0 if never used)
    function getActionCreatedAt(bytes32 actionId) external view returns (uint256) {
        return actionCreatedAt[actionId];
    }

    // ============================================================================
    // Governance Functions
    // ============================================================================

    /// @notice Authorize a caller (e.g., DistrictGate contract)
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

    /// @notice Check if address is authorized
    /// @param caller Address to check
    /// @return True if authorized
    function isAuthorized(address caller) external view returns (bool) {
        return authorizedCallers[caller];
    }

    /// @notice Pause contract
    function pause() external onlyGovernance {
        _pause();
    }

    /// @notice Unpause contract
    function unpause() external onlyGovernance {
        _unpause();
    }

    /// @notice Transfer governance
    /// @param newGovernance New governance address
    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        address previous = governance;
        governance = newGovernance;
        authorizedCallers[newGovernance] = true;
        emit GovernanceTransferred(previous, newGovernance);
    }
}
