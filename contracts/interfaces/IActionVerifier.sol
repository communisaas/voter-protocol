// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IActionVerifier {
    function isVerifiedAction(bytes32 actionHash) external view returns (bool);
}


