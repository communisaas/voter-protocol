// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IDiditVerifier.sol";

/**
 * @title VOTERRegistry
 * @dev Registry for non-transferable civic engagement records
 * @notice Stores immutable proof of verified civic actions
 */
contract VOTERRegistry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EPISTEMIC_AGENT_ROLE = keccak256("EPISTEMIC_AGENT_ROLE");
    
    IDiditVerifier public immutable diditVerifier;
    
    enum ActionType {
        CWC_MESSAGE,
        DIRECT_ACTION
    }
    
    struct VOTERRecord {
        uint256 timestamp;
        ActionType actionType;
        bytes32 actionHash;
        bytes32 districtHash;
        address citizen;
        bool verified;
        string metadata; // IPFS hash for additional data (legacy)
        bytes32 metadataHash; // canonical bytes32 metadata hash (planned default)
        uint256 credibilityScore; // New: Score reflecting content veracity
    }
    
    struct CitizenProfile {
        bool verified;
        bytes32 districtHash;
        uint256 totalActions;
        uint256 joinedTimestamp;
        bool isActive;
        bytes32 diditCredentialId;  // Didit.me credential identifier
        uint256 diditVerificationTime;
        // epistemicReputationScore removed - use ReputationRegistry instead
    }
    
    mapping(address => CitizenProfile) public citizenProfiles;
    mapping(address => VOTERRecord[]) public citizenRecords;
    mapping(bytes32 => bool) public actionHashUsed;
    
    // External SBT/points removed
    mapping(bytes32 => uint256) public districtActionCounts;
    
    uint256 public totalRecords;
    uint256 public totalVerifiedCitizens;
    
    event VOTERRecordCreated(
        address indexed citizen,
        uint256 indexed recordId,
        ActionType actionType,
        bytes32 actionHash,
        bytes32 districtHash
    );
    
    event VOTERPointsMinted(address indexed to, uint256 indexed tokenId, bytes32 actionHash);
    
    event CitizenVerified(
        address indexed citizen,
        bytes32 districtHash,
        uint256 timestamp
    );
    
    event CitizenDeactivated(address indexed citizen, string reason);
    event EpistemicReputationUpdated(address indexed citizen, uint256 newScore);
    
    modifier onlyVerifiedCitizen() {
        require(citizenProfiles[msg.sender].verified && citizenProfiles[msg.sender].isActive, "Not verified citizen");
        _;
    }
    
    modifier onlyVerifier() {
        require(hasRole(VERIFIER_ROLE, msg.sender), "Not authorized verifier");
        _;
    }
    
    constructor(address _diditVerifier) {
        diditVerifier = IDiditVerifier(_diditVerifier);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(EPISTEMIC_AGENT_ROLE, msg.sender); // Grant to deployer
    }

    // VOTERPoints concept removed
    
    /**
     * @dev Verify citizen using Didit.me verifiable credentials
     * @notice Free forever core KYC with optional premium compliance
     * @param citizen Address of the citizen
     * @param districtHash Hash of the electoral district  
     * @param credentialHash Hash of the Didit.me credential
     * @param signature Cryptographic signature from Didit.me
     */
    function verifyCitizenWithDidit(
        address citizen, 
        bytes32 districtHash, 
        bytes32 credentialHash,
        bytes calldata signature
    ) external onlyVerifier {
        require(!citizenProfiles[citizen].verified, "Already verified");
        require(diditVerifier.verifyCredential(credentialHash, signature), "Invalid credential");
        
        IDiditVerifier.Attestation memory attestation = diditVerifier.getAttestation(citizen);
        require(attestation.isVerified, "Identity not verified");
        require(attestation.districtHash == districtHash, "District mismatch");
        
        citizenProfiles[citizen] = CitizenProfile({
            verified: true,
            districtHash: districtHash,
            totalActions: 0,
            joinedTimestamp: block.timestamp,
            isActive: true,
            diditCredentialId: attestation.credentialId,
            diditVerificationTime: block.timestamp
        });
        
        totalVerifiedCitizens++;
        
        emit CitizenVerified(citizen, districtHash, block.timestamp);
    }
    
    // Legacy verification removed: use verifyCitizenWithSelf
    
    /**
     * @dev Create a new VOTER record for verified civic action
     * @param citizen Address of the citizen who took action
     * @param actionType Type of civic action
     * @param actionHash Hash of the action details
     * @param metadata IPFS hash for additional data
     */
    function createVOTERRecord(
        address citizen,
        ActionType actionType,
        bytes32 actionHash,
        string memory metadata,
        uint256 _credibilityScore // New parameter
    ) external onlyVerifier nonReentrant whenNotPaused {
        require(citizenProfiles[citizen].verified && citizenProfiles[citizen].isActive, "Citizen not verified");
        require(!actionHashUsed[actionHash], "Action already recorded");
        require(actionHash != bytes32(0), "Invalid action hash");
        
        bytes32 districtHash = citizenProfiles[citizen].districtHash;
        
        VOTERRecord memory newRecord = VOTERRecord({
            timestamp: block.timestamp,
            actionType: actionType,
            actionHash: actionHash,
            districtHash: districtHash,
            citizen: citizen,
            verified: true,
            metadata: metadata,
            metadataHash: keccak256(bytes(metadata)),
            credibilityScore: _credibilityScore // Assign the new score
        });
        
        citizenRecords[citizen].push(newRecord);
        actionHashUsed[actionHash] = true;
        citizenProfiles[citizen].totalActions++;
        districtActionCounts[districtHash]++;
        totalRecords++;
        
        emit VOTERRecordCreated(
            citizen,
            citizenRecords[citizen].length - 1,
            actionType,
            actionHash,
            districtHash
        );

        // SBT mint removed
    }
    
    /**
     * @dev Get citizen's civic engagement history
     * @param citizen Address of the citizen
     * @return Array of VOTER records
     */
    function getCitizenRecords(address citizen) external view returns (VOTERRecord[] memory) {
        return citizenRecords[citizen];
    }
    
    /**
     * @dev Get specific VOTER record
     * @param citizen Address of the citizen
     * @param recordId Index of the record
     * @return VOTER record details
     */
    function getVOTERRecord(address citizen, uint256 recordId) external view returns (VOTERRecord memory) {
        require(recordId < citizenRecords[citizen].length, "Record does not exist");
        return citizenRecords[citizen][recordId];
    }
    
    /**
     * @dev Get district engagement statistics
     * @param districtHash Hash of the congressional district
     * @return Number of civic actions from this district
     */
    function getDistrictStats(bytes32 districtHash) external view returns (uint256) {
        return districtActionCounts[districtHash];
    }
    
    /**
     * @dev Deactivate a citizen (emergency use)
     * @param citizen Address of the citizen
     * @param reason Reason for deactivation
     */
    function deactivateCitizen(address citizen, string memory reason) external onlyRole(ADMIN_ROLE) {
        require(citizenProfiles[citizen].verified, "Citizen not verified");
        citizenProfiles[citizen].isActive = false;
        emit CitizenDeactivated(citizen, reason);
    }
    
    /**
     * @dev Check if action hash has been used
     * @param actionHash Hash to check
     * @return True if hash has been used
     */
    function isActionHashUsed(bytes32 actionHash) external view returns (bool) {
        return actionHashUsed[actionHash];
    }
    
    /**
     * @dev Get platform statistics
     * @return totalRecords Total number of VOTER records
     * @return totalVerifiedCitizens Total number of verified citizens
     */
    function getPlatformStats() external view returns (uint256, uint256) {
        return (totalRecords, totalVerifiedCitizens);
    }
    
    /**
     * @dev Emergency pause function
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause function
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev DEPRECATED: Use ReputationRegistry instead
     * @notice Epistemic reputation is now handled by ReputationRegistry contract
     */
    function updateEpistemicReputation(address citizen, uint256 newScore) external view onlyRole(EPISTEMIC_AGENT_ROLE) {
        revert("DEPRECATED: Use ReputationRegistry for reputation management");
    }
}