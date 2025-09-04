// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title VOTERToken
 * @dev Governance token for Communiqué platform
 * @notice Earned through verified civic engagement, used for platform governance
 */
contract VOTERToken is ERC20, ERC20Permit, ERC20Votes, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    uint256 public constant INITIAL_MINT_CAP = 100_000_000 * 10**18; // 100M for initial distribution
    
    mapping(address => uint256) public civicActions; // Track actions for reward calculation
    
    event TokensEarned(address indexed citizen, uint256 amount, string actionType);
    
    
    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender), "Not authorized minter");
        _;
    }
    
    constructor() 
        ERC20("VOTER Governance Token", "VOTER")
        ERC20Permit("VOTER Governance Token")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        
        // Initial mint for platform development and community rewards
        _mint(msg.sender, INITIAL_MINT_CAP);
    }
    
    /**
     * @dev Mint VOTER tokens for verified civic actions
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     * @param actionType Type of civic action performed
     */
    function mintForCivicAction(
        address to,
        uint256 amount,
        string memory actionType
    ) external onlyMinter whenNotPaused {
        require(to != address(0), "Invalid recipient");
        
        _mint(to, amount);
        civicActions[to]++;
        
        emit TokensEarned(to, amount, actionType);
    }
    
    
    
    
    
    
    
    /**
     * @dev Burn tokens (for deflationary mechanism)
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(msg.sender, amount);
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    // Override required functions
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20) whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }
    
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }
    
    function _mint(
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }
    
    function _burn(
        address account,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}