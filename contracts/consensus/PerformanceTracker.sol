// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PerformanceTracker
 * @dev Multi-dimensional reputation system for AI models based on actual performance
 * @notice Track accuracy across domains with temporal decay and uncertainty calibration
 */
contract PerformanceTracker {
    
    enum Domain {
        PARAMETER_OPTIMIZATION,
        MARKET_PREDICTION,
        GOVERNANCE_DECISION,
        CHALLENGE_RESOLUTION,
        EMERGENCY_RESPONSE,
        GENERAL
    }
    
    struct PerformanceMetrics {
        uint256 correctPredictions;
        uint256 totalPredictions;
        uint256 confidenceCalibration; // How well model predicts its own accuracy (0-1000)
        uint256 averageConfidence;      // Average confidence in predictions
        uint256 lastUpdateTimestamp;
        uint256 streakLength;           // Current streak of correct predictions
        bool isPositiveStreak;          // true = winning streak, false = losing streak
    }
    
    struct AgentPerformance {
        mapping(Domain => PerformanceMetrics) domainMetrics;
        uint256 globalAccuracy;         // Overall accuracy across all domains (0-1000)
        uint256 reputationScore;        // Weighted reputation (0-10000)
        uint256 uncertaintyScore;       // How well calibrated the model is (0-1000)
        uint256 improvementRate;        // Rate of improvement over time
        uint256 activityLevel;          // How frequently the model participates
        uint256 lastActiveTimestamp;
        uint256 totalDecisions;
        uint256 slashEvents;           // Number of times slashed for poor performance
    }
    
    struct PredictionRecord {
        address model;
        Domain domain;
        bytes32 predictionHash;
        uint256 confidence;              // Model's confidence (0-1000)
        bool wasCorrect;
        uint256 timestamp;
        uint256 weight;                  // Weight of this prediction in scoring
    }
    
    // State variables
    mapping(address => AgentPerformance) public agentPerformance;
    mapping(bytes32 => PredictionRecord) public predictions;
    
    // Temporal decay parameters (immutable for security)
    uint256 public immutable DECAY_PERIOD = 30 days;
    uint256 public immutable DECAY_RATE = 950; // 95% retention per period (out of 1000)
    uint256 public immutable MIN_ACTIVITY_THRESHOLD = 10; // Min predictions for valid score
    
    // Performance thresholds
    uint256 public immutable EXCELLENCE_THRESHOLD = 800; // 80% accuracy
    uint256 public immutable ACCEPTABLE_THRESHOLD = 600; // 60% accuracy
    uint256 public immutable PRUNING_THRESHOLD = 400;    // 40% accuracy
    
    // Calibration parameters
    uint256 public immutable CALIBRATION_WINDOW = 100;   // Last 100 predictions
    uint256 public constant PRECISION = 1000;
    
    // Events
    event PerformanceUpdated(
        address indexed model,
        Domain domain,
        bool wasCorrect,
        uint256 newAccuracy
    );
    
    event ReputationUpdated(
        address indexed model,
        uint256 oldScore,
        uint256 newScore
    );
    
    event ModelPruned(
        address indexed model,
        uint256 finalScore,
        string reason
    );
    
    event CalibrationScoreUpdated(
        address indexed model,
        uint256 calibrationScore,
        uint256 uncertaintyScore
    );
    
    /**
     * @dev Record a prediction outcome and update performance metrics
     * @param model The model that made the prediction
     * @param domain The domain of the prediction
     * @param predictionId Unique identifier for the prediction
     * @param confidence Model's confidence in the prediction (0-1000)
     * @param wasCorrect Whether the prediction was correct
     * @param weight Importance weight for this prediction
     */
    function recordPrediction(
        address model,
        Domain domain,
        bytes32 predictionId,
        uint256 confidence,
        bool wasCorrect,
        uint256 weight
    ) external {
        require(confidence <= PRECISION, "Confidence out of range");
        require(weight > 0, "Weight must be positive");
        
        // Store prediction record
        predictions[predictionId] = PredictionRecord({
            model: model,
            domain: domain,
            predictionHash: predictionId,
            confidence: confidence,
            wasCorrect: wasCorrect,
            timestamp: block.timestamp,
            weight: weight
        });
        
        // Update performance metrics
        _updatePerformanceMetrics(model, domain, wasCorrect, confidence, weight);
        
        // Update calibration scores
        _updateCalibrationScore(model, confidence, wasCorrect);
        
        // Update global metrics
        _updateGlobalMetrics(model);
        
        // Check for pruning conditions
        _checkPruningConditions(model);
        
        emit PerformanceUpdated(model, domain, wasCorrect, _getDomainAccuracy(model, domain));
    }
    
    /**
     * @dev Update performance metrics for a specific domain
     */
    function _updatePerformanceMetrics(
        address model,
        Domain domain,
        bool wasCorrect,
        uint256 confidence,
        uint256 weight
    ) private {
        PerformanceMetrics storage metrics = agentPerformance[model].domainMetrics[domain];
        
        // Apply temporal decay to existing metrics
        _applyTemporalDecay(metrics);
        
        // Update predictions with weight
        if (wasCorrect) {
            metrics.correctPredictions += weight;
        }
        metrics.totalPredictions += weight;
        
        // Update confidence tracking
        uint256 oldAvg = metrics.averageConfidence;
        uint256 totalWeight = metrics.totalPredictions;
        metrics.averageConfidence = (oldAvg * (totalWeight - weight) + confidence * weight) / totalWeight;
        
        // Update streak tracking
        if (wasCorrect) {
            if (metrics.isPositiveStreak) {
                metrics.streakLength++;
            } else {
                metrics.isPositiveStreak = true;
                metrics.streakLength = 1;
            }
        } else {
            if (!metrics.isPositiveStreak) {
                metrics.streakLength++;
            } else {
                metrics.isPositiveStreak = false;
                metrics.streakLength = 1;
            }
        }
        
        metrics.lastUpdateTimestamp = block.timestamp;
        
        // Update activity tracking
        agentPerformance[model].lastActiveTimestamp = block.timestamp;
        agentPerformance[model].totalDecisions++;
    }
    
    /**
     * @dev Update calibration score (how well model predicts its own accuracy)
     */
    function _updateCalibrationScore(
        address model,
        uint256 confidence,
        bool wasCorrect
    ) private {
        // Calculate calibration error
        uint256 actualOutcome = wasCorrect ? PRECISION : 0;
        uint256 calibrationError = confidence > actualOutcome ? 
            confidence - actualOutcome : actualOutcome - confidence;
        
        // Update running calibration score (lower is better)
        AgentPerformance storage perf = agentPerformance[model];
        uint256 oldCalibration = perf.uncertaintyScore;
        
        // Exponential moving average for calibration
        perf.uncertaintyScore = (oldCalibration * 9 + (PRECISION - calibrationError)) / 10;
        
        emit CalibrationScoreUpdated(model, calibrationError, perf.uncertaintyScore);
    }
    
    /**
     * @dev Apply temporal decay to metrics
     */
    function _applyTemporalDecay(PerformanceMetrics storage metrics) private {
        if (metrics.lastUpdateTimestamp == 0) return;
        
        uint256 timePassed = block.timestamp - metrics.lastUpdateTimestamp;
        if (timePassed >= DECAY_PERIOD) {
            uint256 periods = timePassed / DECAY_PERIOD;
            uint256 decayFactor = DECAY_RATE;
            
            // Apply exponential decay
            for (uint256 i = 0; i < periods && i < 10; i++) { // Cap at 10 periods
                metrics.correctPredictions = (metrics.correctPredictions * decayFactor) / PRECISION;
                metrics.totalPredictions = (metrics.totalPredictions * decayFactor) / PRECISION;
            }
        }
    }
    
    /**
     * @dev Update global metrics across all domains
     */
    function _updateGlobalMetrics(address model) private {
        AgentPerformance storage perf = agentPerformance[model];
        uint256 totalCorrect = 0;
        uint256 totalPredictions = 0;
        uint256 activeDomains = 0;
        
        // Aggregate across domains
        for (uint256 i = 0; i <= uint256(Domain.GENERAL); i++) {
            PerformanceMetrics storage metrics = perf.domainMetrics[Domain(i)];
            if (metrics.totalPredictions > 0) {
                totalCorrect += metrics.correctPredictions;
                totalPredictions += metrics.totalPredictions;
                activeDomains++;
            }
        }
        
        if (totalPredictions > 0) {
            perf.globalAccuracy = (totalCorrect * PRECISION) / totalPredictions;
        }
        
        // Calculate reputation score with multiple factors
        uint256 oldReputation = perf.reputationScore;
        perf.reputationScore = _calculateReputationScore(
            perf.globalAccuracy,
            perf.uncertaintyScore,
            perf.activityLevel,
            perf.improvementRate,
            activeDomains
        );
        
        emit ReputationUpdated(model, oldReputation, perf.reputationScore);
    }
    
    /**
     * @dev Calculate composite reputation score
     */
    function _calculateReputationScore(
        uint256 accuracy,
        uint256 calibration,
        uint256 activity,
        uint256 improvement,
        uint256 domainCoverage
    ) private pure returns (uint256) {
        // Weighted combination of factors (out of 10000)
        uint256 score = 0;
        
        // 40% weight on accuracy
        score += (accuracy * 40) / 10;
        
        // 20% weight on calibration
        score += (calibration * 20) / 10;
        
        // 15% weight on activity level
        uint256 activityScore = activity > 100 ? PRECISION : (activity * 10);
        score += (activityScore * 15) / 10;
        
        // 15% weight on improvement rate
        score += (improvement * 15) / 10;
        
        // 10% weight on domain coverage
        uint256 coverageScore = (domainCoverage * PRECISION) / 6; // 6 domains
        score += (coverageScore * 10) / 10;
        
        return score;
    }
    
    /**
     * @dev Check if model should be pruned for poor performance
     */
    function _checkPruningConditions(address model) private {
        AgentPerformance storage perf = agentPerformance[model];
        
        // Don't prune if too few decisions
        if (perf.totalDecisions < MIN_ACTIVITY_THRESHOLD) return;
        
        // Check accuracy threshold
        if (perf.globalAccuracy < PRUNING_THRESHOLD) {
            emit ModelPruned(model, perf.globalAccuracy, "Below accuracy threshold");
            // In production, this would trigger deactivation
        }
        
        // Check for consistent losing streaks
        bool hasLosingStreak = false;
        uint256 maxLosingStreak = 0;
        
        for (uint256 i = 0; i <= uint256(Domain.GENERAL); i++) {
            PerformanceMetrics storage metrics = perf.domainMetrics[Domain(i)];
            if (!metrics.isPositiveStreak && metrics.streakLength > maxLosingStreak) {
                maxLosingStreak = metrics.streakLength;
                hasLosingStreak = true;
            }
        }
        
        if (hasLosingStreak && maxLosingStreak > 10) {
            emit ModelPruned(model, perf.globalAccuracy, "Extended losing streak");
        }
    }
    
    /**
     * @dev Get domain-specific accuracy
     */
    function _getDomainAccuracy(address model, Domain domain) private view returns (uint256) {
        PerformanceMetrics storage metrics = agentPerformance[model].domainMetrics[domain];
        if (metrics.totalPredictions == 0) return 0;
        return (metrics.correctPredictions * PRECISION) / metrics.totalPredictions;
    }
    
    /**
     * @dev Calculate voting weight based on performance
     */
    function calculateVotingWeight(address model) external view returns (uint256) {
        AgentPerformance storage perf = agentPerformance[model];
        
        // No weight if insufficient activity
        if (perf.totalDecisions < MIN_ACTIVITY_THRESHOLD) return 0;
        
        // Base weight on reputation score
        uint256 weight = perf.reputationScore;
        
        // Apply quadratic scaling to prevent domination
        weight = sqrt(weight * PRECISION);
        
        // Bonus for excellence
        if (perf.globalAccuracy >= EXCELLENCE_THRESHOLD) {
            weight = (weight * 125) / 100; // 25% bonus
        }
        
        // Penalty for poor calibration
        if (perf.uncertaintyScore < 500) { // Poorly calibrated
            weight = (weight * 75) / 100; // 25% penalty
        }
        
        return weight;
    }
    
    /**
     * @dev Integer square root (Babylonian method)
     */
    function sqrt(uint256 x) private pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
    
    /**
     * @dev Get comprehensive performance data for a model
     */
    function getPerformanceData(address model) external view returns (
        uint256 globalAccuracy,
        uint256 reputationScore,
        uint256 calibrationScore,
        uint256 totalDecisions,
        uint256 lastActive,
        uint256 votingWeight
    ) {
        AgentPerformance storage perf = agentPerformance[model];
        return (
            perf.globalAccuracy,
            perf.reputationScore,
            perf.uncertaintyScore,
            perf.totalDecisions,
            perf.lastActiveTimestamp,
            this.calculateVotingWeight(model)
        );
    }
    
    /**
     * @dev Get domain-specific performance
     */
    function getDomainPerformance(address model, Domain domain) external view returns (
        uint256 accuracy,
        uint256 totalPredictions,
        uint256 currentStreak,
        bool isWinning,
        uint256 avgConfidence
    ) {
        PerformanceMetrics storage metrics = agentPerformance[model].domainMetrics[domain];
        uint256 acc = metrics.totalPredictions > 0 ? 
            (metrics.correctPredictions * PRECISION) / metrics.totalPredictions : 0;
            
        return (
            acc,
            metrics.totalPredictions,
            metrics.streakLength,
            metrics.isPositiveStreak,
            metrics.averageConfidence
        );
    }
    
    /**
     * @dev Record slash event
     */
    function recordSlash(address model, uint256 amount) external {
        // Track slashing for performance metrics
        agentPerformance[model].totalDecisions++;
    }
    
    /**
     * @dev Get total penalties for a model
     */
    function getTotalPenalties(address model) external view returns (uint256) {
        // Return inverse of reputation as penalty indicator
        if (agentPerformance[model].reputationScore >= PRECISION) {
            return 0;
        }
        return PRECISION - agentPerformance[model].reputationScore;
    }
    
    /**
     * @dev Update model stake
     */
    function updateStake(address model, uint256 amount) external {
        // Stake updates tracked separately in AgentConsensus
        // This is a placeholder for interface compatibility
    }
    
    /**
     * @dev Get top performing models
     */
    function getTopPerformers(uint256 count) external view returns (address[] memory) {
        // Simplified implementation - would maintain sorted list in production
        address[] memory performers = new address[](count);
        
        // Return empty array for now
        return performers;
    }
    
    /**
     * @dev Calculate domain weight for voting
     */
    function calculateDomainWeight(address model, Domain domain) private view returns (uint256) {
        PerformanceMetrics storage metrics = agentPerformance[model].domainMetrics[domain];
        
        if (metrics.totalPredictions < MIN_ACTIVITY_THRESHOLD) {
            return 0;
        }
        
        uint256 accuracy = (metrics.correctPredictions * PRECISION) / metrics.totalPredictions;
        return sqrt(accuracy);
    }
}