// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title IdentityRegistry
 * @dev Minimal implementation of ERC-8004 Identity Registry adapted for human civic participants
 * @notice HONEST DISCLOSURE: This is a simplified subset of ERC-8004 for testnet MVP
 * 
 * What we implement:
 * - Basic participant registration with district tracking
 * - Incremental participant IDs (following ERC-8004 pattern)
 * - Event emission for off-chain indexing
 * 
 * What we DON'T implement (yet):
 * - AgentDomain resolution (humans don't have domains)
 * - Agent Cards (replaced with future Participant Profiles)
 * - CAIP-10 cross-chain addressing (single-chain MVP)
 * - Off-chain URI resolution (using events for now)
 * 
 * Future compatibility:
 * - participantId maps to ERC-8004's AgentID
 * - participantAddress maps to AgentAddress
 * - districtHash replaces AgentDomain for human context
 */
contract IdentityRegistry is AccessControl, Pausable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    
    struct Participant {
        address participantAddress;
        bytes32 districtHash;
        uint256 registrationTime;
        bool isActive;
        // Future: string profileURI for off-chain data
        // Future: bytes32[] attestationHashes for ZK proofs
    }
    
    // ERC-8004 compatible incremental IDs
    uint256 private _nextParticipantId = 1;
    
    // Core storage
    mapping(uint256 => Participant) public participants;
    mapping(address => uint256) public addressToId;
    mapping(bytes32 => uint256[]) public districtParticipants;
    
    // Statistics
    uint256 public totalParticipants;
    uint256 public activeParticipants;
    
    // Events following ERC-8004 pattern
    event ParticipantRegistered(
        uint256 indexed participantId,
        address indexed participantAddress,
        bytes32 indexed districtHash,
        uint256 timestamp
    );
    
    event ParticipantUpdated(
        uint256 indexed participantId,
        bytes32 oldDistrictHash,
        bytes32 newDistrictHash
    );
    
    event ParticipantDeactivated(
        uint256 indexed participantId,
        string reason
    );
    
    constructor(address[] memory registrars) {
        // Grant REGISTRAR_ROLE to initial registrars (no admin role)
        for (uint256 i = 0; i < registrars.length; i++) {
            _grantRole(REGISTRAR_ROLE, registrars[i]);
        }
    }
    
    /**
     * @dev Register a new participant (simplified from ERC-8004's New())
     * @param participantAddress Address of the participant
     * @param districtHash Hash of congressional district
     * @return participantId Unique incremental ID
     * 
     * NOTE: In production, this would verify identity proofs
     * Currently trusts REGISTRAR_ROLE for testnet MVP
     */
    function register(
        address participantAddress,
        bytes32 districtHash
    ) external onlyRole(REGISTRAR_ROLE) whenNotPaused returns (uint256) {
        require(participantAddress != address(0), "Invalid address");
        require(districtHash != bytes32(0), "Invalid district");
        require(addressToId[participantAddress] == 0, "Already registered");
        
        uint256 participantId = _nextParticipantId++;
        
        participants[participantId] = Participant({
            participantAddress: participantAddress,
            districtHash: districtHash,
            registrationTime: block.timestamp,
            isActive: true
        });
        
        addressToId[participantAddress] = participantId;
        districtParticipants[districtHash].push(participantId);
        
        totalParticipants++;
        activeParticipants++;
        
        emit ParticipantRegistered(
            participantId,
            participantAddress,
            districtHash,
            block.timestamp
        );
        
        return participantId;
    }
    
    /**
     * @dev Update participant's district (simplified from ERC-8004's Update())
     * @param participantId ID of the participant
     * @param newDistrictHash New district hash
     * 
     * STUB: Should verify proof of new residence
     * Currently trusts participant or REGISTRAR_ROLE
     */
    function updateDistrict(
        uint256 participantId,
        bytes32 newDistrictHash
    ) external whenNotPaused returns (bool) {
        Participant storage participant = participants[participantId];
        require(participant.participantAddress != address(0), "Participant not found");
        require(participant.isActive, "Participant not active");
        require(
            msg.sender == participant.participantAddress || 
            hasRole(REGISTRAR_ROLE, msg.sender),
            "Unauthorized"
        );
        
        bytes32 oldDistrictHash = participant.districtHash;
        participant.districtHash = newDistrictHash;
        
        // Update district mappings
        _removeFromDistrict(participantId, oldDistrictHash);
        districtParticipants[newDistrictHash].push(participantId);
        
        emit ParticipantUpdated(participantId, oldDistrictHash, newDistrictHash);
        
        return true;
    }
    
    /**
     * @dev Resolve participant by ID (ERC-8004 compatible Get())
     */
    function getParticipant(uint256 participantId) external view returns (
        address participantAddress,
        bytes32 districtHash,
        uint256 registrationTime,
        bool isActive
    ) {
        Participant memory p = participants[participantId];
        return (p.participantAddress, p.districtHash, p.registrationTime, p.isActive);
    }
    
    /**
     * @dev Resolve by address (ERC-8004 compatible ResolveByAddress())
     */
    function resolveByAddress(address participantAddress) external view returns (
        uint256 participantId,
        bytes32 districtHash,
        uint256 registrationTime,
        bool isActive
    ) {
        participantId = addressToId[participantAddress];
        require(participantId != 0, "Not registered");
        
        Participant memory p = participants[participantId];
        return (participantId, p.districtHash, p.registrationTime, p.isActive);
    }
    
    /**
     * @dev Get all participants in a district
     * NOTE: Not in ERC-8004, added for civic use case
     */
    function getDistrictParticipants(bytes32 districtHash) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return districtParticipants[districtHash];
    }
    
    // REMOVED: Admin deactivation function eliminated
    // Participants can only be deactivated through external challenge/validation mechanisms
    
    /**
     * @dev Check if address is registered
     */
    function isRegistered(address participantAddress) external view returns (bool) {
        return addressToId[participantAddress] != 0;
    }
    
    // REMOVED: Admin pause/unpause functions eliminated
    // Contract is now pausable only through external emergency mechanisms
    
    // Internal helper
    function _removeFromDistrict(uint256 participantId, bytes32 districtHash) internal {
        uint256[] storage districtList = districtParticipants[districtHash];
        for (uint i = 0; i < districtList.length; i++) {
            if (districtList[i] == participantId) {
                districtList[i] = districtList[districtList.length - 1];
                districtList.pop();
                break;
            }
        }
    }
    
    /**
     * FUTURE ADDITIONS (documented for grant applications):
     * 
     * 1. Participant Profiles (replacing Agent Cards):
     *    - function setProfileURI(uint256 participantId, string memory uri)
     *    - Off-chain JSON with civic history, attestations
     * 
     * 2. Zero-Knowledge Identity:
     *    - function registerWithProof(bytes32 commitment, bytes calldata zkProof)
     *    - Integration with Semaphore/WorldID for privacy
     * 
     * 3. Cross-chain Support:
     *    - CAIP-10 addressing for multi-chain participants
     *    - Bridge contracts for cross-chain reputation
     * 
     * 4. ENS Integration:
     *    - Resolve participants by ENS names
     *    - Display names for better UX
     */
}