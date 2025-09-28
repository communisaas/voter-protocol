// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./shared/TestBase.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";

/**
 * @title SimpleMultiSigTest
 * @dev Test ActionVerifierMultiSig with actual constructor
 */
contract SimpleMultiSigTest is VOTERTestBase {
    ActionVerifierMultiSig verifier;
    
    address signer1 = address(0x100);
    address signer2 = address(0x101);
    address signer3 = address(0x102);
    
    function setUp() public override {
        super.setUp();
        
        // Create signers array
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;
        
        // Deploy with actual constructor (signers array, threshold)
        verifier = new ActionVerifierMultiSig(signers, 2);
    }
    
    function test_Deployment() public {
        assertEq(verifier.signerThreshold(), 2);
    }
    
    function test_SignerRoles() public {
        bytes32 signerRole = verifier.SIGNER_ROLE();
        assertTrue(verifier.hasRole(signerRole, signer1));
        assertTrue(verifier.hasRole(signerRole, signer2));
        assertTrue(verifier.hasRole(signerRole, signer3));
    }
    
    function test_NoAdminRole() public {
        bytes32 defaultAdminRole = bytes32(0);
        assertFalse(verifier.hasRole(defaultAdminRole, admin));
        assertFalse(verifier.hasRole(defaultAdminRole, user1));
        assertFalse(verifier.hasRole(defaultAdminRole, address(this)));
    }
    
    function test_ZeroThresholdReverts() public {
        address[] memory signers = new address[](1);
        signers[0] = signer1;
        
        vm.expectRevert("threshold=0");
        new ActionVerifierMultiSig(signers, 0);
    }
}