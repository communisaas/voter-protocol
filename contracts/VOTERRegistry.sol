// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/ISelfProtocol.sol";

/**
 * @title VOTERRegistry
 * @dev Registry for non-transferable civic engagement records
 * @notice Stores immutable proof of verified civic actions
 */
contract VOTERRegistry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    ISelfProtocol public immutable selfProtocol;
    
    enum ActionType {
        CWC_MESSAGE,
        DIRECT_ACTION,
        COMMUNITY_ORGANIZING,
        POLICY_ADVOCACY
    }
    
    struct VOTERRecord {
        uint256 timestamp;
        ActionType actionType;
        bytes32 actionHash;
        bytes32 districtHash;
        address citizen;
        bool verified;
        string metadata; // IPFS hash for additional data
    }
    
    struct CitizenProfile {
        bool verified;
        bytes32 districtHash;
        uint256 totalActions;
        uint256 joinedTimestamp;
        bool isActive;
        bytes32 selfPassportHash;  // Self Protocol passport verification
        uint256 selfVerificationTime;
    }
    
    mapping(address => CitizenProfile) public citizenProfiles;
    mapping(address => VOTERRecord[]) public citizenRecords;
    mapping(bytes32 => bool) public actionHashUsed;
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
    
    event CitizenVerified(
        address indexed citizen,
        bytes32 districtHash,
        uint256 timestamp
    );
    
    event CitizenDeactivated(address indexed citizen, string reason);
    
    modifier onlyVerifiedCitizen() {
        require(citizenProfiles[msg.sender].verified && citizenProfiles[msg.sender].isActive, "Not verified citizen");
        _;
    }
    
    modifier onlyVerifier() {
        require(hasRole(VERIFIER_ROLE, msg.sender), "Not authorized verifier");
        _;
    }
    
    constructor(address _selfProtocol) {
        selfProtocol = ISelfProtocol(_selfProtocol);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @dev Verify a citizen's identity through Self Protocol
     * @param citizen Address of the citizen
     * @param districtHash Hash of the congressional district
     * @param selfProof Self Protocol zero-knowledge proof
     */
    function verifyCitizenWithSelf(
        address citizen, 
        bytes32 districtHash, 
        bytes calldata selfProof
    ) external onlyVerifier {
        require(!citizenProfiles[citizen].verified, "Already verified");
        
        // Verify through Self Protocol
        (
            bytes32 passportHash,
            uint256 ageThreshold, 
            bytes2 countryCode
        ) = selfProtocol.verifyIdentity(citizen, selfProof);
        
        // Check eligibility requirements
        require(ageThreshold >= 18, "Must be 18+ to participate");
        require(countryCode == "US", "Must be US citizen");
        require(!selfProtocol.isPassportUsed(passportHash), "Passport already used");
        
        citizenProfiles[citizen] = CitizenProfile({
            verified: true,
            districtHash: districtHash,
            totalActions: 0,
            joinedTimestamp: block.timestamp,
            isActive: true,
            selfPassportHash: passportHash,
            selfVerificationTime: block.timestamp
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
        string memory metadata
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
            metadata: metadata
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
}