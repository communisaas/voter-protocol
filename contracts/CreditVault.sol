// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title CreditVault
 * @dev USD-priced accounting for institutional credits that fund verified outreach and analytics.
 * Note: This is an accounting contract only; custody and settlement occur off-chain or via stablecoins in future iterations.
 */
contract CreditVault is AccessControl, ReentrancyGuard {
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    mapping(address => uint256) public balanceOf;

    event Funded(address indexed payer, uint256 amount, uint256 newBalance);
    event Consumed(address indexed payer, uint256 amount, uint256 newBalance);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function fund(address payer, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(payer != address(0), "INVALID_PAYER");
        require(amount > 0, "INVALID_AMOUNT");
        
        balanceOf[payer] += amount;
        emit Funded(payer, amount, balanceOf[payer]);
    }

    function consume(address payer, uint256 amount) external onlyRole(SPENDER_ROLE) nonReentrant {
        require(payer != address(0), "INVALID_PAYER");
        require(amount > 0, "INVALID_AMOUNT");
        require(balanceOf[payer] >= amount, "INSUFFICIENT_CREDITS");
        balanceOf[payer] -= amount;
        emit Consumed(payer, amount, balanceOf[payer]);
        
        // If payer is a contract, notify it (this creates reentrancy opportunity)
        if (payer.code.length > 0) {
            (bool success, ) = payer.call("");
            // Don't revert on failure, just log
        }
    }
}


