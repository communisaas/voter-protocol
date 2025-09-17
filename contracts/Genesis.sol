// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgentConsensus.sol";
import "./AgentParameters.sol";
import "./PACTreasury.sol";
import "./CommuniqueCore.sol";
import "./ImpactRegistry.sol";

/**
 * @title Genesis
 * @dev One-time bootstrap contract that initializes the protocol and self-destructs
 * @notice The trust anchor: hardcoded parameters for transparent genesis
 */
contract Genesis {
    // Immutable addresses set at deployment
    address public immutable agentConsensus;
    address public immutable agentParameters;
    address public immutable pacTreasury;
    address public immutable communiqueCore;
    address public immutable impactRegistry;
    address public immutable voterToken;
    
    // Conservative genesis parameters (hardcoded for transparency)
    uint256 public constant INITIAL_MIN_STAKE = 1000e18; // 1000 VOTER tokens to become agent
    uint256 public constant INITIAL_QUORUM_PERCENTAGE = 66; // 66% quorum for decisions
    uint256 public constant INITIAL_VOTING_PERIOD = 3 days; // 3 day voting period
    uint256 public constant INITIAL_SLASH_PERCENTAGE = 10; // 10% stake slash for malicious behavior
    
    // Initial reward parameters (conservative)
    uint256 public constant INITIAL_CWC_REWARD_USD = 1e7; // $0.10 per CWC message
    uint256 public constant INITIAL_DIRECT_ACTION_REWARD_USD = 1e7; // $0.10 per direct action
    uint256 public constant INITIAL_MAX_DAILY_MINT_USER = 100e18; // 100 tokens per user per day
    uint256 public constant INITIAL_MAX_DAILY_MINT_PROTOCOL = 10000e18; // 10k tokens protocol-wide per day
    
    // Agent class requirements (enforced diversity)
    uint256 public constant MIN_MAJOR_PROVIDER_AGENTS = 2; // At least 2 from major providers
    uint256 public constant MIN_OPENSOURCE_AGENTS = 3; // At least 3 open-source agents
    uint256 public constant MIN_SPECIALIZED_AGENTS = 1; // At least 1 specialized agent
    
    bool public initialized = false;
    address public immutable deployer;
    
    event GenesisInitialized(
        address indexed agentConsensus,
        uint256 timestamp,
        uint256 minStake,
        uint256 quorum
    );
    
    event GenesisComplete(uint256 timestamp);
    
    constructor(
        address _agentConsensus,
        address _agentParameters,
        address _pacTreasury,
        address _communiqueCore,
        address _impactRegistry,
        address _voterToken
    ) {
        require(_agentConsensus != address(0), "Invalid consensus address");
        require(_agentParameters != address(0), "Invalid parameters address");
        require(_pacTreasury != address(0), "Invalid treasury address");
        require(_communiqueCore != address(0), "Invalid core address");
        require(_impactRegistry != address(0), "Invalid registry address");
        require(_voterToken != address(0), "Invalid token address");
        
        agentConsensus = _agentConsensus;
        agentParameters = _agentParameters;
        pacTreasury = _pacTreasury;
        communiqueCore = _communiqueCore;
        impactRegistry = _impactRegistry;
        voterToken = _voterToken;
        deployer = msg.sender;
    }
    
    /**
     * @dev Initialize the protocol with conservative parameters and hand control to agents
     * @notice This can only be called once. After execution, this contract becomes powerless.
     */
    function initialize() external {
        require(!initialized, "Already initialized");
        require(msg.sender == deployer, "Only deployer can initialize");
        
        // Initialize AgentConsensus with genesis parameters
        AgentConsensus(agentConsensus).initialize(
            INITIAL_MIN_STAKE,
            INITIAL_QUORUM_PERCENTAGE,
            INITIAL_VOTING_PERIOD,
            INITIAL_SLASH_PERCENTAGE,
            MIN_MAJOR_PROVIDER_AGENTS,
            MIN_OPENSOURCE_AGENTS,
            MIN_SPECIALIZED_AGENTS,
            voterToken
        );
        
        // Set initial parameters in AgentParameters
        AgentParameters params = AgentParameters(agentParameters);
        params.setGenesisParameters(
            INITIAL_CWC_REWARD_USD,
            INITIAL_DIRECT_ACTION_REWARD_USD,
            INITIAL_MAX_DAILY_MINT_USER,
            INITIAL_MAX_DAILY_MINT_PROTOCOL
        );
        
        // Transfer control of all contracts to AgentConsensus
        params.transferControlToConsensus(agentConsensus);
        PACTreasury(pacTreasury).transferControlToConsensus(agentConsensus);
        CommuniqueCore(communiqueCore).transferControlToConsensus(agentConsensus);
        ImpactRegistry(impactRegistry).transferControlToConsensus(agentConsensus);
        
        initialized = true;
        
        emit GenesisInitialized(
            agentConsensus,
            block.timestamp,
            INITIAL_MIN_STAKE,
            INITIAL_QUORUM_PERCENTAGE
        );
        
        // This contract has served its purpose
        emit GenesisComplete(block.timestamp);
        
        // Note: selfdestruct is deprecated in newer Solidity versions
        // Instead, this contract simply becomes inert after initialization
        // All its functions will revert, and it holds no funds or permissions
    }
    
    /**
     * @dev Prevent any further actions after initialization
     */
    modifier onlyBeforeInit() {
        require(!initialized, "Genesis complete");
        _;
    }
    
    // Reject any ETH sent to this contract
    receive() external payable {
        revert("Genesis accepts no funds");
    }
    
    fallback() external payable {
        revert("Genesis accepts no calls");
    }
}