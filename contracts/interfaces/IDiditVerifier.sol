// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IDiditVerifier
 * @dev Interface for Didit.me identity verification integration
 * @notice Provides free forever core KYC with verifiable credentials
 */
interface IDiditVerifier {
    struct VerifiableCredential {
        bytes32 credentialHash;     // Hash of the credential data
        uint256 issuedAt;           // Timestamp of issuance
        uint256 expiresAt;          // Expiration timestamp
        address subject;            // Address being verified
        uint8 verificationType;     // 0: Basic KYC, 1: AML, 2: Proof of Address
        bytes32 districtHash;       // Congressional district or electoral region
    }
    
    struct Attestation {
        bool isVerified;            // Whether identity is verified
        uint8 kycLevel;            // 0: None, 1: Basic (free), 2: Premium
        bytes32 districtHash;      // Electoral district hash
        uint256 verifiedAt;        // Verification timestamp
        bytes32 credentialId;      // Unique credential identifier
    }
    
    /**
     * @dev Verify a credential using Didit.me's verifiable credential system
     * @param credentialHash Hash of the credential to verify
     * @param signature Cryptographic signature from Didit.me
     * @return isValid Whether the credential is valid
     */
    function verifyCredential(
        bytes32 credentialHash,
        bytes calldata signature
    ) external view returns (bool isValid);
    
    /**
     * @dev Check if a credential has been revoked
     * @param credentialId Unique identifier of the credential
     * @return isRevoked Whether the credential has been revoked
     */
    function checkRevocation(bytes32 credentialId) external view returns (bool isRevoked);
    
    /**
     * @dev Get attestation for a verified user
     * @param user Address of the user
     * @return attestation The user's verification attestation
     */
    function getAttestation(address user) external view returns (Attestation memory attestation);
    
    /**
     * @dev Verify identity with zero-knowledge proof (privacy-preserving)
     * @param proof ZK proof of identity attributes
     * @param publicInputs Public inputs for the ZK proof
     * @return isValid Whether the proof is valid
     */
    function verifyZKProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool isValid);
    
    /**
     * @dev Get verification cost for different KYC levels
     * @param kycLevel Level of KYC (1: Basic free, 2: AML, 3: Proof of Address)
     * @return cost Cost in USD cents (0 for basic)
     */
    function getVerificationCost(uint8 kycLevel) external pure returns (uint256 cost);
    
    /**
     * @dev Event emitted when a user is verified
     */
    event UserVerified(
        address indexed user,
        bytes32 indexed districtHash,
        uint8 kycLevel,
        bytes32 credentialId
    );
    
    /**
     * @dev Event emitted when a credential is revoked
     */
    event CredentialRevoked(
        bytes32 indexed credentialId,
        address indexed user,
        string reason
    );
}