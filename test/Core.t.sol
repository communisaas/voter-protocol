// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {CIVICToken} from "../contracts/CIVICToken.sol";
import {VOTERRegistry} from "../contracts/VOTERRegistry.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";
import {CommuniqueCore} from "../contracts/CommuniqueCore.sol";
import {ISelfProtocol} from "../contracts/interfaces/ISelfProtocol.sol";

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

contract CoreTest is Test {
    CIVICToken civic;
    VOTERRegistry registry;
    ActionVerifierMultiSig verifier;
    CommuniqueCore core;
    DummySelf self;

    address admin = address(this);
    uint256 signerPk;
    address signer;
    address user = address(0xBEEF);

    function setUp() public {
        self = new DummySelf();
        civic = new CIVICToken();
        registry = new VOTERRegistry(address(self));
        verifier = new ActionVerifierMultiSig(admin, 1);
        signerPk = 0xA11CE;
        signer = vm.addr(signerPk);
        core = new CommuniqueCore(address(registry), address(civic), address(verifier));

        civic.grantRole(civic.MINTER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));

        // Core will perform verification via registry during registration
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

        // Register in core mapping
        core.grantRole(core.OPERATOR_ROLE(), admin);
        // Provide a dummy self-proof
        bytes memory selfProof = hex"01";
        core.registerUser(user, bytes32(uint256(42)), selfProof);

        // Fast-forward to bypass interval check
        vm.warp(block.timestamp + 2 hours);

        uint256 balBefore = civic.balanceOf(user);
        core.processCivicAction(user, VOTERRegistry.ActionType.CWC_MESSAGE, actionHash, "ipfs");
        uint256 balAfter = civic.balanceOf(user);

        assertGt(balAfter, balBefore, "CIVIC not minted");

        // Ensure record exists
        VOTERRegistry.VOTERRecord[] memory records = registry.getCitizenRecords(user);
        assertEq(records.length, 1, "record not created");
        assertEq(records[0].actionHash, actionHash, "wrong action hash");
    }
}


