// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {VOTERToken} from "../contracts/VOTERToken.sol";
import {VOTERRegistry} from "../contracts/VOTERRegistry.sol";
import {IdentityRegistry} from "../contracts/IdentityRegistry.sol";
import {CivicActionRegistry} from "../contracts/CivicActionRegistry.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";
import {CommuniqueCore} from "../contracts/CommuniqueCore.sol";
import {ISelfProtocol} from "../contracts/interfaces/ISelfProtocol.sol";
import {AgentParameters} from "../contracts/AgentParameters.sol";
import {IAgentConsensus} from "../contracts/interfaces/IAgentConsensus.sol";
import "forge-std/console.sol";

// Define CitizenAttestation struct for testing
struct CitizenAttestation {
    bool verified;
    bytes32 hash;
}

contract DummySelf is ISelfProtocol {
    mapping(address => bool) public isVerified;
    mapping(address => CitizenAttestation) public att;

    function verifyIdentity(address, bytes calldata) external pure returns (bytes32, uint256, bytes2) {
        return (bytes32(uint256(1)), 18, "US");
    }
    function isVerifiedCitizen(address citizen) external view returns (bool) { return isVerified[citizen]; }
    function getCitizenAttestation(address citizen) external view returns (CitizenAttestation memory) { return att[citizen]; }
    function isPassportUsed(bytes32) external pure returns (bool) { return false; }
    function verifyAgeRequirement(address, uint256 minimumAge) external pure returns (bool) { return minimumAge <= 18; }
    function verifyCitizenship(address, bytes2 requiredCountry) external pure returns (bool) { return requiredCountry == "US"; }
    function phoneToWallet(bytes32) external pure returns (address walletAddress) { return address(0); }
    function walletToPhone(address) external pure returns (bytes32) { return bytes32(0); }
    function generateSelectiveProof(address, string[] calldata) external pure returns (bytes memory) { return bytes(""); }
    function verifySelectiveProof(bytes calldata, string[] calldata) external pure returns (bool) { return true; }
    
    // ISelfProtocol implementation
    function verifyCredential(address, bytes32) external pure returns (bool) { return true; }
    function isUserVerified(address) external pure returns (bool) { return true; }
}

contract MockAgentConsensus is IAgentConsensus {
    mapping(bytes32 => bool) public verifiedActions;
    
    function setVerified(bytes32 actionHash, bool verified) external {
        verifiedActions[actionHash] = verified;
    }
    
    function isVerified(bytes32 actionHash) external view returns (bool) {
        return verifiedActions[actionHash];
    }
}

contract CommuniqueCoreTest is Test {
    VOTERToken voter;
    VOTERRegistry registry;
    IdentityRegistry identityRegistry;
    CivicActionRegistry civicActionRegistry;
    ActionVerifierMultiSig verifier;
    AgentParameters params;
    CommuniqueCore core;
    DummySelf self;
    MockAgentConsensus mockConsensus;
    address emergencyMultiSig;

    address admin = address(this);
    uint256 signerPk;
    address signer;
    address user = address(0xBEEF);

    function setUp() public {
        self = new DummySelf();
        voter = new VOTERToken();
        registry = new VOTERRegistry(address(self));
        identityRegistry = new IdentityRegistry(admin);
        civicActionRegistry = new CivicActionRegistry(address(identityRegistry), admin);
        verifier = new ActionVerifierMultiSig(admin, 1);
        signerPk = 0xA11CE;
        signer = vm.addr(signerPk);
        emergencyMultiSig = address(0x123); // Mock emergency multisig
        mockConsensus = new MockAgentConsensus();
        params = new AgentParameters(address(mockConsensus));
        
        // Initialize parameters through consensus
        params.initializeParameters(
            1e8, // $1 CWC message
            5e7, // $0.5 direct action
            100e18, // max daily mint per user
            10000e18 // max daily mint protocol
        );
        
        vm.prank(address(this)); // Impersonate CoreTest
        core = new CommuniqueCore(
            address(registry), 
            address(voter), 
            address(identityRegistry),
            address(civicActionRegistry),
            address(mockConsensus), 
            address(params),
            emergencyMultiSig
        );
        vm.stopPrank(); // Stop impersonating

        // Grant CommuniqueCore the EPISTEMIC_AGENT_ROLE on VOTERRegistry
        // voterRegistry.grantRole(VOTERRegistry.EPISTEMIC_AGENT_ROLE, address(core));

        voter.grantRole(voter.MINTER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));

        // AgentConsensusGateway removed - using ActionVerifierMultiSig only

        // Configure dynamic rewards via time-locked parameters
        // params.proposeUintChange(keccak256("reward:CWC_MESSAGE"), 10e18);
        // params.proposeUintChange(keccak256("reward:DIRECT_ACTION"), 5e18);

        // Core will perform verification via registry during registration
    }

    // DEPRECATED: AgentConsensusGateway removed - test disabled
    function test_ConsensusGateway_AllowsProcessing_DISABLED() public {
        // Test disabled - AgentConsensusGateway removed from architecture
        return; // Early exit
    }

    // DEPRECATED: AgentConsensusGateway removed - test disabled
    function test_DailyCap_PerUser_Enforced_DISABLED() public {
        // Test disabled - AgentConsensusGateway removed from architecture
        return; // Early exit
    }

    function test_ProcessAction_MintsAndRecords() public {
        // Pre-verify action via agent consensus
        bytes32 actionHash = keccak256("hello");
        bytes32 registrationProof = keccak256("registration_proof");
        
        // Set up consensus verification
        mockConsensus.setVerified(actionHash, true);
        mockConsensus.setVerified(registrationProof, true);
        
        // Register participant through consensus (no admin role)
        core.registerParticipant(user, bytes32(uint256(42)), registrationProof);

        // Fast-forward to bypass interval check
        vm.warp(block.timestamp + 2 hours);

        uint256 balBefore = voter.balanceOf(user);
        // Caps are already set in initialization
        // No need to set again as parameters are now time-locked
        core.processCivicAction(user, VOTERRegistry.ActionType.CWC_MESSAGE, actionHash, "ipfs", 0);
        uint256 balAfter = voter.balanceOf(user);

        assertGt(balAfter, balBefore, "VOTER not minted");

        // Ensure record exists
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(user);
        assertEq(records.length, 1, "record not created");
        assertEq(records[0].actionHash, actionHash, "wrong action hash");
    }

    function test_ParameterTimelock() public {
        // Test that parameter changes require time-lock
        bytes32 testKey = keccak256("testParam");
        uint256 testValue = 123;
        
        // Propose parameter change
        params.proposeUintChange(testKey, testValue);
        
        // Should not be set immediately
        assertEq(params.getUint(testKey), 0, "Parameter should not be set immediately");
        
        // Fast forward past timelock
        vm.warp(block.timestamp + 48 hours + 1);
        
        // Execute the change
        params.executeUintChange(testKey);
        
        // Now it should be set
        assertEq(params.getUint(testKey), testValue, "Parameter should be set after timelock");
    }
}


