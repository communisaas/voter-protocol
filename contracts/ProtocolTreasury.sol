// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERToken.sol";

/**
 * @title ProtocolTreasury
 * @dev Manages protocol development funds—no political functions
 * @notice Funds developer grants, infrastructure, and community initiatives only
 */
contract ProtocolTreasury is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    
    struct Grant {
        address recipient;
        uint256 amount;
        string purpose; // "development", "infrastructure", "community", "audit"
        string description;
        uint256 proposalTime;
        uint256 votingDeadline;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
        bool cancelled;
    }
    
    struct GrantRecipient {
        uint256 totalReceived;
        uint256 grantCount;
        uint256 lastGrantTime;
    }
    
    // State variables
    IVOTERToken public voterToken;
    
    mapping(uint256 => Grant) public grants;
    mapping(address => GrantRecipient) public recipients;
    mapping(address => mapping(uint256 => bool)) public hasVoted;
    
    uint256 public grantCount;
    uint256 public treasuryBalance;
    uint256 public totalGrantsDistributed;
    
    // Treasury parameters
    uint256 public constant MAX_GRANT_AMOUNT = 50_000 * 10**18; // 50K VOTER max per grant
    uint256 public constant MIN_GRANT_SEPARATION = 7 days;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant MAX_WITHDRAWAL_PERCENT = 10; // 10% of treasury max per grant
    
    // Valid grant purposes (no political funding)
    mapping(string => bool) public validPurposes;
    
    // Events
    event GrantProposed(
        uint256 indexed grantId,
        address indexed recipient,
        uint256 amount,
        string purpose
    );
    
    event VoteCast(
        uint256 indexed grantId,
        address indexed voter,
        bool support,
        uint256 weight
    );
    
    event GrantDistributed(
        uint256 indexed grantId,
        address indexed recipient,
        uint256 amount,
        string purpose
    );
    
    event TreasuryDeposit(
        address indexed from,
        uint256 amount
    );
    
    constructor(
        address admin,
        address _voterToken
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
        
        voterToken = IVOTERToken(_voterToken);
        
        // Initialize valid purposes (explicitly non-political)
        validPurposes["development"] = true;
        validPurposes["infrastructure"] = true;
        validPurposes["community"] = true;
        validPurposes["audit"] = true;
        validPurposes["bug_bounty"] = true;
        validPurposes["research"] = true;
    }
    
    /**
     * @dev Deposit VOTER tokens into treasury
     * @param amount Amount to deposit
     */
    function depositToTreasury(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        treasuryBalance += amount;
        
        emit TreasuryDeposit(msg.sender, amount);
    }
    
    /**
     * @dev Propose a development grant
     * @param recipient Address to receive grant
     * @param amount Grant amount
     * @param purpose Must be valid non-political purpose
     * @param description Detailed description of grant use
     */
    function proposeGrant(
        address recipient,
        uint256 amount,
        string memory purpose,
        string memory description
    ) external whenNotPaused returns (uint256 grantId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0 && amount <= MAX_GRANT_AMOUNT, "Invalid amount");
        require(amount <= treasuryBalance * MAX_WITHDRAWAL_PERCENT / 100, "Exceeds withdrawal limit");
        require(validPurposes[purpose], "Invalid purpose");
        require(bytes(description).length > 0, "No description");
        
        // Check temporal separation for recipient
        GrantRecipient storage recipientRecord = recipients[recipient];
        if (recipientRecord.lastGrantTime > 0) {
            require(
                block.timestamp >= recipientRecord.lastGrantTime + MIN_GRANT_SEPARATION,
                "Too soon after last grant"
            );
        }
        
        grantId = grantCount++;
        
        grants[grantId] = Grant({
            recipient: recipient,
            amount: amount,
            purpose: purpose,
            description: description,
            proposalTime: block.timestamp,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            yesVotes: 0,
            noVotes: 0,
            executed: false,
            cancelled: false
        });
        
        emit GrantProposed(grantId, recipient, amount, purpose);
        
        return grantId;
    }
    
    /**
     * @dev Vote on a grant proposal
     * @param grantId Grant to vote on
     * @param support True for yes, false for no
     */
    function voteOnGrant(uint256 grantId, bool support) external {
        Grant storage grant = grants[grantId];
        require(grant.proposalTime > 0, "Grant not found");
        require(!grant.executed, "Already executed");
        require(!grant.cancelled, "Cancelled");
        require(block.timestamp <= grant.votingDeadline, "Voting ended");
        require(!hasVoted[msg.sender][grantId], "Already voted");
        
        // Weight by VOTER token balance
        uint256 votingPower = voterToken.balanceOf(msg.sender);
        require(votingPower > 0, "No voting power");
        
        hasVoted[msg.sender][grantId] = true;
        
        if (support) {
            grant.yesVotes += votingPower;
        } else {
            grant.noVotes += votingPower;
        }
        
        emit VoteCast(grantId, msg.sender, support, votingPower);
    }
    
    /**
     * @dev Execute approved grant after voting
     * @param grantId Grant to execute
     */
    function executeGrant(uint256 grantId) 
        external 
        nonReentrant 
        onlyRole(TREASURY_ROLE) 
    {
        Grant storage grant = grants[grantId];
        require(grant.proposalTime > 0, "Grant not found");
        require(!grant.executed, "Already executed");
        require(!grant.cancelled, "Cancelled");
        require(block.timestamp > grant.votingDeadline, "Voting not ended");
        require(grant.yesVotes > grant.noVotes, "Grant not approved");
        require(grant.amount <= treasuryBalance, "Insufficient balance");
        
        grant.executed = true;
        
        // Update recipient record
        GrantRecipient storage recipientRecord = recipients[grant.recipient];
        recipientRecord.totalReceived += grant.amount;
        recipientRecord.grantCount++;
        recipientRecord.lastGrantTime = block.timestamp;
        
        // Transfer funds
        treasuryBalance -= grant.amount;
        totalGrantsDistributed += grant.amount;
        
        require(voterToken.transfer(grant.recipient, grant.amount), "Transfer failed");
        
        emit GrantDistributed(
            grantId,
            grant.recipient,
            grant.amount,
            grant.purpose
        );
    }
    
    /**
     * @dev Cancel a grant proposal
     * @param grantId Grant to cancel
     */
    function cancelGrant(uint256 grantId) external onlyRole(GOVERNANCE_ROLE) {
        Grant storage grant = grants[grantId];
        require(!grant.executed, "Already executed");
        
        grant.cancelled = true;
    }
    
    /**
     * @dev Get recipient grant history
     * @param recipient Address to query
     */
    function getRecipientRecord(address recipient) 
        external 
        view 
        returns (GrantRecipient memory) 
    {
        return recipients[recipient];
    }
    
    /**
     * @dev Add new valid grant purpose
     * @param purpose New purpose to add
     */
    function addValidPurpose(string memory purpose) 
        external 
        onlyRole(GOVERNANCE_ROLE) 
    {
        // Explicitly prevent political purposes
        require(
            keccak256(bytes(purpose)) != keccak256(bytes("political")) &&
            keccak256(bytes(purpose)) != keccak256(bytes("electoral")) &&
            keccak256(bytes(purpose)) != keccak256(bytes("campaign")) &&
            keccak256(bytes(purpose)) != keccak256(bytes("pac")) &&
            keccak256(bytes(purpose)) != keccak256(bytes("lobbying")),
            "Political purposes not allowed"
        );
        
        validPurposes[purpose] = true;
    }
    
    /**
     * @dev Emergency withdraw (multi-sig only)
     * @param to Recipient address  
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
        nonReentrant 
    {
        require(amount <= treasuryBalance, "Insufficient balance");
        
        treasuryBalance -= amount;
        require(voterToken.transfer(to, amount), "Transfer failed");
    }
    
    /**
     * @dev Pause contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}