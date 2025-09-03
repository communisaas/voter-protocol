// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title IdentityRegistry
 * @dev ERC-8004 Identity Registry for trustless agent attestations
 * @notice Stores identity attestations for both human participants and AI agents
 */
contract IdentityRegistry is AccessControl {
    using ECDSA for bytes32;
    
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    
    struct Identity {
        address subject;
        string identityType; // "human", "ai_agent", "hybrid"
        bytes32 attestationHash;
        uint256 timestamp;
        address attestor;
        bool isActive;
        string metadataURI; // IPFS URI for additional identity data
    }
    
    struct AgentIdentity {
        string modelType; // "langchain", "autogen", "custom"
        string capabilities; // JSON string of agent capabilities
        address controller; // Who controls this agent
        uint256 registrationTime;
        bool isAutonomous; // Can act without human approval
    }
    
    mapping(address => Identity) public identities;
    mapping(address => AgentIdentity) public agentIdentities;
    mapping(address => address[]) public attestations; // subject => attestors
    mapping(bytes32 => bool) public usedAttestationHashes;
    
    uint256 public totalIdentities;
    uint256 public totalAgents;
    
    event IdentityRegistered(
        address indexed subject,
        string identityType,
        address indexed attestor
    );
    
    event AgentRegistered(
        address indexed agent,
        string modelType,
        address indexed controller
    );
    
    event IdentityRevoked(
        address indexed subject,
        string reason
    );
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTOR_ROLE, msg.sender);
    }
    
    /**
     * @dev Register a new identity with attestation
     * @param subject Address of the identity subject
     * @param identityType Type of identity (human/ai_agent/hybrid)
     * @param attestationHash Hash of attestation data
     * @param metadataURI IPFS URI for metadata
     */
    function registerIdentity(
        address subject,
        string memory identityType,
        bytes32 attestationHash,
        string memory metadataURI
    ) external onlyRole(ATTESTOR_ROLE) {
        require(subject != address(0), "Invalid subject");
        require(!identities[subject].isActive, "Identity already registered");
        require(!usedAttestationHashes[attestationHash], "Attestation already used");
        
        identities[subject] = Identity({
            subject: subject,
            identityType: identityType,
            attestationHash: attestationHash,
            timestamp: block.timestamp,
            attestor: msg.sender,
            isActive: true,
            metadataURI: metadataURI
        });
        
        attestations[subject].push(msg.sender);
        usedAttestationHashes[attestationHash] = true;
        totalIdentities++;
        
        emit IdentityRegistered(subject, identityType, msg.sender);
    }
    
    /**
     * @dev Register an AI agent identity
     * @param agent Address of the agent
     * @param modelType Type of AI model
     * @param capabilities JSON string of capabilities
     * @param isAutonomous Whether agent can act autonomously
     */
    function registerAgent(
        address agent,
        string memory modelType,
        string memory capabilities,
        bool isAutonomous
    ) external {
        require(agent != address(0), "Invalid agent address");
        require(agentIdentities[agent].registrationTime == 0, "Agent already registered");
        
        agentIdentities[agent] = AgentIdentity({
            modelType: modelType,
            capabilities: capabilities,
            controller: msg.sender,
            registrationTime: block.timestamp,
            isAutonomous: isAutonomous
        });
        
        // Also register as identity
        if (!identities[agent].isActive) {
            identities[agent] = Identity({
                subject: agent,
                identityType: "ai_agent",
                attestationHash: keccak256(abi.encodePacked(modelType, capabilities)),
                timestamp: block.timestamp,
                attestor: msg.sender,
                isActive: true,
                metadataURI: ""
            });
            totalIdentities++;
        }
        
        totalAgents++;
        _grantRole(AGENT_ROLE, agent);
        
        emit AgentRegistered(agent, modelType, msg.sender);
    }
    
    /**
     * @dev Check if an address has a verified identity
     * @param subject Address to check
     * @return bool Whether the address has an active identity
     */
    function isVerified(address subject) external view returns (bool) {
        return identities[subject].isActive;
    }
    
    /**
     * @dev Check if an address is a registered agent
     * @param agent Address to check
     * @return bool Whether the address is a registered agent
     */
    function isAgent(address agent) external view returns (bool) {
        return agentIdentities[agent].registrationTime > 0;
    }
    
    /**
     * @dev Get identity details
     * @param subject Address of the identity
     * @return Identity struct
     */
    function getIdentity(address subject) external view returns (Identity memory) {
        return identities[subject];
    }
    
    /**
     * @dev Get agent details
     * @param agent Address of the agent
     * @return AgentIdentity struct
     */
    function getAgentIdentity(address agent) external view returns (AgentIdentity memory) {
        return agentIdentities[agent];
    }
    
    /**
     * @dev Revoke an identity
     * @param subject Address of the identity to revoke
     * @param reason Reason for revocation
     */
    function revokeIdentity(
        address subject,
        string memory reason
    ) external onlyRole(ATTESTOR_ROLE) {
        require(identities[subject].isActive, "Identity not active");
        
        identities[subject].isActive = false;
        
        if (hasRole(AGENT_ROLE, subject)) {
            _revokeRole(AGENT_ROLE, subject);
        }
        
        emit IdentityRevoked(subject, reason);
    }
    
    /**
     * @dev Add additional attestation to existing identity
     * @param subject Address of the identity
     */
    function addAttestation(address subject) external onlyRole(ATTESTOR_ROLE) {
        require(identities[subject].isActive, "Identity not active");
        attestations[subject].push(msg.sender);
    }
    
    /**
     * @dev Get all attestors for an identity
     * @param subject Address of the identity
     * @return Array of attestor addresses
     */
    function getAttestors(address subject) external view returns (address[] memory) {
        return attestations[subject];
    }
}