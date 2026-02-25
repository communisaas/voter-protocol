// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

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
contract AIEvaluationRegistry is IAIEvaluationRegistry, TimelockGovernance {

	// ============================================================================
	// Types
	// ============================================================================

	struct ModelInfo {
		uint8 providerSlot;
		bool active;
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

	/// @notice Count of active models per provider slot
	mapping(uint8 => uint256) public providerModelCount;

	/// @notice Minimum distinct providers for the panel to be operational
	uint256 public minProviders = 3;

	/// @notice AI weight α in basis points (0-10000). Default 40%.
	uint256 public aiWeight = 4000;

	/// @notice Maximum AI weight (governance cannot exceed this)
	uint256 public constant MAX_AI_WEIGHT = 7000;

	/// @notice Basis points denominator
	uint256 public constant BASIS_POINTS = 10000;

	// ============================================================================
	// Events
	// ============================================================================

	event ModelRegistered(address indexed signer, uint8 providerSlot);
	event ModelRemoved(address indexed signer);
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

	// ============================================================================
	// Constructor
	// ============================================================================

	/// @param _governance Governance address
	constructor(address _governance) {
		_initializeGovernance(_governance);
	}

	// ============================================================================
	// Governance Functions
	// ============================================================================

	/// @notice Register a new model signer
	/// @param signer ECDSA address that signs AI evaluation attestations
	/// @param providerSlot Provider identifier (0-255)
	function registerModel(address signer, uint8 providerSlot) external onlyGovernance {
		if (signer == address(0)) revert ZeroAddress();
		if (models[signer].active) revert ModelAlreadyRegistered();

		models[signer] = ModelInfo({
			providerSlot: providerSlot,
			active: true
		});
		modelList.push(signer);
		_modelCount++;
		providerModelCount[providerSlot]++;

		emit ModelRegistered(signer, providerSlot);
	}

	/// @notice Remove a model signer
	/// @param signer Address to remove
	function removeModel(address signer) external onlyGovernance {
		ModelInfo storage info = models[signer];
		if (!info.active) revert ModelNotRegistered();

		// Check that removal won't breach minimums
		uint256 newCount = _modelCount - 1;
		if (newCount < 3) revert BelowMinModels();

		// Check provider diversity after removal
		uint8 slot = info.providerSlot;
		uint256 slotCountAfter = providerModelCount[slot] - 1;
		if (slotCountAfter == 0) {
			// This provider would be removed entirely — check diversity
			uint256 currentProviders = providerCount();
			if (currentProviders - 1 < minProviders) revert BelowMinProviders();
		}

		info.active = false;
		_modelCount--;
		providerModelCount[slot]--;

		emit ModelRemoved(signer);
	}

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
		if (newMin > 0 && providerCount() < newMin) revert BelowMinProviders();
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
	function providerCount() public view returns (uint256) {
		uint256 count;
		// Check slots 0-255. In practice only 0-10 will ever be used.
		// Gas: ~5,000 for 256 iterations of cold SLOAD is fine for a view function.
		for (uint256 i = 0; i < 256; i++) {
			if (providerModelCount[uint8(i)] > 0) {
				count++;
			}
		}
		return count;
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
