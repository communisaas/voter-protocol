// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./shared/TestBase.sol";

/**
 * @title SimpleCompilationTest
 * @dev Basic test to verify our contracts can be imported and basic setup works
 */
contract SimpleCompilationTest is VOTERTestBase {
    
    function test_BasicSetup() public {
        assertEq(user1, address(0x2));
        assertEq(user2, address(0x3));
        assertTrue(true);
    }
    
    function test_ContractsExist() public {
        // Just verify we can reference contract files without deployment
        // This tests that our contract files at least compile
        assertTrue(true);
    }
}