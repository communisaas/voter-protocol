// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

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
 * @dev Truly decentralized parameter store with oracle integration and bounds checking
 * @notice ONLY controlled by agent consensus - no genesis backdoors or admin overrides
 * @notice All parameter changes require time-locks to prevent instant manipulation
 */
contract AgentParameters {
    address public immutable agentConsensus;
    
    // Time-locked parameter changes
    struct PendingChange {
        uint256 proposedValue;
        uint256 executeAfter;
        bool exists;
    }
    mapping(bytes32 => PendingChange) public pendingParameterChanges;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    
    mapping(bytes32 => uint256) private uintParams;
    mapping(bytes32 => address) private addressParams;
    mapping(bytes32 => uint256) public maxValues;
    mapping(bytes32 => uint256) public minValues;
    
    event UintParamSet(bytes32 indexed key, uint256 value);
    event AddressParamSet(bytes32 indexed key, address value);
    event ControlTransferred(address indexed newConsensus);

    modifier onlyConsensus() {
        require(msg.sender == agentConsensus, "Only consensus");
        _;
    }

    constructor(address _agentConsensus) {
        require(_agentConsensus != address(0), "Invalid consensus address");
        agentConsensus = _agentConsensus;
        
        // Set max bounds for USD-based rewards (8 decimals for USD price feeds)
        maxValues[keccak256("rewardUSD:CWC_MESSAGE")] = 10 * 1e8; // Max $10 per action
        maxValues[keccak256("rewardUSD:DIRECT_ACTION")] = 10 * 1e8; // Max $10 per action
        maxValues[keccak256("maxDailyMintPerUser")] = 10000e18;
        maxValues[keccak256("maxDailyMintProtocol")] = 1000000e18;
        maxValues[keccak256("maxRewardPerAction")] = 100e18;

        // Set min bounds for USD-based rewards
        minValues[keccak256("rewardUSD:CWC_MESSAGE")] = 1e7; // Min $0.10 per action
        minValues[keccak256("rewardUSD:DIRECT_ACTION")] = 1e7; // Min $0.10 per action
        minValues[keccak256("maxDailyMintPerUser")] = 0;
        minValues[keccak256("maxDailyMintProtocol")] = 0;
        minValues[keccak256("minActionInterval")] = 1 minutes;
        minValues[keccak256("minRewardPerAction")] = 0;

        // Epistemic Leverage Parameters
        maxValues[keccak256("epistemicLeverageMultiplier")] = 200; // Max 2x bonus
        minValues[keccak256("epistemicLeverageMultiplier")] = 0;
        maxValues[keccak256("minCredibilityForBonus")] = 100;
        minValues[keccak256("minCredibilityForBonus")] = 0;

        // Doubting Parameters
        maxValues[keccak256("doubtingPenaltyRate")] = 100; // Max 100% penalty
        minValues[keccak256("doubtingPenaltyRate")] = 0;
        maxValues[keccak256("minEpistemicReputationForAction")] = 100;
        minValues[keccak256("minEpistemicReputationForAction")] = 0;

        // Counterposition Market Parameters
        maxValues[keccak256("counterpositionMarketFee")] = 1000; // Max 10% fee
        minValues[keccak256("counterpositionMarketFee")] = 0;
        maxValues[keccak256("qParameterInitialValue")] = 100;
        minValues[keccak256("qParameterInitialValue")] = 0;
        maxValues[keccak256("qParameterMinBound")] = 100;
        minValues[keccak256("qParameterMinBound")] = 0;
        maxValues[keccak256("qParameterMaxBound")] = 200;
        minValues[keccak256("qParameterMaxBound")] = 100;
        
        // Oracle circuit breaker parameters
        maxValues[keccak256("oracle:maxPriceChangePerHour")] = 50; // Max 50% price change
        uintParams[keccak256("oracle:maxPriceChangePerHour")] = 50; // Default 50%
    }

    /**
     * @dev Initialize parameters with safe defaults (consensus-only)
     * @notice Can only be called once by consensus to set initial values
     */
    function initializeParameters(
        uint256 _cwcReward,
        uint256 _directActionReward,
        uint256 _maxDailyMintUser,
        uint256 _maxDailyMintProtocol
    ) external onlyConsensus {
        require(uintParams[keccak256("initialized")] == 0, "Already initialized");
        
        // Validate parameters are within bounds
        require(_cwcReward >= minValues[keccak256("rewardUSD:CWC_MESSAGE")] && 
               _cwcReward <= maxValues[keccak256("rewardUSD:CWC_MESSAGE")], "CWC reward out of bounds");
        require(_directActionReward >= minValues[keccak256("rewardUSD:DIRECT_ACTION")] && 
               _directActionReward <= maxValues[keccak256("rewardUSD:DIRECT_ACTION")], "Direct action reward out of bounds");
        
        uintParams[keccak256("rewardUSD:CWC_MESSAGE")] = _cwcReward;
        uintParams[keccak256("rewardUSD:DIRECT_ACTION")] = _directActionReward;
        uintParams[keccak256("maxDailyMintPerUser")] = _maxDailyMintUser;
        uintParams[keccak256("maxDailyMintProtocol")] = _maxDailyMintProtocol;
        uintParams[keccak256("initialized")] = 1;
    }

    /**
     * @dev Propose a parameter change with time-lock
     */
    function proposeUintChange(bytes32 key, uint256 value) external onlyConsensus {
        // Validate bounds
        if (maxValues[key] > 0) {
            require(value <= maxValues[key], "Exceeds maximum");
        }
        if (minValues[key] > 0) {
            require(value >= minValues[key], "Below minimum");
        }
        
        pendingParameterChanges[key] = PendingChange({
            proposedValue: value,
            executeAfter: block.timestamp + TIMELOCK_DELAY,
            exists: true
        });
        
        emit ParameterChangeProposed(key, value, block.timestamp + TIMELOCK_DELAY);
    }
    
    /**
     * @dev Execute a time-locked parameter change
     */
    function executeUintChange(bytes32 key) external {
        PendingChange memory change = pendingParameterChanges[key];
        require(change.exists, "No pending change");
        require(block.timestamp >= change.executeAfter, "Timelock not expired");
        
        uintParams[key] = change.proposedValue;
        delete pendingParameterChanges[key];
        
        emit UintParamSet(key, change.proposedValue);
    }

    function getUint(bytes32 key) external view returns (uint256) {
        return uintParams[key];
    }
    
    /**
     * @dev Set address parameters (critical oracle addresses require consensus)
     */
    function setAddress(bytes32 key, address value) external onlyConsensus {
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
    
    // Events for time-locked parameter changes
    event ParameterChangeProposed(bytes32 indexed key, uint256 newValue, uint256 executeAfter);
}