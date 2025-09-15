// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

// Chainlink Price Feed Interface
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId, 
        int256 answer, 
        uint256 startedAt, 
        uint256 updatedAt, 
        uint80 answeredInRound
    );
}

/**
 * @title AgentParameters
 * @dev Parameter store with oracle integration and bounds checking
 * @notice Manages dynamic USD-pegged rewards through multi-oracle consensus
 */
contract AgentParameters is AccessControl {
    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");

    mapping(bytes32 => uint256) private uintParams;
    mapping(bytes32 => address) private addressParams;
    mapping(bytes32 => uint256) public maxValues;
    mapping(bytes32 => uint256) public minValues;
    
    event UintParamSet(bytes32 indexed key, uint256 value);
    event AddressParamSet(bytes32 indexed key, address value);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_SETTER_ROLE, admin);
        
        // Set max bounds for USD-based rewards (8 decimals for USD price feeds)
        maxValues[keccak256("rewardUSD:CWC_MESSAGE")] = 10 * 1e8; // Max $10 per action
        maxValues[keccak256("rewardUSD:DIRECT_ACTION")] = 10 * 1e8; // Max $10 per action
        maxValues[keccak256("maxDailyMintPerUser")] = 10000e18;
        maxValues[keccak256("maxDailyMintProtocol")] = 1000000e18;
        maxValues[keccak256("maxRewardPerAction")] = 100e18; // New: max for individual action reward

        // Set min bounds for USD-based rewards
        minValues[keccak256("rewardUSD:CWC_MESSAGE")] = 1e7; // Min $0.10 per action
        minValues[keccak256("rewardUSD:DIRECT_ACTION")] = 1e7; // Min $0.10 per action
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
        
        // Set initial USD reward values (can be updated by governance)
        uintParams[keccak256("rewardUSD:CWC_MESSAGE")] = 1e7; // $0.10 default
        uintParams[keccak256("rewardUSD:DIRECT_ACTION")] = 1e7; // $0.10 default
        
        // Oracle circuit breaker parameters
        maxValues[keccak256("oracle:maxPriceChangePerHour")] = 50; // Max 50% price change per hour
        uintParams[keccak256("oracle:maxPriceChangePerHour")] = 50; // Default 50%
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
    
    function setAddress(bytes32 key, address value) external onlyRole(PARAM_SETTER_ROLE) {
        require(value != address(0), "Zero address");
        addressParams[key] = value;
        emit AddressParamSet(key, value);
    }
    
    function getAddress(bytes32 key) external view returns (address) {
        return addressParams[key];
    }
    
    /**
     * @dev Get oracle consensus price from multiple feeds
     * @return price Consensus price in USD with 8 decimals
     * @return isValid Whether the price is valid based on circuit breaker rules
     */
    function getOracleConsensusPrice() external view returns (uint256 price, bool isValid) {
        address chainlinkFeed = addressParams[keccak256("oracle:VOTER_USD_Chainlink")];
        address redstoneFeed = addressParams[keccak256("oracle:VOTER_USD_Redstone")];
        
        // If no oracles configured, return invalid price to trigger fallback
        if (chainlinkFeed == address(0) && redstoneFeed == address(0)) {
            return (0, false);
        }
        
        uint256[] memory prices = new uint256[](2);
        uint256 validPrices = 0;
        
        // Get Chainlink price
        if (chainlinkFeed != address(0)) {
            try IAggregatorV3(chainlinkFeed).latestRoundData() returns (
                uint80, int256 answer, uint256, uint256 updatedAt, uint80
            ) {
                uint256 minTimestamp = block.timestamp > 3600 ? block.timestamp - 3600 : 0;
                if (answer > 0 && updatedAt > minTimestamp) { // Price updated within last hour
                    prices[validPrices++] = uint256(answer);
                }
            } catch {}
        }
        
        // Get RedStone price (same interface as Chainlink)
        if (redstoneFeed != address(0)) {
            try IAggregatorV3(redstoneFeed).latestRoundData() returns (
                uint80, int256 answer, uint256, uint256 updatedAt, uint80
            ) {
                uint256 minTimestamp = block.timestamp > 3600 ? block.timestamp - 3600 : 0;
                if (answer > 0 && updatedAt > minTimestamp) {
                    prices[validPrices++] = uint256(answer);
                }
            } catch {}
        }
        
        require(validPrices > 0, "No valid oracle prices");
        
        // Calculate average of valid prices
        uint256 sum = 0;
        for (uint256 i = 0; i < validPrices; i++) {
            sum += prices[i];
        }
        price = sum / validPrices;
        
        // Check circuit breaker (would need previous price storage for full implementation)
        isValid = true; // Simplified - in production, check against previous hour's price
        
        return (price, isValid);
    }
}


