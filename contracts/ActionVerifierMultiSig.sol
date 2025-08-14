// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import {IActionVerifier} from "./interfaces/IActionVerifier.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ActionVerifierMultiSig
 * @dev Threshold-based EIP-712 signature verification for action hashes
 */
contract ActionVerifierMultiSig is AccessControl, IActionVerifier {
    using ECDSA for bytes32;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant ACTION_TYPEHASH = keccak256("Action(bytes32 actionHash)");

    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 public signerThreshold;
    mapping(bytes32 => bool) public isVerifiedAction;

    event ActionVerified(bytes32 indexed actionHash, uint256 signerCount);
    event ThresholdUpdated(uint256 newThreshold);

    constructor(address admin, uint256 initialThreshold) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SIGNER_ROLE, admin);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("VOTER-ActionVerifier")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        require(initialThreshold > 0, "threshold=0");
        signerThreshold = initialThreshold;
    }

    function setSignerThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold > 0, "threshold=0");
        signerThreshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    function verifyAndMark(bytes32 actionHash, bytes[] calldata signatures) external {
        require(actionHash != bytes32(0), "invalid hash");
        require(!isVerifiedAction[actionHash], "already verified");
        require(signatures.length >= signerThreshold, "insufficient sigs");

        bytes32 digest = _hashAction(actionHash);

        // Track unique signer addresses to prevent duplicates
        address[] memory seen = new address[](signatures.length);
        uint256 seenCount = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(hasRole(SIGNER_ROLE, signer), "unauthorized signer");

            // uniqueness check
            for (uint256 j = 0; j < seenCount; j++) {
                require(seen[j] != signer, "duplicate signer");
            }
            seen[seenCount++] = signer;
        }

        require(seenCount >= signerThreshold, "below threshold");
        isVerifiedAction[actionHash] = true;
        emit ActionVerified(actionHash, seenCount);
    }

    function _hashAction(bytes32 actionHash) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ACTION_TYPEHASH, actionHash));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }
}


