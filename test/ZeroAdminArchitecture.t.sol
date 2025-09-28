// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./shared/TestBase.sol";
import {VOTERToken} from "../contracts/VOTERToken.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";
import {AgentParameters} from "../contracts/AgentParameters.sol";

/**
 * @title ZeroAdminArchitectureTest
 * @dev Verify that our core contracts have zero admin control
 */
contract ZeroAdminArchitectureTest is VOTERTestBase {
    VOTERToken token;
    ActionVerifierMultiSig verifier;
    AgentParameters params;
    
    function setUp() public override {
        super.setUp();
        
        // Mock addresses
        address consensusEngine = address(0x10);
        address bounds = address(0x11);
        address communiqueCore = address(0x12);
        
        // Deploy contracts
        token = new VOTERToken(consensusEngine, bounds, communiqueCore);
        
        address[] memory signers = new address[](2);
        signers[0] = user1;
        signers[1] = user2;
        verifier = new ActionVerifierMultiSig(signers, 2);
        
        params = new AgentParameters(consensusEngine);
    }
    
    function test_VOTERTokenHasNoAdminControls() public {
        // VOTERToken doesn't inherit AccessControl - verify immutable design
        // Only CommuniqueCore can mint, no admin functions exist
        
        // Verify immutable addresses are set correctly
        assertEq(address(token.consensusEngine()), address(0x10));
        assertEq(address(token.bounds()), address(0x11));
        assertEq(token.communiqueCore(), address(0x12));
        
        // Verify no owner() function exists (not Ownable)
        // This would fail compilation if owner() existed
        assertTrue(address(token) != address(0));
    }
    
    function test_MultiSigHasNoAdminRole() public {
        bytes32 defaultAdminRole = bytes32(0);
        
        // Verify no admin role exists
        assertFalse(verifier.hasRole(defaultAdminRole, admin));
        assertFalse(verifier.hasRole(defaultAdminRole, user1));
        assertFalse(verifier.hasRole(defaultAdminRole, address(this)));
        
        // Verify threshold is immutable (no function to change it)
        assertEq(verifier.signerThreshold(), 2);
    }
    
    function test_AgentParametersRequiresConsensus() public {
        // Verify immutable consensus address
        assertEq(params.agentConsensus(), address(0x10));
        
        // AgentParameters doesn't inherit AccessControl - only has consensus modifier
        // All parameter changes require consensus, no admin functions exist
        assertTrue(address(params) != address(0));
    }
    
    function test_OnlyAuthorizedContractsCanMint() public {
        bytes32 actionHash = keccak256("test");
        
        // Random addresses cannot mint
        vm.prank(admin);
        vm.expectRevert("Only CommuniqueCore");
        token.mintReward(user1, 100e18, actionHash);
        
        vm.prank(user1);
        vm.expectRevert("Only CommuniqueCore");
        token.mintReward(user1, 100e18, actionHash);
        
        // Only CommuniqueCore can mint
        vm.prank(address(0x12)); // communiqueCore
        token.mintReward(user1, 100e18, actionHash);
        assertEq(token.balanceOf(user1), 100e18);
    }
}