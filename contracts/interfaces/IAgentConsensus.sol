// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IAgentConsensus {
    function isVerified(bytes32 actionHash) external view returns (bool);
}


