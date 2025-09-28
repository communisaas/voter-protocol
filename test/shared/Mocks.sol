// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../../contracts/interfaces/IActionVerifier.sol";
import "../../contracts/interfaces/IAgentConsensus.sol";
import "../../contracts/interfaces/IDiditVerifier.sol";

/**
 * @title Mocks
 * @dev Consolidated mock contracts for testing VOTER Protocol
 * @notice Provides configurable behavior for comprehensive testing
 */

// ============================================================================
// CHAINLINK PRICE FEED MOCKS
// ============================================================================

/**
 * @dev Mock Chainlink price aggregator for testing oracle functionality
 */
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimals_;
    bool public shouldRevert;
    
    // Call tracking
    uint256 public latestRoundDataCallCount;
    
    constructor(int256 _answer, uint8 _decimals) {
        answer = _answer;
        decimals_ = _decimals;
        updatedAt = block.timestamp;
        shouldRevert = false;
    }
    
    function decimals() external view returns (uint8) {
        return decimals_;
    }
    
    function latestRoundData() external returns (
        uint80 roundId,
        int256 _answer,
        uint256 startedAt,
        uint256 _updatedAt,
        uint80 answeredInRound
    ) {
        latestRoundDataCallCount++;
        
        if (shouldRevert) {
            revert("Mock aggregator: forced revert");
        }
        
        return (1, answer, block.timestamp, updatedAt, 1);
    }
    
    function setAnswer(int256 _answer) external {
        answer = _answer;
        updatedAt = block.timestamp;
    }
    
    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }
    
    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }
}

// ============================================================================
// ACTION VERIFICATION MOCKS
// ============================================================================

/**
 * @dev Mock action verifier with configurable behavior
 */
contract MockActionVerifier is IActionVerifier {
    mapping(bytes32 => bool) public verified;
    mapping(bytes32 => bool) public isSet; // Track if value was explicitly set
    mapping(bytes32 => bool) public shouldFailVerification;
    
    // Call tracking
    uint256 public isVerifiedActionCallCount;
    mapping(bytes32 => uint256) public actionCallCounts;
    
    // Default behavior
    bool public defaultVerificationResult = true;
    
    function isVerifiedAction(bytes32 actionHash) external view override returns (bool) {
        if (shouldFailVerification[actionHash]) {
            return false;
        }
        
        // If explicitly set, return that value
        if (isSet[actionHash]) {
            return verified[actionHash];
        }
        
        return defaultVerificationResult;
    }
    
    // Non-view version for call tracking in tests
    function isVerifiedActionWithTracking(bytes32 actionHash) external returns (bool) {
        isVerifiedActionCallCount++;
        actionCallCounts[actionHash]++;
        return this.isVerifiedAction(actionHash);
    }
    
    // Configuration functions
    function setVerified(bytes32 actionHash, bool status) external {
        verified[actionHash] = status;
        isSet[actionHash] = true;
    }
    
    function setShouldFailVerification(bytes32 actionHash, bool shouldFail) external {
        shouldFailVerification[actionHash] = shouldFail;
    }
    
    function setDefaultVerificationResult(bool defaultResult) external {
        defaultVerificationResult = defaultResult;
    }
    
    // Call count getters
    function getActionCallCount(bytes32 actionHash) external view returns (uint256) {
        return actionCallCounts[actionHash];
    }
}

// ============================================================================
// IDENTITY VERIFICATION MOCKS
// ============================================================================

/**
 * @dev Mock Didit verifier with comprehensive testing capabilities
 */
contract MockDiditVerifier is IDiditVerifier {
    mapping(address => Attestation) private attestations;
    mapping(bytes32 => bool) private revokedCredentials;
    mapping(bytes32 => bool) private validCredentials;
    mapping(bytes32 => bool) private credentialSet; // Track if credential was explicitly set
    
    // Configuration
    bool public defaultCredentialValidity = true;
    bool public defaultRevocationStatus = false;
    uint256 public defaultKycLevel = 1;
    
    // Call tracking
    uint256 public verifyCredentialCallCount;
    uint256 public checkRevocationCallCount;
    uint256 public getAttestationCallCount;
    uint256 public verifyZKProofCallCount;
    uint256 public getVerificationCostCallCount;
    
    function verifyCredential(bytes32 credentialHash, bytes calldata) 
        external 
        view
        override 
        returns (bool) 
    {
        if (credentialSet[credentialHash]) {
            return validCredentials[credentialHash];
        }
        
        return defaultCredentialValidity;
    }
    
    // Non-view version for call tracking in tests
    function verifyCredentialWithTracking(bytes32 credentialHash, bytes calldata data) 
        external 
        returns (bool) 
    {
        verifyCredentialCallCount++;
        return this.verifyCredential(credentialHash, data);
    }
    
    function checkRevocation(bytes32 credentialId) external view override returns (bool) {
        if (revokedCredentials[credentialId]) {
            return true;
        }
        
        return defaultRevocationStatus;
    }
    
    // Non-view version for call tracking in tests
    function checkRevocationWithTracking(bytes32 credentialId) external returns (bool) {
        checkRevocationCallCount++;
        return this.checkRevocation(credentialId);
    }
    
    function getAttestation(address user) external view override returns (Attestation memory) {
        if (attestations[user].credentialId == bytes32(0)) {
            return Attestation({
                isVerified: true,
                kycLevel: uint8(defaultKycLevel),
                districtHash: keccak256(abi.encodePacked("district_", user)),
                verifiedAt: block.timestamp,
                credentialId: keccak256(abi.encodePacked(user, "credential"))
            });
        }
        
        return attestations[user];
    }
    
    // Non-view version for call tracking in tests
    function getAttestationWithTracking(address user) external returns (Attestation memory) {
        getAttestationCallCount++;
        return this.getAttestation(user);
    }
    
    function verifyZKProof(bytes calldata, uint256[] calldata) 
        external 
        view
        override 
        returns (bool) 
    {
        return defaultCredentialValidity;
    }
    
    // Non-view version for call tracking in tests
    function verifyZKProofWithTracking(bytes calldata proof, uint256[] calldata publicInputs) 
        external 
        returns (bool) 
    {
        verifyZKProofCallCount++;
        return this.verifyZKProof(proof, publicInputs);
    }
    
    function getVerificationCost(uint8 kycLevel) external pure override returns (uint256) {
        if (kycLevel == 1) return 0; // Basic KYC is free
        if (kycLevel == 2) return 35; // AML screening $0.35
        if (kycLevel == 3) return 50; // Proof of address $0.50
        return 0;
    }
    
    // Non-view version for call tracking in tests
    function getVerificationCostWithTracking(uint8 kycLevel) external returns (uint256) {
        getVerificationCostCallCount++;
        return this.getVerificationCost(kycLevel);
    }
    
    // Configuration functions
    function setAttestation(address user, Attestation memory attestation) external {
        attestations[user] = attestation;
    }
    
    function setCredentialValidity(bytes32 credentialHash, bool isValid) external {
        validCredentials[credentialHash] = isValid;
        credentialSet[credentialHash] = true;
    }
    
    function setCredentialRevoked(bytes32 credentialId, bool isRevoked) external {
        revokedCredentials[credentialId] = isRevoked;
    }
    
    function setDefaultCredentialValidity(bool defaultValidity) external {
        defaultCredentialValidity = defaultValidity;
    }
    
    function setDefaultRevocationStatus(bool defaultRevoked) external {
        defaultRevocationStatus = defaultRevoked;
    }
    
    function setDefaultKycLevel(uint256 kycLevel) external {
        defaultKycLevel = kycLevel;
    }
}

// ============================================================================
// AGENT CONSENSUS MOCKS
// ============================================================================

/**
 * @dev Mock agent consensus with configurable decisions
 */
contract MockAgentConsensus is IAgentConsensus {
    mapping(bytes32 => bool) public verifiedActions;
    mapping(bytes32 => bool) public shouldFailConsensus;
    
    // Call tracking
    uint256 public isVerifiedCallCount;
    mapping(bytes32 => uint256) public actionConsensusCallCounts;
    
    // Default behavior
    bool public defaultConsensusResult = true;
    
    function isVerified(bytes32 actionHash) external view override returns (bool) {
        if (shouldFailConsensus[actionHash]) {
            return false;
        }
        
        if (verifiedActions[actionHash]) {
            return verifiedActions[actionHash];
        }
        
        return defaultConsensusResult;
    }
    
    // Non-view version for call tracking in tests
    function isVerifiedWithTracking(bytes32 actionHash) external returns (bool) {
        isVerifiedCallCount++;
        actionConsensusCallCounts[actionHash]++;
        return this.isVerified(actionHash);
    }
    
    // Configuration functions
    function setVerified(bytes32 actionHash, bool verified) external {
        verifiedActions[actionHash] = verified;
    }
    
    function setShouldFailConsensus(bytes32 actionHash, bool shouldFail) external {
        shouldFailConsensus[actionHash] = shouldFail;
    }
    
    function setDefaultConsensusResult(bool defaultResult) external {
        defaultConsensusResult = defaultResult;
    }
    
    // Call count getters
    function getActionConsensusCallCount(bytes32 actionHash) external view returns (uint256) {
        return actionConsensusCallCounts[actionHash];
    }
}

// ============================================================================
// PHASE 3 MOCKS - NEW CONSENSUS INFRASTRUCTURE
// ============================================================================

/**
 * @dev Mock consensus engine for testing multi-stage consensus processes
 */
contract MockConsensusEngine {
    enum Stage {
        PROPOSAL,
        RESEARCH,
        COMMITMENT,
        REVEAL,
        EXECUTION,
        COMPLETED,
        FAILED
    }
    
    struct MockConsensus {
        bytes32 proposalHash;
        Stage currentStage;
        uint256 stageDeadline;
        bool executed;
        bool shouldFail;
    }
    
    mapping(bytes32 => MockConsensus) public consensuses;
    mapping(bytes32 => bool) public shouldFailExecution;
    
    // Call tracking
    uint256 public createProposalCallCount;
    uint256 public executeCallCount;
    uint256 public getStageCallCount;
    
    // Default behavior
    Stage public defaultStage = Stage.PROPOSAL;
    uint256 public defaultDeadline = 1 hours;
    
    function createProposal(
        bytes32 proposalHash,
        string calldata description,
        bytes calldata payload,
        address targetContract
    ) external returns (bool) {
        createProposalCallCount++;
        
        consensuses[proposalHash] = MockConsensus({
            proposalHash: proposalHash,
            currentStage: defaultStage,
            stageDeadline: block.timestamp + defaultDeadline,
            executed: false,
            shouldFail: shouldFailExecution[proposalHash]
        });
        
        return true;
    }
    
    function executeConsensus(bytes32 proposalHash) external returns (bool) {
        executeCallCount++;
        
        MockConsensus storage consensus = consensuses[proposalHash];
        
        if (consensus.shouldFail || shouldFailExecution[proposalHash]) {
            consensus.currentStage = Stage.FAILED;
            return false;
        }
        
        consensus.executed = true;
        consensus.currentStage = Stage.COMPLETED;
        return true;
    }
    
    function getCurrentStage(bytes32 proposalHash) external returns (Stage) {
        getStageCallCount++;
        
        if (consensuses[proposalHash].proposalHash == bytes32(0)) {
            return defaultStage;
        }
        
        return consensuses[proposalHash].currentStage;
    }
    
    function isExecuted(bytes32 proposalHash) external view returns (bool) {
        return consensuses[proposalHash].executed;
    }
    
    // Configuration functions
    function setConsensusStage(bytes32 proposalHash, Stage stage) external {
        consensuses[proposalHash].currentStage = stage;
    }
    
    function setShouldFailExecution(bytes32 proposalHash, bool shouldFail) external {
        shouldFailExecution[proposalHash] = shouldFail;
        consensuses[proposalHash].shouldFail = shouldFail;
    }
    
    function setDefaultStage(Stage stage) external {
        defaultStage = stage;
    }
    
    function setDefaultDeadline(uint256 deadline) external {
        defaultDeadline = deadline;
    }
}

/**
 * @dev Mock AI model registry for testing model registration and attestation
 */
contract MockModelRegistry {
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
    
    struct MockModel {
        address modelAddress;
        ModelProvider provider;
        string modelId;
        bool isRegistered;
        bool isActive;
        uint256 registeredAt;
    }
    
    mapping(address => MockModel) public registeredModels;
    mapping(string => address) public modelIdToAddress;
    mapping(address => bool) public shouldFailRegistration;
    
    // Call tracking
    uint256 public registerModelCallCount;
    uint256 public isRegisteredCallCount;
    uint256 public isActiveCallCount;
    
    // Default behavior
    bool public defaultRegistrationResult = true;
    bool public defaultActiveStatus = true;
    
    function registerModel(
        address modelAddress,
        ModelProvider provider,
        string calldata modelId,
        bytes calldata attestation
    ) external returns (bool) {
        registerModelCallCount++;
        
        if (shouldFailRegistration[modelAddress]) {
            return false;
        }
        
        registeredModels[modelAddress] = MockModel({
            modelAddress: modelAddress,
            provider: provider,
            modelId: modelId,
            isRegistered: defaultRegistrationResult,
            isActive: defaultActiveStatus,
            registeredAt: block.timestamp
        });
        
        modelIdToAddress[modelId] = modelAddress;
        
        return defaultRegistrationResult;
    }
    
    function isRegistered(address modelAddress) external returns (bool) {
        isRegisteredCallCount++;
        
        if (registeredModels[modelAddress].modelAddress == address(0)) {
            return defaultRegistrationResult;
        }
        
        return registeredModels[modelAddress].isRegistered;
    }
    
    function isActive(address modelAddress) external returns (bool) {
        isActiveCallCount++;
        
        if (registeredModels[modelAddress].modelAddress == address(0)) {
            return defaultActiveStatus;
        }
        
        return registeredModels[modelAddress].isActive;
    }
    
    function getModel(address modelAddress) external view returns (MockModel memory) {
        return registeredModels[modelAddress];
    }
    
    // Configuration functions
    function setModelStatus(address modelAddress, bool _isRegistered, bool _isActive) external {
        registeredModels[modelAddress].isRegistered = _isRegistered;
        registeredModels[modelAddress].isActive = _isActive;
    }
    
    function setShouldFailRegistration(address modelAddress, bool shouldFail) external {
        shouldFailRegistration[modelAddress] = shouldFail;
    }
    
    function setDefaultRegistrationResult(bool defaultResult) external {
        defaultRegistrationResult = defaultResult;
    }
    
    function setDefaultActiveStatus(bool defaultStatus) external {
        defaultActiveStatus = defaultStatus;
    }
}

/**
 * @dev Mock performance tracker for testing AI model performance metrics
 */
contract MockPerformanceTracker {
    enum Domain {
        PARAMETER_OPTIMIZATION,
        MARKET_PREDICTION,
        GOVERNANCE_DECISION,
        CHALLENGE_RESOLUTION,
        EMERGENCY_RESPONSE,
        GENERAL
    }
    
    struct MockPerformanceMetrics {
        uint256 correctPredictions;
        uint256 totalPredictions;
        uint256 confidenceCalibration;
        uint256 averageConfidence;
        uint256 lastUpdateTimestamp;
        uint256 streakLength;
        bool isPositiveStreak;
    }
    
    mapping(address => mapping(Domain => MockPerformanceMetrics)) public performance;
    mapping(address => uint256) public votingWeights;
    mapping(address => bool) public shouldFailUpdate;
    
    // Call tracking
    uint256 public updatePerformanceCallCount;
    uint256 public getVotingWeightCallCount;
    uint256 public getPerformanceCallCount;
    
    // Default values
    uint256 public defaultVotingWeight = 100;
    uint256 public defaultCorrectPredictions = 80;
    uint256 public defaultTotalPredictions = 100;
    uint256 public defaultConfidenceCalibration = 850; // 85%
    
    function updatePerformance(
        address modelAddress,
        Domain domain,
        bool wasCorrect,
        uint256 confidence
    ) external returns (bool) {
        updatePerformanceCallCount++;
        
        if (shouldFailUpdate[modelAddress]) {
            return false;
        }
        
        MockPerformanceMetrics storage metrics = performance[modelAddress][domain];
        
        if (metrics.lastUpdateTimestamp == 0) {
            // Initialize with defaults
            metrics.correctPredictions = defaultCorrectPredictions;
            metrics.totalPredictions = defaultTotalPredictions;
            metrics.confidenceCalibration = defaultConfidenceCalibration;
            metrics.averageConfidence = confidence;
            metrics.streakLength = 1;
            metrics.isPositiveStreak = wasCorrect;
        } else {
            // Update metrics
            metrics.totalPredictions++;
            if (wasCorrect) {
                metrics.correctPredictions++;
            }
            
            // Update confidence calibration (simplified)
            metrics.averageConfidence = (metrics.averageConfidence + confidence) / 2;
            
            // Update streak
            if ((wasCorrect && metrics.isPositiveStreak) || (!wasCorrect && !metrics.isPositiveStreak)) {
                metrics.streakLength++;
            } else {
                metrics.streakLength = 1;
                metrics.isPositiveStreak = wasCorrect;
            }
        }
        
        metrics.lastUpdateTimestamp = block.timestamp;
        return true;
    }
    
    function getVotingWeight(address modelAddress, Domain domain) external returns (uint256) {
        getVotingWeightCallCount++;
        
        if (votingWeights[modelAddress] > 0) {
            return votingWeights[modelAddress];
        }
        
        return defaultVotingWeight;
    }
    
    function getPerformance(address modelAddress, Domain domain) 
        external 
        returns (MockPerformanceMetrics memory) 
    {
        getPerformanceCallCount++;
        
        if (performance[modelAddress][domain].lastUpdateTimestamp == 0) {
            return MockPerformanceMetrics({
                correctPredictions: defaultCorrectPredictions,
                totalPredictions: defaultTotalPredictions,
                confidenceCalibration: defaultConfidenceCalibration,
                averageConfidence: 500, // 50%
                lastUpdateTimestamp: block.timestamp,
                streakLength: 5,
                isPositiveStreak: true
            });
        }
        
        return performance[modelAddress][domain];
    }
    
    // Configuration functions
    function setVotingWeight(address modelAddress, uint256 weight) external {
        votingWeights[modelAddress] = weight;
    }
    
    function setPerformanceMetrics(
        address modelAddress,
        Domain domain,
        MockPerformanceMetrics memory metrics
    ) external {
        performance[modelAddress][domain] = metrics;
    }
    
    function setShouldFailUpdate(address modelAddress, bool shouldFail) external {
        shouldFailUpdate[modelAddress] = shouldFail;
    }
    
    function setDefaultValues(
        uint256 votingWeight,
        uint256 correctPredictions,
        uint256 totalPredictions,
        uint256 confidenceCalibration
    ) external {
        defaultVotingWeight = votingWeight;
        defaultCorrectPredictions = correctPredictions;
        defaultTotalPredictions = totalPredictions;
        defaultConfidenceCalibration = confidenceCalibration;
    }
}

/**
 * @dev Mock circuit breaker for testing emergency controls
 */
contract MockCircuitBreaker {
    mapping(address => bool) public userBlocked;
    mapping(bytes32 => bool) public actionBlocked;
    mapping(string => bool) public reasonBlocked;
    
    // Call tracking
    uint256 public checkCircuitBreakersCallCount;
    uint256 public triggerCallCount;
    uint256 public resetCallCount;
    
    // Default behavior
    bool public defaultShouldBlock = false;
    string public defaultReason = "No issues detected";
    
    // Thresholds for testing
    uint256 public massiveActionThreshold = 100000 * 10**18;
    uint256 public rapidActionThreshold = 50;
    uint256 public suspiciousBatchSize = 20;
    
    function checkCircuitBreakers(
        address user,
        uint256 amount,
        bytes32 actionHash
    ) external returns (bool blocked, string memory reason) {
        checkCircuitBreakersCallCount++;
        
        // Check user-specific blocks
        if (userBlocked[user]) {
            return (true, "User blocked by circuit breaker");
        }
        
        // Check action-specific blocks
        if (actionBlocked[actionHash]) {
            return (true, "Action blocked by circuit breaker");
        }
        
        // Check amount threshold
        if (amount > massiveActionThreshold) {
            return (true, "Amount exceeds safety threshold");
        }
        
        return (defaultShouldBlock, defaultReason);
    }
    
    function triggerCircuitBreaker(string calldata reason, address user) external returns (bool) {
        triggerCallCount++;
        
        userBlocked[user] = true;
        reasonBlocked[reason] = true;
        
        return true;
    }
    
    function resetCircuitBreaker(address user) external returns (bool) {
        resetCallCount++;
        
        userBlocked[user] = false;
        
        return true;
    }
    
    function isBlocked(address user) external view returns (bool) {
        return userBlocked[user];
    }
    
    // Configuration functions
    function setUserBlocked(address user, bool blocked) external {
        userBlocked[user] = blocked;
    }
    
    function setActionBlocked(bytes32 actionHash, bool blocked) external {
        actionBlocked[actionHash] = blocked;
    }
    
    function setDefaultShouldBlock(bool shouldBlock) external {
        defaultShouldBlock = shouldBlock;
    }
    
    function setDefaultReason(string calldata reason) external {
        defaultReason = reason;
    }
    
    function setThresholds(
        uint256 massiveThreshold,
        uint256 rapidThreshold,
        uint256 batchSize
    ) external {
        massiveActionThreshold = massiveThreshold;
        rapidActionThreshold = rapidThreshold;
        suspiciousBatchSize = batchSize;
    }
}

// ============================================================================
// UTILITY FUNCTIONS FOR TEST SETUP
// ============================================================================

/**
 * @dev Helper contract for setting up multiple mocks with standard configurations
 */
contract MockFactory {
    function deployStandardMocks() external returns (
        MockAggregator chainlinkOracle,
        MockAggregator redstoneOracle,
        MockActionVerifier actionVerifier,
        MockDiditVerifier diditVerifier,
        MockAgentConsensus agentConsensus
    ) {
        // Deploy price oracles with realistic prices
        chainlinkOracle = new MockAggregator(200000000000, 8); // $2000 ETH with 8 decimals
        redstoneOracle = new MockAggregator(200000000000, 8);  // $2000 ETH with 8 decimals
        
        // Deploy verification mocks
        actionVerifier = new MockActionVerifier();
        diditVerifier = new MockDiditVerifier();
        agentConsensus = new MockAgentConsensus();
        
        return (chainlinkOracle, redstoneOracle, actionVerifier, diditVerifier, agentConsensus);
    }
    
    function deployPhase3Mocks() external returns (
        MockConsensusEngine consensusEngine,
        MockModelRegistry modelRegistry,
        MockPerformanceTracker performanceTracker,
        MockCircuitBreaker circuitBreaker
    ) {
        consensusEngine = new MockConsensusEngine();
        modelRegistry = new MockModelRegistry();
        performanceTracker = new MockPerformanceTracker();
        circuitBreaker = new MockCircuitBreaker();
        
        return (consensusEngine, modelRegistry, performanceTracker, circuitBreaker);
    }
}