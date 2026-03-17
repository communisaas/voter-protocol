// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "openzeppelin/security/Pausable.sol";
import "openzeppelin/security/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "openzeppelin/utils/cryptography/ECDSA.sol";
import "./TimelockGovernance.sol";
import "./LMSRMath.sol";
import "./IDebateWeightVerifier.sol";
import "./IPositionNoteVerifier.sol";
import "./IAIEvaluationRegistry.sol";
import { SD59x18, sd, ZERO as SD_ZERO } from "prb-math/SD59x18.sol";

/// @title DebateMarket
/// @notice Staked debate protocol for verified-membership communities
/// @dev Composes with DistrictGate (three-tree proof verification), NullifierRegistry
///      (double-stake prevention), and USDC staking with protocol fee on argument stakes.
///
/// ARCHITECTURE:
/// 1. Proposer opens a debate by posting a proposition hash and staking a bond
/// 2. Verified members submit arguments (SUPPORT/OPPOSE/AMEND) with financial stakes
/// 3. Members co-sign existing arguments, adding their weight
/// 4. After deadline, resolution finds the highest-scoring argument via
///    sqrt(stake) * 2^engagementTier weighted tally
/// 5. Winners claim proportional payout from the losing pool
///
/// PHASE 2 — POSITION PRIVACY:
/// LMSR trades use a commit-reveal scheme with ZK proofs for position privacy.
/// revealTrade accepts a debate_weight ZK proof instead of raw stakeAmount/engagementTier.
/// The proof's public outputs (weightedAmount, noteCommitment) drive LMSR quantity updates
/// and are emitted for off-chain position tree construction by shadow-atlas.
/// After resolution, settlePrivatePosition verifies a position_note ZK proof to attest
/// winning positions without revealing identity. Token settlement is Phase 4.
///
/// PRIVACY:
/// - All participation is anonymous via three-tree ZK proofs
/// - Nullifiers prevent double-staking without revealing identity
/// - Arguments are content-addressed (body stored off-chain)
/// - LMSR trades use debate_weight ZK proofs to hide raw stake/tier
/// - Position settlement uses position_note ZK proofs for anonymous attestation
///
/// ANTI-PLUTOCRACY:
/// - sqrt(stake) dampens financial advantage (verified in-circuit for LMSR trades)
/// - Engagement tier multipliers (2^tier) reward sustained participation
/// - A Tier 4 Pillar at $2 outweighs a Tier 1 newcomer at $100
/// - Engagement tier 0 (no history) is excluded — debates require demonstrated participation
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
		RESOLVED,
		RESOLVING,
		AWAITING_GOVERNANCE,
		UNDER_APPEAL,
		CANCELLED
	}

	enum TradeDirection {
		BUY,
		SELL
	}

	struct TradeCommitment {
		bytes32 commitHash;
		address committer;
		bool revealed;
	}

	struct TradeReveal {
		uint256 argumentIndex;
		TradeDirection direction;
		uint256 stakeAmount;
		uint256 weightedAmount;
		uint8 engagementTier;
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
		// Phase 3: AI Resolution
		bool aiScoresSubmitted;
		uint256 resolutionDeadline;
		uint256 appealDeadline;
		bytes32 governanceJustification;
		uint8 resolutionMethod; // 0=unresolved, 1=ai_community, 2=governance_override
		// Engagement-aware resolution (V10)
		uint256 participationDeadline; // block.timestamp + duration/3, set in proposeDebate
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
		/// @notice Designated payout address. If address(0), falls back to submitter.
		/// @dev Allows relayer-submitted transactions to direct settlement funds to the
		///      user's actual wallet rather than the relayer's address (fixes R-01).
		address beneficiary;
	}

	// ============================================================================
	// Immutables & Constants
	// ============================================================================

	/// @notice ERC-20 staking token (USDC, 6 decimals)
	IERC20 public immutable stakingToken;

	/// @notice DistrictGate for three-tree proof verification
	IDistrictGate public immutable districtGate;

	/// @notice Verifier for debate_weight ZK proofs (Phase 2)
	/// @dev Proves sqrt(stake) * tierMultiplier in-circuit, hiding raw stake/tier.
	///      Governance-mutable via timelocked two-phase update (SA-3).
	IDebateWeightVerifier public debateWeightVerifier;

	/// @notice Verifier for position_note ZK proofs (Phase 2)
	/// @dev Proves Merkle membership in position tree, enabling private settlement attestation.
	///      Governance-mutable via timelocked two-phase update (SA-3).
	IPositionNoteVerifier public positionNoteVerifier;

	/// @notice Minimum debate duration (72 hours)
	uint256 public constant MIN_DURATION = 72 hours;

	/// @notice Maximum debate duration (30 days)
	uint256 public constant MAX_DURATION = 30 days;

	/// @notice Minimum unique participants for proposer bond return
	uint256 public constant BOND_RETURN_THRESHOLD = 5;

	/// @notice Minimum proposer bond (1 USDC, 6-decimal stablecoin)
	uint256 public constant MIN_PROPOSER_BOND = 1e6;

	/// @notice Minimum argument/co-sign stake (1 USDC, 6-decimal stablecoin)
	uint256 public constant MIN_ARGUMENT_STAKE = 1e6;

	/// @notice Maximum reveals per epoch (gas DOS prevention on Scroll's 10M gas limit)
	/// @dev 256 reveals × ~30K gas each ≈ 7.7M gas. Commits beyond 256 strand the epoch.
	uint256 public constant MAX_REVEALS_PER_EPOCH = 256;

	/// @notice Maximum protocol fee in basis points (10% hard cap)
	uint256 public constant MAX_FEE_BPS = 1000;

	/// @notice Maximum arguments per debate (gas DOS prevention on Scroll)
	uint256 public constant MAX_ARGUMENTS = 500;

	/// @notice Emergency withdrawal delay after debate deadline
	uint256 public constant EMERGENCY_WITHDRAW_DELAY = 30 days;

	/// @notice Cooldown before deadline during which arguments cannot be submitted (anti-snipe)
	/// @dev LMSR trades remain open until true deadline. Prevents uncounterable last-second arguments.
	uint256 public constant ARGUMENT_COOLDOWN = 1 hours;

	/// @notice Minimum unique participants required to proceed to resolution
	/// @dev Governance-tunable via setMinParticipants(). Debates below this threshold are cancellable.
	uint256 public minParticipants = 3;

	/// @notice BN254 scalar field modulus for action domain field compatibility
	/// @dev Action domains must be valid BN254 field elements for the ZK circuit.
	uint256 public constant BN254_MODULUS =
		21888242871839275222246405745257275088548364400416034343698204186575808495617;

	// ============================================================================
	// State
	// ============================================================================

	/// @notice Protocol fee in basis points (e.g. 200 = 2%), applied to argument stakes only
	uint256 public protocolFeeBps;

	/// @notice Accumulated protocol fees available for sweep
	uint256 public accumulatedFees;

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
	// LMSR State
	// ============================================================================

	/// @notice LMSR quantity for each argument: debateId => argumentIndex => q_i (SD59x18)
	/// @dev q_i starts at 0 for each argument. BUY adds weighted shares, SELL subtracts.
	mapping(bytes32 => mapping(uint256 => SD59x18)) public lmsrQuantities;

	/// @notice LMSR liquidity parameter per debate (SD59x18)
	/// @dev Set once at market creation: b = jurisdictionSizeHint * BASE_LIQUIDITY_PER_MEMBER
	///      Larger b → deeper liquidity → prices move slower → need more consensus to shift.
	mapping(bytes32 => SD59x18) public lmsrLiquidity;

	/// @notice Current epoch number per debate
	mapping(bytes32 => uint256) public currentEpoch;

	/// @notice Trade commitments per epoch: debateId => epoch => index => commitment
	mapping(bytes32 => mapping(uint256 => TradeCommitment[])) internal _epochCommitments;

	/// @notice Trade reveals per epoch: debateId => epoch => index => reveal
	mapping(bytes32 => mapping(uint256 => TradeReveal[])) internal _epochReveals;

	/// @notice Whether an epoch has been executed: debateId => epoch => executed
	mapping(bytes32 => mapping(uint256 => bool)) public epochExecuted;

	/// @notice Epoch start timestamp per debate (set on first trade commit)
	mapping(bytes32 => uint256) public epochStartTime;

	/// @notice Base liquidity per verified member (SD59x18, in 1e18 units)
	/// @dev Governance-tunable. Default: 1e15 (0.001 per member in SD59x18).
	///      District with 700K members → b ≈ 700. District with 200 → b ≈ 0.2.
	SD59x18 public baseLiquidityPerMember = SD59x18.wrap(1e15);

	/// @notice Epoch duration in seconds (governance-tunable)
	uint256 public epochDuration = 300; // 5 minutes

	// ============================================================================
	// Position Privacy State (Phase 2)
	// ============================================================================

	/// @notice Position tree root per debate, updated by governance after epoch execution
	/// @dev Built off-chain by shadow-atlas from PositionCommitted events.
	///      Zero until updatePositionRoot is called after at least one reveal.
	mapping(bytes32 => bytes32) public positionRoot;

	/// @notice Pending position root update per debate (two-phase timelocked)
	struct PendingPositionRoot {
		bytes32 newRoot;
		uint256 leafCount;
		uint256 executeTime;
	}
	mapping(bytes32 => PendingPositionRoot) public pendingPositionRoots;

	/// @notice Pending verifier update (two-phase timelocked, SA-3)
	/// @dev Slot 0 = debateWeightVerifier, slot 1 = positionNoteVerifier
	struct PendingVerifierUpdate {
		address newVerifier;
		uint256 executeTime;
	}
	mapping(uint8 => PendingVerifierUpdate) public pendingVerifierUpdates;

	/// @notice Position nullifiers spent: debateId => nullifier => spent
	/// @dev Prevents the same position_note proof from being used twice in settlePrivatePosition.
	mapping(bytes32 => mapping(bytes32 => bool)) public positionNullifiers;

	/// @notice Total weighted amount per argument from LMSR trades: debateId => argIndex => totalWeight
	/// @dev Accumulated across all epochs and reveals. Used for future proportional payout calculation.
	mapping(bytes32 => mapping(uint256 => uint256)) public lmsrArgumentWeights;

	/// @notice Total LMSR weighted amount across all arguments: debateId => total
	/// @dev Sum of all weightedAmounts from all revealed trades (BUY and SELL combined).
	mapping(bytes32 => uint256) public lmsrTotalWeight;

	// ============================================================================
	// AI Resolution State (Phase 3)
	// ============================================================================

	/// @notice AI evaluation registry (model signers, quorum, α weight)
	IAIEvaluationRegistry public immutable aiRegistry;

	/// @notice Packed AI scores per argument: debateId => argumentIndex => packed
	/// @dev Packs 5 dimension scores as uint16 (0-10000 basis points each):
	///      bits [79:64]=reasoning, [63:48]=accuracy, [47:32]=evidence,
	///      [31:16]=constructiveness, [15:0]=feasibility
	mapping(bytes32 => mapping(uint256 => uint256)) public aiArgumentScores;

	/// @notice Number of valid AI signatures received per debate
	mapping(bytes32 => uint256) public aiSignatureCount;

	/// @notice AI evaluation nonce per debate (prevents replay)
	mapping(bytes32 => uint256) public aiEvalNonce;

	/// @notice Appeal bonds: debateId => appealer => bond amount
	mapping(bytes32 => mapping(address => uint256)) public appealBonds;

	/// @notice Whether a debate has any active appeals
	mapping(bytes32 => bool) public hasAppeal;

	/// @notice Whether a debate's appeal has been finalized (appeal window closed)
	/// @dev Once true, governance may sweep forfeited appeal bonds via sweepAppealBond.
	mapping(bytes32 => bool) public appealFinalized;

	/// @notice Resolution extension duration (governance-tunable, default 48h)
	uint256 public resolutionExtension = 48 hours;

	/// @notice Appeal window duration
	uint256 public constant APPEAL_WINDOW = 7 days;

	/// @notice Appeal bond multiplier (2× proposer bond)
	uint256 public constant APPEAL_BOND_MULTIPLIER = 2;

	/// @notice EIP-712 domain separator for AI evaluation signatures
	bytes32 public immutable AI_EVAL_DOMAIN_SEPARATOR;

	/// @notice EIP-712 type hash for AI evaluation
	bytes32 public constant AI_EVALUATION_TYPEHASH = keccak256(
		"AIEvaluation(bytes32 debateId,uint256[] packedScores,uint256 nonce,uint256 deadline)"
	);

	// ============================================================================
	// Events
	// ============================================================================

	event DebateProposed(
		bytes32 indexed debateId,
		bytes32 indexed actionDomain,
		bytes32 propositionHash,
		uint256 deadline,
		bytes32 baseDomain
	);

	event ArgumentSubmitted(
		bytes32 indexed debateId,
		uint256 indexed argumentIndex,
		Stance stance,
		bytes32 bodyHash,
		uint8 engagementTier,
		uint256 weight,
		bytes32 nullifier
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

	event SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout, address indexed recipient);

	event ProposerBondReturned(bytes32 indexed debateId, uint256 bondAmount);

	event ProposerBondForfeited(bytes32 indexed debateId, uint256 bondAmount);

	event EmergencyWithdrawn(bytes32 indexed debateId, bytes32 nullifier, uint256 amount, address indexed recipient);

	/// @notice Emitted when a forfeited appeal bond is swept to the governance treasury
	event AppealBondForfeited(bytes32 indexed debateId, address indexed appealer, uint256 bond);

	event ContractPaused(address indexed caller);
	event ContractUnpaused(address indexed caller);

	event TradeCommitted(
		bytes32 indexed debateId,
		uint256 indexed epoch,
		bytes32 commitHash,
		uint256 commitIndex
	);

	event TradeRevealed(
		bytes32 indexed debateId,
		uint256 indexed epoch,
		uint256 argumentIndex,
		TradeDirection direction,
		uint256 weightedAmount
	);

	event EpochExecuted(
		bytes32 indexed debateId,
		uint256 indexed epoch,
		uint256 tradesApplied
	);

	event LiquidityParameterUpdated(SD59x18 oldValue, SD59x18 newValue);

	/// @notice Emitted when a trade is revealed with a debate_weight ZK proof
	/// @dev shadow-atlas listens for this event to construct the position Merkle tree.
	///      The noteCommitment is an opaque Poseidon2 commitment; the tree builder hashes it.
	event PositionCommitted(
		bytes32 indexed debateId,
		uint256 indexed epoch,
		uint256 argumentIndex,
		uint256 weightedAmount,
		bytes32 noteCommitment
	);

	/// @notice Emitted when governance updates the position tree root
	event PositionRootUpdated(bytes32 indexed debateId, bytes32 newRoot, uint256 leafCount);

	/// @notice Emitted when a position root update is initiated (timelock starts)
	event PositionRootUpdateInitiated(bytes32 indexed debateId, bytes32 newRoot, uint256 leafCount, uint256 executeTime);

	/// @notice Emitted when a pending position root update is cancelled
	event PositionRootUpdateCancelled(bytes32 indexed debateId);

	/// @notice Emitted when a verifier update is initiated (SA-3)
	/// @param slot 0 = debateWeightVerifier, 1 = positionNoteVerifier
	event VerifierUpdateInitiated(uint8 indexed slot, address newVerifier, uint256 executeTime);

	/// @notice Emitted when a verifier update is executed (SA-3)
	event VerifierUpdated(uint8 indexed slot, address newVerifier);

	/// @notice Emitted when a pending verifier update is cancelled (SA-3)
	event VerifierUpdateCancelled(uint8 indexed slot);

	/// @notice Emitted when a user proves winning position ownership via position_note proof
	/// @dev Phase 2: attestation only (no token transfer). claimedWeight is informational.
	event PrivateSettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 claimedWeight);

	// Protocol Fee Events
	event FeeSwept(address indexed to, uint256 amount);
	event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps);
	event EpochDurationUpdated(uint256 oldDuration, uint256 newDuration);
	event ResolutionExtensionUpdated(uint256 oldDuration, uint256 newDuration);
	event DebateEscalated(bytes32 indexed debateId);

	// Phase 3: AI Resolution Events
	event AIEvaluationSubmitted(bytes32 indexed debateId, uint256 signatureCount, uint256 nonce);
	event DebateResolvedWithAI(
		bytes32 indexed debateId,
		uint256 winningArgumentIndex,
		uint256 aiScore,
		uint256 communityScore,
		uint256 finalScore,
		uint8 resolutionMethod
	);
	event GovernanceResolutionSubmitted(bytes32 indexed debateId, uint256 winningIndex, bytes32 justification);
	event ResolutionAppealed(bytes32 indexed debateId, address indexed appealer, uint256 bond);
	event AppealFinalized(bytes32 indexed debateId, bool upheld);
	event DebateCancelled(bytes32 indexed debateId, uint256 actualParticipants, uint256 requiredParticipants);
	event MinParticipantsUpdated(uint256 oldValue, uint256 newValue);

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
	error EpochNotInCommitPhase();
	error EpochNotInRevealPhase();
	error EpochAlreadyExecuted();
	error InvalidCommitIndex();
	error CommitHashMismatch();
	error NotCommitter();
	error AlreadyRevealed();
	error InvalidTradeDirection();
	error InvalidJurisdictionSize();
	error MarketNotStarted();
	/// @notice Thrown when a debate_weight ZK proof fails verification in revealTrade
	error InvalidDebateWeightProof();
	/// @notice Thrown when a position_note ZK proof fails verification in settlePrivatePosition
	error InvalidPositionNoteProof();
	/// @notice Thrown when a position nullifier has already been spent
	error PositionNullifierSpent();
	/// @notice Thrown when settlePrivatePosition is called before updatePositionRoot
	error PositionRootNotSet();
	/// @notice Thrown when the proof's position_root does not match the stored root
	error InvalidPositionRoot();
	// Phase 3: AI Resolution Errors
	error AIScoresAlreadySubmitted();
	error InsufficientSignatures();
	error InvalidSignature();
	error AIScoresNotSubmitted();
	error DebateNotResolving();
	error DebateNotAwaitingGovernance();
	error DebateNotUnderAppeal();
	error AppealWindowExpired();
	error AppealWindowActive();
	error InsufficientAppealBond();
	error ResolutionDeadlineNotReached();
	error SignatureExpired();
	error AppealBondAlreadySwept();
	error AppealNotFinalized();
	error AlreadyAppealed();
	error FeeExceedsCap();
	error NoFeesToSweep();
	error EpochDurationOutOfRange();
	error ResolutionExtensionOutOfRange();
	error BaseLiquidityMustBePositive();
	// Engagement-aware resolution errors (V10)
	error ParticipationWindowOpen();
	error ParticipationThresholdMet();
	error ArgumentWindowClosed();
	error MinParticipantsOutOfRange();
	error InsufficientSellWeight();
	/// @notice Thrown when a packed AI score has a dimension exceeding 10000 basis points
	error InvalidAIScore();
	/// @notice Thrown when an epoch has more reveals than MAX_REVEALS_PER_EPOCH
	error TooManyReveals();
	/// @notice Thrown when a two-phase operation is already pending for this key
	error OperationAlreadyPending();
	/// @notice Thrown when no two-phase operation is pending for this key
	error NoOperationPending();
	/// @notice Thrown when an invalid verifier slot is specified (must be 0 or 1)
	error InvalidVerifierSlot();

	// ============================================================================
	// Constructor
	// ============================================================================

	/// @notice Deploy DebateMarket
	/// @param _districtGate Address of DistrictGate contract
	/// @param _debateWeightVerifier Address of the debate_weight UltraHonk verifier (Phase 2)
	/// @param _positionNoteVerifier Address of the position_note UltraHonk verifier (Phase 2)
	/// @param _aiRegistry Address of AIEvaluationRegistry (Phase 3)
	/// @param _governance Governance address for pause/unpause
	/// @param _stakingToken Address of ERC-20 staking token (USDC)
	/// @param _protocolFeeBps Protocol fee in basis points (e.g. 200 = 2%)
	/// @dev GOVERNANCE_TIMELOCK hardcoded to 10 minutes for hackathon deploy.
	///      EIP-170 prevents parameterization (24984 > 24576 with immutable).
	///      Mainnet: extract LMSR into library to reclaim headroom, then parameterize.
	constructor(
		address _districtGate,
		address _debateWeightVerifier,
		address _positionNoteVerifier,
		address _aiRegistry,
		address _governance,
		address _stakingToken,
		uint256 _protocolFeeBps
	) TimelockGovernance(10 minutes) {
		if (_districtGate == address(0)) revert ZeroAddress();
		if (_debateWeightVerifier == address(0)) revert ZeroAddress();
		if (_positionNoteVerifier == address(0)) revert ZeroAddress();
		if (_aiRegistry == address(0)) revert ZeroAddress();
		if (_stakingToken == address(0)) revert ZeroAddress();
		if (_protocolFeeBps > MAX_FEE_BPS) revert FeeExceedsCap();
		// _governance zero-check is inside _initializeGovernance
		_initializeGovernance(_governance);
		districtGate = IDistrictGate(_districtGate);
		debateWeightVerifier = IDebateWeightVerifier(_debateWeightVerifier);
		positionNoteVerifier = IPositionNoteVerifier(_positionNoteVerifier);
		aiRegistry = IAIEvaluationRegistry(_aiRegistry);
		stakingToken = IERC20(_stakingToken);
		protocolFeeBps = _protocolFeeBps;

		// EIP-712 domain separator for AI evaluation signatures
		AI_EVAL_DOMAIN_SEPARATOR = keccak256(
			abi.encode(
				keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
				keccak256("DebateMarket"),
				keccak256("3"),
				block.chainid,
				address(this)
			)
		);
	}

	// ============================================================================
	// Transfer Boundary — all token flow routes through these 3 functions
	// ============================================================================

	/// @dev Pull stake with fee extraction. Returns net amount credited to staker.
	///      Fee applies only to argument stakes (submitArgument, coSignArgument).
	function _pullStake(address from, uint256 gross) internal returns (uint256 net) {
		uint256 fee = (gross * protocolFeeBps) / 10_000;
		net = gross - fee;
		accumulatedFees += fee;
		stakingToken.safeTransferFrom(from, address(this), gross);
	}

	/// @dev Pull exact amount with no fee (bonds, appeals).
	function _pullExact(address from, uint256 amount) internal {
		stakingToken.safeTransferFrom(from, address(this), amount);
	}

	/// @dev Send tokens out (settlements, bond returns, fee sweeps).
	function _send(address to, uint256 amount) internal {
		stakingToken.safeTransfer(to, amount);
	}

	// ============================================================================
	// Core Functions
	// ============================================================================

	/// @notice Propose a new debate derived from a template's registered base domain
	/// @param propositionHash Hash of the proposition text (stored off-chain)
	/// @param duration Debate duration in seconds [MIN_DURATION, MAX_DURATION]
	/// @param jurisdictionSizeHint Estimated jurisdiction size for participation depth
	/// @param baseDomain Template's registered action domain (must be whitelisted on DistrictGate)
	/// @param bondAmount USDC bond amount (must be >= MIN_PROPOSER_BOND). Caller must approve first.
	/// @return debateId Unique identifier for the debate
	/// @dev DERIVED DOMAIN: The debate's action domain is deterministically derived as:
	///      debateDomain = keccak256(baseDomain, "debate", propositionHash) % BN254_MODULUS
	///      This ensures each debate has a unique nullifier scope while inheriting
	///      authorization from the template's registered base domain.
	///      The derived domain is registered atomically on DistrictGate during this call.
	function proposeDebate(
		bytes32 propositionHash,
		uint256 duration,
		uint256 jurisdictionSizeHint,
		bytes32 baseDomain,
		uint256 bondAmount
	) external whenNotPaused nonReentrant returns (bytes32 debateId) {
		if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
		if (bondAmount < MIN_PROPOSER_BOND) revert InsufficientBond();
		if (jurisdictionSizeHint == 0) revert InvalidJurisdictionSize();

		// Derive the debate-specific action domain from the template's base domain
		bytes32 debateActionDomain = deriveDomain(baseDomain, propositionHash);

		// Register the derived domain on DistrictGate (atomic, no timelock)
		// Reverts if: DebateMarket not authorized, baseDomain not registered, or domain already exists
		districtGate.registerDerivedDomain(baseDomain, debateActionDomain);

		// Generate unique debate ID
		debateId = keccak256(
			abi.encodePacked(propositionHash, debateActionDomain, block.timestamp, msg.sender)
		);

		if (debates[debateId].deadline != 0) revert DebateAlreadyExists();

		Debate storage debate = debates[debateId];
		debate.propositionHash = propositionHash;
		debate.actionDomain = debateActionDomain;
		debate.deadline = block.timestamp + duration;
		debate.participationDeadline = block.timestamp + duration / 3;
		debate.jurisdictionSizeHint = jurisdictionSizeHint;
		debate.status = DebateStatus.ACTIVE;
		debate.proposer = msg.sender;
		debate.proposerBond = bondAmount;

		// Initialize LMSR liquidity: b = jurisdictionSizeHint * baseLiquidityPerMember
		// Larger jurisdictions get deeper liquidity (prices harder to move).
		// Scale jurisdictionSizeHint to 18-decimal SD59x18 before multiplication.
		lmsrLiquidity[debateId] = sd(int256(jurisdictionSizeHint) * 1e18) * baseLiquidityPerMember;

		// Pull bond (no fee on proposer bonds)
		_pullExact(msg.sender, bondAmount);

		emit DebateProposed(debateId, debateActionDomain, propositionHash, debate.deadline, baseDomain);
	}

	/// @notice Submit an argument to a debate
	/// @dev NULLIFIER CONSTRAINT: Submitting an argument consumes the user's nullifier for this
	///      debate's action domain. The same user CANNOT also call `commitTrade()` for this debate —
	///      the shared nullifier scope enforces mutual exclusion between staking and trading roles.
	///      This is by-design: arguers have financial skin-in-the-game (USDC stakes), while LMSR
	///      traders provide pure price signal without token commitment. (R2-F02 documentation)
	/// @param debateId Debate to submit argument to
	/// @param stance SUPPORT, OPPOSE, or AMEND
	/// @param bodyHash Hash of argument text (stored off-chain)
	/// @param amendmentHash Hash of proposed amendment (only if stance == AMEND)
	/// @param stakeAmount USDC stake amount (must be >= MIN_ARGUMENT_STAKE). Caller must approve first.
	/// @param signer Address that signed the proof submission (typically the relayer)
	/// @param proof ZK proof bytes
	/// @param publicInputs 31 public inputs from three-tree circuit
	/// @param verifierDepth Depth for verifier lookup
	/// @param deadline Signature expiration timestamp
	/// @param signature EIP-712 signature from signer
	/// @param beneficiary Designated settlement recipient. If address(0), settlement goes
	///        to msg.sender (the relayer). Pass the user's wallet address here so that
	///        claimSettlement forwards funds to the actual user, not the relayer (R-01 fix).
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
		bytes calldata signature,
		address beneficiary
	) external whenNotPaused nonReentrant {
		if (stakeAmount < MIN_ARGUMENT_STAKE) revert InsufficientStake();

		// Pull stake with protocol fee — net amount enters scoring and settlement
		uint256 netStake = _pullStake(msg.sender, stakeAmount);

		// Delegate all validation, proof verification, and storage writes to internal helper.
		// Splitting here keeps mpos temporaries from publicInputs (calldata array) and
		// Debate storage slot accesses in separate Yul frames, avoiding stack-too-deep (via_ir).
		(uint256 argumentIndex, uint256 weight, uint8 engagementTier, bytes32 nullifier) = _submitArgumentCore(
			debateId, stance, bodyHash, amendmentHash, netStake,
			signer, proof, publicInputs, verifierDepth, deadline, signature, beneficiary
		);

		emit ArgumentSubmitted(debateId, argumentIndex, stance, bodyHash, engagementTier, weight, nullifier);
	}

	/// @notice Co-sign an existing argument in a debate
	/// @param debateId Debate containing the argument
	/// @param argumentIndex Index of the argument to co-sign
	/// @param stakeAmount USDC stake amount (must be >= MIN_ARGUMENT_STAKE). Caller must approve first.
	/// @param signer Address that signed the proof submission (typically the relayer)
	/// @param proof ZK proof bytes
	/// @param publicInputs 31 public inputs from three-tree circuit
	/// @param verifierDepth Depth for verifier lookup
	/// @param deadline Signature expiration timestamp
	/// @param signature EIP-712 signature from signer
	/// @param beneficiary Designated settlement recipient. If address(0), settlement goes
	///        to msg.sender (the relayer). Pass the user's wallet address here so that
	///        claimSettlement forwards funds to the actual user, not the relayer (R-01 fix).
	function coSignArgument(
		bytes32 debateId,
		uint256 argumentIndex,
		uint256 stakeAmount,
		address signer,
		bytes calldata proof,
		uint256[31] calldata publicInputs,
		uint8 verifierDepth,
		uint256 deadline,
		bytes calldata signature,
		address beneficiary
	) external whenNotPaused nonReentrant {
		if (stakeAmount < MIN_ARGUMENT_STAKE) revert InsufficientStake();

		// Pull stake with protocol fee — net amount enters scoring and settlement
		uint256 netStake = _pullStake(msg.sender, stakeAmount);

		// Delegate all validation, proof verification, and storage writes to internal helper.
		// Splitting here keeps mpos temporaries from publicInputs (calldata array) and
		// Debate storage slot accesses in separate Yul frames, avoiding stack-too-deep (via_ir).
		(uint256 weight, uint8 engagementTier) = _coSignArgumentCore(
			debateId, argumentIndex, netStake,
			signer, proof, publicInputs, verifierDepth, deadline, signature, beneficiary
		);

		emit CoSignSubmitted(debateId, argumentIndex, engagementTier, weight);
	}

	/// @notice Resolve a debate after the AI resolution grace period has passed
	/// @dev Community-only resolution fallback. Waits `resolutionExtension` after deadline
	///      to give the AI evaluation pipeline time to submit scores first (R2-F01 fix).
	///      If AI scores were submitted during the grace period, status will be RESOLVING,
	///      and this function will revert — use `resolveDebateWithAI()` instead.
	/// @param debateId Debate to resolve
	function resolveDebate(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.deadline + resolutionExtension) revert DebateStillActive();
		if (debate.argumentCount == 0) revert NoArgumentsSubmitted();
		if (debate.uniqueParticipants < minParticipants) revert InsufficientParticipation();

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
	/// @dev Payout goes to the designated beneficiary if one was recorded at submission time;
	///      otherwise to the submitter (typically the relayer). Either the submitter or the
	///      beneficiary may call this function — both are authorized to trigger the transfer.
	///      This resolves R-01: tokens no longer strand at the relayer wallet.
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

		// Authorization: submitter (relayer) or beneficiary (user wallet) may trigger claim.
		// This allows either party to initiate the transfer while funds always go to recipient.
		if (msg.sender != record.submitter && msg.sender != record.beneficiary) {
			revert UnauthorizedClaimer();
		}

		record.claimed = true;

		// Calculate payout: stake + proportional share of losing pool
		uint256 winningArgStake = argumentTotalStakes[debateId][debate.winningArgumentIndex];
		uint256 losingPool = debate.totalStake - winningArgStake;
		uint256 payout = record.stakeAmount;
		if (winningArgStake > 0) {
			payout += (losingPool * record.stakeAmount) / winningArgStake;
		}

		// Route payout: beneficiary takes precedence over submitter (R-01 fix).
		address recipient = record.beneficiary != address(0) ? record.beneficiary : record.submitter;
		_send(recipient, payout);

		emit SettlementClaimed(debateId, nullifier, payout, recipient);
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

		_send(msg.sender, debate.proposerBond);

		emit ProposerBondReturned(debateId, debate.proposerBond);
	}

	/// @notice Sweep forfeited proposer bond to governance treasury
	/// @dev Sweepable in three cases:
	///      1. Resolved debate with insufficient participation (< BOND_RETURN_THRESHOLD)
	///      2. Expired debate with zero arguments (abandoned — can never be resolved)
	///      3. Stale debate: past emergency withdrawal delay, all stakes withdrawn, never resolved
	function sweepForfeitedBond(bytes32 debateId) external onlyGovernance nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.bondClaimed) revert BondAlreadyClaimed();

		bool isResolved = debate.status == DebateStatus.RESOLVED;
		bool isAbandoned = debate.status == DebateStatus.ACTIVE
			&& block.timestamp >= debate.deadline
			&& debate.argumentCount == 0;
		bool isStale = debate.status == DebateStatus.ACTIVE
			&& block.timestamp >= debate.deadline + EMERGENCY_WITHDRAW_DELAY
			&& debate.argumentCount > 0
			&& debate.totalStake == 0;

		if (isResolved) {
			if (debate.uniqueParticipants >= BOND_RETURN_THRESHOLD) revert InsufficientParticipation();
		} else if (!isAbandoned && !isStale) {
			revert DebateNotResolved();
		}

		debate.bondClaimed = true;
		_send(governance, debate.proposerBond);

		emit ProposerBondForfeited(debateId, debate.proposerBond);
	}

	/// @notice Cancel an under-participated debate and return proposer bond
	/// @dev Callable by anyone after the participation deadline if uniqueParticipants < minParticipants.
	///      Stakers can immediately withdraw via emergencyWithdraw (no 30-day wait for CANCELLED).
	/// @param debateId Debate to cancel
	function cancelUnderparticipated(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.participationDeadline) revert ParticipationWindowOpen();
		if (debate.uniqueParticipants >= minParticipants) revert ParticipationThresholdMet();

		debate.status = DebateStatus.CANCELLED;
		debate.bondClaimed = true;
		_send(debate.proposer, debate.proposerBond);

		emit DebateCancelled(debateId, debate.uniqueParticipants, minParticipants);
	}

	/// @notice Check whether a debate is eligible for cancellation
	/// @param debateId Debate to check
	/// @return cancellable True if cancelUnderparticipated would succeed
	function isCancellable(bytes32 debateId) external view returns (bool cancellable) {
		Debate storage debate = debates[debateId];
		cancellable = debate.deadline != 0
			&& debate.status == DebateStatus.ACTIVE
			&& block.timestamp >= debate.participationDeadline
			&& debate.uniqueParticipants < minParticipants;
	}

	/// @notice Emergency withdrawal when contract is paused for extended period
	/// @dev Available 30 days after debate deadline for unresolved debates only.
	///      Returns original stake only (no profit). Not gated by whenNotPaused
	///      so it works even when contract is paused — that's the intended use case.
	///      Resolved debates must use claimSettlement instead.
	///      Payout follows the same beneficiary routing as claimSettlement (R-01 fix):
	///      funds go to beneficiary if set, otherwise to submitter.
	function emergencyWithdraw(bytes32 debateId, bytes32 nullifier) external nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();

		// FP5-F01: Allow emergency withdrawal from AWAITING_GOVERNANCE.
		// RESOLVING and UNDER_APPEAL have permissionless exits (resolveDebateWithAI, finalizeAppeal),
		// but AWAITING_GOVERNANCE requires governance action. If governance disappears, funds lock.
		DebateStatus status = debate.status;
		if (status == DebateStatus.CANCELLED) {
			// Cancelled debates: immediate withdrawal (no 30-day wait)
		} else if (status == DebateStatus.ACTIVE || status == DebateStatus.AWAITING_GOVERNANCE) {
			if (block.timestamp < debate.deadline + EMERGENCY_WITHDRAW_DELAY) revert DebateStillActive();
		} else {
			revert DebateNotActive();
		}

		StakeRecord storage record = stakeRecords[debateId][nullifier];
		if (record.stakeAmount == 0) revert StakeRecordNotFound();
		if (record.claimed) revert AlreadyClaimed();

		// Authorization: submitter (relayer) or beneficiary (user wallet) may trigger withdrawal.
		if (msg.sender != record.submitter && msg.sender != record.beneficiary) {
			revert UnauthorizedClaimer();
		}

		record.claimed = true;

		// Decrement accounting so settlement math remains solvent if debate is later resolved
		debate.totalStake -= record.stakeAmount;
		argumentTotalStakes[debateId][record.argumentIndex] -= record.stakeAmount;

		// Route refund: beneficiary takes precedence over submitter (R-01 fix).
		address recipient = record.beneficiary != address(0) ? record.beneficiary : record.submitter;
		_send(recipient, record.stakeAmount);

		emit EmergencyWithdrawn(debateId, nullifier, record.stakeAmount, recipient);
	}

	// ============================================================================
	// LMSR Trading Functions
	// ============================================================================

	/// @notice Commit a trade during the commit phase of the current epoch
	/// @dev NULLIFIER CONSTRAINT: Committing a trade consumes the user's nullifier for this
	///      debate's action domain. The same user CANNOT also call `submitArgument()` or
	///      `coSignArgument()` for this debate — mutual exclusion between trading and staking.
	///      LMSR trades are pure price signal with no token flow. (R2-F02 documentation)
	/// @param debateId Debate to trade in
	/// @param commitHash keccak256(abi.encodePacked(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce))
	/// @param signer Address that signed the ZK proof
	/// @param proof ZK proof bytes
	/// @param publicInputs 31 public inputs from three-tree circuit
	/// @param verifierDepth Depth for verifier lookup
	/// @param deadline Signature expiration timestamp
	/// @param signature EIP-712 signature from signer
	function commitTrade(
		bytes32 debateId,
		bytes32 commitHash,
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
		if (debate.argumentCount == 0) revert NoArgumentsSubmitted();

		// Initialize epoch timing on first commit
		if (epochStartTime[debateId] == 0) {
			epochStartTime[debateId] = block.timestamp;
		}

		// Verify we're in commit phase
		if (!_isCommitPhase(debateId)) revert EpochNotInCommitPhase();

		// Verify three-tree proof (identity + engagement)
		districtGate.verifyThreeTreeProof(
			signer, proof, publicInputs, verifierDepth, deadline, signature
		);

		// Verify action domain matches debate
		if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();

		// Verify engagement tier > 0
		uint256 engagementTierRaw = publicInputs[30];
		if (engagementTierRaw > 4) revert InvalidEngagementTier();
		if (LMSRMath.tierMultiplier(uint8(engagementTierRaw)) == 0) revert InvalidEngagementTier();

		// Store commitment
		uint256 epoch = currentEpoch[debateId];
		uint256 commitIndex = _epochCommitments[debateId][epoch].length;
		_epochCommitments[debateId][epoch].push(TradeCommitment({
			commitHash: commitHash,
			committer: msg.sender,
			revealed: false
		}));

		emit TradeCommitted(debateId, epoch, commitHash, commitIndex);
	}

	/// @notice Reveal a previously committed trade during the reveal phase (Phase 2)
	/// @dev Phase 2 change: instead of raw stakeAmount/engagementTier, the caller provides
	///      a debate_weight ZK proof. The circuit proves sqrt(stake)*tier in zero-knowledge,
	///      outputting weightedAmount and a noteCommitment for off-chain position tree construction.
	///      Commit hash format changes to: keccak256(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce)
	/// @param debateId Debate containing the trade
	/// @param epoch Epoch the commitment was made in
	/// @param commitIndex Index of the commitment in that epoch
	/// @param argumentIndex Index of the argument being traded
	/// @param direction BUY or SELL
	/// @param nonce Random nonce used in commitment hash
	/// @param debateWeightProof Serialized UltraHonk debate_weight proof bytes
	/// @param debateWeightPublicInputs [0] weightedAmount, [1] noteCommitment (from the proof)
	function revealTrade(
		bytes32 debateId,
		uint256 epoch,
		uint256 commitIndex,
		uint256 argumentIndex,
		TradeDirection direction,
		bytes32 nonce,
		bytes calldata debateWeightProof,
		bytes32[2] calldata debateWeightPublicInputs
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();

		// Must be in reveal phase for the committed epoch
		if (!_isRevealPhase(debateId, epoch)) revert EpochNotInRevealPhase();

		// Validate commitment exists and caller is committer
		if (commitIndex >= _epochCommitments[debateId][epoch].length) revert InvalidCommitIndex();
		TradeCommitment storage commitment = _epochCommitments[debateId][epoch][commitIndex];
		if (commitment.committer != msg.sender) revert NotCommitter();
		if (commitment.revealed) revert AlreadyRevealed();

		// Verify the debate_weight ZK proof before touching commitment state
		// The proof attests: weightedAmount = sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier)
		// and noteCommitment = Poseidon2(argumentIndex, weightedAmount, randomness)
		bytes32[] memory pubInputsDyn = new bytes32[](2);
		pubInputsDyn[0] = debateWeightPublicInputs[0];
		pubInputsDyn[1] = debateWeightPublicInputs[1];
		if (!debateWeightVerifier.verify(debateWeightProof, pubInputsDyn)) {
			revert InvalidDebateWeightProof();
		}

		// Extract proven outputs from public inputs
		uint256 weightedAmount = uint256(debateWeightPublicInputs[0]);
		bytes32 noteCommitment = debateWeightPublicInputs[1];

		// Verify preimage matches commitment hash.
		// Phase 2 format: keccak256(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce)
		// Including epoch prevents cross-epoch commit hash linkage (C-2 privacy fix):
		// identical positions in different epochs produce different hashes.
		bytes32 expectedHash = keccak256(
			abi.encodePacked(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce)
		);
		if (expectedHash != commitment.commitHash) revert CommitHashMismatch();

		// Validate argument exists and weightedAmount is non-zero
		if (argumentIndex >= debate.argumentCount) revert ArgumentNotFound();
		if (weightedAmount == 0) revert InsufficientStake();

		// Mark as revealed
		commitment.revealed = true;

		// Track LMSR weighted amounts per argument for future proportional settlement (R2-F03 fix)
		if (direction == TradeDirection.BUY) {
			lmsrArgumentWeights[debateId][argumentIndex] += weightedAmount;
			lmsrTotalWeight[debateId] += weightedAmount;
		} else {
			if (weightedAmount > lmsrArgumentWeights[debateId][argumentIndex]) revert InsufficientSellWeight();
			if (weightedAmount > lmsrTotalWeight[debateId]) revert InsufficientSellWeight();
			lmsrArgumentWeights[debateId][argumentIndex] -= weightedAmount;
			lmsrTotalWeight[debateId] -= weightedAmount;
		}

		// Store reveal for batch execution in executeEpoch
		// stakeAmount is zero (not revealed on-chain); engagementTier is zero (hidden in proof).
		// The weightedAmount from the proof is authoritative.
		_epochReveals[debateId][epoch].push(TradeReveal({
			argumentIndex: argumentIndex,
			direction: direction,
			stakeAmount: 0,       // not revealed on-chain in Phase 2
			weightedAmount: weightedAmount,
			engagementTier: 0     // hidden inside the ZK proof in Phase 2
		}));

		// NOTE: No token transfer — LMSR trades are pure price signal.
		// Financial skin-in-the-game comes from submitArgument/coSignArgument only.

		// Emit position commitment event for shadow-atlas off-chain tree builder.
		// The tree builder computes Poseidon2(argumentIndex, weightedAmount, randomness)
		// and inserts the resulting leaf into the position Merkle tree.
		emit PositionCommitted(debateId, epoch, argumentIndex, weightedAmount, noteCommitment);

		emit TradeRevealed(debateId, epoch, argumentIndex, direction, weightedAmount);
	}

	/// @notice Execute all revealed trades for a completed epoch (permissionless)
	/// @param debateId Debate to execute epoch for
	/// @param epoch Epoch number to execute
	function executeEpoch(
		bytes32 debateId,
		uint256 epoch
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (epochExecuted[debateId][epoch]) revert EpochAlreadyExecuted();

		// Epoch must be past its reveal window
		if (!_isEpochExecutable(debateId, epoch)) revert EpochNotInRevealPhase();

		TradeReveal[] storage reveals = _epochReveals[debateId][epoch];
		uint256 numReveals = reveals.length;
		if (numReveals > MAX_REVEALS_PER_EPOCH) revert TooManyReveals();

		// Mark executed before any state changes (best practice — reverts undo state anyway)
		epochExecuted[debateId][epoch] = true;

		// Advance epoch counter if this was the current epoch
		if (epoch == currentEpoch[debateId]) {
			currentEpoch[debateId]++;
			epochStartTime[debateId] = block.timestamp;
		}

		// Empty epoch: market clock still advances; no quantities to update
		if (numReveals == 0) {
			emit EpochExecuted(debateId, epoch, 0);
			return;
		}

		// Apply all revealed trades to LMSR quantities (pure signal — no token accounting)
		// Quantities store raw weighted amounts; computePrice divides by b once (FP-3 fix)
		for (uint256 i = 0; i < numReveals; i++) {
			TradeReveal storage reveal = reveals[i];
			SD59x18 delta = sd(int256(reveal.weightedAmount) * 1e18);

			if (reveal.direction == TradeDirection.BUY) {
				lmsrQuantities[debateId][reveal.argumentIndex] =
					lmsrQuantities[debateId][reveal.argumentIndex] + delta;
			} else {
				lmsrQuantities[debateId][reveal.argumentIndex] =
					lmsrQuantities[debateId][reveal.argumentIndex] - delta;
			}
		}

		emit EpochExecuted(debateId, epoch, numReveals);
	}

	/// @notice Set base liquidity per member (governance only, must be positive)
	/// @param newValue New base liquidity per member (SD59x18, must be > 0)
	function setBaseLiquidityPerMember(
		SD59x18 newValue
	) external onlyGovernance {
		if (!newValue.gt(SD_ZERO)) revert BaseLiquidityMustBePositive();
		SD59x18 old = baseLiquidityPerMember;
		baseLiquidityPerMember = newValue;
		emit LiquidityParameterUpdated(old, newValue);
	}

	/// @notice Set epoch duration (governance only, bounded 1 hour – 30 days)
	/// @param newDuration New epoch duration in seconds
	function setEpochDuration(uint256 newDuration) external onlyGovernance {
		if (newDuration < 1 hours || newDuration > 30 days) revert EpochDurationOutOfRange();
		uint256 old = epochDuration;
		epochDuration = newDuration;
		emit EpochDurationUpdated(old, newDuration);
	}

	// ============================================================================
	// Position Privacy Functions (Phase 2)
	// ============================================================================

	/// @notice Initiate a position root update (starts governance timelock)
	/// @dev Called by governance after shadow-atlas rebuilds the position Merkle tree
	///      from PositionCommitted events. The root becomes active after GOVERNANCE_TIMELOCK.
	/// @param debateId Debate whose position tree was updated
	/// @param newRoot New Merkle root after inserting all position commitments
	/// @param leafCount Total number of leaves in the tree (informational, emitted in event)
	function initiatePositionRootUpdate(
		bytes32 debateId,
		bytes32 newRoot,
		uint256 leafCount
	) external onlyGovernance {
		if (debates[debateId].deadline == 0) revert DebateNotFound();
		if (pendingPositionRoots[debateId].executeTime != 0) revert OperationAlreadyPending();
		uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
		pendingPositionRoots[debateId] = PendingPositionRoot(newRoot, leafCount, executeTime);
		emit PositionRootUpdateInitiated(debateId, newRoot, leafCount, executeTime);
	}

	/// @notice Execute a pending position root update (after timelock)
	/// @param debateId Debate whose position root to update
	function executePositionRootUpdate(bytes32 debateId) external {
		PendingPositionRoot memory pending = pendingPositionRoots[debateId];
		if (pending.executeTime == 0) revert NoOperationPending();
		if (block.timestamp < pending.executeTime) revert TimelockNotExpired();
		positionRoot[debateId] = pending.newRoot;
		delete pendingPositionRoots[debateId];
		emit PositionRootUpdated(debateId, pending.newRoot, pending.leafCount);
	}

	/// @notice Cancel a pending position root update
	/// @param debateId Debate whose pending update to cancel
	function cancelPositionRootUpdate(bytes32 debateId) external onlyGovernance {
		if (pendingPositionRoots[debateId].executeTime == 0) revert NoOperationPending();
		delete pendingPositionRoots[debateId];
		emit PositionRootUpdateCancelled(debateId);
	}

	// ============================================================================
	// Verifier Update Functions (SA-3)
	// ============================================================================

	/// @notice Initiate a verifier update (starts governance timelock)
	/// @param slot 0 = debateWeightVerifier, 1 = positionNoteVerifier
	/// @param newVerifier New verifier contract address
	function initiateVerifierUpdate(uint8 slot, address newVerifier) external onlyGovernance {
		if (slot > 1) revert InvalidVerifierSlot();
		if (newVerifier == address(0)) revert ZeroAddress();
		if (pendingVerifierUpdates[slot].executeTime != 0) revert OperationAlreadyPending();
		uint256 executeTime = block.timestamp + GOVERNANCE_TIMELOCK;
		pendingVerifierUpdates[slot] = PendingVerifierUpdate(newVerifier, executeTime);
		emit VerifierUpdateInitiated(slot, newVerifier, executeTime);
	}

	/// @notice Execute a pending verifier update (after timelock)
	/// @param slot 0 = debateWeightVerifier, 1 = positionNoteVerifier
	function executeVerifierUpdate(uint8 slot) external {
		PendingVerifierUpdate memory pending = pendingVerifierUpdates[slot];
		if (pending.executeTime == 0) revert NoOperationPending();
		if (block.timestamp < pending.executeTime) revert TimelockNotExpired();
		if (slot == 0) {
			debateWeightVerifier = IDebateWeightVerifier(pending.newVerifier);
		} else {
			positionNoteVerifier = IPositionNoteVerifier(pending.newVerifier);
		}
		delete pendingVerifierUpdates[slot];
		emit VerifierUpdated(slot, pending.newVerifier);
	}

	/// @notice Cancel a pending verifier update
	/// @param slot 0 = debateWeightVerifier, 1 = positionNoteVerifier
	function cancelVerifierUpdate(uint8 slot) external onlyGovernance {
		if (pendingVerifierUpdates[slot].executeTime == 0) revert NoOperationPending();
		delete pendingVerifierUpdates[slot];
		emit VerifierUpdateCancelled(slot);
	}

	/// @notice Claim settlement via ZK proof of position ownership (Phase 2 — attestation only)
	/// @dev Verifies a position_note proof proving the caller held a winning LMSR position.
	///      Phase 2 is attestation-only: no tokens are transferred. The nullifier is spent
	///      to prevent duplicate claims. Token settlement (proportional payout) is Phase 4.
	///
	///      Verification order (fail-fast, cheapest checks first):
	///      1. Debate must exist and be RESOLVED
	///      2. Position root must be set (governance must call updatePositionRoot first)
	///      3. Proof's position_root must match stored root
	///      4. Proof's debate_id must match debateId
	///      5. Proof's winning_argument_index must match debate resolution
	///      6. Nullifier must not be spent
	///      7. ZK proof verification (most expensive — done last)
	///
	/// @param debateId Debate to claim from
	/// @param positionProof Serialized UltraHonk position_note proof bytes
	/// @param positionPublicInputs Fixed array:
	///        [0] position_root           — Merkle root the proof was generated against
	///        [1] nullifier               — Unique spend tag for this claim
	///        [2] debate_id               — bytes32 debate identifier (must match debateId param)
	///        [3] winning_argument_index  — Argument index the prover claims won
	///        [4] claimed_weighted_amount — Trade weight the prover held (informational in Phase 2)
	function settlePrivatePosition(
		bytes32 debateId,
		bytes calldata positionProof,
		bytes32[5] calldata positionPublicInputs
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.RESOLVED) revert DebateNotResolved();

		// Position root must exist (governance must call updatePositionRoot after reveals)
		bytes32 storedRoot = positionRoot[debateId];
		if (storedRoot == bytes32(0)) revert PositionRootNotSet();

		// Proof's position_root must match the stored root
		if (positionPublicInputs[0] != storedRoot) revert InvalidPositionRoot();

		// Proof's debate_id must match this debate (domain separation)
		if (positionPublicInputs[2] != debateId) revert ActionDomainMismatch();

		// Proof's winning_argument_index must match the resolved winner
		if (uint256(positionPublicInputs[3]) != debate.winningArgumentIndex) revert NotWinningSide();

		// Nullifier must not already be spent
		bytes32 nullifier = positionPublicInputs[1];
		if (positionNullifiers[debateId][nullifier]) revert PositionNullifierSpent();

		// Verify ZK proof (most expensive operation — done last after all cheap checks pass)
		bytes32[] memory pubInputsDyn = new bytes32[](5);
		for (uint256 i = 0; i < 5; i++) {
			pubInputsDyn[i] = positionPublicInputs[i];
		}
		if (!positionNoteVerifier.verify(positionProof, pubInputsDyn)) {
			revert InvalidPositionNoteProof();
		}

		// Mark nullifier as spent (prevents replay)
		positionNullifiers[debateId][nullifier] = true;

		// Phase 2: attestation only. claimedWeight is recorded via event for analytics.
		// Phase 4 (Flow Encryption) will add proportional token settlement here.
		uint256 claimedWeight = uint256(positionPublicInputs[4]);

		emit PrivateSettlementClaimed(debateId, nullifier, claimedWeight);
	}

	// ============================================================================
	// AI Resolution Functions (Phase 3)
	// ============================================================================

	/// @notice Submit AI evaluation scores with M-of-N EIP-712 signatures
	/// @dev Permissionless: anyone can relay the signed evaluation bundle.
	///      Each signature is from a registered model signer attesting to the same scores.
	///      Quorum: ceil(2N/3) valid signatures required.
	/// @param debateId Debate to evaluate
	/// @param packedScores Array of packed scores (one per argument). Each uint256 packs
	///        5 dimension scores as uint16: [reasoning:16][accuracy:16][evidence:16][constructiveness:16][feasibility:16]
	/// @param deadline Signature expiration timestamp
	/// @param signatures Array of EIP-712 signatures from registered model signers
	function submitAIEvaluation(
		bytes32 debateId,
		uint256[] calldata packedScores,
		uint256 deadline,
		bytes[] calldata signatures
	) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.deadline) revert DebateStillActive();
		if (debate.aiScoresSubmitted) revert AIScoresAlreadySubmitted();
		if (debate.argumentCount == 0) revert NoArgumentsSubmitted();
		if (debate.uniqueParticipants < minParticipants) revert InsufficientParticipation();
		if (packedScores.length != debate.argumentCount) revert ArgumentNotFound();
		if (block.timestamp > deadline) revert SignatureExpired();

		// Verify M-of-N signatures
		uint256 nonce = aiEvalNonce[debateId];
		bytes32 structHash = keccak256(
			abi.encode(
				AI_EVALUATION_TYPEHASH,
				debateId,
				keccak256(abi.encodePacked(packedScores)),
				nonce,
				deadline
			)
		);
		bytes32 digest = keccak256(
			abi.encodePacked("\x19\x01", AI_EVAL_DOMAIN_SEPARATOR, structHash)
		);

		uint256 validSigs = _countValidSignatures(digest, signatures);
		uint256 required = aiRegistry.quorum();
		if (validSigs < required) revert InsufficientSignatures();

		// Validate all packed scores have dimensions <= 10000 (fast-fail before storage)
		for (uint256 i = 0; i < packedScores.length; i++) {
			uint256 packed = packedScores[i];
			if (uint16(packed) > 10000 ||
				uint16(packed >> 16) > 10000 ||
				uint16(packed >> 32) > 10000 ||
				uint16(packed >> 48) > 10000 ||
				uint16(packed >> 64) > 10000) {
				revert InvalidAIScore();
			}
		}

		// Store packed scores
		for (uint256 i = 0; i < packedScores.length; i++) {
			aiArgumentScores[debateId][i] = packedScores[i];
		}

		debate.aiScoresSubmitted = true;
		debate.status = DebateStatus.RESOLVING;
		aiSignatureCount[debateId] = validSigs;
		aiEvalNonce[debateId] = nonce + 1;

		emit AIEvaluationSubmitted(debateId, validSigs, nonce);
	}

	/// @notice Finalize resolution using AI scores + community signal
	/// @dev Can only be called after AI scores are submitted (status == RESOLVING).
	///      Computes: final = α × ai_score + (1 - α) × normalize(community_score)
	/// @param debateId Debate to resolve
	function resolveDebateWithAI(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.RESOLVING) revert DebateNotResolving();
		if (debate.uniqueParticipants < minParticipants) revert InsufficientParticipation();

		uint256 alpha = aiRegistry.aiWeight();
		uint256 argCount = debate.argumentCount;

		// Find max community score for normalization
		uint256 maxCommunity = 0;
		for (uint256 i = 0; i < argCount; i++) {
			uint256 cs = arguments[debateId][i].weightedScore;
			if (cs > maxCommunity) maxCommunity = cs;
		}

		// Compute blended final score per argument, find winner
		uint256 bestIndex = 0;
		uint256 bestFinal = 0;

		for (uint256 i = 0; i < argCount; i++) {
			uint256 aiScore = LMSRMath.computeWeightedAIScore(aiArgumentScores[debateId][i]);
			uint256 communityScore = arguments[debateId][i].weightedScore;
			uint256 finalScore = LMSRMath.computeFinalScore(aiScore, communityScore, maxCommunity, alpha);

			if (finalScore > bestFinal) {
				bestFinal = finalScore;
				bestIndex = i;
			}
		}

		Argument storage winner = arguments[debateId][bestIndex];
		debate.winningArgumentIndex = bestIndex;
		debate.winningStance = winner.stance;
		debate.winningBodyHash = winner.bodyHash;
		debate.winningAmendmentHash = winner.amendmentHash;
		debate.status = DebateStatus.RESOLVED;
		debate.resolutionMethod = 1; // ai_community

		uint256 winnerAI = LMSRMath.computeWeightedAIScore(aiArgumentScores[debateId][bestIndex]);
		uint256 winnerCommunity = arguments[debateId][bestIndex].weightedScore;

		emit DebateResolvedWithAI(debateId, bestIndex, winnerAI, winnerCommunity, bestFinal, 1);
	}

	/// @notice Escalate to governance when AI consensus is insufficient
	/// @dev Called by governance when the off-chain service detects that < M models converged.
	///      Transitions debate to AWAITING_GOVERNANCE and sets a resolution deadline.
	///      Restricted to governance to prevent premature bypass of AI resolution flow.
	/// @param debateId Debate to escalate
	function escalateToGovernance(bytes32 debateId) external onlyGovernance whenNotPaused {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp < debate.deadline) revert DebateStillActive();

		debate.status = DebateStatus.AWAITING_GOVERNANCE;
		debate.resolutionDeadline = block.timestamp + resolutionExtension;
		emit DebateEscalated(debateId);
	}

	/// @notice Governance resolves a debate when AI consensus fails
	/// @param debateId Debate to resolve
	/// @param winningIndex Index of the winning argument
	/// @param justification Hash of the governance justification text (stored off-chain)
	function submitGovernanceResolution(
		bytes32 debateId,
		uint256 winningIndex,
		bytes32 justification
	) external onlyGovernance whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.AWAITING_GOVERNANCE) revert DebateNotAwaitingGovernance();
		/// @dev SC-5: Governance must wait until resolutionDeadline (snapshotted in escalateToGovernance)
		///      before resolving. Prevents instant governance resolution after escalation.
		if (block.timestamp < debate.resolutionDeadline) revert ResolutionDeadlineNotReached();
		if (winningIndex >= debate.argumentCount) revert ArgumentNotFound();

		Argument storage winner = arguments[debateId][winningIndex];
		debate.winningArgumentIndex = winningIndex;
		debate.winningStance = winner.stance;
		debate.winningBodyHash = winner.bodyHash;
		debate.winningAmendmentHash = winner.amendmentHash;
		debate.status = DebateStatus.UNDER_APPEAL;
		debate.resolutionMethod = 2; // governance_override
		debate.appealDeadline = block.timestamp + APPEAL_WINDOW;
		debate.governanceJustification = justification;

		emit GovernanceResolutionSubmitted(debateId, winningIndex, justification);
	}

	/// @notice Appeal a governance resolution by staking 2× proposer bond
	/// @param debateId Debate to appeal
	function appealResolution(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.UNDER_APPEAL) revert DebateNotUnderAppeal();
		if (block.timestamp >= debate.appealDeadline) revert AppealWindowExpired();
		if (appealBonds[debateId][msg.sender] != 0) revert AlreadyAppealed();

		uint256 requiredBond = debate.proposerBond * APPEAL_BOND_MULTIPLIER;
		if (requiredBond < MIN_PROPOSER_BOND * APPEAL_BOND_MULTIPLIER) {
			requiredBond = MIN_PROPOSER_BOND * APPEAL_BOND_MULTIPLIER;
		}

		appealBonds[debateId][msg.sender] = requiredBond;
		hasAppeal[debateId] = true;

		// Pull exact appeal bond (no fee on appeals)
		_pullExact(msg.sender, requiredBond);

		emit ResolutionAppealed(debateId, msg.sender, requiredBond);
	}

	/// @notice Finalize resolution after appeal window expires
	/// @dev If no appeal was filed, governance resolution stands and debate becomes RESOLVED.
	///      If an appeal was filed, the governance resolution still stands (Phase 1 behavior).
	///      In both cases the debate transitions to RESOLVED and appealFinalized is set to true,
	///      enabling governance to sweep any forfeited appeal bonds via sweepAppealBond.
	///      Future: Phase 3+ Kleros/UMA integration will introduce genuine appeal adjudication
	///      where upheld appeals refund the bond; defeated appeals forfeit it.
	/// @param debateId Debate to finalize
	function finalizeAppeal(bytes32 debateId) external whenNotPaused nonReentrant {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.UNDER_APPEAL) revert DebateNotUnderAppeal();
		if (block.timestamp < debate.appealDeadline) revert AppealWindowActive();

		// Mark finalized before status change so sweepAppealBond can check it
		appealFinalized[debateId] = true;

		if (!hasAppeal[debateId]) {
			// No appeal → governance resolution stands unchallenged
			debate.status = DebateStatus.RESOLVED;
			emit AppealFinalized(debateId, true);
		} else {
			// Appeal filed but not adjudicated (Phase 1): governance resolution stands.
			// Appeal bonds are forfeited; governance sweeps them via sweepAppealBond.
			// Future: community vote / Kleros integration would adjudicate here.
			debate.status = DebateStatus.RESOLVED;
			emit AppealFinalized(debateId, false);
		}
	}

	/// @notice Sweep a forfeited appeal bond to the governance treasury (F9 fix)
	/// @dev Appeal bonds are forfeited when an appeal is filed but not upheld (Phase 1:
	///      all filed appeals currently fail because community adjudication is not yet
	///      implemented). Only callable after finalizeAppeal has been called and only
	///      if the appealer's bond has not already been swept.
	///      Governance must call this separately for each appealer — the contract does not
	///      auto-iterate over all appealers because the appealer set is unbounded.
	/// @param debateId Debate whose appeal bond to sweep
	/// @param appealer Address of the appealer whose forfeited bond to sweep
	function sweepAppealBond(bytes32 debateId, address appealer) external onlyGovernance nonReentrant {
		if (debates[debateId].deadline == 0) revert DebateNotFound();
		if (!appealFinalized[debateId]) revert AppealNotFinalized();

		uint256 bond = appealBonds[debateId][appealer];
		if (bond == 0) revert AppealBondAlreadySwept();

		// Zero out before transfer (CEI pattern)
		appealBonds[debateId][appealer] = 0;

		_send(governance, bond);

		emit AppealBondForfeited(debateId, appealer, bond);
	}

	/// @notice Set resolution extension duration (governance only, bounded 1 day – 90 days)
	/// @param newDuration New duration in seconds
	function setResolutionExtension(uint256 newDuration) external onlyGovernance {
		if (newDuration < 1 days || newDuration > 90 days) revert ResolutionExtensionOutOfRange();
		uint256 old = resolutionExtension;
		resolutionExtension = newDuration;
		emit ResolutionExtensionUpdated(old, newDuration);
	}

	/// @notice Set minimum unique participants required for resolution (governance only)
	/// @dev SC-6: Only allow lowering. Raising would retroactively cancel active debates
	///      that already passed their participation deadline with the old threshold.
	///      On mainnet (external LMSR library), switch to two-phase with timelock.
	/// @param newMin New minimum (must be >= 1, <= current minParticipants)
	function setMinParticipants(uint256 newMin) external onlyGovernance {
		if (newMin == 0 || newMin > minParticipants) revert MinParticipantsOutOfRange();
		uint256 old = minParticipants;
		minParticipants = newMin;
		emit MinParticipantsUpdated(old, newMin);
	}

	/// @notice Sweep accumulated protocol fees to a destination address (governance only)
	/// @param to Destination for swept fees
	function sweepFees(address to) external onlyGovernance nonReentrant {
		if (to == address(0)) revert ZeroAddress();
		uint256 amount = accumulatedFees;
		if (amount == 0) revert NoFeesToSweep();
		accumulatedFees = 0;
		_send(to, amount);
		emit FeeSwept(to, amount);
	}

	/// @notice Update protocol fee basis points (governance only)
	/// @param newFeeBps New fee in basis points (must be <= MAX_FEE_BPS)
	function setProtocolFee(uint256 newFeeBps) external onlyGovernance {
		if (newFeeBps > MAX_FEE_BPS) revert FeeExceedsCap();
		emit ProtocolFeeUpdated(protocolFeeBps, newFeeBps);
		protocolFeeBps = newFeeBps;
	}

	// ============================================================================
	// View Functions
	// ============================================================================

	/// @notice Get the LMSR price for a specific argument (0 to 1e18 scale)
	/// @param debateId Debate identifier
	/// @param argumentIndex Argument to price
	/// @return price Price as SD59x18 (between 0 and 1e18)
	function getPrice(
		bytes32 debateId,
		uint256 argumentIndex
	) external view returns (SD59x18 price) {
		Debate storage debate = debates[debateId];
		if (debate.argumentCount == 0) return SD_ZERO;
		if (argumentIndex >= debate.argumentCount) return SD_ZERO;

		SD59x18 b = lmsrLiquidity[debateId];
		if (b == SD_ZERO) return SD_ZERO;

		SD59x18[] memory quantities = _loadQuantities(debateId, debate.argumentCount);
		price = LMSRMath.computePrice(quantities, b, argumentIndex);
	}

	/// @notice Get LMSR prices for all arguments in a debate
	/// @param debateId Debate identifier
	/// @return prices Array of prices (SD59x18, each between 0 and 1e18, sum to ~1e18)
	function getPrices(bytes32 debateId) external view returns (SD59x18[] memory prices) {
		Debate storage debate = debates[debateId];
		uint256 count = debate.argumentCount;
		prices = new SD59x18[](count);
		if (count == 0) return prices;

		SD59x18 b = lmsrLiquidity[debateId];
		if (b == SD_ZERO) return prices;

		SD59x18[] memory quantities = _loadQuantities(debateId, count);
		prices = LMSRMath.computePrices(quantities, b);
	}

	/// @notice Get the current epoch phase for a debate
	/// @param debateId Debate identifier
	/// @return epoch Current epoch number
	/// @return isCommit Whether in commit phase
	/// @return isReveal Whether in reveal phase
	/// @return secondsRemaining Seconds until phase ends
	function getEpochPhase(bytes32 debateId)
		external
		view
		returns (
			uint256 epoch,
			bool isCommit,
			bool isReveal,
			uint256 secondsRemaining
		)
	{
		epoch = currentEpoch[debateId];
		uint256 start = epochStartTime[debateId];
		if (start == 0) return (epoch, false, false, 0);

		uint256 elapsed = block.timestamp - start;
		uint256 halfEpoch = epochDuration / 2;

		if (elapsed < halfEpoch) {
			isCommit = true;
			secondsRemaining = halfEpoch - elapsed;
		} else if (elapsed < epochDuration) {
			isReveal = true;
			secondsRemaining = epochDuration - elapsed;
		}
		// else: epoch is executable, both false
	}

	/// @notice Get number of commitments in an epoch
	function getEpochCommitCount(
		bytes32 debateId,
		uint256 epoch
	) external view returns (uint256) {
		return _epochCommitments[debateId][epoch].length;
	}

	/// @notice Get number of reveals in an epoch
	function getEpochRevealCount(
		bytes32 debateId,
		uint256 epoch
	) external view returns (uint256) {
		return _epochReveals[debateId][epoch].length;
	}

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
	// Domain Derivation
	// ============================================================================

	/// @notice Derive a debate action domain from a base domain and proposition hash
	/// @param baseDomain Template's registered action domain
	/// @param propositionHash Hash of the debate proposition
	/// @return The debate-scoped action domain (BN254 field element)
	/// @dev Deterministic: same inputs always produce the same output.
	///      The "debate" string acts as a phase discriminator, preventing collision
	///      with future derivation schemes (e.g., "poll", "petition").
	function deriveDomain(
		bytes32 baseDomain,
		bytes32 propositionHash
	) internal pure returns (bytes32) {
		uint256 raw = uint256(keccak256(abi.encodePacked(baseDomain, "debate", propositionHash)));
		return bytes32(raw % BN254_MODULUS);
	}

	// ============================================================================
	// Internal Functions
	// ============================================================================

	/// @notice Core logic for submitArgument: validate debate state, verify proof, write storage.
	/// @dev Extracted from submitArgument so that publicInputs calldata mpos temporaries
	///      and Debate storage slot mpos temporaries never accumulate in the same Yul frame.
	///      Without this split, via_ir generates 21 simultaneous expr_mpos_* variables (limit=20).
	/// @return argumentIndex  Index of the newly created argument
	/// @return weight         sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier)
	/// @return engagementTier Engagement tier extracted from public inputs (for event emit)
	/// @return nullifier      Nullifier from publicInputs[26] (for event emit + audit trail)
	function _submitArgumentCore(
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
		bytes calldata signature,
		address beneficiary
	) internal returns (uint256 argumentIndex, uint256 weight, uint8 engagementTier, bytes32 nullifier) {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp >= debate.deadline - ARGUMENT_COOLDOWN) revert ArgumentWindowClosed();
		if (debate.argumentCount >= MAX_ARGUMENTS) revert TooManyArguments();

		// Verify three-tree proof (handles nullifier recording, authority check, etc.)
		districtGate.verifyThreeTreeProof(
			signer, proof, publicInputs, verifierDepth, deadline, signature
		);

		if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();

		uint256 engagementTierRaw = publicInputs[30];
		if (engagementTierRaw > 4) revert InvalidEngagementTier();
		engagementTier = uint8(engagementTierRaw);
		if (LMSRMath.tierMultiplier(engagementTier) == 0) revert InvalidEngagementTier();

		nullifier = bytes32(publicInputs[26]);
		argumentIndex = debate.argumentCount;

		weight = _writeArgumentAndStake(
			debateId, argumentIndex, stance, bodyHash, amendmentHash,
			stakeAmount, nullifier, engagementTier, beneficiary
		);

		debate.argumentCount++;
		debate.uniqueParticipants++;
		debate.totalStake += stakeAmount;
	}

	/// @notice Core logic for coSignArgument: validate debate state, verify proof, write storage.
	/// @dev Extracted from coSignArgument for the same via_ir mpos depth reason as _submitArgumentCore.
	/// @return weight         sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier)
	/// @return engagementTier Engagement tier extracted from public inputs (for event emit)
	function _coSignArgumentCore(
		bytes32 debateId,
		uint256 argumentIndex,
		uint256 stakeAmount,
		address signer,
		bytes calldata proof,
		uint256[31] calldata publicInputs,
		uint8 verifierDepth,
		uint256 deadline,
		bytes calldata signature,
		address beneficiary
	) internal returns (uint256 weight, uint8 engagementTier) {
		Debate storage debate = debates[debateId];
		if (debate.deadline == 0) revert DebateNotFound();
		if (debate.status != DebateStatus.ACTIVE) revert DebateNotActive();
		if (block.timestamp >= debate.deadline - ARGUMENT_COOLDOWN) revert ArgumentWindowClosed();
		if (argumentIndex >= debate.argumentCount) revert ArgumentNotFound();

		// Verify three-tree proof
		districtGate.verifyThreeTreeProof(
			signer, proof, publicInputs, verifierDepth, deadline, signature
		);

		if (bytes32(publicInputs[27]) != debate.actionDomain) revert ActionDomainMismatch();

		uint256 engagementTierRaw = publicInputs[30];
		if (engagementTierRaw > 4) revert InvalidEngagementTier();
		engagementTier = uint8(engagementTierRaw);
		if (LMSRMath.tierMultiplier(engagementTier) == 0) revert InvalidEngagementTier();

		bytes32 nullifier = bytes32(publicInputs[26]);

		weight = _writeCoSignStake(
			debateId, argumentIndex, stakeAmount, nullifier, engagementTier, beneficiary
		);

		debate.uniqueParticipants++;
		debate.totalStake += stakeAmount;
	}

	/// @notice Write a new argument and its initial stake record. Extracted to reduce Yul
	///         variable depth in submitArgument under via_ir (fixes stack-too-deep).
	/// @return weight  sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier)
	function _writeArgumentAndStake(
		bytes32 debateId,
		uint256 argumentIndex,
		Stance stance,
		bytes32 bodyHash,
		bytes32 amendmentHash,
		uint256 stakeAmount,
		bytes32 nullifier,
		uint8 engagementTier,
		address beneficiary
	) internal returns (uint256 weight) {
		weight = LMSRMath.sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier);

		Argument storage arg = arguments[debateId][argumentIndex];
		arg.stance = stance;
		arg.bodyHash = bodyHash;
		arg.amendmentHash = amendmentHash;
		arg.stakeAmount = stakeAmount;
		arg.engagementTier = engagementTier;
		arg.weightedScore = weight;

		argumentTotalStakes[debateId][argumentIndex] = stakeAmount;

		// Write stake record via storage pointer (field-by-field) rather than a struct literal.
		// A struct literal with 6 fields generates 6 simultaneous expr_mpos_* temporaries in
		// the Yul IR, pushing the total above the 20-variable limit under via_ir.
		// Individual field writes use fewer live mpos temporaries at once.
		if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
		StakeRecord storage rec = stakeRecords[debateId][nullifier];
		rec.argumentIndex = argumentIndex;
		rec.stakeAmount = stakeAmount;
		rec.engagementTier = engagementTier;
		rec.claimed = false;
		rec.submitter = msg.sender;
		rec.beneficiary = beneficiary;
	}

	/// @notice Write a co-sign stake record and update argument score. Extracted to reduce Yul
	///         variable depth in coSignArgument under via_ir (fixes stack-too-deep).
	/// @return weight  sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier)
	function _writeCoSignStake(
		bytes32 debateId,
		uint256 argumentIndex,
		uint256 stakeAmount,
		bytes32 nullifier,
		uint8 engagementTier,
		address beneficiary
	) internal returns (uint256 weight) {
		weight = LMSRMath.sqrt(stakeAmount) * LMSRMath.tierMultiplier(engagementTier);
		arguments[debateId][argumentIndex].weightedScore += weight;
		argumentTotalStakes[debateId][argumentIndex] += stakeAmount;

		// Write stake record via storage pointer (field-by-field) — see _writeArgumentAndStake.
		if (stakeRecords[debateId][nullifier].stakeAmount != 0) revert DuplicateNullifier();
		StakeRecord storage rec = stakeRecords[debateId][nullifier];
		rec.argumentIndex = argumentIndex;
		rec.stakeAmount = stakeAmount;
		rec.engagementTier = engagementTier;
		rec.claimed = false;
		rec.submitter = msg.sender;
		rec.beneficiary = beneficiary;
	}

	/// @notice Check if a debate is in the commit phase of its current epoch
	function _isCommitPhase(bytes32 debateId) internal view returns (bool) {
		uint256 start = epochStartTime[debateId];
		if (start == 0) return true; // First commit initializes epoch
		uint256 elapsed = block.timestamp - start;
		return elapsed < epochDuration / 2;
	}

	/// @notice Check if a specific epoch is in its reveal phase
	function _isRevealPhase(bytes32 debateId, uint256 epoch) internal view returns (bool) {
		if (epoch != currentEpoch[debateId]) return false;
		uint256 start = epochStartTime[debateId];
		if (start == 0) return false;
		uint256 elapsed = block.timestamp - start;
		return elapsed >= epochDuration / 2 && elapsed < epochDuration;
	}

	/// @notice Check if an epoch's reveal window has closed and it can be executed
	function _isEpochExecutable(bytes32 debateId, uint256 epoch) internal view returns (bool) {
		if (epoch > currentEpoch[debateId]) return false;
		if (epoch < currentEpoch[debateId]) return true; // Past epoch, always executable
		uint256 start = epochStartTime[debateId];
		if (start == 0) return false;
		return (block.timestamp - start) >= epochDuration;
	}

	/// @notice Load LMSR quantities from storage into a memory array
	function _loadQuantities(bytes32 debateId, uint256 count) internal view returns (SD59x18[] memory quantities) {
		quantities = new SD59x18[](count);
		for (uint256 i = 0; i < count; i++) {
			quantities[i] = lmsrQuantities[debateId][i];
		}
	}

	// ============================================================================
	// AI Resolution Internals
	// ============================================================================

	/// @notice Count valid unique EIP-712 signatures from registered model signers
	/// @param digest EIP-712 digest to verify against
	/// @param signatures Array of signatures to validate
	/// @return count Number of valid unique registered signers
	function _countValidSignatures(
		bytes32 digest,
		bytes[] calldata signatures
	) internal view returns (uint256 count) {
		// Track seen signers to prevent duplicate counting
		address[] memory seen = new address[](signatures.length);

		for (uint256 i = 0; i < signatures.length; i++) {
			if (signatures[i].length != 65) continue;

			address recovered = ECDSA.recover(digest, signatures[i]);
			if (recovered == address(0)) continue;
			if (!aiRegistry.isRegistered(recovered)) continue;

			// Check for duplicate
			bool duplicate = false;
			for (uint256 j = 0; j < count; j++) {
				if (seen[j] == recovered) {
					duplicate = true;
					break;
				}
			}
			if (duplicate) continue;

			seen[count] = recovered;
			count++;
		}
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

	function registerDerivedDomain(bytes32 baseDomain, bytes32 derivedDomain) external;
}
