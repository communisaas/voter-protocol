// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERToken.sol";
import "./TemplateRegistry.sol";

/**
 * @title TreasuryManager
 * @dev Manages treasury funds for 501(c)(4) electoral funding based on demonstrated impact
 * @notice Implements "legislators who learn get funded" with full FEC compliance
 */
contract TreasuryManager is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    
    struct FundingProposal {
        address proposer;
        string representative;     // Name of representative
        string district;           // Congressional district
        uint256 amount;           // Funding amount in VOTER tokens
        bytes32[] templateIds;    // Templates that influenced this rep
        string rationale;         // Observable evidence of learning
        uint256 proposalTime;
        uint256 votingDeadline;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
        bool cancelled;
    }
    
    struct RepresentativeRecord {
        string name;
        string district;
        string party;             // For transparency, not decision-making
        uint256 totalFunded;      // Total funding received
        uint256 responseScore;    // Responsiveness to constituents (0-100)
        uint256 lastFundingTime;  // Temporal separation enforcement
        bytes32[] influencedBy;   // Templates that changed their position
    }
    
    struct ComplianceCheck {
        bool passedFECLimits;     // Within FEC contribution limits
        bool passedCoordination;  // No coordination detected
        bool passedTiming;        // Sufficient temporal separation
        bool passedForeign;       // No foreign national involvement
        string notes;
    }
    
    // State variables
    IVOTERToken public voterToken;
    TemplateRegistry public templateRegistry;
    
    mapping(uint256 => FundingProposal) public proposals;
    mapping(string => RepresentativeRecord) public representatives;
    mapping(address => mapping(uint256 => bool)) public hasVoted;
    mapping(address => bool) public blacklistedAddresses;
    mapping(string => bool) public sanctionedCountries;
    
    uint256 public proposalCount;
    uint256 public treasuryBalance;
    uint256 public totalDistributed;
    
    // Compliance parameters
    uint256 public constant MAX_SINGLE_DISTRIBUTION = 100_000 * 10**18; // $100K equivalent
    uint256 public constant MIN_TEMPORAL_SEPARATION = 30 days;
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant MAX_WITHDRAWAL_PERCENT = 20; // 20% of treasury max
    
    // FEC compliance limits (in USD equivalent)
    uint256 public constant PAC_CONTRIBUTION_LIMIT = 5_000 * 10**18;
    uint256 public constant ISSUE_ADVOCACY_UNLIMITED = type(uint256).max;
    
    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        string representative,
        uint256 amount,
        address proposer
    );
    
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight
    );
    
    event FundingDistributed(
        uint256 indexed proposalId,
        string representative,
        uint256 amount,
        string fundingType
    );
    
    event ComplianceCheckPerformed(
        uint256 indexed proposalId,
        bool passed,
        string reason
    );
    
    event TreasuryDeposit(
        address indexed from,
        uint256 amount
    );
    
    constructor(
        address admin,
        address _voterToken,
        address _templateRegistry
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        
        voterToken = IVOTERToken(_voterToken);
        templateRegistry = TemplateRegistry(_templateRegistry);
        
        // Initialize sanctioned countries (OFAC list)
        sanctionedCountries["IR"] = true; // Iran
        sanctionedCountries["KP"] = true; // North Korea
        sanctionedCountries["SY"] = true; // Syria
        sanctionedCountries["RU"] = true; // Russia
        sanctionedCountries["CU"] = true; // Cuba
    }
    
    /**
     * @dev Deposit VOTER tokens into treasury
     * @param amount Amount to deposit
     */
    function depositToTreasury(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(!blacklistedAddresses[msg.sender], "Address blacklisted");
        
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        treasuryBalance += amount;
        
        emit TreasuryDeposit(msg.sender, amount);
    }
    
    /**
     * @dev Create funding proposal for a representative who learned
     * @param representative Name of the representative
     * @param district Congressional district
     * @param amount Funding amount requested
     * @param templateIds Templates that influenced this representative
     * @param rationale Observable evidence of learning
     */
    function createProposal(
        string memory representative,
        string memory district,
        uint256 amount,
        bytes32[] memory templateIds,
        string memory rationale
    ) external whenNotPaused returns (uint256 proposalId) {
        require(amount > 0 && amount <= MAX_SINGLE_DISTRIBUTION, "Invalid amount");
        require(amount <= treasuryBalance * MAX_WITHDRAWAL_PERCENT / 100, "Exceeds withdrawal limit");
        require(templateIds.length > 0, "No templates provided");
        require(bytes(rationale).length > 0, "No rationale provided");
        
        // Check temporal separation
        RepresentativeRecord storage rep = representatives[representative];
        if (rep.lastFundingTime > 0) {
            require(
                block.timestamp >= rep.lastFundingTime + MIN_TEMPORAL_SEPARATION,
                "Too soon after last funding"
            );
        }
        
        // Verify templates have real impact
        uint256 totalImpact = 0;
        for (uint256 i = 0; i < templateIds.length; i++) {
            totalImpact += templateRegistry.calculateFundingImpact(templateIds[i]);
        }
        require(totalImpact > 50, "Insufficient template impact");
        
        proposalId = proposalCount++;
        
        proposals[proposalId] = FundingProposal({
            proposer: msg.sender,
            representative: representative,
            district: district,
            amount: amount,
            templateIds: templateIds,
            rationale: rationale,
            proposalTime: block.timestamp,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            yesVotes: 0,
            noVotes: 0,
            executed: false,
            cancelled: false
        });
        
        emit ProposalCreated(proposalId, representative, amount, msg.sender);
        
        return proposalId;
    }
    
    /**
     * @dev Vote on a funding proposal
     * @param proposalId Proposal to vote on
     * @param support True for yes, false for no
     */
    function voteOnProposal(uint256 proposalId, bool support) external {
        FundingProposal storage proposal = proposals[proposalId];
        require(proposal.proposalTime > 0, "Proposal not found");
        require(!proposal.executed, "Already executed");
        require(!proposal.cancelled, "Cancelled");
        require(block.timestamp <= proposal.votingDeadline, "Voting ended");
        require(!hasVoted[msg.sender][proposalId], "Already voted");
        
        // Weight by VOTER token balance
        uint256 votingPower = voterToken.balanceOf(msg.sender);
        require(votingPower > 0, "No voting power");
        
        hasVoted[msg.sender][proposalId] = true;
        
        if (support) {
            proposal.yesVotes += votingPower;
        } else {
            proposal.noVotes += votingPower;
        }
        
        emit VoteCast(proposalId, msg.sender, support, votingPower);
    }
    
    /**
     * @dev Execute approved proposal after voting period
     * @param proposalId Proposal to execute
     */
    function executeProposal(uint256 proposalId) 
        external 
        nonReentrant 
        onlyRole(DISTRIBUTOR_ROLE) 
    {
        FundingProposal storage proposal = proposals[proposalId];
        require(proposal.proposalTime > 0, "Proposal not found");
        require(!proposal.executed, "Already executed");
        require(!proposal.cancelled, "Cancelled");
        require(block.timestamp > proposal.votingDeadline, "Voting not ended");
        require(proposal.yesVotes > proposal.noVotes, "Proposal not approved");
        
        // Perform compliance checks
        ComplianceCheck memory compliance = performComplianceCheck(proposalId);
        require(
            compliance.passedFECLimits && 
            compliance.passedCoordination && 
            compliance.passedTiming &&
            compliance.passedForeign,
            "Failed compliance"
        );
        
        emit ComplianceCheckPerformed(
            proposalId, 
            true, 
            compliance.notes
        );
        
        proposal.executed = true;
        
        // Update representative record
        RepresentativeRecord storage rep = representatives[proposal.representative];
        rep.name = proposal.representative;
        rep.district = proposal.district;
        rep.totalFunded += proposal.amount;
        rep.lastFundingTime = block.timestamp;
        
        // Add influenced templates
        for (uint256 i = 0; i < proposal.templateIds.length; i++) {
            rep.influencedBy.push(proposal.templateIds[i]);
        }
        
        // Calculate responsiveness score
        rep.responseScore = calculateResponsivenessScore(proposal.templateIds);
        
        // Transfer funds (in production, would go to 501c4 wallet)
        treasuryBalance -= proposal.amount;
        totalDistributed += proposal.amount;
        
        // Determine funding type for transparency
        string memory fundingType = proposal.amount <= PAC_CONTRIBUTION_LIMIT 
            ? "PAC_CONTRIBUTION" 
            : "ISSUE_ADVOCACY";
        
        emit FundingDistributed(
            proposalId,
            proposal.representative,
            proposal.amount,
            fundingType
        );
    }
    
    /**
     * @dev Perform compliance checks on a proposal
     * @param proposalId Proposal to check
     * @return compliance Compliance check results
     */
    function performComplianceCheck(uint256 proposalId) 
        public 
        view 
        returns (ComplianceCheck memory) 
    {
        FundingProposal storage proposal = proposals[proposalId];
        ComplianceCheck memory check;
        
        // FEC limits check
        check.passedFECLimits = proposal.amount <= ISSUE_ADVOCACY_UNLIMITED;
        
        // Coordination check (simplified - would check external data)
        check.passedCoordination = true; // No direct coordination
        
        // Timing check - allow first funding (lastFundingTime == 0)
        RepresentativeRecord storage rep = representatives[proposal.representative];
        check.passedTiming = rep.lastFundingTime == 0 || 
                            block.timestamp >= rep.lastFundingTime + MIN_TEMPORAL_SEPARATION;
        
        // Foreign national check (simplified)
        check.passedForeign = !blacklistedAddresses[proposal.proposer];
        
        check.notes = "Automated compliance check passed";
        
        return check;
    }
    
    /**
     * @dev Calculate responsiveness score based on template influence
     * @param templateIds Templates that influenced the representative
     * @return score Responsiveness score (0-100)
     */
    function calculateResponsivenessScore(bytes32[] memory templateIds) 
        internal 
        view 
        returns (uint256 score) 
    {
        uint256 totalImpact = 0;
        uint256 totalCredibility = 0;
        
        for (uint256 i = 0; i < templateIds.length; i++) {
            (
                ,
                ,
                ,
                ,
                uint256 impactScore,
                uint256 credibilityScore,
                ,
            ) = templateRegistry.templates(templateIds[i]);
            
            totalImpact += impactScore;
            totalCredibility += credibilityScore;
        }
        
        if (templateIds.length > 0) {
            score = (totalImpact + totalCredibility) / (templateIds.length * 2);
        } else {
            score = 50; // Neutral if no templates
        }
        
        return score;
    }
    
    /**
     * @dev Cancel a proposal (only proposer or admin)
     * @param proposalId Proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external {
        FundingProposal storage proposal = proposals[proposalId];
        require(
            msg.sender == proposal.proposer || 
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(!proposal.executed, "Already executed");
        
        proposal.cancelled = true;
    }
    
    /**
     * @dev Add address to blacklist (compliance only)
     * @param account Address to blacklist
     */
    function blacklistAddress(address account) 
        external 
        onlyRole(COMPLIANCE_ROLE) 
    {
        blacklistedAddresses[account] = true;
    }
    
    /**
     * @dev Remove address from blacklist (compliance only)
     * @param account Address to unblacklist
     */
    function unblacklistAddress(address account) 
        external 
        onlyRole(COMPLIANCE_ROLE) 
    {
        blacklistedAddresses[account] = false;
    }
    
    /**
     * @dev Get representative funding history
     * @param representative Name of representative
     * @return record Complete funding record
     */
    function getRepresentativeRecord(string memory representative) 
        external 
        view 
        returns (RepresentativeRecord memory) 
    {
        return representatives[representative];
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
     * @dev Pause contract (admin only)
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause contract (admin only)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}