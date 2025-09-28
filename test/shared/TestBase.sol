// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";

/**
 * @title TestBase
 * @dev Minimal test base that actually works
 */
contract VOTERTestBase is Test {
    
    // Test users
    address internal admin = address(0x1);
    address internal user1 = address(0x2);
    address internal user2 = address(0x3);
    address internal verifier1 = address(0x4);
    
    function setUp() public virtual {
        // Give test accounts some ETH
        vm.deal(admin, 100 ether);
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        vm.deal(verifier1, 10 ether);
        
        // Label accounts for better test output
        vm.label(admin, "admin");
        vm.label(user1, "user1");
        vm.label(user2, "user2");
        vm.label(verifier1, "verifier1");
    }
}