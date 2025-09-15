// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/VOTERRegistry.sol";
import "../contracts/interfaces/IDiditVerifier.sol";

contract MockDiditVerifier is IDiditVerifier {
    mapping(address => Attestation) public attestations;
    mapping(bytes32 => bool) public revokedCredentials;
    
    function verifyCredential(
        bytes32 credentialHash,
        bytes calldata
    ) external pure returns (bool) {
        // Mock: accept any non-zero credential hash
        return credentialHash != bytes32(0);
    }
    
    function checkRevocation(bytes32 credentialId) external view returns (bool) {
        return revokedCredentials[credentialId];
    }
    
    function getAttestation(address user) external view returns (Attestation memory) {
        // Return a mock attestation for testing
        if (attestations[user].isVerified) {
            return attestations[user];
        }
        // Default attestation for testing
        return Attestation({
            isVerified: true,
            kycLevel: 1,
            districtHash: keccak256("CA-12"),
            verifiedAt: block.timestamp,
            credentialId: keccak256(abi.encodePacked(user))
        });
    }
    
    function verifyZKProof(
        bytes calldata,
        uint256[] calldata
    ) external pure returns (bool) {
        return true;
    }
    
    function getVerificationCost(uint8 kycLevel) external pure returns (uint256) {
        if (kycLevel == 1) return 0; // Basic KYC is free
        if (kycLevel == 2) return 35; // AML screening $0.35
        if (kycLevel == 3) return 50; // Proof of address $0.50
        return 0;
    }
    
    // Helper function for testing
    function setAttestation(address user, Attestation memory attestation) external {
        attestations[user] = attestation;
    }
}

contract VOTERRegistryTest is Test {
    VOTERRegistry public registry;
    MockDiditVerifier public diditVerifier;
    
    address public admin = address(this);
    address public verifier = address(0xBEEF);
    address public alice = address(0x1);
    address public bob = address(0x2);
    
    bytes32 public district1 = keccak256("CA-12");
    bytes32 public district2 = keccak256("TX-3");
    
    function setUp() public {
        diditVerifier = new MockDiditVerifier();
        registry = new VOTERRegistry(address(diditVerifier));
        
        // Grant verifier role
        registry.grantRole(registry.VERIFIER_ROLE(), verifier);
    }
    
    function test_VerifyCitizen() public {
        // Verify Alice
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Check verification
        (bool verified, bytes32 district, , , bool isActive, , ) = registry.citizenProfiles(alice);
        assertTrue(verified);
        assertTrue(isActive);
        assertEq(district, district1);
    }
    
    function test_CannotVerifyTwice() public {
        // Verify Alice
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Try to verify again
        vm.prank(verifier);
        vm.expectRevert("Already verified");
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
    }
    
    function test_OnlyVerifierCanVerify() public {
        // Try to verify without verifier role
        vm.expectRevert();
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
    }
    
    function test_CreateVOTERRecord() public {
        // Verify citizen first
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Create VOTER record
        bytes32 actionHash = keccak256("action1");
        vm.prank(verifier);
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "ipfs://metadata",
            75
        );
        
        // Check record
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(alice);
        assertEq(records.length, 1);
        assertEq(records[0].citizen, alice);
        assertEq(uint(records[0].actionType), uint(VOTERRegistry.ActionType.CWC_MESSAGE));
        assertEq(records[0].actionHash, actionHash);
        assertEq(records[0].metadata, "ipfs://metadata");
        assertEq(records[0].credibilityScore, 75);
    }
    
    function test_CannotCreateRecordForUnverified() public {
        bytes32 actionHash = keccak256("action1");
        
        vm.prank(verifier);
        vm.expectRevert("Citizen not verified");
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            actionHash,
            "ipfs://metadata",
            75
        );
    }
    
    function test_GetCitizenRecords() public {
        // Verify citizen
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Create multiple records
        vm.startPrank(verifier);
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.CWC_MESSAGE,
            keccak256("action1"),
            "ipfs://metadata1",
            80
        );
        
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.DIRECT_ACTION,
            keccak256("action2"),
            "ipfs://metadata2",
            90
        );
        vm.stopPrank();
        
        // Get records
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(alice);
        assertEq(records.length, 2);
    }
    
    function test_ActionTypeEnumeration() public {
        // Test all action types are valid
        assertTrue(uint(VOTERRegistry.ActionType.CWC_MESSAGE) == 0);
        assertTrue(uint(VOTERRegistry.ActionType.DIRECT_ACTION) == 1);
    }
    
    function test_RecordCredibilityScore() public {
        // Verify citizen
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Create record with credibility score
        vm.prank(verifier);
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.DIRECT_ACTION,
            keccak256("petition1"),
            "ipfs://petition",
            95
        );
        
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(alice);
        assertEq(records[0].credibilityScore, 95);
    }
    
    function test_EmptyMetadataAllowed() public {
        // Verify citizen
        vm.prank(verifier);
        registry.verifyCitizenWithDidit(alice, district1, keccak256("credential1"), bytes("signature"));
        
        // Create record with empty metadata
        vm.prank(verifier);
        registry.createVOTERRecord(
            alice,
            VOTERRegistry.ActionType.DIRECT_ACTION,
            keccak256("action"),
            "", // Empty metadata
            50
        );
        
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(alice);
        assertEq(records[0].metadata, "");
    }
}