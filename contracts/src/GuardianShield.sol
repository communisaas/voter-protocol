// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title GuardianShield
/// @notice Multi-jurisdiction guardian system with veto power
/// @dev Provides defense against legal coercion attacks by requiring
///      guardians in different legal jurisdictions to NOT veto
///      governance actions. A single guardian veto blocks the action.
///
/// SECURITY MODEL:
/// - Guardians should be in different legal jurisdictions
/// - Recommended: non-Five-Eyes countries, strong privacy law
/// - Examples: EFF Europe, Chaos Computer Club, Open Rights Group
///
/// ATTACK RESISTANCE:
/// - NSL + gag order in one jurisdiction cannot coerce all guardians
/// - Guardians can veto without explaining (maintains plausible deniability)
/// - Single veto is sufficient (fail-safe default)
abstract contract GuardianShield {
    /// @notice Guardian addresses with veto power
    mapping(address => bool) public guardians;
    
    /// @notice Total number of guardians
    uint256 public guardianCount;
    
    /// @notice Minimum guardians required for operation
    uint256 public constant MIN_GUARDIANS = 2;
    
    /// @notice Vetoed targets (governance transfers, verifier upgrades)
    mapping(address => bool) public vetoed;
    
    /// @notice Guardian who cast the veto (for accountability)
    mapping(address => address) public vetoedBy;
    
    // Events
    event GuardianAdded(address indexed guardian, uint256 newCount);
    event GuardianRemoved(address indexed guardian, uint256 newCount);
    event TargetVetoed(address indexed target, address indexed vetoingGuardian);
    event VetoCleared(address indexed target);
    
    // Errors
    error NotGuardian();
    error AlreadyGuardian();
    error NotAGuardian();
    error AlreadyVetoed();
    error InsufficientGuardians();
    error CannotRemoveLastGuardian();
    error TransferVetoed();
    
    modifier onlyGuardian() {
        if (!guardians[msg.sender]) revert NotGuardian();
        _;
    }
    
    /// @notice Internal function to add a guardian
    /// @dev Must be called by governance (override in child)
    function _addGuardian(address guardian) internal {
        if (guardians[guardian]) revert AlreadyGuardian();
        guardians[guardian] = true;
        guardianCount++;
        emit GuardianAdded(guardian, guardianCount);
    }
    
    /// @notice Internal function to remove a guardian
    /// @dev Must maintain MIN_GUARDIANS
    function _removeGuardian(address guardian) internal {
        if (!guardians[guardian]) revert NotAGuardian();
        if (guardianCount <= MIN_GUARDIANS) revert CannotRemoveLastGuardian();
        guardians[guardian] = false;
        guardianCount--;
        emit GuardianRemoved(guardian, guardianCount);
    }
    
    /// @notice Veto a pending target (governance transfer or verifier upgrade)
    /// @param target Address being vetoed
    /// @dev Only guardians can veto. Single veto is sufficient to block.
    ///      Veto cannot be undone except by governance clearing it.
    function veto(address target) external onlyGuardian {
        if (vetoed[target]) revert AlreadyVetoed();
        vetoed[target] = true;
        vetoedBy[target] = msg.sender;
        emit TargetVetoed(target, msg.sender);
    }
    
    /// @notice Check if a target has been vetoed
    /// @param target Address to check
    /// @return True if vetoed
    function isVetoed(address target) public view returns (bool) {
        return vetoed[target];
    }
    
    /// @notice Internal function to clear a veto
    /// @dev Called when governance cancels the operation
    function _clearVeto(address target) internal {
        if (vetoed[target]) {
            delete vetoed[target];
            delete vetoedBy[target];
            emit VetoCleared(target);
        }
    }
    
    /// @notice Check if guardian quorum is met
    /// @return True if at least MIN_GUARDIANS are set
    function hasGuardianQuorum() public view returns (bool) {
        return guardianCount >= MIN_GUARDIANS;
    }
}
