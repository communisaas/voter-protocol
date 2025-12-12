// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title TimelockGovernance
/// @notice Simple governance with timelocks for solo founder launch
/// @dev Phase 1 honest governance model - no false security theater
///
/// THREAT MODEL (HONEST):
/// - Single point of failure: Founder compromise = governance compromise
/// - Mitigation: All critical operations have timelocks (7-14 days)
/// - Community response: Monitor events, exit protocol during timelock if malicious
///
/// WHAT THIS PROVIDES:
/// - Time for community to detect malicious governance actions
/// - Opportunity to exit protocol before malicious changes execute
/// - Transparent on-chain record of all pending operations
///
/// WHAT THIS DOES NOT PROVIDE:
/// - Nation-state resistance (requires multi-jurisdiction guardians)
/// - Protection against founder key compromise
/// - Censorship resistance (founder can pause)
///
/// UPGRADE PATH:
/// - Phase 2+: Add GuardianShield when real guardians are recruited
/// - Guardians should be humans in different legal jurisdictions
/// - NOT LLM agents, NOT VPN-separated keys from same person
abstract contract TimelockGovernance {
    /// @notice Governance address (initially founder, later multisig)
    address public governance;

    /// @notice Pending governance transfer target => execution timestamp
    mapping(address => uint256) public pendingGovernance;

    /// @notice Timelock for governance transfers (7 days)
    /// @dev Gives community time to detect and respond to malicious transfers
    uint256 public constant GOVERNANCE_TIMELOCK = 7 days;

    // Events - transparent on-chain record
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceTransferCancelled(address indexed target);

    // Errors
    error UnauthorizedCaller();
    error ZeroAddress();
    error SameAddress();
    error TransferNotInitiated();
    error TimelockNotExpired();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller();
        _;
    }

    /// @notice Initialize governance
    /// @param _governance Initial governance address (founder)
    function _initializeGovernance(address _governance) internal {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
    }

    // ============================================================================
    // Governance Transfer (7-day timelock)
    // ============================================================================

    /// @notice Initiate governance transfer (starts 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Anyone can monitor GovernanceTransferInitiated events
    ///      Community has 7 days to respond if transfer looks malicious
    function initiateGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        if (newGovernance == governance) revert SameAddress();

        uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
        pendingGovernance[newGovernance] = executeTime;

        emit GovernanceTransferInitiated(newGovernance, executeTime);
    }

    /// @notice Execute governance transfer (after 7-day timelock)
    /// @param newGovernance New governance address
    /// @dev Can be called by anyone after timelock expires
    function executeGovernanceTransfer(address newGovernance) external {
        uint256 executeTime = pendingGovernance[newGovernance];
        if (executeTime == 0) revert TransferNotInitiated();
        if (block.timestamp < executeTime) revert TimelockNotExpired();

        address previousGovernance = governance;
        governance = newGovernance;
        delete pendingGovernance[newGovernance];

        emit GovernanceTransferred(previousGovernance, newGovernance);
    }

    /// @notice Cancel pending governance transfer
    /// @param newGovernance Target to cancel
    function cancelGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (pendingGovernance[newGovernance] == 0) revert TransferNotInitiated();

        delete pendingGovernance[newGovernance];

        emit GovernanceTransferCancelled(newGovernance);
    }

    /// @notice Get time remaining until governance transfer can execute
    /// @param newGovernance Pending transfer target
    /// @return secondsRemaining Time in seconds (0 if ready or not initiated)
    function getGovernanceTransferDelay(address newGovernance) external view returns (uint256 secondsRemaining) {
        uint256 executeTime = pendingGovernance[newGovernance];
        if (executeTime == 0 || block.timestamp >= executeTime) {
            return 0;
        }
        return executeTime - block.timestamp;
    }
}
