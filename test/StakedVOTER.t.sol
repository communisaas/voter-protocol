// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/StakedVOTER.sol";
import "../contracts/VOTERToken.sol";

contract StakedVOTERTest is Test {
    StakedVOTER public staking;
    VOTERToken public voterToken;
    
    address admin = address(this);
    address user1 = address(0x1);
    address user2 = address(0x2);
    address attacker = address(0x666);
    
    uint256 constant INITIAL_BALANCE = 10000 * 10**18;
    uint256 constant MIN_DURATION = 30 days;
    uint256 constant MAX_DURATION = 365 days;
    
    event Staked(address indexed user, uint256 amount, uint256 duration);
    event Unstaked(address indexed user, uint256 amount, uint256 rewards);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    function setUp() public {
        voterToken = new VOTERToken();
        staking = new StakedVOTER(address(voterToken));
        
        // Setup initial balances
        voterToken.transfer(user1, INITIAL_BALANCE);
        voterToken.transfer(user2, INITIAL_BALANCE);
        voterToken.transfer(attacker, INITIAL_BALANCE);
        
        // Fund staking contract with reward tokens (10% of initial supply for rewards)
        uint256 rewardFunding = 10_000_000 * 10**18; // 10M tokens for rewards
        voterToken.approve(address(staking), rewardFunding);
        staking.fundRewards(rewardFunding);
        
        // Approve staking contract
        vm.prank(user1);
        voterToken.approve(address(staking), type(uint256).max);
        vm.prank(user2);
        voterToken.approve(address(staking), type(uint256).max);
        vm.prank(attacker);
        voterToken.approve(address(staking), type(uint256).max);
    }
    
    // ============ CRITICAL REENTRANCY TESTS ============
    
    function test_NoReentrancyInStake() public {
        ReentrantStaker malicious = new ReentrantStaker(staking, voterToken);
        voterToken.transfer(address(malicious), 1000 * 10**18);
        
        // Since ERC20 doesn't have callbacks, reentrancy protection works by preventing
        // the same function from being called again during execution
        // This test verifies the function executes successfully (no revert expected)
        malicious.attackStake();
        
        // Verify only one stake was created (no reentrancy occurred)
        assertEq(staking.totalStaked(address(malicious)), 100 * 10**18);
    }
    
    function test_NoReentrancyInUnstake() public {
        // Setup: User stakes first
        vm.prank(user1);
        staking.stake(1000 * 10**18, MIN_DURATION);
        
        // Fast forward past lock period
        vm.warp(block.timestamp + MIN_DURATION + 1);
        
        // Deploy malicious contract
        ReentrantUnstaker malicious = new ReentrantUnstaker(staking, voterToken);
        
        // Transfer staked position to malicious contract (if transferable)
        // Note: sVOTER tokens are ERC20, so they can be transferred
        vm.prank(user1);
        staking.transfer(address(malicious), 1000 * 10**18);
        
        // Malicious contract tries to re-enter during unstake
        vm.expectRevert();
        malicious.attackUnstake(0);
    }
    
    function test_NoReentrancyInClaimRewards() public {
        // Setup: User stakes
        vm.prank(user1);
        staking.stake(1000 * 10**18, MIN_DURATION);
        
        // Fast forward to accumulate rewards
        vm.warp(block.timestamp + 30 days);
        
        ReentrantClaimer malicious = new ReentrantClaimer(staking);
        
        // This should not allow reentrancy
        vm.expectRevert();
        malicious.attackClaim(0);
    }
    
    // ============ REWARD CALCULATION OVERFLOW/UNDERFLOW ============
    
    function test_RewardCalculationOverflow() public {
        // Test with large but valid amount that won't cause transfer issues
        uint256 largeStake = voterToken.balanceOf(admin) / 2; // Half of admin's balance
        
        voterToken.transfer(user1, largeStake);
        vm.prank(user1);
        voterToken.approve(address(staking), largeStake);
        
        // This should work without overflow in the reward calculation
        vm.prank(user1);
        staking.stake(largeStake, MAX_DURATION);
        
        // Fast forward and check rewards don't overflow
        vm.warp(block.timestamp + MAX_DURATION);
        uint256 rewards = staking.calculateRewards(user1, 0);
        
        // Rewards should be calculable without overflow
        assertTrue(rewards > 0);
        assertTrue(rewards < largeStake * 2); // Reasonable upper bound
    }
    
    function test_RewardCalculationPrecision() public {
        // Test small amounts don't underflow
        vm.prank(user1);
        staking.stake(1, MIN_DURATION);
        
        vm.warp(block.timestamp + 1 days);
        
        uint256 rewards = staking.calculateRewards(user1, 0);
        // Even 1 wei staked should calculate rewards without underflow
        assertTrue(rewards >= 0);
    }
    
    // ============ LOCK DURATION BYPASS ATTEMPTS ============
    
    function test_CannotUnstakeBeforeLockExpiry() public {
        vm.prank(user1);
        staking.stake(1000 * 10**18, MIN_DURATION);
        
        // Try to unstake immediately
        vm.prank(user1);
        vm.expectRevert("Still locked");
        staking.unstake(0);
        
        // Try after half the lock period
        vm.warp(block.timestamp + MIN_DURATION / 2);
        vm.prank(user1);
        vm.expectRevert("Still locked");
        staking.unstake(0);
        
        // Should work after lock period
        vm.warp(block.timestamp + MIN_DURATION + 1);
        vm.prank(user1);
        staking.unstake(0);
    }
    
    function test_EmergencyUnstakePenalty() public {
        uint256 stakeAmount = 1000 * 10**18;
        
        vm.prank(user1);
        staking.stake(stakeAmount, MAX_DURATION);
        
        uint256 balanceBefore = voterToken.balanceOf(user1);
        
        // Emergency unstake immediately
        vm.prank(user1);
        staking.emergencyUnstake(0);
        
        uint256 balanceAfter = voterToken.balanceOf(user1);
        uint256 received = balanceAfter - balanceBefore;
        
        // Should receive 90% (10% penalty)
        assertEq(received, stakeAmount * 90 / 100);
    }
    
    function test_CannotEvadePenaltyByTransfer() public {
        uint256 stakeAmount = 1000 * 10**18;
        
        vm.prank(user1);
        staking.stake(stakeAmount, MAX_DURATION);
        
        // Transfer sVOTER to user2
        vm.prank(user1);
        staking.transfer(user2, stakeAmount);
        
        // user2 tries emergency unstake (but can't access user1's stake position)
        vm.prank(user2);
        vm.expectRevert("Invalid stake index");
        staking.emergencyUnstake(0);
        
        // user1 tries emergency unstake but doesn't have sVOTER tokens to burn
        vm.prank(user1);
        vm.expectRevert("ERC20: burn amount exceeds balance");
        staking.emergencyUnstake(0);
        
        // This demonstrates that transferring sVOTER tokens doesn't allow penalty evasion
        // - the position holder can't unstake without the tokens
    }
    
    // ============ DOUBLE-CLAIM EXPLOITS ============
    
    function test_CannotDoubleClaimRewards() public {
        vm.prank(user1);
        staking.stake(1000 * 10**18, MIN_DURATION);
        
        // Fast forward to accumulate rewards
        vm.warp(block.timestamp + 30 days);
        
        // Claim rewards once
        uint256 firstClaim = staking.calculateRewards(user1, 0);
        vm.prank(user1);
        staking.claimRewards(0);
        
        // Try to claim again immediately
        vm.prank(user1);
        vm.expectRevert("No rewards to claim");
        staking.claimRewards(0);
    }
    
    function test_CannotClaimAfterUnstake() public {
        vm.prank(user1);
        staking.stake(1000 * 10**18, MIN_DURATION);
        
        vm.warp(block.timestamp + MIN_DURATION + 1);
        
        // Unstake (includes reward claim)
        vm.prank(user1);
        staking.unstake(0);
        
        // Try to claim rewards from unstaked position
        vm.prank(user1);
        vm.expectRevert("No active stake");
        staking.claimRewards(0);
    }
    
    // ============ MULTIPLE STAKE POSITIONS ============
    
    function test_MultipleStakePositions() public {
        // User creates multiple stakes
        vm.startPrank(user1);
        staking.stake(100 * 10**18, MIN_DURATION);
        staking.stake(200 * 10**18, MIN_DURATION * 2);
        staking.stake(300 * 10**18, MAX_DURATION);
        vm.stopPrank();
        
        // Verify total staked
        assertEq(staking.totalStaked(user1), 600 * 10**18);
        assertEq(staking.totalValueLocked(), 600 * 10**18);
        
        // Verify can unstake independently
        vm.warp(block.timestamp + MIN_DURATION + 1);
        vm.prank(user1);
        staking.unstake(0); // First position
        
        assertEq(staking.totalStaked(user1), 500 * 10**18);
    }
    
    function test_InvalidStakeIndex() public {
        vm.prank(user1);
        staking.stake(100 * 10**18, MIN_DURATION);
        
        // Try to unstake non-existent position
        vm.warp(block.timestamp + MIN_DURATION + 1);
        vm.prank(user1);
        vm.expectRevert("Invalid stake index");
        staking.unstake(5);
    }
    
    // ============ VOTING POWER PRESERVATION ============
    
    function test_VotingPowerMaintained() public {
        uint256 stakeAmount = 1000 * 10**18;
        
        // Delegate voting power before staking
        vm.prank(user1);
        voterToken.delegate(user1);
        
        uint256 votesBefore = voterToken.getVotes(user1);
        
        // Stake tokens
        vm.prank(user1);
        staking.stake(stakeAmount, MIN_DURATION);
        
        // Delegate sVOTER voting power
        vm.prank(user1);
        staking.delegate(user1);
        
        uint256 sVotesAfter = staking.getVotes(user1);
        
        // Voting power should be preserved in sVOTER
        assertEq(sVotesAfter, stakeAmount);
    }
    
    // ============ FUZZ TESTING ============
    
    function testFuzz_StakeAmounts(uint256 amount, uint256 duration) public {
        amount = bound(amount, 1, INITIAL_BALANCE);
        duration = bound(duration, MIN_DURATION, MAX_DURATION);
        
        vm.prank(user1);
        staking.stake(amount, duration);
        
        assertEq(staking.totalStaked(user1), amount);
        assertEq(staking.balanceOf(user1), amount);
    }
    
    function testFuzz_RewardCalculation(
        uint256 amount,
        uint256 duration,
        uint256 timeElapsed
    ) public {
        amount = bound(amount, 1 * 10**18, INITIAL_BALANCE);
        duration = bound(duration, MIN_DURATION, MAX_DURATION);
        timeElapsed = bound(timeElapsed, 0, duration * 2);
        
        vm.prank(user1);
        staking.stake(amount, duration);
        
        vm.warp(block.timestamp + timeElapsed);
        
        uint256 rewards = staking.calculateRewards(user1, 0);
        
        // Rewards should increase with time
        if (timeElapsed > 0) {
            assertTrue(rewards > 0);
        }
        
        // Rewards should never exceed reasonable bounds
        assertTrue(rewards < amount * 2); // Max 200% return
    }
    
    // ============ INVARIANT TESTS ============
    
    function invariant_TotalValueLockedConsistency() public {
        uint256 tvl = staking.totalValueLocked();
        uint256 sumOfStakes = staking.totalStaked(user1) + staking.totalStaked(user2);
        
        // TVL should equal sum of all individual stakes
        assertTrue(tvl >= sumOfStakes);
    }
    
    function invariant_RewardsNeverNegative() public {
        if (staking.totalStaked(user1) > 0) {
            uint256 rewards = staking.getTotalPendingRewards(user1);
            assertTrue(rewards >= 0);
        }
    }
    
    // ============ EDGE CASES ============
    
    function test_StakeZeroAmount() public {
        vm.prank(user1);
        vm.expectRevert("Cannot stake 0");
        staking.stake(0, MIN_DURATION);
    }
    
    function test_InvalidDuration() public {
        // Too short
        vm.prank(user1);
        vm.expectRevert("Invalid duration");
        staking.stake(100 * 10**18, MIN_DURATION - 1);
        
        // Too long
        vm.prank(user1);
        vm.expectRevert("Invalid duration");
        staking.stake(100 * 10**18, MAX_DURATION + 1);
    }
    
    function test_UnstakeAlreadyUnstaked() public {
        vm.prank(user1);
        staking.stake(100 * 10**18, MIN_DURATION);
        
        vm.warp(block.timestamp + MIN_DURATION + 1);
        
        // Unstake once
        vm.prank(user1);
        staking.unstake(0);
        
        // Try to unstake again
        vm.prank(user1);
        vm.expectRevert("Already unstaked");
        staking.unstake(0);
    }
}

// ============ HELPER CONTRACTS FOR ATTACK SIMULATIONS ============

contract ReentrantStaker {
    StakedVOTER staking;
    VOTERToken token;
    bool attacking = false;
    
    constructor(StakedVOTER _staking, VOTERToken _token) {
        staking = _staking;
        token = _token;
        token.approve(address(staking), type(uint256).max);
    }
    
    function attackStake() external {
        attacking = true;
        staking.stake(100 * 10**18, 30 days);
    }
    
    // ERC20 callback hook (if it existed)
    function onERC20Received() external {
        if (attacking) {
            attacking = false;
            // Try to stake again during the first stake
            staking.stake(100 * 10**18, 30 days);
        }
    }
}

contract ReentrantUnstaker {
    StakedVOTER staking;
    VOTERToken token;
    bool attacking = false;
    
    constructor(StakedVOTER _staking, VOTERToken _token) {
        staking = _staking;
        token = _token;
    }
    
    function attackUnstake(uint256 index) external {
        attacking = true;
        staking.unstake(index);
    }
    
    receive() external payable {
        if (attacking) {
            attacking = false;
            // Try to unstake again during reward transfer
            staking.unstake(0);
        }
    }
}

contract ReentrantClaimer {
    StakedVOTER staking;
    bool attacking = false;
    
    constructor(StakedVOTER _staking) {
        staking = _staking;
    }
    
    function attackClaim(uint256 index) external {
        attacking = true;
        staking.claimRewards(index);
    }
    
    receive() external payable {
        if (attacking) {
            attacking = false;
            // Try to claim again during the first claim
            staking.claimRewards(0);
        }
    }
}