// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import {VOTERToken} from "../contracts/VOTERToken.sol";
import {CivicGovernor, CivicTimelock} from "../contracts/GovernanceSetup.sol";
import {CommuniqueCore} from "../contracts/CommuniqueCore.sol";
import {VOTERRegistry} from "../contracts/VOTERRegistry.sol";

contract DeployGovernance is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address voterAddr = vm.envAddress("VOTER_ADDR");
        address coreAddr = vm.envAddress("CORE_ADDR");
        address registryAddr = vm.envAddress("REGISTRY_ADDR");

        vm.startBroadcast(pk);

        CivicTimelock timelock = new CivicTimelock(2 days, new address[](0), new address[](0), msg.sender);
        CivicGovernor governor = new CivicGovernor(VOTERToken(voterAddr));

        // Transfer roles to timelock (admin) and governor (proposer)
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0)); // open executor

        // Optional: revoke deployer admin, assign timelock as admin of core/registry/token
        CommuniqueCore core = CommuniqueCore(coreAddr);
        VOTERRegistry registry = VOTERRegistry(registryAddr);
        VOTERToken voter = VOTERToken(voterAddr);

        // Note: these require that contracts support role admin changes; otherwise propose via governance later
        core.grantRole(core.DEFAULT_ADMIN_ROLE(), address(timelock));
        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock));
        voter.grantRole(voter.DEFAULT_ADMIN_ROLE(), address(timelock));

        // If using multisig verifier, timelock should admin it as well (set externally via proposal)

        vm.stopBroadcast();

        console2.log("Timelock:", address(timelock));
        console2.log("Governor:", address(governor));
    }
}


