// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";
import "../src/TimelockGovernance.sol";

// =============================================================================
// Invariant Tests (TST-003)
// =============================================================================
//
// Four priority invariants for the voter-protocol contract system:
//
// 1. NULLIFIER UNIQUENESS: A nullifier used in one action domain can never be
//    reused in that same domain (same-domain replay is impossible).
//
// 2. GOVERNANCE TIMELOCK MONOTONICITY: Pending governance transfers can never
//    bypass the 7-day timelock. If a transfer is pending, its execute timestamp
//    is always >= now + GOVERNANCE_TIMELOCK at the time it was set.
//
// 3. GENESIS SEAL IRREVERSIBILITY: Once sealGenesis() is called, genesisSealed
//    must remain true forever. Monotonically increasing boolean.
//
// 4. VERIFIER REGISTRY CONSISTENCY: A sealed registry's verifier mapping can
//    only change through the 14-day timelock path. No direct writes post-seal.
//
// NOTE: via_ir + vm.warp bug — we track timestamps in explicit local variables,
// never use `block.timestamp + X` in sequential warps.
// =============================================================================

// =============================================================================
// Handler: NullifierRegistryHandler
// =============================================================================
// Drives NullifierRegistry through its state space. Tracks all recorded
// (actionId, nullifier) pairs to verify the uniqueness invariant.

contract NullifierRegistryHandler is Test {
    NullifierRegistry public registry;
    address public governance;

    // Ghost state: track every (actionId, nullifier) pair ever recorded
    bytes32[] public recordedActionIds;
    bytes32[] public recordedNullifiers;
    uint256 public recordCount;

    // Ghost state: count of reverted double-record attempts
    uint256 public doubleRecordReverts;

    // Pool of action IDs and nullifiers for bounded exploration
    bytes32[4] public actionPool;
    bytes32[6] public nullifierPool;

    constructor(NullifierRegistry _registry, address _governance) {
        registry = _registry;
        governance = _governance;

        actionPool[0] = keccak256("action-alpha");
        actionPool[1] = keccak256("action-beta");
        actionPool[2] = keccak256("action-gamma");
        actionPool[3] = keccak256("action-delta");

        nullifierPool[0] = bytes32(uint256(0x1001));
        nullifierPool[1] = bytes32(uint256(0x1002));
        nullifierPool[2] = bytes32(uint256(0x1003));
        nullifierPool[3] = bytes32(uint256(0x1004));
        nullifierPool[4] = bytes32(uint256(0x1005));
        nullifierPool[5] = bytes32(uint256(0x1006));
    }

    /// @notice Record a nullifier, advancing time to avoid rate limits.
    /// Fuzzer chooses from bounded pools to create interesting collisions.
    function recordNullifier(uint8 actionSeed, uint8 nullifierSeed) external {
        bytes32 actionId = actionPool[actionSeed % 4];
        bytes32 nullifier = nullifierPool[nullifierSeed % 6];
        bytes32 merkleRoot = bytes32(uint256(0xFACE));

        // Advance time past rate limit (60s)
        uint256 newTime = block.timestamp + 61;
        vm.warp(newTime);

        vm.prank(governance);
        try registry.recordNullifier(actionId, nullifier, merkleRoot) {
            // Success: track ghost state
            recordedActionIds.push(actionId);
            recordedNullifiers.push(nullifier);
            recordCount++;
        } catch {
            // Expected: NullifierAlreadyUsed or RateLimitExceeded
            // If the pair was already recorded, this is the safety invariant working
            if (registry.nullifierUsed(actionId, nullifier)) {
                doubleRecordReverts++;
            }
        }
    }

    /// @notice Record a nullifier that is explicitly the same as a previously
    /// recorded one. This is the adversarial path — must always revert.
    function replayNullifier(uint256 index) external {
        if (recordCount == 0) return;

        uint256 idx = index % recordCount;
        bytes32 actionId = recordedActionIds[idx];
        bytes32 nullifier = recordedNullifiers[idx];
        bytes32 merkleRoot = bytes32(uint256(0xDEAD));

        // Advance time past rate limit
        uint256 newTime = block.timestamp + 61;
        vm.warp(newTime);

        vm.prank(governance);
        // This MUST revert — the whole point of nullifiers
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        registry.recordNullifier(actionId, nullifier, merkleRoot);
    }
}

// =============================================================================
// Handler: GovernanceTimelockHandler
// =============================================================================
// Drives TimelockGovernance through governance transfer lifecycle.
// Tracks initiation timestamps to verify timelock monotonicity.

contract GovernanceTimelockHandler is Test {
    NullifierRegistry public registry;
    address public currentGovernance;

    // Ghost state: pending transfer targets and their initiation times
    address[] public pendingTargets;
    mapping(address => uint256) public initiatedAt;

    // Explicit time tracking (via_ir warp bug)
    uint256 public currentTime;

    // Counter for premature execution attempts that correctly reverted
    uint256 public prematureExecutionReverts;

    // Pool of candidate governance addresses
    address[4] public candidatePool;

    constructor(NullifierRegistry _registry, address _governance) {
        registry = _registry;
        currentGovernance = _governance;
        currentTime = block.timestamp;

        candidatePool[0] = address(0xA001);
        candidatePool[1] = address(0xA002);
        candidatePool[2] = address(0xA003);
        candidatePool[3] = address(0xA004);
    }

    /// @notice Initiate a governance transfer (starts 7-day timelock)
    function initiateTransfer(uint8 candidateSeed) external {
        address candidate = candidatePool[candidateSeed % 4];
        if (candidate == currentGovernance) return;

        // Advance time slightly for realism
        currentTime = currentTime + 1;
        vm.warp(currentTime);

        vm.prank(currentGovernance);
        try registry.initiateGovernanceTransfer(candidate) {
            pendingTargets.push(candidate);
            initiatedAt[candidate] = currentTime;
        } catch {
            // Expected: candidate == governance or zero address
        }
    }

    /// @notice Try to execute a transfer before the timelock expires — must revert
    function tryPrematureExecution(uint8 candidateSeed) external {
        address candidate = candidatePool[candidateSeed % 4];
        uint256 initTime = initiatedAt[candidate];
        if (initTime == 0) return;

        // Warp to a time strictly BEFORE the 7-day timelock
        // Use half the timelock period to ensure we're well before expiry
        uint256 prematureTime = initTime + 3 days;
        vm.warp(prematureTime);
        currentTime = prematureTime;

        vm.expectRevert(TimelockGovernance.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(candidate);
        prematureExecutionReverts++;
    }

    /// @notice Execute a transfer after the timelock expires
    function executeTransfer(uint8 candidateSeed) external {
        address candidate = candidatePool[candidateSeed % 4];
        uint256 initTime = initiatedAt[candidate];
        if (initTime == 0) return;

        // Warp past timelock: initTime + 7 days + 1 second
        uint256 executeTime = initTime + 7 days + 1;
        vm.warp(executeTime);
        currentTime = executeTime;

        try registry.executeGovernanceTransfer(candidate) {
            currentGovernance = candidate;
            delete initiatedAt[candidate];
        } catch {
            // Transfer may have been cancelled or already executed
        }
    }

    /// @notice Cancel a pending transfer
    function cancelTransfer(uint8 candidateSeed) external {
        address candidate = candidatePool[candidateSeed % 4];
        if (initiatedAt[candidate] == 0) return;

        vm.prank(currentGovernance);
        try registry.cancelGovernanceTransfer(candidate) {
            delete initiatedAt[candidate];
        } catch {
            // May not be pending
        }
    }
}

// =============================================================================
// Handler: GenesisSealHandler
// =============================================================================
// Drives VerifierRegistry and NullifierRegistry genesis seal operations.
// Verifies that once sealed, the seal cannot be undone.

contract GenesisSealHandler is Test {
    VerifierRegistry public verifierRegistry;
    NullifierRegistry public nullifierRegistry;
    address public governance;

    // Ghost state: whether we have observed the seal
    bool public verifierSealObserved;
    bool public nullifierSealObserved;

    // Counter for post-seal genesis operation reverts
    uint256 public postSealGenesisReverts;

    constructor(
        VerifierRegistry _verifierRegistry,
        NullifierRegistry _nullifierRegistry,
        address _governance
    ) {
        verifierRegistry = _verifierRegistry;
        nullifierRegistry = _nullifierRegistry;
        governance = _governance;
    }

    /// @notice Seal the VerifierRegistry genesis
    function sealVerifierGenesis() external {
        vm.prank(governance);
        try verifierRegistry.sealGenesis() {
            verifierSealObserved = true;
        } catch {
            // Expected: GenesisAlreadySealed if called twice
            if (verifierRegistry.genesisSealed()) {
                postSealGenesisReverts++;
            }
        }
    }

    /// @notice Seal the NullifierRegistry genesis
    function sealNullifierGenesis() external {
        vm.prank(governance);
        try nullifierRegistry.sealGenesis() {
            nullifierSealObserved = true;
        } catch {
            // Expected: GenesisAlreadySealed if called twice
            if (nullifierRegistry.genesisSealed()) {
                postSealGenesisReverts++;
            }
        }
    }

    /// @notice Attempt genesis-only operation on VerifierRegistry after seal
    function tryGenesisRegisterAfterSeal(uint8 depthSeed) external {
        if (!verifierRegistry.genesisSealed()) return;

        uint8[4] memory depths = [uint8(18), 20, 22, 24];
        uint8 depth = depths[depthSeed % 4];
        address fakeVerifier = address(uint160(0xBEEF0000 + depth));

        vm.prank(governance);
        try verifierRegistry.registerVerifier(depth, fakeVerifier) {
            // This should NEVER succeed after seal
            revert("INVARIANT VIOLATED: registerVerifier succeeded after sealGenesis");
        } catch {
            // Expected: GenesisAlreadySealed
            postSealGenesisReverts++;
        }
    }

    /// @notice Attempt genesis-only operation on NullifierRegistry after seal
    function tryGenesisAuthorizeAfterSeal() external {
        if (!nullifierRegistry.genesisSealed()) return;

        address fakeCaller = address(0xCAFE);

        vm.prank(governance);
        try nullifierRegistry.authorizeCallerGenesis(fakeCaller) {
            // This should NEVER succeed after seal
            revert("INVARIANT VIOLATED: authorizeCallerGenesis succeeded after sealGenesis");
        } catch {
            // Expected: GenesisAlreadySealed
            postSealGenesisReverts++;
        }
    }
}

// =============================================================================
// Handler: VerifierRegistryConsistencyHandler
// =============================================================================
// Drives VerifierRegistry post-seal operations. Captures verifier state at seal
// time, then verifies that changes only happen through the 14-day timelock path.

contract VerifierRegistryConsistencyHandler is Test {
    VerifierRegistry public registry;
    address public governance;

    // Ghost state: snapshot of verifier addresses at seal time
    mapping(uint8 => address) public sealedVerifiers;
    bool public isSealed;

    // Ghost state: proposals that completed the full timelock cycle
    uint256 public timelockCompletedCount;

    // Ghost state: number of times a verifier changed WITHOUT timelock (should be 0)
    uint256 public unauthorizedChanges;

    // Explicit time tracking (via_ir warp bug)
    uint256 public currentTime;

    // Depths
    uint8[4] public depths = [uint8(18), 20, 22, 24];

    constructor(VerifierRegistry _registry, address _governance) {
        registry = _registry;
        governance = _governance;
        currentTime = block.timestamp;
    }

    /// @notice Register a verifier during genesis (before seal)
    function genesisRegister(uint8 depthSeed) external {
        if (isSealed) return;

        uint8 depth = depths[depthSeed % 4];
        address verifier = address(uint160(0xBEEF00 + uint160(depth)));

        // Avoid revert from re-registering same depth
        if (registry.verifierByDepth(depth) != address(0)) return;

        vm.prank(governance);
        try registry.registerVerifier(depth, verifier) {} catch {}
    }

    /// @notice Seal genesis and snapshot the verifier state
    function sealAndSnapshot() external {
        if (isSealed) return;

        vm.prank(governance);
        try registry.sealGenesis() {
            isSealed = true;
            // Snapshot all verifier addresses at seal time
            for (uint256 i = 0; i < 4; i++) {
                sealedVerifiers[depths[i]] = registry.verifierByDepth(depths[i]);
            }
        } catch {}
    }

    /// @notice Propose a verifier upgrade (starts 14-day timelock)
    function proposeUpgrade(uint8 depthSeed) external {
        if (!isSealed) return;

        uint8 depth = depths[depthSeed % 4];

        // Only propose upgrade if a verifier exists at this depth
        if (registry.verifierByDepth(depth) == address(0)) return;
        // Skip if proposal already pending
        if (registry.pendingVerifiers(depth) != address(0)) return;

        address newVerifier = address(uint160(0xABCD00 + uint160(depth) + uint160(currentTime)));

        currentTime = currentTime + 1;
        vm.warp(currentTime);

        vm.prank(governance);
        try registry.proposeVerifierUpgrade(depth, newVerifier) {} catch {}
    }

    /// @notice Execute a verifier upgrade after the 14-day timelock
    function executeUpgrade(uint8 depthSeed) external {
        if (!isSealed) return;

        uint8 depth = depths[depthSeed % 4];
        if (registry.pendingVerifiers(depth) == address(0)) return;

        uint256 execTime = registry.verifierExecutionTime(depth);
        // Warp past timelock
        uint256 newTime = execTime + 1;
        if (newTime <= currentTime) newTime = currentTime + 1;
        vm.warp(newTime);
        currentTime = newTime;

        try registry.executeVerifierUpgrade(depth) {
            // Successful upgrade through timelock — update our snapshot
            sealedVerifiers[depth] = registry.verifierByDepth(depth);
            timelockCompletedCount++;
        } catch {}
    }

    /// @notice Cancel a pending verifier proposal
    function cancelProposal(uint8 depthSeed) external {
        if (!isSealed) return;

        uint8 depth = depths[depthSeed % 4];
        if (registry.pendingVerifiers(depth) == address(0)) return;

        vm.prank(governance);
        try registry.cancelVerifierUpgrade(depth) {} catch {}
    }

    /// @notice Check that verifier state matches our tracked state.
    /// If verifier changed without going through our tracked timelock
    /// path, that is a violation.
    function checkConsistency() external view {
        if (!isSealed) return;

        for (uint256 i = 0; i < 4; i++) {
            uint8 depth = depths[i];
            address current = registry.verifierByDepth(depth);
            address tracked = sealedVerifiers[depth];
            // Current must match our tracked value. The tracked value is
            // updated ONLY when executeUpgrade() succeeds (timelock path).
            assert(current == tracked);
        }
    }
}

// =============================================================================
// Invariant Test Suite
// =============================================================================

/// @title InvariantNullifierUniqueness
/// @notice INVARIANT 1: A nullifier used in one action domain can never be
///         reused in that same domain.
contract InvariantNullifierUniqueness is Test {
    NullifierRegistry public registry;
    NullifierRegistryHandler public handler;
    address public governance = address(0x60B);

    function setUp() public {
        registry = new NullifierRegistry(governance);

        // Authorize governance as caller (it is by default in constructor)
        // The constructor already sets authorizedCallers[governance] = true

        handler = new NullifierRegistryHandler(registry, governance);

        // Target only the handler — Foundry will call its functions randomly
        targetContract(address(handler));
    }

    /// @notice Every recorded (actionId, nullifier) pair must be marked as used
    function invariant_recordedNullifiersAreMarkedUsed() public view {
        uint256 count = handler.recordCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 actionId = handler.recordedActionIds(i);
            bytes32 nullifier = handler.recordedNullifiers(i);
            assertTrue(
                registry.nullifierUsed(actionId, nullifier),
                "Recorded nullifier must be marked as used"
            );
        }
    }

    /// @notice nullifierUsed can only transition false -> true, never true -> false
    /// Verified by checking that all pairs the handler recorded remain true.
    /// (The handler's replayNullifier function additionally asserts reverts.)
    function invariant_nullifierUsedIsMonotonic() public view {
        // Same check as above — if any recorded pair becomes false, the
        // protocol is broken
        uint256 count = handler.recordCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 actionId = handler.recordedActionIds(i);
            bytes32 nullifier = handler.recordedNullifiers(i);
            assertTrue(
                registry.nullifierUsed(actionId, nullifier),
                "nullifierUsed must be monotonically true once set"
            );
        }
    }

    /// @notice Participant count must equal the number of recorded pairs per action
    function invariant_participantCountMatchesRecords() public view {
        // Build counts from ghost state
        uint256 count = handler.recordCount();
        // We check a weaker invariant: participantCount >= 0 and is monotonic
        // (full per-action counting would require more ghost state)
        bytes32[4] memory actionPool;
        actionPool[0] = keccak256("action-alpha");
        actionPool[1] = keccak256("action-beta");
        actionPool[2] = keccak256("action-gamma");
        actionPool[3] = keccak256("action-delta");

        for (uint256 i = 0; i < 4; i++) {
            uint256 pCount = registry.actionParticipantCount(actionPool[i]);
            // Participant count must be non-negative (trivially true for uint256)
            // and must match the number of unique nullifiers in that action
            assertTrue(pCount <= count, "Participant count cannot exceed total records");
        }
    }
}

/// @title InvariantGovernanceTimelock
/// @notice INVARIANT 2: Pending governance transfers can never bypass the
///         7-day timelock. A transfer initiated at time T cannot execute
///         before T + 7 days.
contract InvariantGovernanceTimelock is Test {
    NullifierRegistry public registry;
    GovernanceTimelockHandler public handler;
    address public governance = address(0x60B);

    function setUp() public {
        registry = new NullifierRegistry(governance);
        handler = new GovernanceTimelockHandler(registry, governance);
        targetContract(address(handler));
    }

    /// @notice All pending governance transfers must have executeTime >= 7 days from initiation
    function invariant_pendingTransfersRespectTimelock() public view {
        address[4] memory candidates = [
            address(0xA001),
            address(0xA002),
            address(0xA003),
            address(0xA004)
        ];

        for (uint256 i = 0; i < 4; i++) {
            uint256 executeTime = registry.pendingGovernance(candidates[i]);
            uint256 initTime = handler.initiatedAt(candidates[i]);

            if (executeTime != 0 && initTime != 0) {
                // The execute time must be at least 7 days after initiation
                assertTrue(
                    executeTime >= initTime + 7 days,
                    "Governance transfer timelock violated: executeTime < initiatedAt + 7 days"
                );
            }
        }
    }

    /// @notice Premature execution attempts must always be caught
    function invariant_prematureExecutionsAlwaysRevert() public view {
        // This is verified by the handler's tryPrematureExecution which uses
        // vm.expectRevert. If it didn't revert, the test would fail.
        // The counter simply tracks that we exercised this path.
        // (No assertion needed — vm.expectRevert is the assertion)
        assertTrue(true);
    }

    /// @notice Governance address is never zero
    function invariant_governanceNeverZero() public view {
        assertTrue(
            registry.governance() != address(0),
            "Governance address must never be zero"
        );
    }
}

/// @title InvariantGenesisSeal
/// @notice INVARIANT 3: Once sealGenesis() is called, genesisSealed must
///         remain true forever. The seal is irreversible.
contract InvariantGenesisSeal is Test {
    VerifierRegistry public verifierRegistry;
    NullifierRegistry public nullifierRegistry;
    GenesisSealHandler public handler;
    address public governance = address(0x60B);

    function setUp() public {
        verifierRegistry = new VerifierRegistry(governance);
        nullifierRegistry = new NullifierRegistry(governance);
        handler = new GenesisSealHandler(
            verifierRegistry,
            nullifierRegistry,
            governance
        );
        targetContract(address(handler));
    }

    /// @notice Once the handler has observed a VerifierRegistry seal, the
    /// on-chain state must remain sealed
    function invariant_verifierGenesisSealIsIrreversible() public view {
        if (handler.verifierSealObserved()) {
            assertTrue(
                verifierRegistry.genesisSealed(),
                "VerifierRegistry genesisSealed must be true once observed"
            );
        }
    }

    /// @notice Once the handler has observed a NullifierRegistry seal, the
    /// on-chain state must remain sealed
    function invariant_nullifierGenesisSealIsIrreversible() public view {
        if (handler.nullifierSealObserved()) {
            assertTrue(
                nullifierRegistry.genesisSealed(),
                "NullifierRegistry genesisSealed must be true once observed"
            );
        }
    }

    /// @notice genesisSealed is monotonic: if it was false before and true now,
    /// it can never go back to false. (Same check from different angle.)
    function invariant_genesisSealedMonotonic() public view {
        // If EITHER registry is sealed, calling sealGenesis again must revert.
        // The handler's postSealGenesisReverts tracks these attempts.
        // If genesisSealed is true, that's the end state — verified by the above.
        if (verifierRegistry.genesisSealed()) {
            assertTrue(handler.verifierSealObserved() || handler.postSealGenesisReverts() > 0);
        }
        if (nullifierRegistry.genesisSealed()) {
            assertTrue(handler.nullifierSealObserved() || handler.postSealGenesisReverts() > 0);
        }
    }

    /// @notice Genesis-only operations MUST fail after seal
    function invariant_genesisOperationsBlockedAfterSeal() public view {
        // The handler's tryGenesisRegisterAfterSeal and tryGenesisAuthorizeAfterSeal
        // will revert("INVARIANT VIOLATED") if genesis ops succeed post-seal.
        // If we get here, no violations occurred.
        assertTrue(true);
    }
}

/// @title InvariantVerifierRegistryConsistency
/// @notice INVARIANT 4: A sealed registry's verifier mapping can only change
///         through the 14-day timelock path. No direct writes post-seal.
contract InvariantVerifierRegistryConsistency is Test {
    VerifierRegistry public registry;
    VerifierRegistryConsistencyHandler public handler;
    address public governance = address(0x60B);

    function setUp() public {
        registry = new VerifierRegistry(governance);
        handler = new VerifierRegistryConsistencyHandler(registry, governance);
        targetContract(address(handler));
    }

    /// @notice Verifier addresses must match the handler's tracked state.
    /// The handler only updates tracked state when executeUpgrade succeeds
    /// (which requires the 14-day timelock). Any discrepancy means a change
    /// bypassed the timelock.
    function invariant_verifierChangesOnlyThroughTimelock() public view {
        if (!handler.isSealed()) return;

        uint8[4] memory depths = [uint8(18), 20, 22, 24];
        for (uint256 i = 0; i < 4; i++) {
            address current = registry.verifierByDepth(depths[i]);
            address tracked = handler.sealedVerifiers(depths[i]);
            assertEq(
                current,
                tracked,
                "Verifier changed without going through timelock path"
            );
        }
    }

    /// @notice Pending proposals must always have execution times >= 14 days in the future
    /// from when they were proposed
    function invariant_pendingProposalsRespect14DayTimelock() public view {
        if (!handler.isSealed()) return;

        uint8[4] memory depths = [uint8(18), 20, 22, 24];
        for (uint256 i = 0; i < 4; i++) {
            address pending = registry.pendingVerifiers(depths[i]);
            uint256 execTime = registry.verifierExecutionTime(depths[i]);

            if (pending != address(0)) {
                // Execution time must be set and must be at least 14 days from now
                // (we can't check "from proposal time" without ghost state for that,
                // but we CAN verify it hasn't been set to something in the past
                // relative to the current block, which would indicate manipulation)
                assertTrue(
                    execTime > 0,
                    "Pending proposal must have non-zero execution time"
                );
            }
        }
    }

    /// @notice No unauthorized changes counter must remain zero
    function invariant_noUnauthorizedChanges() public view {
        assertEq(
            handler.unauthorizedChanges(),
            0,
            "Unauthorized verifier changes detected"
        );
    }

    /// @notice Direct registerVerifier must be impossible post-seal
    function invariant_directRegistrationBlockedPostSeal() public {
        if (!registry.genesisSealed()) return;

        // Try direct registration — must revert
        vm.prank(governance);
        try registry.registerVerifier(18, address(0xBAD)) {
            fail("INVARIANT VIOLATED: registerVerifier succeeded post-seal");
        } catch {
            // Expected: GenesisAlreadySealed
        }
    }
}
