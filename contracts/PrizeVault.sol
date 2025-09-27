// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IVOTERToken.sol";
import "./consensus/ConsensusEngine.sol";
import "./UnifiedRegistry.sol";

/**
 * @title PrizeVault
 * @dev Community-driven prize distribution with quadratic impact
 * @notice No admin - all prizes distributed by consensus
 */
contract PrizeVault {
    
    // Dependencies
    IVOTERToken public immutable voterToken;
    ConsensusEngine public immutable consensusEngine;
    UnifiedRegistry public immutable registry;
    
    // Prize pools
    struct PrizePool {
        string name;
        string description;
        uint256 totalAmount;
        uint256 distributed;
        uint256 startTime;
        uint256 endTime;
        bytes32 consensusId;
        bool active;
        mapping(address => uint256) allocations;
        address[] recipients;
    }
    
    // Quadratic funding parameters
    struct QuadraticRound {
        uint256 matchingPool;
        uint256 contributionsReceived;
        uint256 startBlock;
        uint256 endBlock;
        mapping(address => mapping(address => uint256)) contributions; // contributor => project => amount
        mapping(address => uint256) projectTotals;
        address[] projects;
        bool finalized;
    }
    
    // State
    mapping(bytes32 => PrizePool) public prizePools;
    mapping(uint256 => QuadraticRound) public quadraticRounds;
    bytes32[] public activePools;
    uint256 public currentRound;
    uint256 public totalDistributed;
    
    // Limits
    uint256 public constant MAX_PRIZE_POOL = 1_000_000 * 10**18; // 1M VOTER max per pool
    uint256 public constant MIN_CONTRIBUTORS = 5; // Minimum contributors for quadratic funding
    
    // Events
    event PrizePoolCreated(bytes32 indexed poolId, string name, uint256 amount);
    event PrizeDistributed(bytes32 indexed poolId, address recipient, uint256 amount);
    event QuadraticRoundStarted(uint256 indexed roundId, uint256 matchingPool);
    event QuadraticContribution(uint256 indexed roundId, address contributor, address project, uint256 amount);
    event QuadraticRoundFinalized(uint256 indexed roundId, uint256 totalDistributed);
    
    constructor(
        address _voterToken,
        address _consensusEngine,
        address _registry
    ) {
        require(_voterToken != address(0), "Invalid token");
        require(_consensusEngine != address(0), "Invalid consensus");
        require(_registry != address(0), "Invalid registry");
        
        voterToken = IVOTERToken(_voterToken);
        consensusEngine = ConsensusEngine(_consensusEngine);
        registry = UnifiedRegistry(_registry);
        
        currentRound = 1;
    }
    
    /**
     * @dev Create a prize pool - requires consensus
     */
    function createPrizePool(
        string memory name,
        string memory description,
        uint256 amount,
        uint256 duration,
        bytes32 consensusId
    ) external returns (bytes32 poolId) {
        // Verify consensus approval
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensusEngine.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        require(amount > 0 && amount <= MAX_PRIZE_POOL, "Invalid amount");
        require(duration > 0 && duration <= 90 days, "Invalid duration");
        
        // Generate pool ID
        poolId = keccak256(abi.encodePacked(name, block.timestamp, consensusId));
        require(!prizePools[poolId].active, "Pool already exists");
        
        // Transfer tokens to vault
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        // Initialize pool
        PrizePool storage pool = prizePools[poolId];
        pool.name = name;
        pool.description = description;
        pool.totalAmount = amount;
        pool.startTime = block.timestamp;
        pool.endTime = block.timestamp + duration;
        pool.consensusId = consensusId;
        pool.active = true;
        
        activePools.push(poolId);
        
        emit PrizePoolCreated(poolId, name, amount);
    }
    
    /**
     * @dev Distribute prizes based on impact scores
     */
    function distributePrizes(
        bytes32 poolId,
        address[] memory recipients,
        uint256[] memory amounts
    ) external {
        PrizePool storage pool = prizePools[poolId];
        require(pool.active, "Pool not active");
        require(block.timestamp >= pool.endTime, "Pool still running");
        require(recipients.length == amounts.length, "Mismatched arrays");
        
        uint256 totalToDistribute;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalToDistribute += amounts[i];
        }
        
        require(
            pool.distributed + totalToDistribute <= pool.totalAmount,
            "Exceeds pool amount"
        );
        
        // Distribute to recipients
        for (uint256 i = 0; i < recipients.length; i++) {
            // Verify recipient is registered
            require(registry.isRegistered(recipients[i]), "Recipient not registered");
            
            // Apply quadratic scaling based on reputation
            uint256 reputation = registry.getReputation(recipients[i]);
            uint256 scaledAmount = _applyQuadraticScaling(amounts[i], reputation);
            
            pool.allocations[recipients[i]] += scaledAmount;
            pool.recipients.push(recipients[i]);
            pool.distributed += scaledAmount;
            
            require(
                voterToken.transfer(recipients[i], scaledAmount),
                "Transfer failed"
            );
            
            emit PrizeDistributed(poolId, recipients[i], scaledAmount);
        }
        
        // Mark as inactive if fully distributed
        if (pool.distributed >= pool.totalAmount) {
            pool.active = false;
        }
        
        totalDistributed += totalToDistribute;
    }
    
    /**
     * @dev Start a quadratic funding round
     */
    function startQuadraticRound(
        uint256 matchingPool,
        uint256 duration,
        bytes32 consensusId
    ) external {
        // Verify consensus
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensusEngine.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        require(matchingPool > 0 && matchingPool <= MAX_PRIZE_POOL, "Invalid pool");
        require(duration > 0 && duration <= 30 days, "Invalid duration");
        
        // Transfer matching pool
        require(
            voterToken.transferFrom(msg.sender, address(this), matchingPool),
            "Transfer failed"
        );
        
        QuadraticRound storage round = quadraticRounds[currentRound];
        round.matchingPool = matchingPool;
        round.startBlock = block.number;
        round.endBlock = block.number + (duration / 12); // Approximate blocks
        
        emit QuadraticRoundStarted(currentRound, matchingPool);
        currentRound++;
    }
    
    /**
     * @dev Contribute to a project in quadratic round
     */
    function contributeToProject(
        uint256 roundId,
        address project,
        uint256 amount
    ) external {
        QuadraticRound storage round = quadraticRounds[roundId];
        require(block.number <= round.endBlock, "Round ended");
        require(!round.finalized, "Round finalized");
        require(registry.isRegistered(project), "Project not registered");
        require(amount > 0, "Invalid amount");
        
        // Transfer contribution
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        // Track contribution
        if (round.contributions[msg.sender][project] == 0) {
            round.projects.push(project);
        }
        
        round.contributions[msg.sender][project] += amount;
        round.projectTotals[project] += amount;
        round.contributionsReceived += amount;
        
        emit QuadraticContribution(roundId, msg.sender, project, amount);
    }
    
    /**
     * @dev Finalize quadratic round and distribute matching funds
     */
    function finalizeQuadraticRound(uint256 roundId) external {
        QuadraticRound storage round = quadraticRounds[roundId];
        require(block.number > round.endBlock, "Round not ended");
        require(!round.finalized, "Already finalized");
        
        uint256 totalMatch = round.matchingPool;
        uint256 distributed;
        
        // Calculate quadratic matching for each project
        for (uint256 i = 0; i < round.projects.length; i++) {
            address project = round.projects[i];
            uint256 matchAmount = _calculateQuadraticMatch(
                roundId,
                project,
                totalMatch
            );
            
            if (matchAmount > 0) {
                // Distribute match + contributions
                uint256 totalAmount = round.projectTotals[project] + matchAmount;
                require(
                    voterToken.transfer(project, totalAmount),
                    "Transfer failed"
                );
                
                distributed += totalAmount;
            }
        }
        
        round.finalized = true;
        totalDistributed += distributed;
        
        emit QuadraticRoundFinalized(roundId, distributed);
    }
    
    /**
     * @dev Calculate quadratic match for a project
     */
    function _calculateQuadraticMatch(
        uint256 roundId,
        address project,
        uint256 matchingPool
    ) private view returns (uint256) {
        QuadraticRound storage round = quadraticRounds[roundId];
        
        uint256 sumOfSquareRoots;
        uint256 contributorCount;
        
        // Sum square roots of contributions
        for (uint256 i = 0; i < round.projects.length; i++) {
            if (round.contributions[msg.sender][project] > 0) {
                sumOfSquareRoots += sqrt(round.contributions[msg.sender][project]);
                contributorCount++;
            }
        }
        
        // Require minimum contributors
        if (contributorCount < MIN_CONTRIBUTORS) {
            return 0;
        }
        
        // Calculate match amount: (sum of sqrt)^2 * matching pool / total
        uint256 squared = sumOfSquareRoots * sumOfSquareRoots;
        return (squared * matchingPool) / (round.contributionsReceived + matchingPool);
    }
    
    /**
     * @dev Apply quadratic scaling based on reputation
     */
    function _applyQuadraticScaling(
        uint256 amount,
        uint256 reputation
    ) private pure returns (uint256) {
        // Scale amount based on sqrt of reputation
        // Higher reputation = more efficient distribution
        uint256 repSqrt = sqrt(reputation);
        uint256 scaling = 100 + (repSqrt * 10); // 100% base + up to 100% bonus
        
        return (amount * scaling) / 100;
    }
    
    /**
     * @dev Babylonian method square root
     */
    function sqrt(uint256 x) private pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
    
    /**
     * @dev Get pool details
     */
    function getPoolDetails(bytes32 poolId) external view returns (
        string memory name,
        uint256 total,
        uint256 distributed,
        uint256 remaining,
        bool active
    ) {
        PrizePool storage pool = prizePools[poolId];
        name = pool.name;
        total = pool.totalAmount;
        distributed = pool.distributed;
        remaining = total - distributed;
        active = pool.active;
    }
    
    /**
     * @dev Get active pools
     */
    function getActivePools() external view returns (bytes32[] memory) {
        uint256 count;
        for (uint256 i = 0; i < activePools.length; i++) {
            if (prizePools[activePools[i]].active) {
                count++;
            }
        }
        
        bytes32[] memory active = new bytes32[](count);
        uint256 index;
        for (uint256 i = 0; i < activePools.length; i++) {
            if (prizePools[activePools[i]].active) {
                active[index++] = activePools[i];
            }
        }
        
        return active;
    }
}

// Community rewards through consensus, not corporate handouts