// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "forge-std/Test.sol";
import "../src/DistrictRegistry.sol";

contract DistrictRegistryTest is Test {
    DistrictRegistry public registry;

    address public governance = address(0x1);
    address public newGovernance = address(0x2);
    address public attacker = address(0x3);

    bytes32 public constant DISTRICT_ROOT_1 = keccak256("DISTRICT_1");
    bytes32 public constant DISTRICT_ROOT_2 = keccak256("DISTRICT_2");
    bytes3 public constant USA = "USA";
    bytes3 public constant GBR = "GBR";

    event DistrictRegistered(bytes32 indexed districtRoot, bytes3 indexed country, uint256 timestamp);
    event GovernanceTransferInitiated(address indexed newGovernance, uint256 executeTime);
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceTransferCancelled(address indexed newGovernance);

    function setUp() public {
        registry = new DistrictRegistry(governance);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(registry.governance(), governance);
        assertEq(registry.GOVERNANCE_TIMELOCK(), 7 days);
    }

    function testFail_ConstructorZeroAddress() public {
        new DistrictRegistry(address(0));
    }

    // ============ District Registration Tests ============

    function test_RegisterDistrict() public {
        vm.prank(governance);
        vm.expectEmit(true, true, false, true);
        emit DistrictRegistered(DISTRICT_ROOT_1, USA, block.timestamp);

        registry.registerDistrict(DISTRICT_ROOT_1, USA);

        assertEq(registry.getCountry(DISTRICT_ROOT_1), USA);
    }

    function testFail_RegisterDistrictUnauthorized() public {
        vm.prank(attacker);
        registry.registerDistrict(DISTRICT_ROOT_1, USA);
    }

    function testFail_RegisterDistrictDuplicate() public {
        vm.startPrank(governance);
        registry.registerDistrict(DISTRICT_ROOT_1, USA);
        registry.registerDistrict(DISTRICT_ROOT_1, USA); // Should fail
        vm.stopPrank();
    }

    function testFail_RegisterDistrictInvalidCountry() public {
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT_1, bytes3(0));
    }

    // ============ Batch Registration Tests ============

    function test_RegisterDistrictsBatch() public {
        bytes32[] memory roots = new bytes32[](2);
        bytes3[] memory countries = new bytes3[](2);

        roots[0] = DISTRICT_ROOT_1;
        roots[1] = DISTRICT_ROOT_2;
        countries[0] = USA;
        countries[1] = GBR;

        vm.prank(governance);
        registry.registerDistrictsBatch(roots, countries);

        assertEq(registry.getCountry(DISTRICT_ROOT_1), USA);
        assertEq(registry.getCountry(DISTRICT_ROOT_2), GBR);
    }

    function testFail_RegisterDistrictsBatchLengthMismatch() public {
        bytes32[] memory roots = new bytes32[](2);
        bytes3[] memory countries = new bytes3[](1);

        vm.prank(governance);
        registry.registerDistrictsBatch(roots, countries);
    }

    // ============ Governance Timelock Tests ============

    function test_InitiateGovernanceTransfer() public {
        uint256 expectedExecuteTime = block.timestamp + 7 days;

        vm.prank(governance);
        vm.expectEmit(true, false, false, true);
        emit GovernanceTransferInitiated(newGovernance, expectedExecuteTime);

        registry.initiateGovernanceTransfer(newGovernance);

        assertEq(registry.pendingGovernance(newGovernance), expectedExecuteTime);
    }

    function testFail_InitiateGovernanceTransferUnauthorized() public {
        vm.prank(attacker);
        registry.initiateGovernanceTransfer(newGovernance);
    }

    function testFail_InitiateGovernanceTransferZeroAddress() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(address(0));
    }

    function testFail_InitiateGovernanceTransferToSelf() public {
        vm.prank(governance);
        registry.initiateGovernanceTransfer(governance);
    }

    function test_ExecuteGovernanceTransferAfterTimelock() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days);

        // Execute transfer (anyone can execute)
        vm.expectEmit(true, true, false, false);
        emit GovernanceTransferred(governance, newGovernance);

        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);
        assertEq(registry.pendingGovernance(newGovernance), 0); // Should be deleted
    }

    function test_ExecuteGovernanceTransferByAnyone() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days);

        // Attacker can execute (but doesn't benefit from it)
        vm.prank(attacker);
        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);
    }

    function testFail_ExecuteGovernanceTransferNotInitiated() public {
        registry.executeGovernanceTransfer(newGovernance);
    }

    function testFail_ExecuteGovernanceTransferBeforeTimelock() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Try to execute immediately (should fail)
        registry.executeGovernanceTransfer(newGovernance);
    }

    function testFail_ExecuteGovernanceTransferOneDayEarly() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Fast forward 6 days (not enough)
        vm.warp(block.timestamp + 6 days);

        // Try to execute (should fail)
        registry.executeGovernanceTransfer(newGovernance);
    }

    function test_CancelGovernanceTransfer() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        assertEq(registry.pendingGovernance(newGovernance), block.timestamp + 7 days);

        // Cancel transfer
        vm.prank(governance);
        vm.expectEmit(true, false, false, false);
        emit GovernanceTransferCancelled(newGovernance);

        registry.cancelGovernanceTransfer(newGovernance);

        assertEq(registry.pendingGovernance(newGovernance), 0);
    }

    function testFail_CancelGovernanceTransferUnauthorized() public {
        // Initiate transfer
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        // Attacker tries to cancel (should fail)
        vm.prank(attacker);
        registry.cancelGovernanceTransfer(newGovernance);
    }

    function testFail_CancelGovernanceTransferNotInitiated() public {
        vm.prank(governance);
        registry.cancelGovernanceTransfer(newGovernance);
    }

    // ============ Governance Attack Scenario Tests ============

    function test_CompromisedGovernanceCannotInstantTakeover() public {
        // Attacker compromises governance multi-sig
        vm.prank(governance);
        registry.initiateGovernanceTransfer(attacker);

        // Governance is still the original (transfer not executed)
        assertEq(registry.governance(), governance);

        // Community detects malicious transfer during 7-day window
        // They can fork or organize response

        // Fast forward only 1 day - still can't execute
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(DistrictRegistry.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(attacker);
    }

    function test_CommunityCanDetectAndRespond() public {
        // Malicious transfer initiated
        vm.prank(governance);
        registry.initiateGovernanceTransfer(attacker);

        // Community has 7 days to:
        // 1. Detect malicious transfer (GovernanceTransferInitiated event)
        // 2. Organize response (social consensus)
        // 3. Exit to fork if necessary

        // In this scenario, governance realizes mistake and cancels
        vm.prank(governance);
        registry.cancelGovernanceTransfer(attacker);

        // Governance remains unchanged
        assertEq(registry.governance(), governance);

        // Cannot execute cancelled transfer
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(DistrictRegistry.TransferNotInitiated.selector);
        registry.executeGovernanceTransfer(attacker);
    }

    function test_NewGovernanceCanRegisterDistricts() public {
        // Transfer governance successfully
        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + 7 days);
        registry.executeGovernanceTransfer(newGovernance);

        // New governance can register districts
        vm.prank(newGovernance);
        registry.registerDistrict(DISTRICT_ROOT_1, USA);

        assertEq(registry.getCountry(DISTRICT_ROOT_1), USA);

        // Old governance cannot
        vm.prank(governance);
        vm.expectRevert(DistrictRegistry.UnauthorizedCaller.selector);
        registry.registerDistrict(DISTRICT_ROOT_2, GBR);
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterDistrict(bytes32 root, bytes3 country) public {
        vm.assume(country != bytes3(0));

        vm.prank(governance);
        registry.registerDistrict(root, country);

        assertEq(registry.getCountry(root), country);
    }

    function testFuzz_TimelockEnforcement(uint256 timeElapsed) public {
        vm.assume(timeElapsed < 7 days);

        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + timeElapsed);

        // Should fail if less than 7 days
        vm.expectRevert(DistrictRegistry.TimelockNotExpired.selector);
        registry.executeGovernanceTransfer(newGovernance);
    }

    function testFuzz_TimelockSuccess(uint256 timeElapsed) public {
        vm.assume(timeElapsed >= 7 days && timeElapsed < 365 days);

        vm.prank(governance);
        registry.initiateGovernanceTransfer(newGovernance);

        vm.warp(block.timestamp + timeElapsed);

        // Should succeed if 7+ days
        registry.executeGovernanceTransfer(newGovernance);

        assertEq(registry.governance(), newGovernance);
    }

    // ============ District Lookup Tests ============

    function test_IsDistrictInCountry() public {
        vm.prank(governance);
        registry.registerDistrict(DISTRICT_ROOT_1, USA);

        assertTrue(registry.isDistrictInCountry(DISTRICT_ROOT_1, USA));
        assertFalse(registry.isDistrictInCountry(DISTRICT_ROOT_1, GBR));
        assertFalse(registry.isDistrictInCountry(DISTRICT_ROOT_2, USA));
    }

    function test_GetCountryUnregistered() public view {
        bytes3 country = registry.getCountry(DISTRICT_ROOT_1);
        assertEq(country, bytes3(0));
    }
}
