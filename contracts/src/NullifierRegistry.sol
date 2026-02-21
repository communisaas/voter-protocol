// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import "./TimelockGovernance.sol";

/// @title NullifierRegistry
/// @notice Action-scoped nullifier registry using external nullifier pattern
/// @dev External nullifier = action_id allows same user to participate in
///      different actions while preventing double-submission within same action.
///
/// SECURITY PROPERTIES:
/// - Same user CAN participate in multiple actions (different action_ids)
/// - Same user CANNOT participate twice in same action (same action_id)
/// - Nullifiers are domain-separated by action_id
/// - All governance operations have 7-day timelocks (CRITICAL-001 fix)
///
/// GAS OPTIMIZATION (Scroll L2):
/// - ~20k gas per SSTORE on L1 → ~200 gas on Scroll L2
/// - Total submission: ~222k gas L1 → ~2.2k gas L2 equivalent
///
/// RELATIONSHIP TO DistrictGate:
/// - This contract provides the nullifier registry layer
/// - DistrictGate handles proof verification + calls this registry
/// - Separation allows upgrading registry without changing verifier
///
/// GOVERNANCE TIMELOCK (CRITICAL-001):
/// - All governance operations (transferGovernance, authorizeCaller, revokeCaller)
///   have 7-day timelocks to give community time to respond to malicious actions
/// - This matches the security pattern used by DistrictRegistry, VerifierRegistry,
///   CampaignRegistry, and DistrictGate
contract NullifierRegistry is Pausable, ReentrancyGuard, TimelockGovernance {
    /// @notice Nested mapping: actionId => userNullifier => used
    /// @dev Action ID serves as the external nullifier (domain separator)
    ///      User nullifier = H2(identity_commitment, action_domain) from circuit
    mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

    /// @notice Tracks first submission timestamp per action
    mapping(bytes32 => uint256) public actionCreatedAt;

    /// @notice Count of unique participants per action
    mapping(bytes32 => uint256) public actionParticipantCount;

    /// @notice Authorized contracts that can mark nullifiers as used
    mapping(address => bool) public authorizedCallers;

    /// @notice Pending caller authorization operations
    /// @dev Maps caller address => execute timestamp (0 if no pending operation)
    mapping(address => uint256) public pendingCallerAuthorization;

    /// @notice Pending caller revocation operations
    /// @dev Maps caller address => execute timestamp (0 if no pending operation)
    mapping(address => uint256) public pendingCallerRevocation;

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

    event CallerAuthorizationProposed(address indexed caller, uint256 executeTime);
    event CallerAuthorized(address indexed caller);
    event CallerAuthorizationCancelled(address indexed caller);
    event CallerRevocationProposed(address indexed caller, uint256 executeTime);
    event CallerRevoked(address indexed caller);
    event CallerRevocationCancelled(address indexed caller);

    // Genesis events
    event GenesisSealed();
    event CallerAuthorizedGenesis(address indexed caller);

    // Errors
    error NullifierAlreadyUsed();
    error RateLimitExceeded();
    error CallerAlreadyAuthorized();
    error CallerNotAuthorized();
    error CallerAuthorizationNotPending();
    error CallerRevocationNotPending();
    error CallerAuthorizationTimelockNotExpired();
    error CallerRevocationTimelockNotExpired();
    error CallerAuthorizationAlreadyPending();
    error CallerRevocationAlreadyPending();
    error GenesisAlreadySealed();

    modifier onlyAuthorizedCaller() {
        if (!authorizedCallers[msg.sender]) revert UnauthorizedCaller();
        _;
    }

    /// @notice Timelock duration for caller authorization/revocation
    uint256 public constant CALLER_AUTHORIZATION_TIMELOCK = 7 days;

    /// @notice Whether genesis registration phase is complete
    /// @dev Once sealed, all caller authorizations require the timelock path
    bool public genesisSealed;

    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        _initializeGovernance(_governance);
        // Governance is always authorized
        authorizedCallers[_governance] = true;
    }

    // ============================================================================
    // Genesis Registration (no timelock — deployer IS governance)
    // ============================================================================

    /// @notice Direct caller authorization during genesis phase
    /// @param caller Address to authorize (e.g., DistrictGate contract)
    /// @dev Only available before sealGenesis(). At genesis there are no users
    ///      to protect from front-running — the deployer IS the sole operator.
    ///      Once sealed, all future authorizations require the timelock path.
    function authorizeCallerGenesis(address caller) external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (caller == address(0)) revert ZeroAddress();
        if (authorizedCallers[caller]) revert CallerAlreadyAuthorized();

        authorizedCallers[caller] = true;

        emit CallerAuthorizedGenesis(caller);
    }

    /// @notice Seal genesis phase — all future caller changes require timelocks
    /// @dev Irreversible. Call after initial callers are authorized.
    function sealGenesis() external onlyGovernance {
        if (genesisSealed) revert GenesisAlreadySealed();
        genesisSealed = true;
        emit GenesisSealed();
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
    // Caller Authorization (7-day timelock)
    // ============================================================================

    /// @notice Propose authorizing a caller (starts 7-day timelock)
    /// @param caller Address to authorize (e.g., DistrictGate contract)
    /// @dev Anyone can monitor CallerAuthorizationProposed events
    ///      Community has 7 days to respond if authorization looks malicious
    ///
    /// SECURITY (HIGH-001 FIX): Prevents overwriting existing pending proposals
    /// to avoid griefing attacks that reset the timelock indefinitely.
    function proposeCallerAuthorization(address caller) external onlyGovernance {
        if (caller == address(0)) revert ZeroAddress();
        if (authorizedCallers[caller]) revert CallerAlreadyAuthorized();
        // HIGH-001 FIX: Prevent overwriting existing pending proposals
        // Without this check, an attacker with temporary governance access could
        // repeatedly call proposeCallerAuthorization to reset the timelock
        if (pendingCallerAuthorization[caller] != 0) revert CallerAuthorizationAlreadyPending();

        uint256 executeTime = block.timestamp + CALLER_AUTHORIZATION_TIMELOCK;
        pendingCallerAuthorization[caller] = executeTime;

        emit CallerAuthorizationProposed(caller, executeTime);
    }

    /// @notice Execute caller authorization (after 7-day timelock)
    /// @param caller Address to authorize
    /// @dev Can be called by anyone after timelock expires
    function executeCallerAuthorization(address caller) external {
        uint256 executeTime = pendingCallerAuthorization[caller];
        if (executeTime == 0) revert CallerAuthorizationNotPending();
        if (block.timestamp < executeTime) revert CallerAuthorizationTimelockNotExpired();

        authorizedCallers[caller] = true;
        delete pendingCallerAuthorization[caller];

        emit CallerAuthorized(caller);
    }

    /// @notice Cancel pending caller authorization
    /// @param caller Address to cancel authorization for
    function cancelCallerAuthorization(address caller) external onlyGovernance {
        if (pendingCallerAuthorization[caller] == 0) revert CallerAuthorizationNotPending();

        delete pendingCallerAuthorization[caller];

        emit CallerAuthorizationCancelled(caller);
    }

    // ============================================================================
    // Caller Revocation (7-day timelock)
    // ============================================================================

    /// @notice Propose revoking a caller's authorization (starts 7-day timelock)
    /// @param caller Address to revoke
    /// @dev Anyone can monitor CallerRevocationProposed events
    ///      Community has 7 days to respond if revocation looks malicious
    ///
    /// SECURITY (HIGH-001 FIX): Prevents overwriting existing pending proposals
    function proposeCallerRevocation(address caller) external onlyGovernance {
        if (!authorizedCallers[caller]) revert CallerNotAuthorized();
        // HIGH-001 FIX: Prevent overwriting existing pending proposals
        if (pendingCallerRevocation[caller] != 0) revert CallerRevocationAlreadyPending();

        uint256 executeTime = block.timestamp + CALLER_AUTHORIZATION_TIMELOCK;
        pendingCallerRevocation[caller] = executeTime;

        emit CallerRevocationProposed(caller, executeTime);
    }

    /// @notice Execute caller revocation (after 7-day timelock)
    /// @param caller Address to revoke
    /// @dev Can be called by anyone after timelock expires
    function executeCallerRevocation(address caller) external {
        uint256 executeTime = pendingCallerRevocation[caller];
        if (executeTime == 0) revert CallerRevocationNotPending();
        if (block.timestamp < executeTime) revert CallerRevocationTimelockNotExpired();

        authorizedCallers[caller] = false;
        delete pendingCallerRevocation[caller];

        emit CallerRevoked(caller);
    }

    /// @notice Cancel pending caller revocation
    /// @param caller Address to cancel revocation for
    function cancelCallerRevocation(address caller) external onlyGovernance {
        if (pendingCallerRevocation[caller] == 0) revert CallerRevocationNotPending();

        delete pendingCallerRevocation[caller];

        emit CallerRevocationCancelled(caller);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// @notice Check if address is authorized
    /// @param caller Address to check
    /// @return True if authorized
    function isAuthorized(address caller) external view returns (bool) {
        return authorizedCallers[caller];
    }

    /// @notice Get time remaining until caller authorization can execute
    /// @param caller Pending authorization target
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getCallerAuthorizationDelay(address caller) external view returns (uint256 secondsRemaining) {
        uint256 executeTime = pendingCallerAuthorization[caller];
        if (executeTime == 0 || block.timestamp >= executeTime) {
            return 0;
        }
        return executeTime - block.timestamp;
    }

    /// @notice Get time remaining until caller revocation can execute
    /// @param caller Pending revocation target
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getCallerRevocationDelay(address caller) external view returns (uint256 secondsRemaining) {
        uint256 executeTime = pendingCallerRevocation[caller];
        if (executeTime == 0 || block.timestamp >= executeTime) {
            return 0;
        }
        return executeTime - block.timestamp;
    }

    // ============================================================================
    // Pause Controls (immediate - for emergency use only)
    // ============================================================================

    /// @notice Pause contract (immediate - emergency only)
    /// @dev No timelock for pause - enables fast response to attacks
    function pause() external onlyGovernance {
        _pause();
    }

    /// @notice Unpause contract (immediate)
    /// @dev No timelock for unpause - resuming operations is not risky
    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============================================================================
    // Governance Transfer Override
    // ============================================================================

    /// @notice Execute governance transfer (after 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Overrides TimelockGovernance to also update authorized callers
    function executeGovernanceTransfer(address newGovernance) external override {
        uint256 executeTime = pendingGovernance[newGovernance];
        if (executeTime == 0) revert TransferNotInitiated();
        if (block.timestamp < executeTime) revert TimelockNotExpired();

        address previousGovernance = governance;

        // Update governance
        governance = newGovernance;
        delete pendingGovernance[newGovernance];

        // Update authorized callers: new governance is authorized, old is revoked
        authorizedCallers[newGovernance] = true;
        authorizedCallers[previousGovernance] = false;

        emit GovernanceTransferred(previousGovernance, newGovernance);
    }
}
