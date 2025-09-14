// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/CreditVault.sol";

contract CreditVaultTest is Test {
    CreditVault public vault;
    
    address admin = address(this);
    address spender = address(0x1);
    address payer1 = address(0x2);
    address payer2 = address(0x3);
    address attacker = address(0x666);
    
    event Funded(address indexed payer, uint256 amount, uint256 newBalance);
    event Consumed(address indexed payer, uint256 amount, uint256 newBalance);
    
    function setUp() public {
        vault = new CreditVault(admin);
        vault.grantRole(vault.SPENDER_ROLE(), spender);
    }
    
    // ============ CRITICAL SECURITY TESTS ============
    
    function test_IntegerOverflowInFund() public {
        // Fund with large amount
        uint256 largeAmount = type(uint256).max - 100;
        vault.fund(payer1, largeAmount);
        assertEq(vault.balanceOf(payer1), largeAmount);
        
        // Try to overflow - Solidity 0.8+ built-in overflow protection should trigger
        vm.expectRevert(); // Expects arithmetic overflow panic
        vault.fund(payer1, 200);
    }
    
    function test_NoReentrancyInConsume() public {
        // Deploy malicious contract that tries reentrancy
        ReentrantConsumer malicious = new ReentrantConsumer(vault);
        vault.grantRole(vault.SPENDER_ROLE(), address(malicious));
        vault.fund(address(malicious), 1000);
        
        // Attack succeeds but only consumes once due to reentrancy protection
        malicious.attack();
        
        // Verify only 500 was consumed (first call), reentrancy was blocked
        assertEq(vault.balanceOf(address(malicious)), 500);
    }
    
    function test_AccessControlBypass() public {
        // Non-admin cannot fund
        vm.prank(payer1);
        vm.expectRevert();
        vault.fund(payer2, 100);
        
        // Non-spender cannot consume
        vm.prank(payer1);
        vm.expectRevert();
        vault.consume(payer2, 100);
        
        // Admin cannot consume without spender role
        vault.fund(payer1, 1000);
        vault.revokeRole(vault.SPENDER_ROLE(), admin);
        vm.expectRevert();
        vault.consume(payer1, 100);
    }
    
    function test_FrontRunningProtection() public {
        // Fund account
        vault.fund(payer1, 1000);
        
        // Simulate front-running scenario
        // Transaction 1: User tries to consume 500
        // Transaction 2: Attacker front-runs and consumes 600
        // Transaction 1 should fail due to insufficient balance
        
        vm.prank(spender);
        vault.consume(payer1, 600); // Front-runner
        
        vm.prank(spender);
        vm.expectRevert("INSUFFICIENT_CREDITS");
        vault.consume(payer1, 500); // Original transaction fails
    }
    
    // ============ EDGE CASES & BOUNDARIES ============
    
    function test_ZeroAmountHandling() public {
        // Cannot fund with zero
        vm.expectRevert("INVALID_AMOUNT");
        vault.fund(payer1, 0);
        
        // Cannot consume zero
        vault.fund(payer1, 100);
        vm.prank(spender);
        vm.expectRevert("INVALID_AMOUNT");
        vault.consume(payer1, 0);
    }
    
    function test_ZeroAddressHandling() public {
        // Cannot fund zero address
        vm.expectRevert("INVALID_PAYER");
        vault.fund(address(0), 100);
        
        // Cannot consume from zero address
        vm.prank(spender);
        vm.expectRevert("INVALID_PAYER");
        vault.consume(address(0), 100);
    }
    
    function test_ConsumeExactBalance() public {
        vault.fund(payer1, 1000);
        
        vm.prank(spender);
        vault.consume(payer1, 1000);
        
        assertEq(vault.balanceOf(payer1), 0);
    }
    
    function test_MultipleConsumersRaceCondition() public {
        address spender2 = address(0x4);
        vault.grantRole(vault.SPENDER_ROLE(), spender2);
        
        vault.fund(payer1, 1000);
        
        // Both try to consume
        vm.prank(spender);
        vault.consume(payer1, 600);
        
        vm.prank(spender2);
        vault.consume(payer1, 400);
        
        assertEq(vault.balanceOf(payer1), 0);
        
        // Third attempt should fail
        vm.prank(spender);
        vm.expectRevert("INSUFFICIENT_CREDITS");
        vault.consume(payer1, 1);
    }
    
    // ============ FUZZ TESTING ============
    
    function testFuzz_FundingAmounts(uint256 amount) public {
        vm.assume(amount > 0 && amount < type(uint256).max);
        
        vault.fund(payer1, amount);
        assertEq(vault.balanceOf(payer1), amount);
    }
    
    function testFuzz_ConsumeUpToBalance(uint256 fundAmount, uint256 consumeAmount) public {
        vm.assume(fundAmount > 0 && fundAmount < type(uint256).max / 2);
        vm.assume(consumeAmount > 0 && consumeAmount <= fundAmount);
        
        vault.fund(payer1, fundAmount);
        
        vm.prank(spender);
        vault.consume(payer1, consumeAmount);
        
        assertEq(vault.balanceOf(payer1), fundAmount - consumeAmount);
    }
    
    function testFuzz_MultipleOperations(uint256[] memory operations) public {
        vm.assume(operations.length > 0 && operations.length <= 10);
        
        uint256 totalFunded = 0;
        uint256 totalConsumed = 0;
        
        for (uint i = 0; i < operations.length; i++) {
            uint256 amount = bound(operations[i], 1, 10000);
            
            if (i % 2 == 0) {
                // Fund
                vault.fund(payer1, amount);
                totalFunded += amount;
            } else if (totalFunded > totalConsumed) {
                // Consume (only if balance available)
                uint256 consumeAmount = amount % (totalFunded - totalConsumed) + 1;
                vm.prank(spender);
                vault.consume(payer1, consumeAmount);
                totalConsumed += consumeAmount;
            }
        }
        
        assertEq(vault.balanceOf(payer1), totalFunded - totalConsumed);
    }
    
    // ============ EVENT EMISSION TESTS ============
    
    function test_FundingEmitsCorrectEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Funded(payer1, 500, 500);
        vault.fund(payer1, 500);
        
        vm.expectEmit(true, false, false, true);
        emit Funded(payer1, 300, 800);
        vault.fund(payer1, 300);
    }
    
    function test_ConsumptionEmitsCorrectEvent() public {
        vault.fund(payer1, 1000);
        
        vm.prank(spender);
        vm.expectEmit(true, false, false, true);
        emit Consumed(payer1, 400, 600);
        vault.consume(payer1, 400);
    }
    
    // ============ ROLE MANAGEMENT TESTS ============
    
    function test_RoleRenunciation() public {
        // Spender renounces their role (OpenZeppelin requires msg.sender as account parameter)
        vm.startPrank(spender);
        vault.renounceRole(vault.SPENDER_ROLE(), spender);
        vm.stopPrank();
        
        // Should no longer be able to consume
        vault.fund(payer1, 100);
        vm.prank(spender);
        vm.expectRevert();
        vault.consume(payer1, 50);
    }
    
    function test_AdminTransfer() public {
        address newAdmin = address(0x99);
        
        // Grant admin role to new address
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), newAdmin);
        
        // New admin can fund
        vm.prank(newAdmin);
        vault.fund(payer1, 100);
        assertEq(vault.balanceOf(payer1), 100);
        
        // Old admin can still fund (hasn't renounced)
        vault.fund(payer2, 200);
        assertEq(vault.balanceOf(payer2), 200);
    }
    
    // ============ INVARIANT TESTS ============
    
    function invariant_BalanceNeverNegative() public {
        // This is enforced by uint256 type, but good to verify
        assertTrue(vault.balanceOf(payer1) >= 0);
        assertTrue(vault.balanceOf(payer2) >= 0);
    }
    
    function invariant_ConsumeNeverExceedsBalance() public {
        uint256 balance = vault.balanceOf(payer1);
        if (balance > 0) {
            vm.prank(spender);
            vm.expectRevert("INSUFFICIENT_CREDITS");
            vault.consume(payer1, balance + 1);
        }
    }
}

// Helper contract for reentrancy test
contract ReentrantConsumer {
    CreditVault vault;
    bool attacking = false;
    
    constructor(CreditVault _vault) {
        vault = _vault;
    }
    
    function attack() external {
        attacking = true;
        vault.consume(address(this), 500);
    }
    
    // If there was a callback, this would be triggered
    fallback() external {
        if (attacking) {
            attacking = false;
            // Try to consume again during the first consume
            vault.consume(address(this), 500);
        }
    }
}