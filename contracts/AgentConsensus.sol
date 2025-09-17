// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IVOTERToken.sol";

/**
 * @title AgentConsensus
 * @dev Multi-class agent consensus system replacing centralized governance
 * @notice The Zoo Model: diverse agents prevent collusion
 */
contract AgentConsensus is ReentrancyGuard, Pausable {
    
    enum AgentClass {
        MAJOR_PROVIDER,    // OpenAI, Anthropic, Google
        OPEN_SOURCE,       // Llama, Mixtral, etc.
        SPECIALIZED        // Task-specific models
    }
    
    enum ProposalType {
        PARAMETER_UPDATE,
        TREASURY_DISBURSEMENT,
        AGENT_REGISTRATION,
        AGENT_REMOVAL,
        EMERGENCY_PAUSE
    }
    
    struct Agent {
        address operator;           // Address operating the agent
        AgentClass class;          // Agent classification
        string modelIdentifier;     // Model name/version
        uint256 stakedAmount;       // Staked VOTER tokens
        uint256 reputationScore;    // Performance history (0-100)
        uint256 registeredAt;       // Registration timestamp
        uint256 lastActivityAt;     // Last participation timestamp
        uint256 slashEvents;        // Number of times slashed
        bool isActive;              // Active status
        bytes32 proofOfOperation;  // Hash proving independent operation
    }
    
    struct Proposal {
        ProposalType proposalType;
        bytes payload;              // Encoded function call
        address targetContract;     // Contract to execute on
        uint256 createdAt;
        uint256 votingEndsAt;
        uint256 executionDelay;     // Time after voting before execution
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
        bool vetoed;
        string ipfsHash;           // Detailed proposal documentation
        mapping(address => bool) hasVoted;
        mapping(address => bool) votes; // true = yes, false = no
    }
    
    struct VotingPower {
        uint256 majorProviderVotes;
        uint256 openSourceVotes;
        uint256 specializedVotes;
        uint256 totalVotes;
    }
    
    // State variables
    IVOTERToken public voterToken;
    uint256 public minStakeAmount;
    uint256 public quorumPercentage;
    uint256 public votingPeriod;
    uint256 public slashPercentage;
    uint256 public proposalCount;
    
    // Agent diversity requirements
    uint256 public minMajorProviderAgents;
    uint256 public minOpenSourceAgents;
    uint256 public minSpecializedAgents;
    
    // Class-based voting weights (basis points, 10000 = 100%)
    uint256 public constant MAJOR_PROVIDER_WEIGHT = 3300;  // 33%
    uint256 public constant OPEN_SOURCE_WEIGHT = 3400;     // 34%
    uint256 public constant SPECIALIZED_WEIGHT = 3300;     // 33%
    
    // Agent registry
    mapping(address => Agent) public agents;
    mapping(bytes32 => bool) public usedProofs; // Prevent proof reuse
    address[] public agentList;
    
    // Proposals
    mapping(uint256 => Proposal) public proposals;
    
    // Reputation decay
    uint256 public constant REPUTATION_DECAY_PERIOD = 30 days;
    uint256 public constant REPUTATION_DECAY_RATE = 5; // 5 points per period
    
    // Circuit breaker
    address public circuitBreakerMultisig;
    bool public emergencyPause = false;
    
    // Events
    event AgentRegistered(
        address indexed agent,
        AgentClass class,
        string model,
        uint256 stake
    );
    
    event ProposalCreated(
        uint256 indexed proposalId,
        ProposalType proposalType,
        address proposer,
        string ipfsHash
    );
    
    event VoteCast(
        uint256 indexed proposalId,
        address indexed agent,
        bool support,
        uint256 weight
    );
    
    event ProposalExecuted(
        uint256 indexed proposalId,
        bool success,
        bytes returnData
    );
    
    event AgentSlashed(
        address indexed agent,
        uint256 amount,
        string reason
    );
    
    event ProofChallengeIssued(
        address indexed agent,
        bytes32 challenge
    );
    
    modifier onlyActiveAgent() {
        require(agents[msg.sender].isActive, "Not an active agent");
        _;
    }
    
    modifier onlyCircuitBreaker() {
        require(msg.sender == circuitBreakerMultisig, "Not circuit breaker");
        _;
    }
    
    /**
     * @dev Initialize consensus system (called by Genesis contract only)
     */
    function initialize(
        uint256 _minStake,
        uint256 _quorumPercentage,
        uint256 _votingPeriod,
        uint256 _slashPercentage,
        uint256 _minMajorProvider,
        uint256 _minOpenSource,
        uint256 _minSpecialized,
        address _voterToken
    ) external {
        require(address(voterToken) == address(0), "Already initialized");
        require(_voterToken != address(0), "Invalid token");
        
        voterToken = IVOTERToken(_voterToken);
        minStakeAmount = _minStake;
        quorumPercentage = _quorumPercentage;
        votingPeriod = _votingPeriod;
        slashPercentage = _slashPercentage;
        minMajorProviderAgents = _minMajorProvider;
        minOpenSourceAgents = _minOpenSource;
        minSpecializedAgents = _minSpecialized;
    }
    
    /**
     * @dev Register as an agent with proof of independent operation
     */
    function registerAgent(
        AgentClass _class,
        string memory _modelIdentifier,
        uint256 _stakeAmount,
        bytes32 _proofOfOperation
    ) external nonReentrant {
        require(_stakeAmount >= minStakeAmount, "Insufficient stake");
        require(!agents[msg.sender].isActive, "Already registered");
        require(!usedProofs[_proofOfOperation], "Proof already used");
        
        // Transfer stake
        require(
            voterToken.transferFrom(msg.sender, address(this), _stakeAmount),
            "Stake transfer failed"
        );
        
        // Register agent
        agents[msg.sender] = Agent({
            operator: msg.sender,
            class: _class,
            modelIdentifier: _modelIdentifier,
            stakedAmount: _stakeAmount,
            reputationScore: 50, // Start at neutral
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            slashEvents: 0,
            isActive: true,
            proofOfOperation: _proofOfOperation
        });
        
        agentList.push(msg.sender);
        usedProofs[_proofOfOperation] = true;
        
        emit AgentRegistered(msg.sender, _class, _modelIdentifier, _stakeAmount);
    }
    
    /**
     * @dev Create a proposal for consensus voting
     */
    function createProposal(
        ProposalType _type,
        address _target,
        bytes memory _payload,
        string memory _ipfsHash,
        uint256 _executionDelay
    ) external onlyActiveAgent returns (uint256 proposalId) {
        require(checkDiversityRequirements(), "Insufficient agent diversity");
        
        proposalId = proposalCount++;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.proposalType = _type;
        proposal.targetContract = _target;
        proposal.payload = _payload;
        proposal.createdAt = block.timestamp;
        proposal.votingEndsAt = block.timestamp + votingPeriod;
        proposal.executionDelay = _executionDelay;
        proposal.ipfsHash = _ipfsHash;
        proposal.executed = false;
        proposal.vetoed = false;
        
        // Update agent activity
        agents[msg.sender].lastActivityAt = block.timestamp;
        
        emit ProposalCreated(proposalId, _type, msg.sender, _ipfsHash);
    }
    
    /**
     * @dev Cast vote on a proposal
     */
    function castVote(uint256 _proposalId, bool _support) external onlyActiveAgent {
        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp <= proposal.votingEndsAt, "Voting ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        
        Agent storage agent = agents[msg.sender];
        
        // Calculate voting weight based on class and reputation
        uint256 weight = calculateVotingWeight(agent);
        
        proposal.hasVoted[msg.sender] = true;
        proposal.votes[msg.sender] = _support;
        
        if (_support) {
            proposal.yesVotes += weight;
        } else {
            proposal.noVotes += weight;
        }
        
        // Update activity
        agent.lastActivityAt = block.timestamp;
        
        // Reward participation
        if (agent.reputationScore < 95) {
            agent.reputationScore += 1;
        }
        
        emit VoteCast(_proposalId, msg.sender, _support, weight);
    }
    
    /**
     * @dev Execute a passed proposal after delay
     */
    function executeProposal(uint256 _proposalId) external nonReentrant {
        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp > proposal.votingEndsAt, "Voting not ended");
        require(
            block.timestamp >= proposal.votingEndsAt + proposal.executionDelay,
            "Execution delay not met"
        );
        require(!proposal.executed, "Already executed");
        require(!proposal.vetoed, "Proposal vetoed");
        require(!emergencyPause, "System paused");
        
        // Check quorum and approval
        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;
        uint256 quorumVotes = (getTotalStake() * quorumPercentage) / 100;
        require(totalVotes >= quorumVotes, "Quorum not met");
        require(proposal.yesVotes > proposal.noVotes, "Proposal not approved");
        
        // Check class participation requirements
        require(checkClassParticipation(_proposalId), "Insufficient class diversity");
        
        proposal.executed = true;
        
        // Execute the proposal
        (bool success, bytes memory returnData) = proposal.targetContract.call(
            proposal.payload
        );
        
        if (!success) {
            // Slash agents who voted yes on failed proposal
            slashFailedProposalVoters(_proposalId);
        }
        
        emit ProposalExecuted(_proposalId, success, returnData);
    }
    
    /**
     * @dev Challenge an agent's proof of operation
     */
    function challengeAgent(
        address _agent,
        bytes32 _newChallenge
    ) external onlyActiveAgent {
        Agent storage challenged = agents[_agent];
        require(challenged.isActive, "Agent not active");
        
        // Issue challenge that agent must respond to
        emit ProofChallengeIssued(_agent, _newChallenge);
        
        // Agent has 24 hours to respond with valid proof
        // Implementation would include challenge-response verification
    }
    
    /**
     * @dev Slash an agent's stake for malicious behavior
     */
    function slashAgent(
        address _agent,
        string memory _reason
    ) internal {
        Agent storage agent = agents[_agent];
        require(agent.isActive, "Agent not active");
        
        uint256 slashAmount = (agent.stakedAmount * slashPercentage) / 100;
        agent.stakedAmount -= slashAmount;
        agent.slashEvents++;
        
        // Reduce reputation
        if (agent.reputationScore >= 20) {
            agent.reputationScore -= 20;
        } else {
            agent.reputationScore = 0;
        }
        
        // Remove if stake too low
        if (agent.stakedAmount < minStakeAmount) {
            agent.isActive = false;
        }
        
        emit AgentSlashed(_agent, slashAmount, _reason);
    }
    
    /**
     * @dev Slash agents who voted yes on failed proposals
     */
    function slashFailedProposalVoters(uint256 _proposalId) internal {
        Proposal storage proposal = proposals[_proposalId];
        
        for (uint256 i = 0; i < agentList.length; i++) {
            address agent = agentList[i];
            if (proposal.hasVoted[agent] && proposal.votes[agent]) {
                slashAgent(agent, "Voted yes on failed proposal");
            }
        }
    }
    
    /**
     * @dev Calculate voting weight based on class and reputation
     */
    function calculateVotingWeight(Agent memory _agent) internal pure returns (uint256) {
        uint256 baseWeight;
        
        if (_agent.class == AgentClass.MAJOR_PROVIDER) {
            baseWeight = MAJOR_PROVIDER_WEIGHT;
        } else if (_agent.class == AgentClass.OPEN_SOURCE) {
            baseWeight = OPEN_SOURCE_WEIGHT;
        } else {
            baseWeight = SPECIALIZED_WEIGHT;
        }
        
        // Adjust by reputation (50-150% of base weight)
        uint256 repMultiplier = 50 + _agent.reputationScore;
        return (baseWeight * repMultiplier) / 100;
    }
    
    /**
     * @dev Check if minimum diversity requirements are met
     */
    function checkDiversityRequirements() public view returns (bool) {
        uint256 majorProviders = 0;
        uint256 openSource = 0;
        uint256 specialized = 0;
        
        for (uint256 i = 0; i < agentList.length; i++) {
            Agent memory agent = agents[agentList[i]];
            if (!agent.isActive) continue;
            
            if (agent.class == AgentClass.MAJOR_PROVIDER) majorProviders++;
            else if (agent.class == AgentClass.OPEN_SOURCE) openSource++;
            else if (agent.class == AgentClass.SPECIALIZED) specialized++;
        }
        
        return (
            majorProviders >= minMajorProviderAgents &&
            openSource >= minOpenSourceAgents &&
            specialized >= minSpecializedAgents
        );
    }
    
    /**
     * @dev Check if all classes participated in voting
     */
    function checkClassParticipation(uint256 _proposalId) internal view returns (bool) {
        Proposal storage proposal = proposals[_proposalId];
        bool hasMajorProvider = false;
        bool hasOpenSource = false;
        bool hasSpecialized = false;
        
        for (uint256 i = 0; i < agentList.length; i++) {
            address agentAddr = agentList[i];
            if (!proposal.hasVoted[agentAddr]) continue;
            
            Agent memory agent = agents[agentAddr];
            if (agent.class == AgentClass.MAJOR_PROVIDER) hasMajorProvider = true;
            else if (agent.class == AgentClass.OPEN_SOURCE) hasOpenSource = true;
            else if (agent.class == AgentClass.SPECIALIZED) hasSpecialized = true;
        }
        
        return hasMajorProvider && hasOpenSource && hasSpecialized;
    }
    
    /**
     * @dev Get total staked across all agents
     */
    function getTotalStake() public view returns (uint256 total) {
        for (uint256 i = 0; i < agentList.length; i++) {
            if (agents[agentList[i]].isActive) {
                total += agents[agentList[i]].stakedAmount;
            }
        }
    }
    
    /**
     * @dev Apply reputation decay for inactive agents
     */
    function applyReputationDecay(address _agent) external {
        Agent storage agent = agents[_agent];
        require(agent.isActive, "Agent not active");
        
        uint256 inactivePeriods = (block.timestamp - agent.lastActivityAt) / REPUTATION_DECAY_PERIOD;
        if (inactivePeriods > 0) {
            uint256 decay = inactivePeriods * REPUTATION_DECAY_RATE;
            if (agent.reputationScore > decay) {
                agent.reputationScore -= decay;
            } else {
                agent.reputationScore = 0;
            }
        }
    }
    
    /**
     * @dev Emergency pause (circuit breaker only)
     */
    function emergencyStop() external onlyCircuitBreaker {
        emergencyPause = true;
        _pause();
    }
    
    /**
     * @dev Set circuit breaker multisig (one-time, called by Genesis)
     */
    function setCircuitBreaker(address _multisig) external {
        require(circuitBreakerMultisig == address(0), "Already set");
        circuitBreakerMultisig = _multisig;
    }
    
    /**
     * @dev Get voting power breakdown for a proposal
     */
    function getVotingPowerBreakdown(uint256 _proposalId) 
        external 
        view 
        returns (VotingPower memory) 
    {
        Proposal storage proposal = proposals[_proposalId];
        VotingPower memory power;
        
        for (uint256 i = 0; i < agentList.length; i++) {
            address agentAddr = agentList[i];
            if (!proposal.hasVoted[agentAddr]) continue;
            
            Agent memory agent = agents[agentAddr];
            uint256 weight = calculateVotingWeight(agent);
            
            if (proposal.votes[agentAddr]) {
                power.totalVotes += weight;
                if (agent.class == AgentClass.MAJOR_PROVIDER) {
                    power.majorProviderVotes += weight;
                } else if (agent.class == AgentClass.OPEN_SOURCE) {
                    power.openSourceVotes += weight;
                } else {
                    power.specializedVotes += weight;
                }
            }
        }
        
        return power;
    }
}