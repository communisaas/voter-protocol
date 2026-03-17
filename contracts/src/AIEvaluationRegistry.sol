// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./TimelockGovernance.sol";
import "./IAIEvaluationRegistry.sol";

/// @title AIEvaluationRegistry
/// @notice Registry of AI model signers for debate market resolution
/// @dev Manages the panel of AI evaluation models that score debate arguments.
///      Each model has an associated signer address (ECDSA key) and a provider slot
///      for diversity enforcement. The registry enforces:
///      - Minimum 3 active models
///      - Minimum 3 distinct providers (anti-collusion)
///      - AI weight α capped at 70% (community always has ≥30% voice)
///
/// PROVIDER SLOTS:
///   0 = OpenAI, 1 = Google, 2 = DeepSeek, 3 = Mistral, 4 = Anthropic
///   5-255 = reserved for future providers
///
/// QUORUM:
///   M = ceil(2N/3) where N = modelCount
///   3 models → 2, 4 → 3, 5 → 4, 6 → 4, 7 → 5
///
/// SC-1 FIX: Two-phase model registration/removal with MODEL_TIMELOCK.
///   Without timelock, compromised governance can instantly swap the entire panel
///   and resolve debates with rigged scores in a single block.
///
/// SM-7 FIX: _providerCount state variable (O(1) lookup instead of 256-slot iteration).
contract AIEvaluationRegistry is IAIEvaluationRegistry, TimelockGovernance {

	// ============================================================================
	// Types
	// ============================================================================

	struct ModelInfo {
		uint8 providerSlot;
		bool active;
	}

	/// @notice Pending model registration
	struct PendingRegistration {
		uint8 providerSlot;
		uint256 executeTime;
	}

	// ============================================================================
	// State
	// ============================================================================

	/// @notice Model signer → info
	mapping(address => ModelInfo) public models;

	/// @notice Enumerable list of registered model signers
	address[] public modelList;

	/// @notice Count of active models
	uint256 private _modelCount;

	/// @notice Count of active distinct providers (SM-7: O(1) state variable)
	uint256 private _providerCount;

	/// @notice Count of active models per provider slot
	mapping(uint8 => uint256) public providerModelCount;

	/// @notice Pending model registration operations
	mapping(address => PendingRegistration) public pendingRegistrations;

	/// @notice Pending model removal operations
	mapping(address => uint256) public pendingRemovals;

	/// @notice Minimum distinct providers for the panel to be operational
	uint256 public minProviders = 3;

	/// @notice AI weight α in basis points (0-10000). Default 40%.
	uint256 public aiWeight = 4000;

	/// @notice Maximum AI weight (governance cannot exceed this)
	uint256 public constant MAX_AI_WEIGHT = 7000;

	/// @notice Basis points denominator
	uint256 public constant BASIS_POINTS = 10000;

	/// @notice Timelock for model registration/removal operations
	/// @dev SC-1: Prevents one-block panel swap attack
	uint256 public immutable MODEL_TIMELOCK;

	// ============================================================================
	// Events
	// ============================================================================

	event ModelRegistered(address indexed signer, uint8 providerSlot);
	event ModelRemoved(address indexed signer);
	event ModelRegistrationInitiated(address indexed signer, uint8 providerSlot, uint256 executeTime);
	event ModelRemovalInitiated(address indexed signer, uint256 executeTime);
	event ModelOperationCancelled(address indexed signer);
	event AIWeightUpdated(uint256 oldWeight, uint256 newWeight);
	event MinProvidersUpdated(uint256 oldMin, uint256 newMin);

	// ============================================================================
	// Errors
	// ============================================================================

	error ModelAlreadyRegistered();
	error ModelNotRegistered();
	error WeightExceedsMax();
	error BelowMinProviders();
	error BelowMinModels();
	error InvalidProviderSlot();
	error OperationNotPending();
	error OperationAlreadyPending();

	// ============================================================================
	// Constructor
	// ============================================================================

	/// @param _governance Governance address
	/// @param _governanceTimelock Timelock for governance operations (minimum 10 minutes)
	/// @param _modelTimelock Timelock for model registration/removal (minimum 10 minutes)
	constructor(
		address _governance,
		uint256 _governanceTimelock,
		uint256 _modelTimelock
	) TimelockGovernance(_governanceTimelock) {
		if (_modelTimelock < MIN_GOVERNANCE_TIMELOCK) revert TimelockTooShort();
		_initializeGovernance(_governance);
		MODEL_TIMELOCK = _modelTimelock;
	}

	// ============================================================================
	// SC-1: Two-Phase Model Registration
	// ============================================================================

	/// @notice Initiate model registration (starts MODEL_TIMELOCK)
	/// @param signer ECDSA address that signs AI evaluation attestations
	/// @param providerSlot Provider identifier (0-255)
	function initiateModelRegistration(address signer, uint8 providerSlot) external onlyGovernance {
		if (signer == address(0)) revert ZeroAddress();
		if (models[signer].active) revert ModelAlreadyRegistered();
		if (pendingRegistrations[signer].executeTime != 0) revert OperationAlreadyPending();

		uint256 executeTime = block.timestamp + MODEL_TIMELOCK;
		pendingRegistrations[signer] = PendingRegistration({
			providerSlot: providerSlot,
			executeTime: executeTime
		});

		emit ModelRegistrationInitiated(signer, providerSlot, executeTime);
	}

	/// @notice Execute pending model registration (after MODEL_TIMELOCK)
	/// @param signer Address to register
	function executeModelRegistration(address signer) external {
		PendingRegistration memory pending = pendingRegistrations[signer];
		if (pending.executeTime == 0) revert OperationNotPending();
		if (block.timestamp < pending.executeTime) revert TimelockNotExpired();

		uint8 providerSlot = pending.providerSlot;

		// Check if signer was previously registered (re-registration case)
		bool alreadyInList = false;
		for (uint256 i = 0; i < modelList.length; i++) {
			if (modelList[i] == signer) {
				alreadyInList = true;
				break;
			}
		}

		models[signer] = ModelInfo({
			providerSlot: providerSlot,
			active: true
		});
		if (!alreadyInList) {
			modelList.push(signer);
		}
		_modelCount++;

		// SM-7: Update provider count state variable
		if (providerModelCount[providerSlot] == 0) {
			_providerCount++;
		}
		providerModelCount[providerSlot]++;

		delete pendingRegistrations[signer];

		emit ModelRegistered(signer, providerSlot);
	}

	/// @notice Cancel pending model registration
	/// @param signer Address to cancel registration for
	function cancelModelRegistration(address signer) external onlyGovernance {
		if (pendingRegistrations[signer].executeTime == 0) revert OperationNotPending();
		delete pendingRegistrations[signer];
		emit ModelOperationCancelled(signer);
	}

	// ============================================================================
	// SC-1: Two-Phase Model Removal
	// ============================================================================

	/// @notice Initiate model removal (starts MODEL_TIMELOCK)
	/// @param signer Address to remove
	function initiateModelRemoval(address signer) external onlyGovernance {
		ModelInfo storage info = models[signer];
		if (!info.active) revert ModelNotRegistered();
		if (pendingRemovals[signer] != 0) revert OperationAlreadyPending();

		// Pre-check minimums (re-validated at execute time)
		uint256 newCount = _modelCount - 1;
		if (newCount < 3) revert BelowMinModels();

		uint8 slot = info.providerSlot;
		uint256 slotCountAfter = providerModelCount[slot] - 1;
		if (slotCountAfter == 0) {
			if (_providerCount - 1 < minProviders) revert BelowMinProviders();
		}

		uint256 executeTime = block.timestamp + MODEL_TIMELOCK;
		pendingRemovals[signer] = executeTime;

		emit ModelRemovalInitiated(signer, executeTime);
	}

	/// @notice Execute pending model removal (after MODEL_TIMELOCK)
	/// @param signer Address to remove
	function executeModelRemoval(address signer) external {
		uint256 executeTime = pendingRemovals[signer];
		if (executeTime == 0) revert OperationNotPending();
		if (block.timestamp < executeTime) revert TimelockNotExpired();

		ModelInfo storage info = models[signer];
		if (!info.active) revert ModelNotRegistered();

		// Re-validate minimums at execution time
		uint256 newCount = _modelCount - 1;
		if (newCount < 3) revert BelowMinModels();

		uint8 slot = info.providerSlot;
		uint256 slotCountAfter = providerModelCount[slot] - 1;
		if (slotCountAfter == 0) {
			if (_providerCount - 1 < minProviders) revert BelowMinProviders();
		}

		info.active = false;
		_modelCount--;

		// SM-7: Update provider count state variable
		providerModelCount[slot]--;
		if (providerModelCount[slot] == 0) {
			_providerCount--;
		}

		delete pendingRemovals[signer];

		emit ModelRemoved(signer);
	}

	/// @notice Cancel pending model removal
	/// @param signer Address to cancel removal for
	function cancelModelRemoval(address signer) external onlyGovernance {
		if (pendingRemovals[signer] == 0) revert OperationNotPending();
		delete pendingRemovals[signer];
		emit ModelOperationCancelled(signer);
	}

	// ============================================================================
	// Governance Functions
	// ============================================================================

	/// @notice Update the AI weight α
	/// @param newWeight New weight in basis points (0-MAX_AI_WEIGHT)
	function setAIWeight(uint256 newWeight) external onlyGovernance {
		if (newWeight > MAX_AI_WEIGHT) revert WeightExceedsMax();
		uint256 old = aiWeight;
		aiWeight = newWeight;
		emit AIWeightUpdated(old, newWeight);
	}

	/// @notice Update minimum provider count
	/// @param newMin New minimum (must be achievable with current panel)
	function setMinProviders(uint256 newMin) external onlyGovernance {
		if (newMin > 0 && _providerCount < newMin) revert BelowMinProviders();
		uint256 old = minProviders;
		minProviders = newMin;
		emit MinProvidersUpdated(old, newMin);
	}

	// ============================================================================
	// View Functions
	// ============================================================================

	/// @inheritdoc IAIEvaluationRegistry
	function isRegistered(address signer) external view returns (bool) {
		return models[signer].active;
	}

	/// @inheritdoc IAIEvaluationRegistry
	function modelCount() external view returns (uint256) {
		return _modelCount;
	}

	/// @inheritdoc IAIEvaluationRegistry
	function quorum() external view returns (uint256) {
		return _quorum(_modelCount);
	}

	/// @inheritdoc IAIEvaluationRegistry
	/// @dev SM-7: Returns O(1) state variable instead of iterating 256 slots
	function providerCount() public view returns (uint256) {
		return _providerCount;
	}

	/// @notice Get all active model signers
	/// @return signers Array of active signer addresses
	function getActiveModels() external view returns (address[] memory signers) {
		signers = new address[](_modelCount);
		uint256 idx;
		for (uint256 i = 0; i < modelList.length; i++) {
			if (models[modelList[i]].active) {
				signers[idx++] = modelList[i];
			}
		}
	}

	// ============================================================================
	// Internal
	// ============================================================================

	/// @dev ceil(2n/3)
	function _quorum(uint256 n) internal pure returns (uint256) {
		return (2 * n + 2) / 3;
	}
}
