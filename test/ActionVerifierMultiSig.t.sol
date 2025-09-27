// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/ActionVerifierMultiSig.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ActionVerifierMultiSigTest is Test {
    using ECDSA for bytes32;
    
    ActionVerifierMultiSig public verifier;
    
    address public admin = address(this);
    address public signer1;
    address public signer2;
    address public signer3;
    uint256 public signer1Pk = 1;
    uint256 public signer2Pk = 2;
    uint256 public signer3Pk = 3;
    
    function setUp() public {
        signer1 = vm.addr(signer1Pk);
        signer2 = vm.addr(signer2Pk);
        signer3 = vm.addr(signer3Pk);
        
        address[] memory initialSigners = new address[](3);
        initialSigners[0] = signer1;
        initialSigners[1] = signer2;
        initialSigners[2] = signer3;
        
        verifier = new ActionVerifierMultiSig(initialSigners, 2); // 2-of-3 threshold
    }
    
    function test_SingleSignerBelowThreshold() public {
        bytes32 actionHash = keccak256("action1");
        
        // Create EIP-712 digest
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with only one signer
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer1Pk, digest);
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, s, v);
        
        // Should revert with insufficient signatures
        vm.expectRevert("insufficient sigs");
        verifier.verifyAndMark(actionHash, signatures);
    }
    
    function test_TwoSignersMeetThreshold() public {
        bytes32 actionHash = keccak256("action2");
        
        // Create EIP-712 digest
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with two signers
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(signer1Pk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer2Pk, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        // Should succeed
        verifier.verifyAndMark(actionHash, signatures);
        
        // Verify action is marked
        assertTrue(verifier.isVerifiedAction(actionHash));
    }
    
    function test_DuplicateSignersRejected() public {
        bytes32 actionHash = keccak256("action3");
        
        // Create EIP-712 digest
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with same signer twice
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer1Pk, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r, s, v);
        signatures[1] = abi.encodePacked(r, s, v); // Same signature
        
        // Should revert with duplicate signer
        vm.expectRevert("duplicate signer");
        verifier.verifyAndMark(actionHash, signatures);
    }
    
    function test_UnauthorizedSignerRejected() public {
        bytes32 actionHash = keccak256("action4");
        
        // Create EIP-712 digest
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with unauthorized signer
        uint256 unauthorizedPk = 99;
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(unauthorizedPk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer1Pk, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        // Should revert with unauthorized signer
        vm.expectRevert("unauthorized signer");
        verifier.verifyAndMark(actionHash, signatures);
    }
    
    function test_AlreadyVerifiedAction() public {
        bytes32 actionHash = keccak256("action5");
        
        // Create EIP-712 digest
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with two signers
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(signer1Pk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer2Pk, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        // First verification should succeed
        verifier.verifyAndMark(actionHash, signatures);
        
        // Second verification should fail
        vm.expectRevert("already verified");
        verifier.verifyAndMark(actionHash, signatures);
    }
    
    function test_ThresholdIsImmutable() public {
        // Verify threshold cannot be changed after deployment
        assertEq(verifier.signerThreshold(), 2);
        
        // The setSignerThreshold function no longer exists - threshold is immutable
        // This prevents centralized threshold manipulation
    }
    
    function test_ThreeSignersExceedThreshold() public {
        bytes32 actionHash = keccak256("action7");
        bytes32 digest = _hashAction(actionHash);
        
        // Sign with all three signers
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(signer1Pk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer2Pk, digest);
        (uint8 v3, bytes32 r3, bytes32 s3) = vm.sign(signer3Pk, digest);
        
        bytes[] memory signatures = new bytes[](3);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        signatures[2] = abi.encodePacked(r3, s3, v3);
        
        // Should succeed (exceeds threshold of 2)
        verifier.verifyAndMark(actionHash, signatures);
        assertTrue(verifier.isVerifiedAction(actionHash));
    }
    
    function test_EmptyActionHashRejected() public {
        bytes32 actionHash = bytes32(0);
        bytes32 digest = _hashAction(actionHash);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(signer1Pk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer2Pk, digest);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        vm.expectRevert("invalid hash");
        verifier.verifyAndMark(actionHash, signatures);
    }
    
    function test_ZeroThresholdRejected() public {
        address[] memory emptySigners = new address[](0);
        vm.expectRevert("threshold=0");
        new ActionVerifierMultiSig(emptySigners, 0);
    }
    
    // Helper function to create EIP-712 digest
    function _hashAction(bytes32 actionHash) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(verifier.ACTION_TYPEHASH(), actionHash));
        return keccak256(abi.encodePacked("\x19\x01", verifier.DOMAIN_SEPARATOR(), structHash));
    }
}