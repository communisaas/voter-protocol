// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IVOTERToken.sol";
import "./consensus/ConsensusEngine.sol";
import "./consensus/ImmutableBounds.sol";

/**
 * @title TreasuryManager
 * @dev Consensus-controlled treasury with ZERO admin privileges
 * @notice All disbursements require AI agent consensus through ConsensusEngine
 */
contract TreasuryManager {
    
    // Dependencies
    IVOTERToken public immutable voterToken;
    ConsensusEngine public immutable consensusEngine;
    ImmutableBounds public immutable bounds;
    
    // Treasury state
    uint256 public totalReserves;
    uint256 public totalDistributed;
    uint256 public lastDistributionTime;
    
    // Disbursement tracking
    struct Disbursement {
        address recipient;
        uint256 amount;
        string purpose;
        bytes32 consensusId;
        uint256 timestamp;
        bool executed;
    }
    
    mapping(bytes32 => Disbursement) public disbursements;
    bytes32[] public disbursementHistory;
    
    // Emergency reserve (can only grow, never shrink)
    uint256 public emergencyReserve;
    uint256 public constant EMERGENCY_RESERVE_TARGET = 1_000_000 * 10**18; // 1M VOTER
    
    // Distribution limits from ImmutableBounds
    uint256 public immutable MAX_SINGLE_DISBURSEMENT;
    uint256 public immutable DAILY_DISBURSEMENT_CAP;
    uint256 public immutable WEEKLY_DISBURSEMENT_CAP;
    
    // Daily/weekly tracking
    mapping(uint256 => uint256) public dailyDisbursements; // day => amount
    mapping(uint256 => uint256) public weeklyDisbursements; // week => amount
    
    // Events
    event DisbursementProposed(bytes32 indexed consensusId, address recipient, uint256 amount);
    event DisbursementExecuted(bytes32 indexed consensusId, address recipient, uint256 amount);
    event EmergencyReserveIncreased(uint256 newTotal);
    event TreasuryRefilled(uint256 amount, address from);
    
    constructor(
        address _voterToken,
        address _consensusEngine,
        address _bounds
    ) {
        require(_voterToken != address(0), "Invalid token");
        require(_consensusEngine != address(0), "Invalid consensus");
        require(_bounds != address(0), "Invalid bounds");
        
        voterToken = IVOTERToken(_voterToken);
        consensusEngine = ConsensusEngine(_consensusEngine);
        bounds = ImmutableBounds(_bounds);
        
        // Set immutable limits from bounds
        MAX_SINGLE_DISBURSEMENT = bounds.MAX_TREASURY_DISBURSEMENT();
        DAILY_DISBURSEMENT_CAP = bounds.DAILY_TREASURY_CAP();
        WEEKLY_DISBURSEMENT_CAP = bounds.WEEKLY_TREASURY_CAP();
    }
    
    /**
     * @dev Receive VOTER tokens into treasury
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Invalid amount");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        totalReserves += amount;
        
        // Automatically allocate 10% to emergency reserve if below target
        if (emergencyReserve < EMERGENCY_RESERVE_TARGET) {
            uint256 toReserve = (amount * 10) / 100;
            if (emergencyReserve + toReserve > EMERGENCY_RESERVE_TARGET) {
                toReserve = EMERGENCY_RESERVE_TARGET - emergencyReserve;
            }
            emergencyReserve += toReserve;
            emit EmergencyReserveIncreased(emergencyReserve);
        }
        
        emit TreasuryRefilled(amount, msg.sender);
    }
    
    /**
     * @dev Execute disbursement after consensus approval
     * @param consensusId The approved consensus for this disbursement
     * @param recipient The recipient address
     * @param amount The amount to disburse
     * @param purpose Description of disbursement purpose
     */
    function executeDisbursement(
        bytes32 consensusId,
        address recipient,
        uint256 amount,
        string memory purpose
    ) external {
        // Verify consensus approval
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensusEngine.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        // Check if already disbursed
        require(!disbursements[consensusId].executed, "Already disbursed");
        
        // Validate amount
        require(amount > 0 && amount <= MAX_SINGLE_DISBURSEMENT, "Invalid amount");
        require(amount <= getAvailableBalance(), "Insufficient balance");
        
        // Check daily cap
        uint256 today = block.timestamp / 1 days;
        require(
            dailyDisbursements[today] + amount <= DAILY_DISBURSEMENT_CAP,
            "Daily cap exceeded"
        );
        
        // Check weekly cap
        uint256 week = block.timestamp / 1 weeks;
        require(
            weeklyDisbursements[week] + amount <= WEEKLY_DISBURSEMENT_CAP,
            "Weekly cap exceeded"
        );
        
        // Record disbursement
        disbursements[consensusId] = Disbursement({
            recipient: recipient,
            amount: amount,
            purpose: purpose,
            consensusId: consensusId,
            timestamp: block.timestamp,
            executed: true
        });
        
        disbursementHistory.push(consensusId);
        
        // Update tracking
        dailyDisbursements[today] += amount;
        weeklyDisbursements[week] += amount;
        totalDistributed += amount;
        totalReserves -= amount;
        lastDistributionTime = block.timestamp;
        
        // Execute transfer
        require(voterToken.transfer(recipient, amount), "Transfer failed");
        
        emit DisbursementExecuted(consensusId, recipient, amount);
    }
    
    /**
     * @dev Propose emergency disbursement (requires higher consensus threshold)
     * @notice Emergency disbursements can tap into emergency reserve
     */
    function proposeEmergencyDisbursement(
        address recipient,
        uint256 amount,
        string memory justification
    ) external returns (bytes32 consensusId) {
        require(amount <= emergencyReserve, "Exceeds emergency reserve");
        
        // Create proposal through consensus engine
        bytes memory payload = abi.encodeWithSignature(
            "executeEmergencyDisbursement(address,uint256,string)",
            recipient,
            amount,
            justification
        );
        
        consensusId = consensusEngine.initiateConsensus(
            string(abi.encodePacked("Emergency: ", justification)),
            address(this),
            payload
        );
        
        emit DisbursementProposed(consensusId, recipient, amount);
    }
    
    /**
     * @dev Execute emergency disbursement (called by consensus)
     */
    function executeEmergencyDisbursement(
        address recipient,
        uint256 amount,
        string memory justification
    ) external {
        // Only callable through consensus
        require(msg.sender == address(consensusEngine), "Only consensus");
        require(amount <= emergencyReserve, "Exceeds reserve");
        
        emergencyReserve -= amount;
        totalDistributed += amount;
        
        require(voterToken.transfer(recipient, amount), "Transfer failed");
        
        emit DisbursementExecuted(
            keccak256(abi.encodePacked(recipient, amount, justification)),
            recipient,
            amount
        );
    }
    
    /**
     * @dev Get available balance (excluding emergency reserve)
     */
    function getAvailableBalance() public view returns (uint256) {
        uint256 balance = voterToken.balanceOf(address(this));
        return balance > emergencyReserve ? balance - emergencyReserve : 0;
    }
    
    /**
     * @dev Get remaining daily allowance
     */
    function getRemainingDailyAllowance() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 used = dailyDisbursements[today];
        return used < DAILY_DISBURSEMENT_CAP ? DAILY_DISBURSEMENT_CAP - used : 0;
    }
    
    /**
     * @dev Get remaining weekly allowance
     */
    function getRemainingWeeklyAllowance() external view returns (uint256) {
        uint256 week = block.timestamp / 1 weeks;
        uint256 used = weeklyDisbursements[week];
        return used < WEEKLY_DISBURSEMENT_CAP ? WEEKLY_DISBURSEMENT_CAP - used : 0;
    }
    
    /**
     * @dev Get disbursement history
     */
    function getDisbursementHistory(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        uint256 total = disbursementHistory.length;
        if (offset >= total) {
            return new bytes32[](0);
        }
        
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        
        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = disbursementHistory[i];
        }
        
        return result;
    }
    
    /**
     * @dev Get treasury statistics
     */
    function getTreasuryStats() external view returns (
        uint256 reserves,
        uint256 emergency,
        uint256 distributed,
        uint256 available,
        uint256 dailyRemaining,
        uint256 weeklyRemaining
    ) {
        reserves = totalReserves;
        emergency = emergencyReserve;
        distributed = totalDistributed;
        available = getAvailableBalance();
        
        uint256 today = block.timestamp / 1 days;
        dailyRemaining = dailyDisbursements[today] < DAILY_DISBURSEMENT_CAP 
            ? DAILY_DISBURSEMENT_CAP - dailyDisbursements[today] 
            : 0;
            
        uint256 week = block.timestamp / 1 weeks;
        weeklyRemaining = weeklyDisbursements[week] < WEEKLY_DISBURSEMENT_CAP
            ? WEEKLY_DISBURSEMENT_CAP - weeklyDisbursements[week]
            : 0;
    }
}

// Zero admin control - treasury managed entirely by consensus