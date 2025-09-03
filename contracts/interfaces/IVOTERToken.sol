// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IVOTERToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function mintForCivicAction(address to, uint256 amount, string memory actionType) external;
}