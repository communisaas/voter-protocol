// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictGate.sol";
import "../src/DistrictRegistry.sol";
import "../src/NullifierRegistry.sol";
import "../src/VerifierRegistry.sol";

/// @title DistrictGate Derived Domain Tests
/// @notice Comprehensive tests for derived domain authorization infrastructure
/// @dev Tests cover:
///      1. Genesis deriver authorization (pre-seal, no timelock)
///      2. Timelock deriver authorization (post-seal, 7-day timelock)
///      3. Timelock deriver revocation (7-day timelock)
///      4. registerDerivedDomain (atomic, authorized derivers only)
///      5. Integration (revocation propagation, whitelist coherence)
contract DistrictGateDerivedDomainTest is Test {
    DistrictGate public gate;
    DistrictRegistry public districtRegistry;
    NullifierRegistry public nullifierRegistry;
    VerifierRegistry public verifierRegistry;

    address public governance = address(0x1);
    address public deriver = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant BASE_DOMAIN = keccak256("template-housing-2026");
    bytes32 public constant DERIVED_DOMAIN = keccak256("debate-housing-2026");
    bytes32 public constant DERIVED_DOMAIN_2 = keccak256("debate-housing-2026-v2");

    uint256 public constant SEVEN_DAYS = 7 days;

    // Derived domain events
    event DeriverAuthorizedGenesis(address indexed deriver);
    event DeriverAuthorizationProposed(address indexed deriver, uint256 executeTime);
    event DeriverAuthorized(address indexed deriver);
    event DeriverAuthorizationCancelled(address indexed deriver);
    event DeriverRevocationProposed(address indexed deriver, uint256 executeTime);
    event DeriverRevoked(address indexed deriver);
    event DeriverRevocationCancelled(address indexed deriver);
    event DerivedDomainRegistered(bytes32 indexed baseDomain, bytes32 indexed derivedDomain, address indexed deriver);

    // Action domain events (emitted by registerDerivedDomain)
    event ActionDomainActivated(bytes32 indexed actionDomain);
    event ActionDomainRevoked(bytes32 indexed actionDomain);

    function setUp() public {
        // Deploy mock verifier
        address verifier = address(new MockVerifierDD());

        // Deploy registries
        districtRegistry = new DistrictRegistry(governance, 7 days);
        nullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        verifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);

        // Deploy DistrictGate
        gate = new DistrictGate(
            address(verifierRegistry),
            address(districtRegistry),
            address(nullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );

        // Setup: Register verifier for depth 18 (genesis registration)
        vm.startPrank(governance);
        verifierRegistry.registerVerifier(18, verifier);
        verifierRegistry.sealGenesis();

        // Setup: Register BASE_DOMAIN as an allowed action domain (genesis)
        gate.registerActionDomainGenesis(BASE_DOMAIN);

        // Setup: Authorize deriver during genesis (for tests needing pre-authorized deriver)
        gate.authorizeDeriverGenesis(deriver);

        // Seal genesis
        gate.sealGenesis();
        vm.stopPrank();
    }

    // ============================================================================
    // 1. GENESIS AUTHORIZATION
    // ============================================================================

    /// @notice authorizeDeriverGenesis sets authorizedDerivers mapping
    function test_AuthorizeDeriverGenesis_Success() public {
        // Deploy a fresh gate (unsealed) to test genesis
        DistrictGate freshGate = _deployFreshGate();

        address newDeriver = address(0x10);

        vm.prank(governance);
        freshGate.authorizeDeriverGenesis(newDeriver);

        assertTrue(freshGate.authorizedDerivers(newDeriver));
    }

    /// @notice authorizeDeriverGenesis emits DeriverAuthorizedGenesis and DeriverAuthorized
    function test_AuthorizeDeriverGenesis_EmitsEvent() public {
        DistrictGate freshGate = _deployFreshGate();

        address newDeriver = address(0x10);

        vm.prank(governance);

        vm.expectEmit(true, false, false, false);
        emit DeriverAuthorizedGenesis(newDeriver);

        vm.expectEmit(true, false, false, false);
        emit DeriverAuthorized(newDeriver);

        freshGate.authorizeDeriverGenesis(newDeriver);
    }

    /// @notice authorizeDeriverGenesis reverts after genesis is sealed
    function test_AuthorizeDeriverGenesis_RevertsAfterSeal() public {
        // Main gate is already sealed in setUp
        address newDeriver = address(0x10);

        vm.prank(governance);
        vm.expectRevert(DistrictGate.GenesisAlreadySealed.selector);
        gate.authorizeDeriverGenesis(newDeriver);
    }

    /// @notice authorizeDeriverGenesis reverts on zero address
    function test_AuthorizeDeriverGenesis_RevertsOnZeroAddress() public {
        DistrictGate freshGate = _deployFreshGate();

        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        freshGate.authorizeDeriverGenesis(address(0));
    }

    /// @notice authorizeDeriverGenesis reverts on duplicate authorization
    function test_AuthorizeDeriverGenesis_RevertsOnDuplicate() public {
        DistrictGate freshGate = _deployFreshGate();

        address newDeriver = address(0x10);

        vm.startPrank(governance);
        freshGate.authorizeDeriverGenesis(newDeriver);

        vm.expectRevert(DistrictGate.DeriverAlreadyAuthorized.selector);
        freshGate.authorizeDeriverGenesis(newDeriver);
        vm.stopPrank();
    }

    /// @notice authorizeDeriverGenesis reverts for non-governance caller
    function test_AuthorizeDeriverGenesis_RevertsNonGovernance() public {
        DistrictGate freshGate = _deployFreshGate();

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        freshGate.authorizeDeriverGenesis(address(0x10));
    }

    // ============================================================================
    // 2. TIMELOCK AUTHORIZATION (POST-GENESIS)
    // ============================================================================

    /// @notice proposeDeriverAuthorization sets pending timestamp
    function test_ProposeDeriverAuthorization_Success() public {
        address newDeriver = address(0x20);
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        assertEq(gate.pendingDeriverAuthorization(newDeriver), expectedExecuteTime);
    }

    /// @notice Full flow: propose -> warp 7 days -> execute -> authorized
    function test_ExecuteDeriverAuthorization_AfterTimelock() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        // Warp past timelock
        vm.warp(block.timestamp + SEVEN_DAYS);

        gate.executeDeriverAuthorization(newDeriver);

        assertTrue(gate.authorizedDerivers(newDeriver));
        // Pending state should be cleared
        assertEq(gate.pendingDeriverAuthorization(newDeriver), 0);
    }

    /// @notice executeDeriverAuthorization reverts before timelock expires
    function test_ExecuteDeriverAuthorization_RevertsBeforeTimelock() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        // Try to execute immediately
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeDeriverAuthorization(newDeriver);

        // Try just before timelock expires
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeDeriverAuthorization(newDeriver);
    }

    /// @notice executeDeriverAuthorization reverts when nothing is pending
    function test_ExecuteDeriverAuthorization_RevertsNotPending() public {
        address newDeriver = address(0x20);

        vm.expectRevert(DistrictGate.DeriverAuthorizationNotPending.selector);
        gate.executeDeriverAuthorization(newDeriver);
    }

    /// @notice cancelDeriverAuthorization clears pending state
    function test_CancelDeriverAuthorization_Success() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        // Verify pending exists
        assertGt(gate.pendingDeriverAuthorization(newDeriver), 0);

        // Cancel
        vm.prank(governance);
        gate.cancelDeriverAuthorization(newDeriver);

        // Verify pending cleared
        assertEq(gate.pendingDeriverAuthorization(newDeriver), 0);

        // Verify cannot execute after cancel
        vm.warp(block.timestamp + SEVEN_DAYS);
        vm.expectRevert(DistrictGate.DeriverAuthorizationNotPending.selector);
        gate.executeDeriverAuthorization(newDeriver);
    }

    /// @notice proposeDeriverAuthorization reverts when already pending
    function test_ProposeDeriverAuthorization_RevertsAlreadyPending() public {
        address newDeriver = address(0x20);

        vm.startPrank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        vm.expectRevert(DistrictGate.DeriverAuthorizationAlreadyPending.selector);
        gate.proposeDeriverAuthorization(newDeriver);
        vm.stopPrank();
    }

    /// @notice proposeDeriverAuthorization reverts when deriver is already authorized
    function test_ProposeDeriverAuthorization_RevertsAlreadyAuthorized() public {
        // `deriver` was authorized during genesis in setUp
        vm.prank(governance);
        vm.expectRevert(DistrictGate.DeriverAlreadyAuthorized.selector);
        gate.proposeDeriverAuthorization(deriver);
    }

    /// @notice proposeDeriverAuthorization emits DeriverAuthorizationProposed
    function test_ProposeDeriverAuthorization_EmitsEvent() public {
        address newDeriver = address(0x20);
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit DeriverAuthorizationProposed(newDeriver, expectedExecuteTime);
        gate.proposeDeriverAuthorization(newDeriver);
    }

    /// @notice executeDeriverAuthorization emits DeriverAuthorized
    function test_ExecuteDeriverAuthorization_EmitsEvent() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectEmit(true, false, false, false);
        emit DeriverAuthorized(newDeriver);
        gate.executeDeriverAuthorization(newDeriver);
    }

    /// @notice cancelDeriverAuthorization emits DeriverAuthorizationCancelled
    function test_CancelDeriverAuthorization_EmitsEvent() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit DeriverAuthorizationCancelled(newDeriver);
        gate.cancelDeriverAuthorization(newDeriver);
    }

    /// @notice Only governance can propose deriver authorization
    function test_ProposeDeriverAuthorization_RevertsNonGovernance() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeDeriverAuthorization(address(0x20));
    }

    /// @notice Only governance can cancel deriver authorization
    function test_CancelDeriverAuthorization_RevertsNonGovernance() public {
        address newDeriver = address(0x20);
        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelDeriverAuthorization(newDeriver);
    }

    /// @notice Anyone can execute deriver authorization after timelock
    function test_AnyoneCanExecuteDeriverAuthorization_AfterTimelock() public {
        address newDeriver = address(0x20);

        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute as attacker (not governance)
        vm.prank(attacker);
        gate.executeDeriverAuthorization(newDeriver);

        assertTrue(gate.authorizedDerivers(newDeriver));
    }

    /// @notice proposeDeriverAuthorization reverts on zero address
    function test_ProposeDeriverAuthorization_RevertsOnZeroAddress() public {
        vm.prank(governance);
        vm.expectRevert(TimelockGovernance.ZeroAddress.selector);
        gate.proposeDeriverAuthorization(address(0));
    }

    // ============================================================================
    // 3. TIMELOCK REVOCATION
    // ============================================================================

    /// @notice proposeDeriverRevocation sets pending revocation timestamp
    function test_ProposeDeriverRevocation_Success() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        assertEq(gate.pendingDeriverRevocation(deriver), expectedExecuteTime);
    }

    /// @notice Full flow: propose revocation -> warp -> execute -> revoked
    function test_ExecuteDeriverRevocation_AfterTimelock() public {
        // deriver is authorized from setUp
        assertTrue(gate.authorizedDerivers(deriver));

        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.warp(block.timestamp + SEVEN_DAYS);

        gate.executeDeriverRevocation(deriver);

        assertFalse(gate.authorizedDerivers(deriver));
        // Pending state should be cleared
        assertEq(gate.pendingDeriverRevocation(deriver), 0);
    }

    /// @notice executeDeriverRevocation reverts before timelock expires
    function test_ExecuteDeriverRevocation_RevertsBeforeTimelock() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        // Try immediately
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeDeriverRevocation(deriver);

        // Try just before expiry
        vm.warp(block.timestamp + SEVEN_DAYS - 1);
        vm.expectRevert(DistrictGate.ActionDomainTimelockNotExpired.selector);
        gate.executeDeriverRevocation(deriver);
    }

    /// @notice executeDeriverRevocation reverts when nothing is pending
    function test_ExecuteDeriverRevocation_RevertsNotPending() public {
        vm.expectRevert(DistrictGate.DeriverRevocationNotPending.selector);
        gate.executeDeriverRevocation(deriver);
    }

    /// @notice cancelDeriverRevocation clears pending state
    function test_CancelDeriverRevocation_Success() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        // Verify pending exists
        assertGt(gate.pendingDeriverRevocation(deriver), 0);

        // Cancel
        vm.prank(governance);
        gate.cancelDeriverRevocation(deriver);

        // Verify pending cleared
        assertEq(gate.pendingDeriverRevocation(deriver), 0);

        // Verify deriver is still authorized
        assertTrue(gate.authorizedDerivers(deriver));

        // Verify cannot execute after cancel
        vm.warp(block.timestamp + SEVEN_DAYS);
        vm.expectRevert(DistrictGate.DeriverRevocationNotPending.selector);
        gate.executeDeriverRevocation(deriver);
    }

    /// @notice proposeDeriverRevocation reverts when deriver is not authorized
    function test_ProposeDeriverRevocation_RevertsNotAuthorized() public {
        address notAuthorized = address(0x30);

        vm.prank(governance);
        vm.expectRevert(DistrictGate.DeriverNotAuthorized.selector);
        gate.proposeDeriverRevocation(notAuthorized);
    }

    /// @notice proposeDeriverRevocation reverts when already pending
    function test_ProposeDeriverRevocation_RevertsAlreadyPending() public {
        vm.startPrank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.expectRevert(DistrictGate.DeriverRevocationAlreadyPending.selector);
        gate.proposeDeriverRevocation(deriver);
        vm.stopPrank();
    }

    /// @notice proposeDeriverRevocation emits DeriverRevocationProposed
    function test_ProposeDeriverRevocation_EmitsEvent() public {
        uint256 expectedExecuteTime = block.timestamp + SEVEN_DAYS;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit DeriverRevocationProposed(deriver, expectedExecuteTime);
        gate.proposeDeriverRevocation(deriver);
    }

    /// @notice executeDeriverRevocation emits DeriverRevoked
    function test_ExecuteDeriverRevocation_EmitsEvent() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.warp(block.timestamp + SEVEN_DAYS);

        vm.expectEmit(true, false, false, false);
        emit DeriverRevoked(deriver);
        gate.executeDeriverRevocation(deriver);
    }

    /// @notice cancelDeriverRevocation emits DeriverRevocationCancelled
    function test_CancelDeriverRevocation_EmitsEvent() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit DeriverRevocationCancelled(deriver);
        gate.cancelDeriverRevocation(deriver);
    }

    /// @notice Only governance can propose deriver revocation
    function test_ProposeDeriverRevocation_RevertsNonGovernance() public {
        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.proposeDeriverRevocation(deriver);
    }

    /// @notice Only governance can cancel deriver revocation
    function test_CancelDeriverRevocation_RevertsNonGovernance() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.prank(attacker);
        vm.expectRevert(TimelockGovernance.UnauthorizedCaller.selector);
        gate.cancelDeriverRevocation(deriver);
    }

    /// @notice Anyone can execute deriver revocation after timelock
    function test_AnyoneCanExecuteDeriverRevocation_AfterTimelock() public {
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);

        vm.warp(block.timestamp + SEVEN_DAYS);

        // Execute as attacker (not governance)
        vm.prank(attacker);
        gate.executeDeriverRevocation(deriver);

        assertFalse(gate.authorizedDerivers(deriver));
    }

    // ============================================================================
    // 4. registerDerivedDomain
    // ============================================================================

    /// @notice Authorized deriver can register a derived domain from a valid base
    function test_RegisterDerivedDomain_Success() public {
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);

        // Derived domain is now in the whitelist
        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN));

        // derivedDomainBase tracks the lineage
        assertEq(gate.derivedDomainBase(DERIVED_DOMAIN), BASE_DOMAIN);
    }

    /// @notice registerDerivedDomain emits DerivedDomainRegistered + ActionDomainActivated
    function test_RegisterDerivedDomain_EmitsEvents() public {
        vm.prank(deriver);

        vm.expectEmit(true, true, true, false);
        emit DerivedDomainRegistered(BASE_DOMAIN, DERIVED_DOMAIN, deriver);

        vm.expectEmit(true, false, false, false);
        emit ActionDomainActivated(DERIVED_DOMAIN);

        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
    }

    /// @notice registerDerivedDomain reverts for unauthorized caller
    function test_RegisterDerivedDomain_RevertsUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(DistrictGate.DeriverNotAuthorized.selector);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
    }

    /// @notice registerDerivedDomain reverts when base domain is not in whitelist
    function test_RegisterDerivedDomain_RevertsBaseDomainNotAllowed() public {
        bytes32 invalidBase = keccak256("not-registered-base");

        vm.prank(deriver);
        vm.expectRevert(DistrictGate.BaseDomainNotAllowed.selector);
        gate.registerDerivedDomain(invalidBase, DERIVED_DOMAIN);
    }

    /// @notice registerDerivedDomain reverts on duplicate derived domain
    function test_RegisterDerivedDomain_RevertsDuplicate() public {
        // Register the first time
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);

        // Try to register the same derived domain again
        vm.prank(deriver);
        vm.expectRevert(DistrictGate.DerivedDomainAlreadyRegistered.selector);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
    }

    /// @notice derivedDomainBase correctly records the base domain
    function test_RegisterDerivedDomain_DerivedDomainBase() public {
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);

        assertEq(gate.derivedDomainBase(DERIVED_DOMAIN), BASE_DOMAIN);

        // Unregistered derived domain has zero base
        assertEq(gate.derivedDomainBase(DERIVED_DOMAIN_2), bytes32(0));
    }

    /// @notice Multiple derived domains can be registered from the same base
    function test_RegisterDerivedDomain_MultipleDerivedFromSameBase() public {
        vm.startPrank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN_2);
        vm.stopPrank();

        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN));
        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN_2));

        assertEq(gate.derivedDomainBase(DERIVED_DOMAIN), BASE_DOMAIN);
        assertEq(gate.derivedDomainBase(DERIVED_DOMAIN_2), BASE_DOMAIN);
    }

    // ============================================================================
    // 5. INTEGRATION
    // ============================================================================

    /// @notice Governance can revoke a derived domain via revokeActionDomain
    function test_RevokeActionDomain_WorksOnDerivedDomains() public {
        // Register a derived domain
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN));

        // Governance revokes the derived domain
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit ActionDomainRevoked(DERIVED_DOMAIN);
        gate.revokeActionDomain(DERIVED_DOMAIN);

        // Derived domain is no longer in the whitelist
        assertFalse(gate.allowedActionDomains(DERIVED_DOMAIN));
    }

    /// @notice A registered derived domain passes the allowedActionDomains check
    function test_DerivedDomain_PassesWhitelistCheck() public {
        // Before registration: not allowed
        assertFalse(gate.allowedActionDomains(DERIVED_DOMAIN));

        // Register derived domain
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);

        // After registration: allowed
        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN));
    }

    /// @notice Revoking the base domain does not affect already-registered derived domains
    function test_RevokeBaseDomain_DoesNotAffectDerived() public {
        // Register derived domain
        vm.prank(deriver);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);

        // Revoke the base domain
        vm.prank(governance);
        gate.revokeActionDomain(BASE_DOMAIN);

        assertFalse(gate.allowedActionDomains(BASE_DOMAIN));
        // Derived domain remains active
        assertTrue(gate.allowedActionDomains(DERIVED_DOMAIN));
    }

    /// @notice After a deriver is revoked, they cannot register new derived domains
    function test_RevokedDeriver_CannotRegisterDerivedDomains() public {
        // Revoke deriver via timelock
        vm.prank(governance);
        gate.proposeDeriverRevocation(deriver);
        vm.warp(block.timestamp + SEVEN_DAYS);
        gate.executeDeriverRevocation(deriver);

        // Deriver can no longer register derived domains
        vm.prank(deriver);
        vm.expectRevert(DistrictGate.DeriverNotAuthorized.selector);
        gate.registerDerivedDomain(BASE_DOMAIN, DERIVED_DOMAIN);
    }

    /// @notice Full lifecycle: authorize via timelock -> register derived -> revoke deriver
    function test_FullLifecycle_TimelockAuthorizeRegisterRevoke() public {
        address newDeriver = address(0x50);

        // Step 1: Propose and execute deriver authorization
        vm.prank(governance);
        gate.proposeDeriverAuthorization(newDeriver);

        uint256 t1 = block.timestamp + SEVEN_DAYS;
        vm.warp(t1);
        gate.executeDeriverAuthorization(newDeriver);
        assertTrue(gate.authorizedDerivers(newDeriver));

        // Step 2: New deriver registers a derived domain
        bytes32 newDerived = keccak256("lifecycle-derived");
        vm.prank(newDeriver);
        gate.registerDerivedDomain(BASE_DOMAIN, newDerived);
        assertTrue(gate.allowedActionDomains(newDerived));

        // Step 3: Propose and execute deriver revocation
        vm.prank(governance);
        gate.proposeDeriverRevocation(newDeriver);

        uint256 t2 = t1 + SEVEN_DAYS;
        vm.warp(t2);
        gate.executeDeriverRevocation(newDeriver);
        assertFalse(gate.authorizedDerivers(newDeriver));

        // Derived domain remains active even after deriver revocation
        assertTrue(gate.allowedActionDomains(newDerived));

        // Revoked deriver cannot register new domains
        bytes32 anotherDerived = keccak256("lifecycle-derived-2");
        vm.prank(newDeriver);
        vm.expectRevert(DistrictGate.DeriverNotAuthorized.selector);
        gate.registerDerivedDomain(BASE_DOMAIN, anotherDerived);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    /// @notice Deploy a fresh (unsealed) DistrictGate for genesis tests
    function _deployFreshGate() internal returns (DistrictGate freshGate) {
        DistrictRegistry freshDistrictRegistry = new DistrictRegistry(governance, 7 days);
        NullifierRegistry freshNullifierRegistry = new NullifierRegistry(governance, 7 days, 7 days);
        VerifierRegistry freshVerifierRegistry = new VerifierRegistry(governance, 7 days, 14 days);

        freshGate = new DistrictGate(
            address(freshVerifierRegistry),
            address(freshDistrictRegistry),
            address(freshNullifierRegistry),
            governance,
            7 days,
            7 days,
            7 days,
            24 hours
        );
    }
}

/// @notice Mock verifier that always returns true
contract MockVerifierDD {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
