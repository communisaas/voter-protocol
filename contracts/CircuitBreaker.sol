// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title CircuitBreaker
 * @dev Basic circuit breaker patterns for detecting obvious attacks
 * @notice Simple protection against rapid draining and unusual patterns
 */
contract CircuitBreaker {
    
    // Circuit breaker thresholds
    uint256 public constant MASSIVE_SINGLE_ACTION_THRESHOLD = 100000 * 10**18; // 100K tokens
    uint256 public constant RAPID_ACTION_COUNT_THRESHOLD = 50; // 50 actions per hour per user
    uint256 public constant SUSPICIOUS_BATCH_SIZE = 20; // 20+ identical actions in one block
    
    // Tracking for circuit breakers
    mapping(address => mapping(uint256 => uint256)) public userHourlyActionCount; // user => hour => count
    mapping(bytes32 => uint256) public actionHashCounts; // actionHash => count in current block
    mapping(uint256 => mapping(bytes32 => uint256)) public blockActionCounts; // block => actionHash => count
    
    // Events
    event CircuitBreakerTriggered(string reason, address user, uint256 amount);
    event SuspiciousActivityDetected(string pattern, address user, bytes32 actionHash);
    
    /**
     * @dev Check if action should be blocked by circuit breakers
     * @param user Address taking the action
     * @param amount Token amount involved
     * @param actionHash Hash of the action
     * @return blocked Whether the action should be blocked
     * @return reason Reason for blocking (if blocked)
     */
    function checkCircuitBreakers(
        address user,
        uint256 amount,
        bytes32 actionHash
    ) external returns (bool blocked, string memory reason) {
        
        // 1. Massive single action detection
        if (amount > MASSIVE_SINGLE_ACTION_THRESHOLD) {
            emit CircuitBreakerTriggered("Massive single action", user, amount);
            return (true, "Single action exceeds safety threshold");
        }
        
        // 2. Rapid action detection (per hour)
        uint256 currentHour = block.timestamp / 1 hours;
        userHourlyActionCount[user][currentHour]++;
        
        if (userHourlyActionCount[user][currentHour] > RAPID_ACTION_COUNT_THRESHOLD) {
            emit CircuitBreakerTriggered("Rapid actions", user, amount);
            return (true, "Too many actions in one hour");
        }
        
        // 3. Suspicious batch detection (same action hash in same block)
        blockActionCounts[block.number][actionHash]++;
        
        if (blockActionCounts[block.number][actionHash] > SUSPICIOUS_BATCH_SIZE) {
            emit SuspiciousActivityDetected("Batch spam", user, actionHash);
            return (true, "Suspicious batch activity detected");
        }
        
        // 4. Zero-value action spam (potential DoS)
        if (amount == 0) {
            emit SuspiciousActivityDetected("Zero-value spam", user, actionHash);
            return (true, "Zero-value actions not allowed");
        }
        
        return (false, "");
    }
    
    /**
     * @dev Get current hour's action count for user
     */
    function getUserHourlyActions(address user) external view returns (uint256) {
        uint256 currentHour = block.timestamp / 1 hours;
        return userHourlyActionCount[user][currentHour];
    }
    
    /**
     * @dev Get current block's count for action hash
     */
    function getBlockActionCount(bytes32 actionHash) external view returns (uint256) {
        return blockActionCounts[block.number][actionHash];
    }
    
    /**
     * @dev Check if address shows suspicious patterns
     */
    function isSuspiciousAddress(address user) external view returns (bool) {
        uint256 currentHour = block.timestamp / 1 hours;
        
        // Check recent activity patterns
        uint256 recentActions = 0;
        for (uint256 i = 0; i < 3; i++) { // Last 3 hours
            recentActions += userHourlyActionCount[user][currentHour - i];
        }
        
        // Suspicious if consistently hitting limits
        return recentActions > (RAPID_ACTION_COUNT_THRESHOLD * 2);
    }
    
    /**
     * @dev Emergency halt for specific user (requires external authorization)
     * @notice This would be called by consensus/governance in extreme cases
     */
    function emergencyHaltUser(address user, string memory reason) external {
        // In production, this would require consensus approval
        emit CircuitBreakerTriggered(reason, user, 0);
    }
}