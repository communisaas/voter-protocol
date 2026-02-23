// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import "openzeppelin/token/ERC20/IERC20.sol";
import "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import "./TimelockGovernance.sol";

/// @title DebateMarket
/// @notice Staked debate protocol for verified-membership communities
/// @dev Composes with DistrictGate (three-tree proof verification), NullifierRegistry
///      (double-stake prevention), and an ERC-20 staking token for financial skin-in-the-game.
///
/// ARCHITECTURE:
/// 1. Proposer opens a debate by posting a proposition hash and staking a bond
/// 2. Verified members submit arguments (SUPPORT/OPPOSE/AMEND) with financial stakes
/// 3. Members co-sign existing arguments, adding their weight
/// 4. After deadline, resolution finds the highest-scoring argument via
///    sqrt(stake) * 2^engagementTier weighted tally
/// 5. Winners claim proportional payout from the losing pool
///
/// PRIVACY:
/// - All participation is anonymous via three-tree ZK proofs
/// - Nullifiers prevent double-staking without revealing identity
/// - Arguments are content-addressed (body stored off-chain)
///
/// ANTI-PLUTOCRACY:
/// - sqrt(stake) dampens financial advantage
/// - Engagement tier multipliers (2^tier) reward sustained participation
/// - A Tier 4 Pillar at $2 outweighs a Tier 1 newcomer at $100
contract DebateMarket is Pausable, ReentrancyGuard, TimelockGovernance {
	using SafeERC20 for IERC20;

	// ============================================================================
	// Types
	// ============================================================================

	enum Stance {
		SUPPORT,
		OPPOSE,
		AMEND
	}

	enum DebateStatus {
		ACTIVE,
		RESOLVED
	}

	struct Debate {
		bytes32 propositionHash;
		bytes32 actionDomain;
		uint256 deadline;
		uint256 argumentCount;
		uint256 uniqueParticipants;
		uint256 jurisdictionSizeHint;
		uint256 totalStake;
		uint256 winningArgumentIndex;
		Stance winningStance;
		bytes32 winningBodyHash;
		bytes32 winningAmendmentHash;
		DebateStatus status;
		address proposer;
		uint256 proposerBond;
		bool bondClaimed;
	}

	struct Argument {
		Stance stance;
		bytes32 bodyHash;
		bytes32 amendmentHash;
		uint256 stakeAmount;
		uint8 engagementTier;
		uint256 weightedScore;
	}

	struct StakeRecord {
		uint256 argumentIndex;
		uint256 stakeAmount;
		uint8 engagementTier;
		bool claimed;
		address submitter;
	}

	// ============================================================================
	// Immutables & Constants
	// ============================================================================

	/// @notice DistrictGate for three-tree proof verification
	IDistrictGate public immutable districtGate;

	/// @notice ERC-20 token used for staking (e.g., USDC on Scroll)
	IERC20 public immutable stakingToken;

	/// @notice Minimum debate duration (72 hours)
	uint256 public constant MIN_DURATION = 72 hours;

	/// @notice Maximum debate duration (30 days)
	uint256 public constant MAX_DURATION = 30 days;

	/// @notice Minimum unique participants for proposer bond return
	uint256 public constant BOND_RETURN_THRESHOLD = 5;

	/// @notice Minimum proposer bond ($1 in 6-decimal stablecoins)
	uint256 public constant MIN_PROPOSER_BOND = 1e6;

	/// @notice Minimum argument/co-sign stake ($1 in 6-decimal stablecoins)
	uint256 public constant MIN_ARGUMENT_STAKE = 1e6;

	/// @notice Maximum arguments per debate (gas DOS prevention on Scroll)
	uint256 public constant MAX_ARGUMENTS = 500;

	/// @notice Emergency withdrawal delay after debate deadline
	uint256 public constant EMERGENCY_WITHDRAW_DELAY = 30 days;

	// ============================================================================
	// State
	// ============================================================================

	/// @notice Debate storage keyed by debateId
	mapping(bytes32 => Debate) public debates;

	/// @notice Arguments per debate: debateId => argumentIndex => Argument
	mapping(bytes32 => mapping(uint256 => Argument)) public arguments;

	/// @notice Stake records per debate per nullifier: debateId => nullifier => StakeRecord
	mapping(bytes32 => mapping(bytes32 => StakeRecord)) public stakeRecords;

	/// @notice Cumulative stake per argument: debateId => argumentIndex => totalStake
	/// @dev Tracked incrementally in submitArgument/coSignArgument for O(1) settlement lookups
	mapping(bytes32 => mapping(uint256 => uint256)) public argumentTotalStakes;

	// ============================================================================
	// Events
	// ============================================================================

	event DebateProposed(
		bytes32 indexed debateId,
		bytes32 indexed actionDomain,
		bytes32 propositionHash,
		uint256 deadline
	);

	event ArgumentSubmitted(
		bytes32 indexed debateId,
		uint256 indexed argumentIndex,
		Stance stance,
		bytes32 bodyHash,
		uint8 engagementTier,
		uint256 weight
	);

	event CoSignSubmitted(
		bytes32 indexed debateId,
		uint256 indexed argumentIndex,
		uint8 engagementTier,
		uint256 weight
	);

	event DebateResolved(
		bytes32 indexed debateId,
		uint256 winningArgumentIndex,
		Stance winningStance,
		uint256 winningScore,
		uint256 uniqueParticipants,
		uint256 jurisdictionSizeHint
	);

	event SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout);

	event ProposerBondReturned(bytes32 indexed debateId, uint256 bondAmount);

	event ProposerBondForfeited(bytes32 indexed debateId, uint256 bondAmount);

	event EmergencyWithdrawn(bytes32 indexed debateId, bytes32 nullifier, uint256 amount);

	event ContractPaused(address indexed caller);
	event ContractUnpaused(address indexed caller);

	// ============================================================================
	// Errors
	// ============================================================================

	error DebateNotFound();
	error DebateNotActive();
	error DebateNotResolved();
	error DebateStillActive();
	error DebateExpired();
	error InvalidDuration();
	error InsufficientBond();
	error InsufficientStake();
	error ArgumentNotFound();
	error AlreadyClaimed();
	error NotWinningSide();
	error NotProposer();
	error InsufficientParticipation();
	error BondAlreadyClaimed();
	error ActionDomainNotAllowed();
	error InvalidEngagementTier();
	error StakeRecordNotFound();
	error ActionDomainMismatch();
	error NoArgumentsSubmitted();
	error UnauthorizedClaimer();
	error DuplicateNullifier();
	error DebateAlreadyExists();
	error TooManyArguments();

	// ============================================================================
	// Constructor
	// ============================================================================

	/// @notice Deploy DebateMarket
	/// @param _districtGate Address of DistrictGate contract
	/// @param _stakingToken Address of ERC-20 staking token
	/// @param _governance Governance address for pause/unpause
	constructor(
		address _districtGate,
		address _stakingToken,
		address _governance
	) {
		if (_districtGate == address(0)) revert ZeroAddress();
		if (_stakingToken == address(0)) revert ZeroAddress();
		// _governance zero-check is inside _initializeGovernance
		_initializeGovernance(_governance);
		districtGate = IDistrictGate(_districtGate);
		stakingToken = IERC20(_stakingToken);
	}

	// ============================================================================
	// Core Functions
	// ============================================================================

	/// @notice Propose a new debate
	/// @param propositionHash Hash of the proposition text (stored off-chain)
	/// @param duration Debate duration in seconds [MIN_DURATION, MAX_DURATION]
	/// @param jurisdictionSizeHint Estimated jurisdiction size for participation depth
	/// @param actionDomain Action domain (must be whitelisted on DistrictGate)
	/// @param bondAmount Proposer bond amount (>= MIN_PROPOSER_BOND)
	/// @return debateId Unique identifier for the debate
	/// @dev NULLIFIER SCOPING: Each debate MUST use a unique action domain. The ZK circuit
	///      derives nullifiers as H2(identityCommitment, actionDomain) — two debates sharing
	///      the same actionDomain would prevent any user from participating in both.
	///      Governance pre-registers action domains via DistrictGate.proposeActionDomain()
	///      (7-day timelock). This is the intended anti-spam gate: debate creation requires
	///      a governance-approved domain, not just a bond.
	function proposeDebate(
		bytes32 propositionHash,
		uint256 duration,
		uint256 jurisdictionSizeHint,
		bytes32 actionDomain,
		uint256 bondAmount
	) external whenNotPaused nonReentrant returns (bytes32 debateId) {
		if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
		if (bondAmount < MIN_PROPOSER_BOND) revert InsufficientBond();
		if (!districtGate.allowedActionDomains(actionDomain)) revert ActionDomainNotAllowed();

		// Generate unique debate ID
		debateId = keccak256(
			abi.encodePacked(propositionHash, actionDomain, block.timestamp, msg.sender)
		);

		if (debates[debateId].deadline != 0) revert DebateAlreadyExists();

		Debate storage debate = debates[debateId];
		debate.propositionHash = propositionHash;
		debate.actionDomain = actionDomain;
		debate.deadline = block.timestamp + duration;
		debate.jurisdictionSizeHint = jurisdictionSizeHint;
		debate.status = DebateStatus.ACTIVE;
		debate.proposer = msg.sender;
		debate.proposerBond = bondAmount;

		// Transfer bond from proposer (after state writes — CEI pattern)
		stakingToken.safeTransferFrom(msg.sender, address(this), bondAmount);

		emit DebateProposed(debateId, actionDomain, propositionHash, debate.deadline);
	}

	/// @notice Submit an argument to a debate
	/// @param debateId Debate to submit argument to
	/// @param stance SUPPORT, OPPOSE, or AMEND
	/// @param bodyHash Hash of argument text (stored off-chain)
	/// @param amendmentHash Hash of proposed amendment (only if stance == AMEND)
	/// @param stakeAmount Financial stake (>= MIN_ARGUMENT_STAKE)
	/// @param signer Address that signed the proof submission
	/// @param proof ZK proof bytes
	/// @param publicInputs 31 public inputs from three-tree circuit
	/// @param verifierDepth Depth for verifier lookup
	/// @param deadline Signature expiration timestamp
	/// @param signature EIP-712 signature from signer
	function submitArgument(
		bytes32 debateId,
		Stance stance,
		bytes32 bodyHash,
		bytes32 amendmentHash,
		uint256 stakeAmount,
		address signer,
		bytes calldata proof,
		uint256[31] calldata publicInputs,
		uint8 verifierDepth,
		uint256 deadline,
		bytes calldata signature
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp >= debate.deadline) revert DebateExpired();
		if (stakeAmount < MIN_ARGUMENT_STAKE) revert InsufficientStake();
		if (debate.argumentCount >= MAX_ARGUMENTS) revert TooManyArguments();

		// Verify three-tree proof (handles nullifier recording, authority check, etc.)
		districtGate.verifyThreeTreeProof(
			signer, proof, publicInputs, verifierDepth, deadline, signature
		);

		if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();

		// Extract engagement tier and nullifier from public inputs
		uint256 engagementTierRaw = publicInputs[30];
		if (engagementTierRaw > 4) revert InvalidEngagementTier();
		uint8 engagementTier = uint8(engagementTierRaw);
		if (tierMultiplier(engagementTier) == 0) revert InvalidEngagementTier();

		bytes32 nullifier = bytes32(publicInputs[26]);

		// Compute weight: sqrt(stakeAmount) * tierMultiplier(engagementTier)
		uint256 weight = sqrt(stakeAmount) * tierMultiplier(engagementTier);

		// Store argument
		uint256 argumentIndex = debate.argumentCount;
		Argument storage arg = arguments[debateId][argumentIndex];
		arg.stance = stance;
		arg.bodyHash = bodyHash;
		arg.amendmentHash = amendmentHash;
		arg.stakeAmount = stakeAmount;
		arg.engagementTier = engagementTier;
		arg.weightedScore = weight;

		// Track cumulative stake per argument for settlement
		argumentTotalStakes[debateId][argumentIndex] = stakeAmount;

		// Store stake record keyed by (debateId, nullifier)
		if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
		stakeRecords[debateId][nullifier] = StakeRecord({
			argumentIndex: argumentIndex,
			stakeAmount: stakeAmount,
			engagementTier: engagementTier,
			claimed: false,
			submitter: msg.sender
		});

		// Update debate counters
		debate.argumentCount++;
		debate.uniqueParticipants++;
		debate.totalStake += stakeAmount;

		// Transfer stake (after state writes — CEI pattern)
		stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

		emit ArgumentSubmitted(debateId, argumentIndex, stance, bodyHash, engagementTier, weight);
	}

	/// @notice Co-sign an existing argument in a debate
	/// @param debateId Debate containing the argument
	/// @param argumentIndex Index of the argument to co-sign
	/// @param stakeAmount Financial stake (>= MIN_ARGUMENT_STAKE)
	/// @param signer Address that signed the proof submission
	/// @param proof ZK proof bytes
	/// @param publicInputs 31 public inputs from three-tree circuit
	/// @param verifierDepth Depth for verifier lookup
	/// @param deadline Signature expiration timestamp
	/// @param signature EIP-712 signature from signer
	function coSignArgument(
		bytes32 debateId,
		uint256 argumentIndex,
		uint256 stakeAmount,
		address signer,
		bytes calldata proof,
		uint256[31] calldata publicInputs,
		uint8 verifierDepth,
		uint256 deadline,
		bytes calldata signature
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp >= debate.deadline) revert DebateExpired();
		if (argumentIndex >= debate.argumentCount) revert ArgumentNotFound();
		if (stakeAmount < MIN_ARGUMENT_STAKE) revert InsufficientStake();

		// Verify three-tree proof
		districtGate.verifyThreeTreeProof(
			signer, proof, publicInputs, verifierDepth, deadline, signature
		);

		if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();

		// Extract engagement tier and nullifier
		uint256 engagementTierRaw = publicInputs[30];
		if (engagementTierRaw > 4) revert InvalidEngagementTier();
		uint8 engagementTier = uint8(engagementTierRaw);
		if (tierMultiplier(engagementTier) == 0) revert InvalidEngagementTier();

		bytes32 nullifier = bytes32(publicInputs[26]);

		// Compute weight and add to argument's score
		uint256 weight = sqrt(stakeAmount) * tierMultiplier(engagementTier);
		arguments[debateId][argumentIndex].weightedScore += weight;

		// Track cumulative stake per argument for settlement
		argumentTotalStakes[debateId][argumentIndex] += stakeAmount;

		// Store stake record
		if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
		stakeRecords[debateId][nullifier] = StakeRecord({
			argumentIndex: argumentIndex,
			stakeAmount: stakeAmount,
			engagementTier: engagementTier,
			claimed: false,
			submitter: msg.sender
		});

		// Update debate counters
		debate.uniqueParticipants++;
		debate.totalStake += stakeAmount;

		// Transfer stake (after state writes — CEI pattern)
		stakingToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

		emit CoSignSubmitted(debateId, argumentIndex, engagementTier, weight);
	}

	/// @notice Resolve a debate after the deadline has passed
	/// @dev Iterates all arguments and finds the highest weighted score.
	///      Ties go to the lower index (first-mover advantage).
	/// @param debateId Debate to resolve
	function resolveDebate(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.deadline) revert DebateStillActive();
		if (debate.argumentCount == 0) revert NoArgumentsSubmitted();

		uint256 bestIndex = 0;
		uint256 bestScore = 0;

		for (uint256 i = 0; i < debate.argumentCount; i++) {
			uint256 score = arguments[debateId][i].weightedScore;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}

		Argument storage winner = arguments[debateId][bestIndex];
		debate.winningArgumentIndex = bestIndex;
		debate.winningStance = winner.stance;
		debate.winningBodyHash = winner.bodyHash;
		debate.winningAmendmentHash = winner.amendmentHash;
		debate.status = DebateStatus.RESOLVED;

		emit DebateResolved(
			debateId,
			bestIndex,
			winner.stance,
			bestScore,
			debate.uniqueParticipants,
			debate.jurisdictionSizeHint
		);
	}

	/// @notice Claim settlement payout for a winning staker
	/// @param debateId Debate to claim from
	/// @param nullifier Staker's nullifier (used as key for stake record)
	function claimSettlement(
		bytes32 debateId,
		bytes32 nullifier
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.RESOLVED) revert DebateNotResolved();

		StakeRecord storage record = stakeRecords[debateId][nullifier];
		if (record.stakeAmount == 0) revert StakeRecordNotFound();
		if (record.claimed) revert AlreadyClaimed();
		if (record.argumentIndex != debate.winningArgumentIndex) revert NotWinningSide();
		if (record.submitter != msg.sender) revert UnauthorizedClaimer();

		record.claimed = true;

		// Calculate payout: stake + proportional share of losing pool
		uint256 winningArgStake = argumentTotalStakes[debateId][debate.winningArgumentIndex];
		uint256 losingPool = debate.totalStake - winningArgStake;
		uint256 payout = record.stakeAmount;
		if (winningArgStake > 0) {
			payout += (losingPool * record.stakeAmount) / winningArgStake;
		}

		stakingToken.safeTransfer(record.submitter, payout);

		emit SettlementClaimed(debateId, nullifier, payout);
	}

	/// @notice Claim proposer bond return (requires sufficient participation)
	/// @param debateId Debate to claim bond from
	function claimProposerBond(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.RESOLVED) revert DebateNotResolved();
		if (msg.sender != debate.proposer) revert NotProposer();
		if (debate.bondClaimed) revert BondAlreadyClaimed();
		if (debate.uniqueParticipants < BOND_RETURN_THRESHOLD) {
			revert InsufficientParticipation();
		}

		debate.bondClaimed = true;

		stakingToken.safeTransfer(msg.sender, debate.proposerBond);

		emit ProposerBondReturned(debateId, debate.proposerBond);
	}

	/// @notice Sweep forfeited proposer bond to governance treasury
	/// @dev Sweepable in two cases:
	///      1. Resolved debate with insufficient participation (< BOND_RETURN_THRESHOLD)
	///      2. Expired debate with zero arguments (abandoned — can never be resolved)
	function sweepForfeitedBond(bytes32 debateId) external onlyGovernance nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.bondClaimed) revert BondAlreadyClaimed();

		bool isResolved = debate.status == DebateStatus.RESOLVED;
		bool isAbandoned = debate.status == DebateStatus.ACTIVE
			&& block.timestamp >= debate.deadline
			&& debate.argumentCount == 0;

		if (isResolved) {
			if (debate.uniqueParticipants >= BOND_RETURN_THRESHOLD) revert InsufficientParticipation();
		} else if (!isAbandoned) {
			revert DebateNotResolved();
		}

		debate.bondClaimed = true;
		stakingToken.safeTransfer(governance, debate.proposerBond);

		emit ProposerBondForfeited(debateId, debate.proposerBond);
	}

	/// @notice Emergency withdrawal when contract is paused for extended period
	/// @dev Available 30 days after debate deadline for unresolved debates only.
	///      Returns original stake only (no profit). Not gated by whenNotPaused
	///      so it works even when contract is paused — that's the intended use case.
	///      Resolved debates must use claimSettlement instead.
	function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();

		StakeRecord storage record = stakeRecords[debateId][nullifier];
		if (record.stakeAmount == 0) revert StakeRecordNotFound();
		if (record.claimed) revert AlreadyClaimed();
		if (record.submitter != msg.sender) revert UnauthorizedClaimer();

		record.claimed = true;

		// Decrement accounting so settlement math remains solvent if debate is later resolved
		debate.totalStake -= record.stakeAmount;
		argumentTotalStakes[debateId][record.argumentIndex] -= record.stakeAmount;

		stakingToken.safeTransfer(msg.sender, record.stakeAmount);

		emit EmergencyWithdrawn(debateId, nullifier, record.stakeAmount);
	}

	// ============================================================================
	// View Functions
	// ============================================================================

	/// @notice Get debate state
	/// @param debateId Debate identifier
	/// @return status Debate status
	/// @return deadline_ Argument submission deadline
	/// @return argumentCount Number of arguments submitted
	/// @return totalStake Total tokens staked
	/// @return uniqueParticipants Number of unique participants
	function getDebateState(bytes32 debateId)
		external
		view
		returns (
			DebateStatus status,
			uint256 deadline_,
			uint256 argumentCount,
			uint256 totalStake,
			uint256 uniqueParticipants
		)
	{
		Debate storage debate = debates[debateId];
		return (
			debate.status,
			debate.deadline,
			debate.argumentCount,
			debate.totalStake,
			debate.uniqueParticipants
		);
	}

	/// @notice Get argument weighted score
	/// @param debateId Debate identifier
	/// @param argumentIndex Argument index
	/// @return weightedScore Accumulated tier-weighted score
	function getArgumentScore(
		bytes32 debateId,
		uint256 argumentIndex
	) external view returns (uint256 weightedScore) {
		return arguments[debateId][argumentIndex].weightedScore;
	}

	/// @notice Get participation depth metrics
	/// @param debateId Debate identifier
	/// @return uniqueParticipants Number of unique participants
	/// @return jurisdictionSizeHint Estimated jurisdiction size
	function getParticipationDepth(bytes32 debateId)
		external
		view
		returns (uint256 uniqueParticipants, uint256 jurisdictionSizeHint)
	{
		Debate storage debate = debates[debateId];
		return (debate.uniqueParticipants, debate.jurisdictionSizeHint);
	}

	// ============================================================================
	// Pause Controls
	// ============================================================================

	/// @notice Pause contract (governance only)
	function pause() external onlyGovernance {
		_pause();
		emit ContractPaused(msg.sender);
	}

	/// @notice Unpause contract (governance only)
	function unpause() external onlyGovernance {
		_unpause();
		emit ContractUnpaused(msg.sender);
	}

	// ============================================================================
	// Internal Functions
	// ============================================================================

	/// @notice Babylonian method integer square root
	/// @param x Input value
	/// @return y Floor of sqrt(x)
	function sqrt(uint256 x) internal pure returns (uint256 y) {
		if (x == 0) return 0;
		uint256 z = (x + 1) / 2;
		y = x;
		while (z < y) {
			y = z;
			z = (x / z + z) / 2;
		}
	}

	function tierMultiplier(uint8 tier) internal pure returns (uint256) {
		if (tier == 1) return 2;
		if (tier == 2) return 4;
		if (tier == 3) return 8;
		if (tier == 4) return 16;
		return 0;
	}
}

// ============================================================================
// Minimal Interfaces
// ============================================================================

interface IDistrictGate {
	function verifyThreeTreeProof(
		address signer,
		bytes calldata proof,
		uint256[31] calldata publicInputs,
		uint8 verifierDepth,
		uint256 deadline,
		bytes calldata signature
	) external;

	function allowedActionDomains(bytes32) external view returns (bool);
}
