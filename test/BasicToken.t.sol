// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./shared/TestBase.sol";
import {VOTERToken} from "../contracts/VOTERToken.sol";

/**
 * @title BasicTokenTest
 * @dev Test VOTERToken with actual constructor parameters
 */
contract BasicTokenTest is VOTERTestBase {
    VOTERToken token;
    
    // Mock addresses for dependencies
    address consensusEngine = address(0x10);
    address bounds = address(0x11);
    address communiqueCore = address(0x12);
    
    function setUp() public override {
        super.setUp();
        
        // Deploy token with actual constructor signature
        token = new VOTERToken(consensusEngine, bounds, communiqueCore);
    }
    
    function test_TokenBasics() public {
        assertEq(token.name(), "VOTER Governance Token");
        assertEq(token.symbol(), "VOTER");
        assertEq(token.decimals(), 18);
    }
    
    function test_InitialSupply() public {
        assertEq(token.totalSupply(), 0);
    }
    
    function test_OnlyCommuniqueCoreCanMint() public {
        bytes32 actionHash = keccak256("test_action");
        
        // Non-CommuniqueCore cannot mint
        vm.expectRevert("Only CommuniqueCore");
        token.mintReward(user1, 100e18, actionHash);
        
        // CommuniqueCore can mint
        vm.prank(communiqueCore);
        token.mintReward(user1, 100e18, actionHash);
        
        assertEq(token.balanceOf(user1), 100e18);
    }
    
    function test_Transfer() public {
        // First mint some tokens
        vm.prank(communiqueCore);
        token.mintReward(user1, 100e18, keccak256("action"));
        
        // Transfer tokens
        vm.prank(user1);
        token.transfer(user2, 50e18);
        
        assertEq(token.balanceOf(user1), 50e18);
        assertEq(token.balanceOf(user2), 50e18);
    }
}