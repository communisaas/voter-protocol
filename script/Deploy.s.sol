// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import {VOTERToken} from "../contracts/VOTERToken.sol";
import {VOTERRegistry} from "../contracts/VOTERRegistry.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";
import {CommuniqueCore} from "../contracts/CommuniqueCore.sol";
import {AgentParameters} from "../contracts/AgentParameters.sol";
import {AgentConsensusGateway} from "../contracts/AgentConsensusGateway.sol";
import {AgentConsensusThreshold} from "../contracts/AgentConsensusThreshold.sol";
import {CivicTimelock, CivicGovernor} from "../contracts/GovernanceSetup.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address selfProtocol = vm.envOr("SELF_PROTOCOL", address(0));

        vm.startBroadcast(deployerPk);

        VOTERToken voter = new VOTERToken();
        VOTERRegistry registry = new VOTERRegistry(selfProtocol);
        // Use multisig verifier by default
        ActionVerifierMultiSig multi = new ActionVerifierMultiSig(msg.sender, 2);
        address verifier = address(multi);

        AgentParameters params = new AgentParameters(msg.sender);
        CommuniqueCore core = new CommuniqueCore(address(registry), address(voter), verifier, address(params));
        AgentConsensusGateway gateway = new AgentConsensusGateway(msg.sender);
        AgentConsensusThreshold threshold = new AgentConsensusThreshold(msg.sender, 2);
        // Default to threshold consensus; can switch via governance to gateway or multisig-only
        core.setConsensus(address(threshold));

        // Timelock + Governor
        CivicTimelock timelock = new CivicTimelock(2 days, new address[](0), new address[](0), msg.sender);
        CivicGovernor governor = new CivicGovernor(voter);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));

        // Optional: deploy VOTERPoints and wire to registry
        // Comment out if not desired in a given environment
        // VOTERPoints points = new VOTERPoints(msg.sender);
        // registry.setVOTERPoints(address(points));
        // points.grantRole(points.MINTER_ROLE(), address(registry));

        // Wire roles
        voter.grantRole(voter.MINTER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));
        core.grantRole(core.PAUSER_ROLE(), address(timelock));
        params.grantRole(params.PARAM_SETTER_ROLE(), address(timelock));

        // Hand off admin to timelock and remove EOA from core roles
        bytes32 DEFAULT_ADMIN = core.DEFAULT_ADMIN_ROLE();
        // Core admin
        core.grantRole(DEFAULT_ADMIN, address(timelock));
        core.grantRole(core.ADMIN_ROLE(), address(timelock));
        core.renounceRole(DEFAULT_ADMIN, msg.sender);
        core.renounceRole(core.ADMIN_ROLE(), msg.sender);
        // Parameters admin
        params.grantRole(DEFAULT_ADMIN, address(timelock));
        params.renounceRole(DEFAULT_ADMIN, msg.sender);
        params.renounceRole(params.PARAM_SETTER_ROLE(), msg.sender);
        // Token admin
        voter.grantRole(DEFAULT_ADMIN, address(timelock));
        voter.grantRole(voter.ADMIN_ROLE(), address(timelock));
        voter.renounceRole(DEFAULT_ADMIN, msg.sender);
        voter.renounceRole(voter.ADMIN_ROLE(), msg.sender);
        // Registry admin
        registry.grantRole(DEFAULT_ADMIN, address(timelock));
        registry.grantRole(registry.ADMIN_ROLE(), address(timelock));
        registry.renounceRole(DEFAULT_ADMIN, msg.sender);
        registry.renounceRole(registry.ADMIN_ROLE(), msg.sender);
        // Verifier admin
        multi.grantRole(DEFAULT_ADMIN, address(timelock));
        multi.renounceRole(DEFAULT_ADMIN, msg.sender);
        // Consensus gateway admin
        gateway.grantRole(DEFAULT_ADMIN, address(timelock));
        gateway.renounceRole(DEFAULT_ADMIN, msg.sender);

        vm.stopBroadcast();

        console2.log("VOTER:", address(voter));
        console2.log("Registry:", address(registry));
        console2.log("Verifier:", verifier);
        console2.log("Core:", address(core));
        console2.log("Params:", address(params));
        console2.log("ConsensusGateway:", address(gateway));
        console2.log("ConsensusThreshold:", address(threshold));
        console2.log("Timelock:", address(timelock));
        console2.log("Governor:", address(governor));
    }
}


