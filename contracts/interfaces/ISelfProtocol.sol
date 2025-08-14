// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ISelfProtocol
 * @dev Interface for Self Protocol zero-knowledge identity verification
 */
interface ISelfProtocol {
    
    struct IdentityProof {
        bytes32 passportHash;      // Hash of passport without revealing content
        uint256 ageThreshold;      // Minimum age proved (e.g., 18, 21) without exact age
        bytes2 countryCode;        // Country code (e.g., "US", "CA")
        uint256 verificationTime;  // When the proof was generated
        bytes zkProof;             // Zero-knowledge proof data
    }
    
    struct CitizenAttestation {
        address citizen;
        bytes32 passportHash;
        bool isVerified;
        uint256 verificationTimestamp;
        uint256 expirationTime;
    }
    
    /**
     * @dev Verify an identity proof submitted by a citizen
     * @param citizen Address of the citizen claiming identity
     * @param proof Zero-knowledge proof of identity attributes
     * @return passportHash Hash of the verified passport
     * @return ageThreshold Minimum age threshold met
     * @return countryCode Country of citizenship
     */
    function verifyIdentity(
        address citizen,
        bytes calldata proof
    ) external returns (
        bytes32 passportHash,
        uint256 ageThreshold,
        bytes2 countryCode
    );
    
    /**
     * @dev Check if a citizen is verified through Self Protocol
     * @param citizen Address to check verification status
     * @return True if citizen is verified and verification is still valid
     */
    function isVerifiedCitizen(address citizen) external view returns (bool);
    
    /**
     * @dev Get detailed verification information for a citizen
     * @param citizen Address of the citizen
     * @return CitizenAttestation struct with verification details
     */
    function getCitizenAttestation(address citizen) 
        external 
        view 
        returns (CitizenAttestation memory);
    
    /**
     * @dev Check if a passport hash has already been used
     * @param passportHash Hash to check for previous use
     * @return True if passport has been used for verification
     */
    function isPassportUsed(bytes32 passportHash) external view returns (bool);
    
    /**
     * @dev Verify age requirement without revealing exact age
     * @param citizen Address of the citizen
     * @param minimumAge Minimum age requirement to check
     * @return True if citizen meets the age requirement
     */
    function verifyAgeRequirement(address citizen, uint256 minimumAge) 
        external 
        view 
        returns (bool);
    
    /**
     * @dev Verify citizenship without revealing passport details
     * @param citizen Address of the citizen
     * @param requiredCountry Country code to verify against
     * @return True if citizen is from the required country
     */
    function verifyCitizenship(address citizen, bytes2 requiredCountry) 
        external 
        view 
        returns (bool);
    
    /**
     * @dev Create a wallet address from phone number (Self Connect feature)
     * @param phoneNumber Hashed phone number
     * @return walletAddress Generated wallet address
     */
    function phoneToWallet(bytes32 phoneNumber) 
        external 
        view 
        returns (address walletAddress);
    
    /**
     * @dev Reverse lookup: get phone hash from wallet address
     * @param walletAddress Wallet address to lookup
     * @return phoneHash Associated phone number hash
     */
    function walletToPhone(address walletAddress) 
        external 
        view 
        returns (bytes32 phoneHash);
    
    /**
     * @dev Generate proof for selective disclosure
     * @param citizen Address of the citizen
     * @param attributes Array of attribute names to disclose
     * @return Selective disclosure proof
     */
    function generateSelectiveProof(
        address citizen,
        string[] calldata attributes
    ) external view returns (bytes memory);
    
    /**
     * @dev Verify selective disclosure proof
     * @param proof Selective disclosure proof to verify
     * @param attributes Expected attributes in the proof
     * @return True if proof is valid
     */
    function verifySelectiveProof(
        bytes calldata proof,
        string[] calldata attributes
    ) external view returns (bool);
    
    // Events
    event IdentityVerified(
        address indexed citizen,
        bytes32 indexed passportHash,
        bytes2 countryCode,
        uint256 ageThreshold,
        uint256 timestamp
    );
    
    event VerificationExpired(
        address indexed citizen,
        bytes32 indexed passportHash,
        uint256 timestamp
    );
    
    event SelectiveProofGenerated(
        address indexed citizen,
        string[] attributes,
        uint256 timestamp
    );
}