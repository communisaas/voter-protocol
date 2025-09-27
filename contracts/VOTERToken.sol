// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./consensus/ConsensusEngine.sol";
import "./consensus/ImmutableBounds.sol";

/**
 * @title VOTERToken
 * @dev Fixed supply governance token with halving emission schedule
 * @notice No admin minting - only consensus-controlled emissions
 */
contract VOTERToken is ReentrancyGuard, ERC20, ERC20Permit, ERC20Votes {
    // Dependencies
    ConsensusEngine public immutable consensusEngine;
    ImmutableBounds public immutable bounds;
    address public immutable communiqueCore; // Only contract that can mint
    
    // Fixed supply parameters
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion VOTER
    uint256 public constant INITIAL_EMISSION = 100_000_000 * 10**18; // 100M first year
    uint256 public constant HALVING_PERIOD = 365 days; // Annual halving
    uint256 public constant MIN_EMISSION = 1_000_000 * 10**18; // 1M floor emission
    
    // Emission tracking
    uint256 public currentEpoch;
    uint256 public epochStartTime;
    uint256 public epochEmissionRate;
    uint256 public totalMinted;
    uint256 public epochMinted;
    
    // Daily emission caps
    mapping(uint256 => uint256) public dailyEmissions; // day => amount minted
    
    // Events
    event TokensEarned(address indexed citizen, uint256 amount, bytes32 actionType);
    event EpochAdvanced(uint256 epoch, uint256 emissionRate);
    event EmergencyMint(address recipient, uint256 amount, bytes32 consensusId);
    
    constructor(
        address _consensusEngine,
        address _bounds,
        address _communiqueCore
    ) 
        ERC20("VOTER Governance Token", "VOTER")
        ERC20Permit("VOTER Governance Token")
    {
        require(_consensusEngine != address(0), "Invalid consensus");
        require(_bounds != address(0), "Invalid bounds");
        require(_communiqueCore != address(0), "Invalid core");
        
        consensusEngine = ConsensusEngine(_consensusEngine);
        bounds = ImmutableBounds(_bounds);
        communiqueCore = _communiqueCore;
        
        // Initialize first epoch
        currentEpoch = 1;
        epochStartTime = block.timestamp;
        epochEmissionRate = INITIAL_EMISSION;
    }
    
    /**
     * @dev Mint tokens for civic actions - ONLY callable by CommuniqueCore
     * @param to Recipient address
     * @param amount Amount to mint
     * @param actionHash Hash of the civic action
     */
    function mintReward(
        address to,
        uint256 amount,
        bytes32 actionHash
    ) external nonReentrant {
        require(msg.sender == communiqueCore, "Only CommuniqueCore");
        require(to != address(0), "Invalid recipient");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        
        // Check if epoch should advance
        if (block.timestamp >= epochStartTime + HALVING_PERIOD) {
            _advanceEpoch();
        }
        
        // Check daily emission cap
        uint256 today = block.timestamp / 1 days;
        uint256 dailyCap = epochEmissionRate / 365; // Daily allocation
        require(dailyEmissions[today] + amount <= dailyCap, "Daily cap exceeded");
        
        // Check epoch limit
        require(epochMinted + amount <= epochEmissionRate, "Epoch limit exceeded");
        
        // Mint tokens
        _mint(to, amount);
        
        // Update tracking
        totalMinted += amount;
        epochMinted += amount;
        dailyEmissions[today] += amount;
        
        emit TokensEarned(to, amount, actionHash);
    }
    
    /**
     * @dev Advance to next epoch with halving
     */
    function _advanceEpoch() private {
        currentEpoch++;
        epochStartTime = block.timestamp;
        epochMinted = 0;
        
        // Halve emission rate
        epochEmissionRate = epochEmissionRate / 2;
        
        // Enforce minimum emission
        if (epochEmissionRate < MIN_EMISSION) {
            epochEmissionRate = MIN_EMISSION;
        }
        
        emit EpochAdvanced(currentEpoch, epochEmissionRate);
    }
    
    /**
     * @dev Emergency mint - requires consensus approval
     */
    function emergencyMint(
        address recipient,
        uint256 amount,
        bytes32 consensusId
    ) external {
        // Verify consensus approval
        (ConsensusEngine.Stage stage,,,,,,bool executed) = consensusEngine.getConsensus(consensusId);
        require(stage == ConsensusEngine.Stage.COMPLETED, "Consensus not completed");
        require(executed, "Consensus not executed");
        
        // Emergency mints ignore emission schedule but respect max supply
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        
        _mint(recipient, amount);
        totalMinted += amount;
        
        emit EmergencyMint(recipient, amount, consensusId);
    }
    
    /**
     * @dev Burn tokens - anyone can burn their own
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    /**
     * @dev Get current emission parameters
     */
    function getEmissionStatus() external view returns (
        uint256 epoch,
        uint256 emissionRate,
        uint256 epochRemaining,
        uint256 dailyRemaining,
        uint256 timeToNextEpoch
    ) {
        epoch = currentEpoch;
        emissionRate = epochEmissionRate;
        epochRemaining = epochEmissionRate > epochMinted ? epochEmissionRate - epochMinted : 0;
        
        uint256 today = block.timestamp / 1 days;
        uint256 dailyCap = epochEmissionRate / 365;
        dailyRemaining = dailyCap > dailyEmissions[today] ? dailyCap - dailyEmissions[today] : 0;
        
        uint256 epochEnd = epochStartTime + HALVING_PERIOD;
        timeToNextEpoch = block.timestamp < epochEnd ? epochEnd - block.timestamp : 0;
    }
    
    /**
     * @dev Get circulating supply info
     */
    function getSupplyInfo() external view returns (
        uint256 circulating,
        uint256 minted,
        uint256 burned,
        uint256 remaining
    ) {
        circulating = totalSupply();
        minted = totalMinted;
        burned = totalMinted - totalSupply(); // Difference is burned
        remaining = MAX_SUPPLY - totalSupply();
    }
    
    // Override required functions
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
    
    function _mint(
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }
    
    function _burn(
        address account,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}

// Fixed supply, halving schedule, no admin minting