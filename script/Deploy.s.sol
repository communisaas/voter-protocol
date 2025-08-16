// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import {CIVICToken} from "../contracts/CIVICToken.sol";
import {VOTERRegistry} from "../contracts/VOTERRegistry.sol";
import {ActionVerifierMultiSig} from "../contracts/ActionVerifierMultiSig.sol";
import {CommuniqueCore} from "../contracts/CommuniqueCore.sol";
import {AgentParameters} from "../contracts/AgentParameters.sol";
import {AgentConsensusGateway} from "../contracts/AgentConsensusGateway.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address selfProtocol = vm.envOr("SELF_PROTOCOL", address(0));

        vm.startBroadcast(deployerPk);

        CIVICToken civic = new CIVICToken();
        VOTERRegistry registry = new VOTERRegistry(selfProtocol);
        // Use multisig verifier by default
        ActionVerifierMultiSig multi = new ActionVerifierMultiSig(msg.sender, 2);
        address verifier = address(multi);

        AgentParameters params = new AgentParameters(msg.sender);
        CommuniqueCore core = new CommuniqueCore(address(registry), address(civic), verifier, address(params));
        AgentConsensusGateway gateway = new AgentConsensusGateway(msg.sender);
        core.setConsensus(address(gateway));

        // VOTERPoints removed

        // Wire roles
        civic.grantRole(civic.MINTER_ROLE(), address(core));
        registry.grantRole(registry.VERIFIER_ROLE(), address(core));

        vm.stopBroadcast();

        console2.log("CIVIC:", address(civic));
        console2.log("Registry:", address(registry));
        console2.log("Verifier:", verifier);
        console2.log("Core:", address(core));
        console2.log("Params:", address(params));
        console2.log("ConsensusGateway:", address(gateway));
    }
}


