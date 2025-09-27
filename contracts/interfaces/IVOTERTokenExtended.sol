// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IVOTERToken.sol";

/**
 * @title IVOTERTokenExtended  
 * @dev Extended interface for VOTER Token with quadratic staking support
 * @notice Provides additional functions needed for advanced staking calculations
 */
interface IVOTERTokenExtended is IVOTERToken {
    
    // ============ TOKEN SOURCE TRACKING ============
    
    /**
     * @dev Get breakdown of user's token sources
     * @param account User address
     * @return earnedTokens Tokens earned through civic actions
     * @return purchasedTokens Tokens acquired through purchases/transfers
     */
    function getTokenSources(address account) external view returns (
        uint256 earnedTokens,
        uint256 purchasedTokens
    );
    
    /**
     * @dev Get user's civic action count
     * @param account User address  
     * @return actionCount Number of civic actions performed
     */
    function getCivicActionCount(address account) external view returns (uint256 actionCount);
    
    // ============ STAKING INTEGRATION ============
    
    /**
     * @dev Lock tokens for staking (used by challenge markets)
     * @param account Account to lock tokens for
     * @param amount Amount to lock
     * @return success Whether lock was successful
     */
    function lockTokensForStaking(address account, uint256 amount) external returns (bool success);
    
    /**
     * @dev Unlock tokens after staking period ends
     * @param account Account to unlock tokens for
     * @param amount Amount to unlock
     * @return success Whether unlock was successful
     */
    function unlockTokensFromStaking(address account, uint256 amount) external returns (bool success);
    
    /**
     * @dev Get user's locked token balance
     * @param account User address
     * @return lockedAmount Amount of tokens currently locked
     */
    function getLockedBalance(address account) external view returns (uint256 lockedAmount);
    
    /**
     * @dev Get user's available balance (total - locked)
     * @param account User address
     * @return availableAmount Amount available for staking
     */
    function getAvailableBalance(address account) external view returns (uint256 availableAmount);
    
    // ============ EVENTS ============
    
    event TokensLocked(address indexed account, uint256 amount, string reason);
    event TokensUnlocked(address indexed account, uint256 amount, string reason);
    event TokenSourceRecorded(address indexed account, uint256 amount, bool isEarned);
}