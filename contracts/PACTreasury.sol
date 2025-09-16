// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERToken.sol";
import "./ImpactRegistry.sol";

/**
 * @title PACTreasury
 * @dev Revolutionary transparent PAC using quadratic funding and algorithmic decisions
 * @notice First fully transparent, citizen-driven political funding mechanism
 */
contract PACTreasury is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant CONTRIBUTOR_ROLE = keccak256("CONTRIBUTOR_ROLE");
    
    IVOTERToken public immutable voterToken;
    ImpactRegistry public immutable impactRegistry;
    
    // FEC Limits (updatable via governance)
    uint256 public FEC_INDIVIDUAL_LIMIT = 3_300 * 10**18;  // $3,300 per candidate per election
    uint256 public FEC_PAC_LIMIT = 5_000 * 10**18;        // $5,000 per candidate per election
    uint256 public ELECTION_CYCLE_DURATION = 2 * 365 days; // 2 years
    
    // Quadratic Funding Pool
    uint256 public quadraticMatchingPool;
    uint256 public currentFundingRound;
    
    struct ContributorProfile {
        bool isEmployee;
        bool isShareholder;
        bool isRestrictedClass;
        uint256 totalContributed;
        uint256 autoContributionRate; // Percentage of earned VOTER tokens (0-100)
    }
    
    struct FundingProposal {
        string representative;
        string district;
        uint256 targetAmount;
        uint256 impactThreshold;
        uint256 roundId;
        uint256 totalDirectContributions;
        uint256 quadraticMatch;
        uint256 createdAt;
        uint256 votingDeadline;
        bool executed;
        mapping(address => uint256) contributions; // contributor => amount
        address[] contributors;
    }
    
    struct RepresentativeFunding {
        uint256 totalFunded;
        uint256 lastFundingCycle;
        uint256 currentCycleFunding;
    }
    
    // State tracking
    mapping(address => ContributorProfile) public contributors;
    mapping(uint256 => FundingProposal) public proposals;
    mapping(string => RepresentativeFunding) public representativeFunding;
    mapping(uint256 => mapping(string => uint256)) public roundProposals; // round => representative => proposalId
    
    uint256 public proposalCount;
    uint256 public totalPACBalance;
    uint256 public totalDistributed;
    
    // Quadratic funding parameters
    uint256 public constant MIN_CONTRIBUTORS = 10;      // Minimum contributors for QF
    uint256 public constant QF_AMPLIFICATION_CAP = 10;  // Max 10x amplification
    
    // Events
    event ContributorRegistered(address indexed contributor, bool employee, bool shareholder);
    event ContributionMade(address indexed contributor, uint256 proposalId, uint256 amount);
    event AutoContributionSet(address indexed contributor, uint256 rate);
    event QuadraticFundingCalculated(uint256 indexed proposalId, uint256 match, uint256 contributors);
    event RepresentativeFunded(string representative, uint256 amount, uint256 proposalId);
    event FECLimitUpdated(uint256 newLimit, string limitType);
    event FundingProposalCreated(uint256 indexed proposalId, string representative, uint256 targetAmount);
    
    constructor(
        address admin,
        address _voterToken,
        address _impactRegistry
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        
        voterToken = IVOTERToken(_voterToken);
        impactRegistry = ImpactRegistry(_impactRegistry);
        
        currentFundingRound = 1;
    }
    
    /**
     * @dev Register contributor in restricted class (employees/shareholders)
     * @param contributor Address to register
     * @param isEmployee True if employee
     * @param isShareholder True if shareholder
     */
    function registerContributor(
        address contributor,
        bool isEmployee,
        bool isShareholder
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(isEmployee || isShareholder, "Must be employee or shareholder");
        
        contributors[contributor] = ContributorProfile({
            isEmployee: isEmployee,
            isShareholder: isShareholder,
            isRestrictedClass: true,
            totalContributed: 0,
            autoContributionRate: 0
        });
        
        _grantRole(CONTRIBUTOR_ROLE, contributor);
        
        emit ContributorRegistered(contributor, isEmployee, isShareholder);
    }
    
    /**
     * @dev Set automatic contribution rate for earned VOTER tokens
     * @param rate Percentage (0-100) of earned tokens to auto-contribute
     */
    function setAutoContributionRate(uint256 rate) external {
        require(rate <= 100, "Rate cannot exceed 100%");
        require(contributors[msg.sender].isRestrictedClass, "Not in restricted class");
        
        contributors[msg.sender].autoContributionRate = rate;
        
        emit AutoContributionSet(msg.sender, rate);
    }
    
    /**
     * @dev Create funding proposal for representative based on impact score
     * @param representative Name of representative
     * @param district Congressional district
     * @param targetAmount Target funding amount
     * @param impactThreshold Minimum impact score required
     */
    function createFundingProposal(
        string memory representative,
        string memory district,
        uint256 targetAmount,
        uint256 impactThreshold
    ) external onlyRole(CONTRIBUTOR_ROLE) returns (uint256 proposalId) {
        // Check impact score meets threshold
        uint256 currentImpact = impactRegistry.getRepresentativeScore(representative);
        require(currentImpact >= impactThreshold, "Impact score below threshold");
        
        // Check FEC limits
        RepresentativeFunding storage repFunding = representativeFunding[representative];
        uint256 currentCycle = block.timestamp / ELECTION_CYCLE_DURATION;
        
        if (repFunding.lastFundingCycle < currentCycle) {
            repFunding.currentCycleFunding = 0;
            repFunding.lastFundingCycle = currentCycle;
        }
        
        require(
            repFunding.currentCycleFunding + targetAmount <= FEC_PAC_LIMIT,
            "Would exceed FEC limit for this cycle"
        );
        
        proposalId = proposalCount++;
        FundingProposal storage proposal = proposals[proposalId];
        
        proposal.representative = representative;
        proposal.district = district;
        proposal.targetAmount = targetAmount;
        proposal.impactThreshold = impactThreshold;
        proposal.roundId = currentFundingRound;
        proposal.createdAt = block.timestamp;
        proposal.votingDeadline = block.timestamp + 7 days;
        proposal.executed = false;
        
        roundProposals[currentFundingRound][representative] = proposalId;
        
        emit FundingProposalCreated(proposalId, representative, targetAmount);
        
        return proposalId;
    }
    
    /**
     * @dev Contribute to a funding proposal
     * @param proposalId Proposal to contribute to
     * @param amount Amount to contribute
     */
    function contribute(uint256 proposalId, uint256 amount) external onlyRole(CONTRIBUTOR_ROLE) {
        require(amount > 0, "Amount must be positive");
        FundingProposal storage proposal = proposals[proposalId];
        require(proposal.createdAt > 0, "Proposal does not exist");
        require(block.timestamp <= proposal.votingDeadline, "Voting period ended");
        require(!proposal.executed, "Already executed");
        
        // Transfer tokens from contributor
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        // Track contribution
        if (proposal.contributions[msg.sender] == 0) {
            proposal.contributors.push(msg.sender);
        }
        
        proposal.contributions[msg.sender] += amount;
        proposal.totalDirectContributions += amount;
        contributors[msg.sender].totalContributed += amount;
        
        totalPACBalance += amount;
        
        emit ContributionMade(msg.sender, proposalId, amount);
    }
    
    /**
     * @dev Execute funding proposal with quadratic matching
     * @param proposalId Proposal to execute
     */
    function executeFunding(uint256 proposalId) external onlyRole(GOVERNANCE_ROLE) {
        FundingProposal storage proposal = proposals[proposalId];
        require(proposal.createdAt > 0, "Proposal does not exist");
        require(block.timestamp > proposal.votingDeadline, "Voting still active");
        require(!proposal.executed, "Already executed");
        require(proposal.contributors.length >= MIN_CONTRIBUTORS, "Insufficient contributors");
        
        // Verify impact score still meets threshold
        uint256 currentImpact = impactRegistry.getRepresentativeScore(proposal.representative);
        require(currentImpact >= proposal.impactThreshold, "Impact score dropped below threshold");
        
        // Calculate quadratic funding match
        uint256 quadraticSum = calculateQuadraticSum(proposalId);
        uint256 directSum = proposal.totalDirectContributions;
        
        // Calculate matching amount with amplification cap
        uint256 baseMatch = quadraticSum > directSum ? quadraticSum - directSum : 0;
        uint256 maxMatch = directSum * (QF_AMPLIFICATION_CAP - 1); // Max 10x total (including direct)
        uint256 finalMatch = baseMatch > maxMatch ? maxMatch : baseMatch;
        
        // Ensure we have matching funds available
        if (finalMatch > quadraticMatchingPool) {
            finalMatch = quadraticMatchingPool;
        }
        
        proposal.quadraticMatch = finalMatch;
        proposal.executed = true;
        
        // Update representative funding tracking
        RepresentativeFunding storage repFunding = representativeFunding[proposal.representative];
        uint256 totalFunding = directSum + finalMatch;
        repFunding.totalFunded += totalFunding;
        repFunding.currentCycleFunding += totalFunding;
        
        // Update balances
        totalPACBalance -= directSum;
        quadraticMatchingPool -= finalMatch;
        totalDistributed += totalFunding;
        
        // Transfer funds (in production would go to appropriate recipient)
        // For now, we track the funding decision on-chain
        
        emit QuadraticFundingCalculated(proposalId, finalMatch, proposal.contributors.length);
        emit RepresentativeFunded(proposal.representative, totalFunding, proposalId);
    }
    
    /**
     * @dev Calculate quadratic sum for funding proposal
     * @param proposalId Proposal to calculate for
     * @return quadraticSum The quadratic sum of square roots
     */
    function calculateQuadraticSum(uint256 proposalId) public view returns (uint256) {
        FundingProposal storage proposal = proposals[proposalId];
        uint256 sumOfSqrts = 0;
        
        // Calculate sum of square roots of contributions
        for (uint256 i = 0; i < proposal.contributors.length; i++) {
            address contributor = proposal.contributors[i];
            uint256 contribution = proposal.contributions[contributor];
            sumOfSqrts += sqrt(contribution);
        }
        
        return sumOfSqrts * sumOfSqrts;
    }
    
    /**
     * @dev Handle automatic contributions from earned VOTER tokens
     * @param contributor Address earning tokens
     * @param earnedAmount Amount of tokens earned
     */
    function processAutoContribution(
        address contributor,
        uint256 earnedAmount
    ) external returns (uint256 contributionAmount) {
        require(contributors[contributor].isRestrictedClass, "Not in restricted class");
        
        uint256 rate = contributors[contributor].autoContributionRate;
        if (rate == 0) return 0;
        
        contributionAmount = (earnedAmount * rate) / 100;
        
        // Transfer auto-contribution to PAC
        require(
            voterToken.transferFrom(contributor, address(this), contributionAmount),
            "Auto-contribution transfer failed"
        );
        
        totalPACBalance += contributionAmount;
        contributors[contributor].totalContributed += contributionAmount;
        
        return contributionAmount;
    }
    
    /**
     * @dev Deposit to quadratic matching pool
     * @param amount Amount to deposit
     */
    function depositToMatchingPool(uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        quadraticMatchingPool += amount;
    }
    
    /**
     * @dev Update FEC limits (governance only)
     * @param newLimit New limit amount
     * @param limitType Type of limit ("individual" or "pac")
     */
    function updateFECLimit(uint256 newLimit, string memory limitType) external onlyRole(GOVERNANCE_ROLE) {
        if (keccak256(bytes(limitType)) == keccak256(bytes("individual"))) {
            FEC_INDIVIDUAL_LIMIT = newLimit;
        } else if (keccak256(bytes(limitType)) == keccak256(bytes("pac"))) {
            FEC_PAC_LIMIT = newLimit;
        } else {
            revert("Invalid limit type");
        }
        
        emit FECLimitUpdated(newLimit, limitType);
    }
    
    /**
     * @dev Start new funding round
     */
    function startNewFundingRound() external onlyRole(GOVERNANCE_ROLE) {
        currentFundingRound++;
    }
    
    /**
     * @dev Get proposal contributors and amounts
     * @param proposalId Proposal to query
     */
    function getProposalContributions(uint256 proposalId) 
        external 
        view 
        returns (address[] memory contributorList, uint256[] memory amounts) 
    {
        FundingProposal storage proposal = proposals[proposalId];
        uint256 length = proposal.contributors.length;
        
        contributorList = new address[](length);
        amounts = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            address contributor = proposal.contributors[i];
            contributorList[i] = contributor;
            amounts[i] = proposal.contributions[contributor];
        }
        
        return (contributorList, amounts);
    }
    
    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Square root function (simplified - would use library in production)
     * @param x Number to find square root of
     * @return y Square root result
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}