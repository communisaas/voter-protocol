// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IVOTERToken.sol";

/**
 * @title StakedVOTER
 * @dev Wrapper token that preserves voting power while staking VOTER tokens
 * @notice Allows users to stake VOTER while maintaining governance participation
 */
contract StakedVOTER is ERC20, ERC20Permit, ERC20Votes, ReentrancyGuard {
    IVOTERToken public immutable voterToken;
    
    struct StakePosition {
        uint256 amount;
        uint256 timestamp;
        uint256 lockDuration;
        uint256 lastRewardClaim;
        uint256 accumulatedRewards;
    }
    
    mapping(address => StakePosition[]) public stakes;
    mapping(address => uint256) public totalStaked;
    
    uint256 public totalValueLocked;
    uint256 public rewardRate = 500; // 5% APR in basis points
    uint256 public constant MIN_STAKE_DURATION = 30 days;
    uint256 public constant MAX_STAKE_DURATION = 365 days;
    
    event Staked(address indexed user, uint256 amount, uint256 duration);
    event Unstaked(address indexed user, uint256 amount, uint256 rewards);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    constructor(address _voterToken) 
        ERC20("Staked VOTER", "sVOTER")
        ERC20Permit("Staked VOTER")
    {
        voterToken = IVOTERToken(_voterToken);
    }
    
    /**
     * @dev Stake VOTER tokens and receive sVOTER
     * @param amount Amount of VOTER to stake
     * @param duration Lock duration in seconds
     */
    function stake(uint256 amount, uint256 duration) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        require(duration >= MIN_STAKE_DURATION && duration <= MAX_STAKE_DURATION, "Invalid duration");
        
        // Transfer VOTER tokens to this contract
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        // Mint sVOTER tokens 1:1
        _mint(msg.sender, amount);
        
        // Record stake position
        stakes[msg.sender].push(StakePosition({
            amount: amount,
            timestamp: block.timestamp,
            lockDuration: duration,
            lastRewardClaim: block.timestamp,
            accumulatedRewards: 0
        }));
        
        totalStaked[msg.sender] += amount;
        totalValueLocked += amount;
        
        emit Staked(msg.sender, amount, duration);
    }
    
    /**
     * @dev Unstake tokens and claim rewards
     * @param stakeIndex Index of the stake position
     */
    function unstake(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");
        
        StakePosition storage position = stakes[msg.sender][stakeIndex];
        require(position.amount > 0, "Already unstaked");
        require(
            block.timestamp >= position.timestamp + position.lockDuration,
            "Still locked"
        );
        
        uint256 amount = position.amount;
        uint256 rewards = calculateRewards(msg.sender, stakeIndex);
        
        // Burn sVOTER tokens
        _burn(msg.sender, amount);
        
        // Transfer VOTER tokens back
        require(
            voterToken.transfer(msg.sender, amount),
            "Transfer failed"
        );
        
        // Transfer rewards if any
        if (rewards > 0) {
            require(
                voterToken.transfer(msg.sender, rewards),
                "Reward transfer failed"
            );
        }
        
        totalStaked[msg.sender] -= amount;
        totalValueLocked -= amount;
        
        // Mark as unstaked
        position.amount = 0;
        
        emit Unstaked(msg.sender, amount, rewards);
    }
    
    /**
     * @dev Calculate pending rewards for a stake position
     * @param user Address of the staker
     * @param stakeIndex Index of the stake position
     * @return Pending rewards amount
     */
    function calculateRewards(
        address user,
        uint256 stakeIndex
    ) public view returns (uint256) {
        StakePosition memory position = stakes[user][stakeIndex];
        if (position.amount == 0) return 0;
        
        uint256 stakingDuration = block.timestamp - position.lastRewardClaim;
        
        // Bonus multiplier for longer lock periods
        uint256 lockBonus = 100 + (position.lockDuration * 50 / MAX_STAKE_DURATION);
        
        uint256 rewards = (position.amount * rewardRate * stakingDuration * lockBonus) / 
                         (10000 * 365 days * 100);
        
        return rewards + position.accumulatedRewards;
    }
    
    /**
     * @dev Claim accumulated rewards without unstaking
     * @param stakeIndex Index of the stake position
     */
    function claimRewards(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");
        
        StakePosition storage position = stakes[msg.sender][stakeIndex];
        require(position.amount > 0, "No active stake");
        
        uint256 rewards = calculateRewards(msg.sender, stakeIndex);
        require(rewards > 0, "No rewards to claim");
        
        position.lastRewardClaim = block.timestamp;
        position.accumulatedRewards = 0;
        
        require(
            voterToken.transfer(msg.sender, rewards),
            "Reward transfer failed"
        );
        
        emit RewardsClaimed(msg.sender, rewards);
    }
    
    /**
     * @dev Get all stake positions for a user
     * @param user Address of the user
     * @return Array of stake positions
     */
    function getUserStakes(address user) external view returns (StakePosition[] memory) {
        return stakes[user];
    }
    
    /**
     * @dev Get total pending rewards for a user across all positions
     * @param user Address of the user
     * @return Total pending rewards
     */
    function getTotalPendingRewards(address user) external view returns (uint256) {
        uint256 totalRewards = 0;
        for (uint256 i = 0; i < stakes[user].length; i++) {
            if (stakes[user][i].amount > 0) {
                totalRewards += calculateRewards(user, i);
            }
        }
        return totalRewards;
    }
    
    /**
     * @dev Emergency unstake with penalty (10% fee)
     * @param stakeIndex Index of the stake position
     */
    function emergencyUnstake(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");
        
        StakePosition storage position = stakes[msg.sender][stakeIndex];
        require(position.amount > 0, "Already unstaked");
        
        uint256 amount = position.amount;
        uint256 penalty = amount / 10; // 10% penalty
        uint256 withdrawAmount = amount - penalty;
        
        // Burn sVOTER tokens
        _burn(msg.sender, amount);
        
        // Transfer VOTER tokens back with penalty
        require(
            voterToken.transfer(msg.sender, withdrawAmount),
            "Transfer failed"
        );
        
        totalStaked[msg.sender] -= amount;
        totalValueLocked -= amount;
        
        // Mark as unstaked
        position.amount = 0;
        
        emit Unstaked(msg.sender, withdrawAmount, 0);
    }
    
    // Required overrides for ERC20Votes
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
    
    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }
    
    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
    
    /**
     * @dev Fund the contract with VOTER tokens for rewards
     * @param amount Amount of VOTER tokens to add for rewards
     */
    function fundRewards(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(
            voterToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        emit RewardsFunded(msg.sender, amount);
    }
    
    /**
     * @dev Get available reward balance (total balance minus staked tokens)
     */
    function getAvailableRewardBalance() external view returns (uint256) {
        uint256 totalBalance = voterToken.balanceOf(address(this));
        return totalBalance > totalValueLocked ? totalBalance - totalValueLocked : 0;
    }
    
    event RewardsFunded(address indexed funder, uint256 amount);
}