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
import "forge-std/console.sol";

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
        params = new AgentParameters(admin);
        vm.prank(address(this)); // Impersonate CoreTest (who has DEFAULT_ADMIN_ROLE on VOTERRegistry)
        core = new CommuniqueCore(
            address(registry), 
            address(voter), 
            address(identityRegistry),
            address(civicActionRegistry),
            address(verifier), 
            address(params)
        );
        vm.stopPrank(); // Stop impersonating

        // Grant CommuniqueCore the EPISTEMIC_AGENT_ROLE on VOTERRegistry
        // voterRegistry.grantRole(VOTERRegistry.EPISTEMIC_AGENT_ROLE, address(core));

        voter.grantRole(voter.MINTER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));

        // AgentConsensusGateway removed - using ActionVerifierMultiSig only

        // Configure dynamic rewards via AgentParameters
        params.setUint(keccak256("reward:CWC_MESSAGE"), 10e18);
        params.setUint(keccak256("reward:DIRECT_ACTION"), 5e18);

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
        // Pre-verify action via multisig verifier (1-of-1 threshold)
        bytes32 actionHash = keccak256("hello");
        verifier.grantRole(verifier.SIGNER_ROLE(), signer);
        bytes32 structHash = keccak256(abi.encode(verifier.ACTION_TYPEHASH(), actionHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", verifier.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;
        verifier.verifyAndMark(actionHash, sigs);

        // Register participant through admin role
        core.grantRole(core.ADMIN_ROLE(), admin);
        vm.prank(admin);
        core.registerParticipant(user, bytes32(uint256(42)));

        // Fast-forward to bypass interval check
        vm.warp(block.timestamp + 2 hours);

        uint256 balBefore = voter.balanceOf(user);
        // Set caps sufficiently high for this test
        params.setUint(keccak256("maxDailyMintPerUser"), 10000e18); // Adjusted to fit within AgentParameters maxValues
        params.setUint(keccak256("maxDailyMintProtocol"), 1000000e18); // Adjusted to fit within AgentParameters maxValues
        params.setUint(keccak256("maxRewardPerAction"), 100e18);
        core.processCivicAction(user, VOTERRegistry.ActionType.CWC_MESSAGE, actionHash, "ipfs", 0);
        uint256 balAfter = voter.balanceOf(user);

        assertGt(balAfter, balBefore, "VOTER not minted");

        // Ensure record exists
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(user);
        assertEq(records.length, 1, "record not created");
        assertEq(records[0].actionHash, actionHash, "wrong action hash");
    }

    function test_GrantRoleAndSetParam() public {
        vm.prank(admin);
        params.grantRole(params.PARAM_SETTER_ROLE(), admin);
        params.setUint(keccak256("testParam"), 123);
        assertEq(params.getUint(keccak256("testParam")), 123, "Test param not set");
    }
}


