// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title VOTERToken
 * @dev Governance token for Communiqué platform
 * @notice Earned through verified civic engagement, used for platform governance
 */
contract VOTERToken is ERC20, ERC20Permit, ERC20Votes, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    uint256 public constant INITIAL_MINT_CAP = 100_000_000 * 10**18; // 100M for initial distribution
    
    struct StakeInfo {
        uint256 amount;
        uint256 timestamp;
        uint256 lockDuration;
        bool withdrawn;
    }
    
    mapping(address => StakeInfo[]) public userStakes;
    mapping(address => uint256) public stakingRewards;
    mapping(address => uint256) public civicActions; // Track actions for reward calculation
    
    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public constant MIN_STAKE_DURATION = 30 days;
    uint256 public constant MAX_STAKE_DURATION = 365 days;
    uint256 public constant BASE_APR = 500; // 5% base APR
    
    event TokensEarned(address indexed citizen, uint256 amount, string actionType);
    event TokensStaked(address indexed user, uint256 amount, uint256 duration);
    event TokensUnstaked(address indexed user, uint256 amount, uint256 rewards);
    
    
    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender), "Not authorized minter");
        _;
    }
    
    constructor() 
        ERC20("VOTER Governance Token", "VOTER")
        ERC20Permit("VOTER Governance Token")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        
        // Initial mint for platform development and community rewards
        _mint(msg.sender, INITIAL_MINT_CAP);
    }
    
    /**
     * @dev Mint VOTER tokens for verified civic actions
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     * @param actionType Type of civic action performed
     */
    function mintForCivicAction(
        address to,
        uint256 amount,
        string memory actionType
    ) external onlyMinter whenNotPaused {
        require(to != address(0), "Invalid recipient");
        
        _mint(to, amount);
        civicActions[to]++;
        
        emit TokensEarned(to, amount, actionType);
    }
    
    /**
     * @dev Stake VOTER tokens for governance voting power and rewards
     * @param amount Amount of tokens to stake
     * @param duration Duration to lock tokens (in seconds)
     */
     function stake(uint256 amount, uint256 duration) external nonReentrant whenNotPaused {
        require(amount > 0, "Invalid stake amount");
        require(duration >= MIN_STAKE_DURATION && duration <= MAX_STAKE_DURATION, "Invalid duration");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        _transfer(msg.sender, address(this), amount);
        
        userStakes[msg.sender].push(StakeInfo({
            amount: amount,
            timestamp: block.timestamp,
            lockDuration: duration,
            withdrawn: false
        }));
        
        totalStaked += amount;
        
         // Note: staking currently reduces voting power since tokens leave user's balance.
         // Future version will introduce a staking wrapper to preserve votes.
        
        emit TokensStaked(msg.sender, amount, duration);
    }
    
    /**
     * @dev Unstake tokens and claim rewards
     * @param stakeIndex Index of the stake to withdraw
     */
    function unstake(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < userStakes[msg.sender].length, "Invalid stake index");
        
        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeIndex];
        require(!stakeInfo.withdrawn, "Already withdrawn");
        require(block.timestamp >= stakeInfo.timestamp + stakeInfo.lockDuration, "Still locked");
        
        uint256 rewards = _calculateRewards(msg.sender, stakeIndex);
        
        stakeInfo.withdrawn = true;
        totalStaked -= stakeInfo.amount;
        
        if (rewards > 0 && rewardPool >= rewards) {
            rewardPool -= rewards;
            _transfer(address(this), msg.sender, rewards);
        }
        
        _transfer(address(this), msg.sender, stakeInfo.amount);
        
        emit TokensUnstaked(msg.sender, stakeInfo.amount, rewards);
    }
    
    
    /**
     * @dev Calculate staking rewards for a user
     * @param user Address of the user
     * @param stakeIndex Index of the stake
     * @return Calculated rewards
     */
    function _calculateRewards(address user, uint256 stakeIndex) internal view returns (uint256) {
        StakeInfo memory stakeInfo = userStakes[user][stakeIndex];
        
        uint256 timeStaked = block.timestamp - stakeInfo.timestamp;
        if (timeStaked > stakeInfo.lockDuration) {
            timeStaked = stakeInfo.lockDuration;
        }
        
        // Calculate APR based on lock duration (longer = higher rewards)
        uint256 aprMultiplier = 100 + (stakeInfo.lockDuration * 100 / MAX_STAKE_DURATION);
        uint256 effectiveApr = BASE_APR * aprMultiplier / 100;
        
        return (stakeInfo.amount * effectiveApr * timeStaked) / (10000 * 365 days);
    }
    
    // Fee discount logic removed: no fee-bearing flows implemented
    
    /**
     * @dev Add to reward pool (admin function)
     * @param amount Amount to add to reward pool
     */
    function addToRewardPool(uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        _transfer(msg.sender, address(this), amount);
        rewardPool += amount;
    }
    
    /**
     * @dev Get user's total staked amount
     * @param user Address of the user
     * @return Total staked amount
     */
    function getTotalStaked(address user) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (!userStakes[user][i].withdrawn) {
                total += userStakes[user][i].amount;
            }
        }
        return total;
    }
    
    /**
     * @dev Burn tokens (for deflationary mechanism)
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(msg.sender, amount);
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    // Override required functions
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20) whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }
    
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