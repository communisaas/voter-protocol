// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AgentParameters
 * @dev Parameter store with basic bounds checking
 */
contract AgentParameters is AccessControl {
    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");

    mapping(bytes32 => uint256) private uintParams;
    mapping(bytes32 => uint256) public maxValues;
    mapping(bytes32 => uint256) public minValues; // New mapping
    
    event UintParamSet(bytes32 indexed key, uint256 value);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_SETTER_ROLE, admin);
        
        // Set max bounds
        maxValues[keccak256("reward:CWC_MESSAGE")] = 100e18;
        maxValues[keccak256("reward:DIRECT_ACTION")] = 100e18;
        maxValues[keccak256("maxDailyMintPerUser")] = 10000e18;
        maxValues[keccak256("maxDailyMintProtocol")] = 1000000e18;
        maxValues[keccak256("maxRewardPerAction")] = 100e18; // New: max for individual action reward

        // Set min bounds (new)
        minValues[keccak256("reward:CWC_MESSAGE")] = 1e18; // Example: min 1 CIVIC
        minValues[keccak256("reward:DIRECT_ACTION")] = 1e18; // Example: min 1 CIVIC
        minValues[keccak256("maxDailyMintPerUser")] = 0; // Can be 0
        minValues[keccak256("maxDailyMintProtocol")] = 0; // Can be 0
        minValues[keccak256("minActionInterval")] = 1 minutes; // Example: min 1 minute interval
        minValues[keccak256("minRewardPerAction")] = 0; // New: min for individual action reward (0 means no global min clamp by default)

        // New: Epistemic Leverage Parameters
        maxValues[keccak256("epistemicLeverageMultiplier")] = 200; // Max 2x bonus
        minValues[keccak256("epistemicLeverageMultiplier")] = 0;
        maxValues[keccak256("minCredibilityForBonus")] = 100; // Max credibility score is 100
        minValues[keccak256("minCredibilityForBonus")] = 0;

        // New: Doubting Parameters
        maxValues[keccak256("doubtingPenaltyRate")] = 100; // Max 100% penalty
        minValues[keccak256("doubtingPenaltyRate")] = 0;
        maxValues[keccak256("minEpistemicReputationForAction")] = 100; // Max reputation score is 100
        minValues[keccak256("minEpistemicReputationForAction")] = 0;

        // New: Counterposition Market Parameters
        maxValues[keccak256("counterpositionMarketFee")] = 1000; // Max 10% fee (1000 basis points)
        minValues[keccak256("counterpositionMarketFee")] = 0;
        maxValues[keccak256("qParameterInitialValue")] = 100; // Initial q value (e.g., 1.0)
        minValues[keccak256("qParameterInitialValue")] = 0;
        maxValues[keccak256("qParameterMinBound")] = 100; // Min q value (e.g., 1.0)
        minValues[keccak256("qParameterMinBound")] = 0;
        maxValues[keccak256("qParameterMaxBound")] = 200; // Max q value (e.g., 2.0)
        minValues[keccak256("qParameterMaxBound")] = 100;
    }

    function setUint(bytes32 key, uint256 value) external onlyRole(PARAM_SETTER_ROLE) {
        if (maxValues[key] > 0) {
            require(value <= maxValues[key], "Exceeds maximum");
        }
        // New: check against minValues
        if (minValues[key] > 0) {
            require(value >= minValues[key], "Below minimum");
        }
        uintParams[key] = value;
        emit UintParamSet(key, value);
    }

    function getUint(bytes32 key) external view returns (uint256) {
        return uintParams[key];
    }
}


