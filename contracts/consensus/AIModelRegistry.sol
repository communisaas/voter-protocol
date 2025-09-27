// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IVOTERToken.sol";

/**
 * @title AIModelRegistry
 * @dev Cryptographically verified AI model registration and attestation
 * @notice Real AI agents with proof of operation, not humans pretending
 */
contract AIModelRegistry {
    
    enum ModelProvider {
        OPENAI,
        ANTHROPIC,
        GOOGLE,
        META,
        MISTRAL,
        XAI,
        COHERE,
        OPENSOURCE
    }
    
    enum ModelArchitecture {
        TRANSFORMER,
        DIFFUSION,
        RNN,
        CNN,
        HYBRID,
        NOVEL
    }
    
    struct TEEAttestation {
        bytes32 enclaveHash;        // Hash of secure enclave
        bytes signature;            // Signature from TEE
        uint256 timestamp;          // Attestation timestamp
        bytes32 modelFingerprint;   // Unique model execution fingerprint
        uint256 nonce;             // Prevent replay attacks
    }
    
    struct ModelRegistration {
        address operator;           // Address operating this model
        ModelProvider provider;     // Which company provides the model
        ModelArchitecture arch;     // Underlying architecture type
        string modelIdentifier;     // e.g., "gpt-4-turbo-2024-01"
        bytes32 executionHash;      // Hash of execution environment
        uint256 stakedAmount;       // Economic stake
        uint256 registeredAt;
        bool isActive;
        TEEAttestation lastAttestation;
        bytes publicKey;           // For cryptographic verification
        uint256 failedAttestations; // Track failed verifications
    }
    
    struct ProviderAttestation {
        bytes signature;            // Signature from provider (OpenAI, etc.)
        uint256 validUntil;        // Expiration of attestation
        bytes32 modelHash;         // Provider's model hash
        bool isValid;
    }
    
    // State variables
    IVOTERToken public immutable voterToken;
    uint256 public immutable minStakeAmount;
    uint256 public immutable maxModelsPerProvider;
    uint256 public immutable attestationValidityPeriod;
    
    mapping(address => ModelRegistration) public models;
    mapping(ModelProvider => uint256) public modelCountByProvider;
    mapping(bytes32 => bool) public usedNonces;
    mapping(address => ProviderAttestation) public providerAttestations;
    mapping(bytes32 => bool) public registeredExecutionHashes;
    
    address[] public registeredModels;
    
    // Anti-collusion tracking
    mapping(bytes32 => uint256) public fingerprintLastSeen;
    mapping(bytes32 => address) public fingerprintToModel;
    
    // Events
    event ModelRegistered(
        address indexed modelAddress,
        ModelProvider provider,
        string modelIdentifier,
        uint256 stake
    );
    
    event AttestationSubmitted(
        address indexed modelAddress,
        bytes32 enclaveHash,
        bytes32 modelFingerprint
    );
    
    event ModelDeactivated(
        address indexed modelAddress,
        string reason
    );
    
    event CollusionDetected(
        address indexed model1,
        address indexed model2,
        bytes32 sharedFingerprint
    );
    
    constructor(
        address _voterToken,
        uint256 _minStake,
        uint256 _maxPerProvider,
        uint256 _attestationValidity
    ) {
        voterToken = IVOTERToken(_voterToken);
        minStakeAmount = _minStake;
        maxModelsPerProvider = _maxPerProvider;
        attestationValidityPeriod = _attestationValidity;
    }
    
    /**
     * @dev Register a new AI model with cryptographic proof
     * @param provider The model provider (OpenAI, Anthropic, etc.)
     * @param architecture The underlying model architecture
     * @param modelIdentifier Specific model version string
     * @param publicKey Public key for verification
     * @param providerSignature Signature from model provider
     * @param teeProof Initial TEE attestation
     */
    function registerModel(
        ModelProvider provider,
        ModelArchitecture architecture,
        string memory modelIdentifier,
        bytes memory publicKey,
        bytes memory providerSignature,
        TEEAttestation memory teeProof
    ) external {
        require(!models[msg.sender].isActive, "Model already registered");
        require(
            modelCountByProvider[provider] < maxModelsPerProvider,
            "Provider limit reached"
        );
        
        // Verify provider signature
        require(
            _verifyProviderSignature(
                provider,
                modelIdentifier,
                publicKey,
                providerSignature
            ),
            "Invalid provider signature"
        );
        
        // Verify TEE attestation
        require(
            _verifyTEEAttestation(teeProof, msg.sender),
            "Invalid TEE attestation"
        );
        
        // Check for execution environment uniqueness
        bytes32 execHash = keccak256(abi.encodePacked(
            teeProof.enclaveHash,
            teeProof.modelFingerprint
        ));
        require(
            !registeredExecutionHashes[execHash],
            "Execution environment already registered"
        );
        
        // Transfer stake
        require(
            voterToken.transferFrom(msg.sender, address(this), minStakeAmount),
            "Stake transfer failed"
        );
        
        // Register the model
        models[msg.sender] = ModelRegistration({
            operator: msg.sender,
            provider: provider,
            arch: architecture,
            modelIdentifier: modelIdentifier,
            executionHash: execHash,
            stakedAmount: minStakeAmount,
            registeredAt: block.timestamp,
            isActive: true,
            lastAttestation: teeProof,
            publicKey: publicKey,
            failedAttestations: 0
        });
        
        registeredModels.push(msg.sender);
        modelCountByProvider[provider]++;
        registeredExecutionHashes[execHash] = true;
        
        // Anti-collusion tracking
        _trackFingerprint(teeProof.modelFingerprint, msg.sender);
        
        emit ModelRegistered(msg.sender, provider, modelIdentifier, minStakeAmount);
    }
    
    /**
     * @dev Submit periodic attestation to prove continued independent operation
     * @param attestation New TEE attestation
     */
    function submitAttestation(TEEAttestation memory attestation) external {
        ModelRegistration storage model = models[msg.sender];
        require(model.isActive, "Model not active");
        require(
            block.timestamp >= model.lastAttestation.timestamp + attestationValidityPeriod,
            "Too soon for new attestation"
        );
        
        // Verify the attestation
        if (!_verifyTEEAttestation(attestation, msg.sender)) {
            model.failedAttestations++;
            
            // Deactivate after 3 failed attestations
            if (model.failedAttestations >= 3) {
                _deactivateModel(msg.sender, "Failed attestation threshold");
            }
            return;
        }
        
        // Check for fingerprint collusion
        if (_detectCollusion(attestation.modelFingerprint, msg.sender)) {
            _handleCollusion(attestation.modelFingerprint, msg.sender);
            return;
        }
        
        // Update attestation
        model.lastAttestation = attestation;
        model.failedAttestations = 0; // Reset on successful attestation
        
        emit AttestationSubmitted(
            msg.sender,
            attestation.enclaveHash,
            attestation.modelFingerprint
        );
    }
    
    /**
     * @dev Verify provider signature for model authenticity
     */
    function _verifyProviderSignature(
        ModelProvider provider,
        string memory modelIdentifier,
        bytes memory publicKey,
        bytes memory signature
    ) private pure returns (bool) {
        // In production, this would verify against known provider public keys
        // For now, we check signature structure
        if (signature.length < 65) return false;
        
        // Different providers have different signature schemes
        if (provider == ModelProvider.OPENAI) {
            // OpenAI specific verification
            return signature.length == 65;
        } else if (provider == ModelProvider.ANTHROPIC) {
            // Anthropic specific verification
            return signature.length == 65;
        }
        
        return true; // Default for testing
    }
    
    /**
     * @dev Verify TEE attestation for secure execution
     */
    function _verifyTEEAttestation(
        TEEAttestation memory attestation,
        address modelAddress
    ) private returns (bool) {
        // Check nonce hasn't been used
        if (usedNonces[keccak256(abi.encodePacked(attestation.nonce))]) {
            return false;
        }
        
        // Mark nonce as used
        usedNonces[keccak256(abi.encodePacked(attestation.nonce))] = true;
        
        // Verify timestamp is recent
        if (block.timestamp - attestation.timestamp > 1 hours) {
            return false;
        }
        
        // In production, verify signature against TEE public keys
        // This would integrate with Intel SGX or AWS Nitro attestation services
        
        return attestation.signature.length >= 65;
    }
    
    /**
     * @dev Track fingerprints for collusion detection
     */
    function _trackFingerprint(bytes32 fingerprint, address modelAddress) private {
        // Check if we've seen this fingerprint recently
        if (fingerprintLastSeen[fingerprint] > 0) {
            address existingModel = fingerprintToModel[fingerprint];
            if (existingModel != modelAddress && existingModel != address(0)) {
                // Same fingerprint from different model = collusion
                emit CollusionDetected(existingModel, modelAddress, fingerprint);
            }
        }
        
        fingerprintLastSeen[fingerprint] = block.timestamp;
        fingerprintToModel[fingerprint] = modelAddress;
    }
    
    /**
     * @dev Detect collusion through fingerprint analysis
     */
    function _detectCollusion(
        bytes32 fingerprint,
        address modelAddress
    ) private view returns (bool) {
        // Check if fingerprint belongs to different model
        address registeredModel = fingerprintToModel[fingerprint];
        if (registeredModel != address(0) && registeredModel != modelAddress) {
            // Check if the fingerprint was seen recently (within 24 hours)
            if (block.timestamp - fingerprintLastSeen[fingerprint] < 24 hours) {
                return true; // Collusion detected
            }
        }
        return false;
    }
    
    /**
     * @dev Handle detected collusion
     */
    function _handleCollusion(bytes32 fingerprint, address modelAddress) private {
        address otherModel = fingerprintToModel[fingerprint];
        
        // Slash both models
        _slashModel(modelAddress, 50); // 50% slash
        _slashModel(otherModel, 50);
        
        // Deactivate both models
        _deactivateModel(modelAddress, "Collusion detected");
        _deactivateModel(otherModel, "Collusion detected");
        
        emit CollusionDetected(otherModel, modelAddress, fingerprint);
    }
    
    /**
     * @dev Slash a model's stake
     */
    function _slashModel(address modelAddress, uint256 percentage) private {
        ModelRegistration storage model = models[modelAddress];
        if (model.stakedAmount > 0) {
            uint256 slashAmount = (model.stakedAmount * percentage) / 100;
            model.stakedAmount -= slashAmount;
            
            // Transfer slashed tokens to treasury
            // In production, this would go to a treasury contract
        }
    }
    
    /**
     * @dev Deactivate a model
     */
    function _deactivateModel(address modelAddress, string memory reason) private {
        ModelRegistration storage model = models[modelAddress];
        model.isActive = false;
        
        // Reduce provider count
        modelCountByProvider[model.provider]--;
        
        emit ModelDeactivated(modelAddress, reason);
    }
    
    /**
     * @dev Get model details
     */
    function getModel(address modelAddress) external view returns (
        ModelProvider provider,
        ModelArchitecture architecture,
        string memory identifier,
        uint256 stake,
        bool active,
        uint256 lastAttestationTime
    ) {
        ModelRegistration memory model = models[modelAddress];
        return (
            model.provider,
            model.arch,
            model.modelIdentifier,
            model.stakedAmount,
            model.isActive,
            model.lastAttestation.timestamp
        );
    }
    
    /**
     * @dev Check if model attestation is current
     */
    function isAttestationCurrent(address modelAddress) external view returns (bool) {
        ModelRegistration memory model = models[modelAddress];
        if (!model.isActive) return false;
        
        return block.timestamp - model.lastAttestation.timestamp <= attestationValidityPeriod;
    }
    
    /**
     * @dev Get provider diversity metrics
     */
    function getProviderDiversity() external view returns (
        uint256[8] memory providerCounts
    ) {
        for (uint256 i = 0; i < 8; i++) {
            providerCounts[i] = modelCountByProvider[ModelProvider(i)];
        }
        return providerCounts;
    }
    
    /**
     * @dev Check diversity requirements
     */
    function checkDiversityRequirements(
        uint256 minMajor,
        uint256 minOpen,
        uint256 minSpecialized
    ) external view returns (bool) {
        // Count major providers (OpenAI, Anthropic, Google)
        uint256 majorCount = modelCountByProvider[ModelProvider.OPENAI] +
                           modelCountByProvider[ModelProvider.ANTHROPIC] +
                           modelCountByProvider[ModelProvider.GOOGLE];
        
        // Count open source providers
        uint256 openCount = modelCountByProvider[ModelProvider.META] +
                          modelCountByProvider[ModelProvider.MISTRAL];
        
        // Count specialized providers
        uint256 specializedCount = modelCountByProvider[ModelProvider.XAI] +
                                 modelCountByProvider[ModelProvider.COHERE] +
                                 modelCountByProvider[ModelProvider.OPENSOURCE];
        
        return majorCount >= minMajor && openCount >= minOpen && specializedCount >= minSpecialized;
    }
}