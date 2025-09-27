// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ISelfProtocol
 * @dev Interface for Self Protocol integration
 * @notice Placeholder interface for Self Protocol identity verification
 */
interface ISelfProtocol {
    /**
     * @dev Verify identity credentials
     * @param user Address to verify
     * @param credentialHash Hash of the credential
     * @return isValid Whether the credential is valid
     */
    function verifyCredential(address user, bytes32 credentialHash) external view returns (bool isValid);
    
    /**
     * @dev Get user's verification status
     * @param user Address to check
     * @return isVerified Whether the user is verified
     */
    function isUserVerified(address user) external view returns (bool isVerified);
}