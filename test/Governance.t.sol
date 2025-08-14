// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {CIVICToken} from "../contracts/CIVICToken.sol";
import {CivicGovernor, CivicTimelock} from "../contracts/GovernanceSetup.sol";

contract GovernanceTest is Test {
    CIVICToken civic;
    CivicTimelock timelock;
    CivicGovernor governor;

    address voter = address(0xA11CE);

    function setUp() public {
        civic = new CIVICToken();
        timelock = new CivicTimelock(1 days, new address[](0), new address[](0), address(this));
        governor = new CivicGovernor(civic);

        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));

        // Give voter power
        civic.transfer(voter, 20_000e18); // above 10k threshold
        vm.prank(voter);
        civic.delegate(voter);
        // Ensure checkpointing before proposing (Governor checks votes at prior timepoint)
        vm.roll(block.number + 1);
    }

    function test_CanProposeAndVote() public {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(civic);
        values[0] = 0;
        calldatas[0] = abi.encodeWithSignature("pause()");
        uint256 proposalId = governor.propose(targets, values, calldatas, "Test Proposal");

        vm.roll(block.number + governor.votingDelay() + 1);

        vm.prank(voter);
        governor.castVote(proposalId, 1);
    }
}


