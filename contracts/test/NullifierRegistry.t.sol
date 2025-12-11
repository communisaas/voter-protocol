// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/NullifierRegistry.sol";

contract NullifierRegistryTest is Test {
    NullifierRegistry public registry;
    
    address public governance = address(0x1);
    address public districtGate = address(0x2);
    address public unauthorized = address(0x3);
    
    bytes32 public actionId1 = keccak256("action-1");
    bytes32 public actionId2 = keccak256("action-2");
    bytes32 public nullifier1 = keccak256("nullifier-1");
    bytes32 public nullifier2 = keccak256("nullifier-2");
    bytes32 public merkleRoot = keccak256("merkle-root");

    function setUp() public {
        vm.prank(governance);
        registry = new NullifierRegistry(governance);
        
        // Authorize DistrictGate as caller
        vm.prank(governance);
        registry.authorizeCaller(districtGate);
    }

    // ============================================================================
    // Basic Functionality
    // ============================================================================

    function test_RecordNullifier() public {
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        assertTrue(registry.isNullifierUsed(actionId1, nullifier1));
        assertEq(registry.getParticipantCount(actionId1), 1);
    }

    function test_DifferentActionsAllowed() public {
        // Same nullifier can be used for different actions
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        // Wait for rate limit
        vm.warp(block.timestamp + 61);
        
        vm.prank(districtGate);
        registry.recordNullifier(actionId2, nullifier1, merkleRoot);
        
        assertTrue(registry.isNullifierUsed(actionId1, nullifier1));
        assertTrue(registry.isNullifierUsed(actionId2, nullifier1));
    }

    function test_DifferentUsersAllowed() public {
        // Different nullifiers for same action
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier2, merkleRoot);
        
        assertEq(registry.getParticipantCount(actionId1), 2);
    }

    // ============================================================================
    // Security: Double-Submission Prevention
    // ============================================================================

    function test_RevertOnDoubleSubmission() public {
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        // Wait for rate limit
        vm.warp(block.timestamp + 61);
        
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    // ============================================================================
    // Security: Rate Limiting
    // ============================================================================

    function test_RateLimitEnforced() public {
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        // Try to submit for different action within rate limit
        vm.expectRevert(NullifierRegistry.RateLimitExceeded.selector);
        vm.prank(districtGate);
        registry.recordNullifier(actionId2, nullifier1, merkleRoot);
    }

    function test_RateLimitExpires() public {
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        // Wait for rate limit to expire
        vm.warp(block.timestamp + 61);
        
        // Should succeed now
        vm.prank(districtGate);
        registry.recordNullifier(actionId2, nullifier1, merkleRoot);
        
        assertTrue(registry.isNullifierUsed(actionId2, nullifier1));
    }

    // ============================================================================
    // Security: Authorization
    // ============================================================================

    function test_RevertUnauthorizedCaller() public {
        vm.expectRevert(NullifierRegistry.UnauthorizedCaller.selector);
        vm.prank(unauthorized);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    function test_AuthorizeAndRevokeCaller() public {
        // Initially unauthorized
        assertFalse(registry.isAuthorized(unauthorized));
        
        // Authorize
        vm.prank(governance);
        registry.authorizeCaller(unauthorized);
        assertTrue(registry.isAuthorized(unauthorized));
        
        // Revoke
        vm.prank(governance);
        registry.revokeCaller(unauthorized);
        assertFalse(registry.isAuthorized(unauthorized));
    }

    // ============================================================================
    // Governance
    // ============================================================================

    function test_TransferGovernance() public {
        address newGov = address(0x999);
        
        vm.prank(governance);
        registry.transferGovernance(newGov);
        
        assertEq(registry.governance(), newGov);
        assertTrue(registry.isAuthorized(newGov));
    }

    function test_RevertZeroAddressGovernance() public {
        vm.expectRevert(NullifierRegistry.ZeroAddress.selector);
        vm.prank(governance);
        registry.transferGovernance(address(0));
    }

    // ============================================================================
    // Pausable
    // ============================================================================

    function test_PauseBlocks() public {
        vm.prank(governance);
        registry.pause();
        
        vm.expectRevert("Pausable: paused");
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    function test_UnpauseRestores() public {
        vm.prank(governance);
        registry.pause();
        
        vm.prank(governance);
        registry.unpause();
        
        vm.prank(districtGate);
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
        
        assertTrue(registry.isNullifierUsed(actionId1, nullifier1));
    }

    // ============================================================================
    // Events
    // ============================================================================

    function test_EmitsActionSubmitted() public {
        vm.prank(districtGate);
        
        vm.expectEmit(true, true, false, true);
        emit ActionSubmitted(actionId1, nullifier1, merkleRoot, block.timestamp);
        
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }

    event ActionSubmitted(bytes32 indexed actionId, bytes32 indexed nullifier, bytes32 merkleRoot, uint256 timestamp);
    event ActionCreated(bytes32 indexed actionId, uint256 timestamp);

    function test_EmitsActionCreated() public {
        vm.prank(districtGate);
        
        vm.expectEmit(true, false, false, true);
        emit ActionCreated(actionId1, block.timestamp);
        
        registry.recordNullifier(actionId1, nullifier1, merkleRoot);
    }
}
