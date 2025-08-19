// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CivicNetworkAnalyzer
 * @dev On-chain network analysis for civic information flow
 */
contract CivicNetworkAnalyzer is AccessControl {
    bytes32 public constant ANALYZER_ROLE = keccak256("ANALYZER_ROLE");

    struct NetworkNode {
        address user;
        uint256 state;
        uint256 district;
        uint256 activationProbability; // scaled by 1e18
        uint256 templateCount;
    }
    
    struct InformationFlow {
        address from_user;
        address to_user;
        uint256 weight; // scaled by 1e18
        uint256 timestamp;
    }
    
    struct CascadeMetrics {
        uint256 thresholdProbability; // scaled by 1e18
        uint256 maxFlowCapacity;
        uint256 networkSize;
        uint256 timestamp;
    }

    mapping(address => NetworkNode) public nodes;
    mapping(bytes32 => InformationFlow) public flows; // keccak256(from, to) => flow
    mapping(uint256 => CascadeMetrics) public dailyMetrics; // day => metrics
    
    address[] public activeUsers;
    uint256 public currentThreshold;
    
    event NetworkNodeUpdated(address indexed user, uint256 activationProbability);
    event InformationFlowRecorded(address indexed from, address indexed to, uint256 weight);
    event CascadeAnalysisComplete(uint256 threshold, uint256 maxFlow);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ANALYZER_ROLE, admin);
    }

    function updateNetworkNode(
        address user,
        uint256 state,
        uint256 district,
        uint256 activationProbability,
        uint256 templateCount
    ) external onlyRole(ANALYZER_ROLE) {
        NetworkNode storage node = nodes[user];
        
        if (node.user == address(0)) {
            activeUsers.push(user);
        }
        
        node.user = user;
        node.state = state;
        node.district = district;
        node.activationProbability = activationProbability;
        node.templateCount = templateCount;
        
        emit NetworkNodeUpdated(user, activationProbability);
    }

    function recordInformationFlow(
        address from_user,
        address to_user,
        uint256 weight
    ) external onlyRole(ANALYZER_ROLE) {
        bytes32 flowId = keccak256(abi.encodePacked(from_user, to_user));
        
        flows[flowId] = InformationFlow({
            from_user: from_user,
            to_user: to_user,
            weight: weight,
            timestamp: block.timestamp
        });
        
        emit InformationFlowRecorded(from_user, to_user, weight);
    }

    function calculatePercolationThreshold() external onlyRole(ANALYZER_ROLE) returns (uint256) {
        uint256 totalActivation = 0;
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < activeUsers.length; i++) {
            NetworkNode memory node = nodes[activeUsers[i]];
            if (node.user != address(0)) {
                totalActivation += node.activationProbability;
                activeCount++;
            }
        }
        
        if (activeCount == 0) return 0;
        
        // Simple threshold = 80% of average activation probability
        uint256 threshold = (totalActivation * 8) / (activeCount * 10);
        currentThreshold = threshold;
        
        return threshold;
    }

    function storeDailyMetrics(
        uint256 day,
        uint256 thresholdProbability,
        uint256 maxFlowCapacity,
        uint256 networkSize
    ) external onlyRole(ANALYZER_ROLE) {
        dailyMetrics[day] = CascadeMetrics({
            thresholdProbability: thresholdProbability,
            maxFlowCapacity: maxFlowCapacity,
            networkSize: networkSize,
            timestamp: block.timestamp
        });
        
        emit CascadeAnalysisComplete(thresholdProbability, maxFlowCapacity);
    }

    function getNetworkNode(address user) external view returns (NetworkNode memory) {
        return nodes[user];
    }
    
    function getActiveUsersCount() external view returns (uint256) {
        return activeUsers.length;
    }
    
    function getDailyMetrics(uint256 day) external view returns (CascadeMetrics memory) {
        return dailyMetrics[day];
    }
}