"""
Market Agent - Optimizes economic incentives
"""

from typing import Dict, Any
import math
from agents.base_agent import BaseAgent
from agents.config import SAFETY_RAILS


class MarketAgent(BaseAgent):
    """
    Optimizes reward amounts based on impact measurement
    Balances token distribution for maximum participation
    """
    
    def __init__(self):
        super().__init__("market_agent")
        self.min_reward = self.config["min_reward"]
        self.max_reward = self.config["max_reward"]
        
    async def calculate_reward(
        self,
        action_type: str,
        user_reputation: int,
        current_participation: int
    ) -> int:
        """
        Calculate optimal reward amount for an action
        """
        # Base rewards by action type
        base_rewards = {
            "cwc_message": 10 * 10**18,  # 10 VOTER
            "direct_action": 5 * 10**18,  # 5 VOTER
            "challenge_market": 20 * 10**18,  # 20 VOTER
        }
        
        base_reward = base_rewards.get(action_type, 5 * 10**18)
        
        # Apply reputation multiplier (0.5x to 2x)
        reputation_multiplier = self._calculate_reputation_multiplier(user_reputation)
        
        # Apply participation adjustment (inverse relationship)
        participation_multiplier = self._calculate_participation_multiplier(current_participation)
        
        # Calculate final reward
        reward = int(base_reward * reputation_multiplier * participation_multiplier)
        
        # Apply bounds
        reward = max(self.min_reward, min(self.max_reward, reward))
        
        # Learn from this calculation
        self.remember(
            decision="calculate_reward",
            context={
                "action_type": action_type,
                "reputation": user_reputation,
                "participation": current_participation
            },
            outcome={
                "reward": reward,
                "effectiveness": 0.5  # Will be updated based on impact
            }
        )
        
        return reward
    
    def _calculate_reputation_multiplier(self, reputation: int) -> float:
        """
        Calculate reward multiplier based on reputation (0-100 scale)
        Higher reputation = higher rewards (incentivize quality)
        """
        if reputation >= 80:
            return 2.0
        elif reputation >= 60:
            return 1.5
        elif reputation >= 40:
            return 1.2
        elif reputation >= 20:
            return 1.0
        else:
            return 0.5
    
    def _calculate_participation_multiplier(self, participation: int) -> float:
        """
        Calculate reward multiplier based on current participation
        Higher participation = lower rewards (natural equilibrium)
        """
        if participation < 100:
            return 1.5  # Low participation, boost rewards
        elif participation < 500:
            return 1.2
        elif participation < 1000:
            return 1.0
        elif participation < 5000:
            return 0.8
        else:
            return 0.6  # High participation, reduce rewards
    
    async def optimize_incentives(
        self,
        current_metrics: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Optimize incentive structure based on current metrics
        """
        avg_participation = current_metrics.get("avg_participation", 1000)
        avg_impact = current_metrics.get("avg_impact", 0.5)
        token_velocity = current_metrics.get("token_velocity", 1.0)
        
        adjustments = {}
        
        # If impact is low but participation is high, reduce rewards
        if avg_impact < 0.4 and avg_participation > 2000:
            adjustments["reward_multiplier"] = 0.8
            adjustments["reason"] = "High participation with low impact"
        
        # If impact is high but participation is low, increase rewards
        elif avg_impact > 0.7 and avg_participation < 500:
            adjustments["reward_multiplier"] = 1.3
            adjustments["reason"] = "High impact potential with low participation"
        
        # If token velocity is too high (dumping), reduce rewards
        elif token_velocity > 2.0:
            adjustments["reward_multiplier"] = 0.7
            adjustments["reason"] = "High token velocity indicating selling pressure"
        
        else:
            adjustments["reward_multiplier"] = 1.0
            adjustments["reason"] = "Balanced metrics"
        
        # Store optimization decision
        self.remember(
            decision="optimize_incentives",
            context=current_metrics,
            outcome=adjustments
        )
        
        return adjustments
    
    async def calculate_market_dynamics(
        self,
        supply: int,
        demand: int,
        price: float
    ) -> Dict[str, Any]:
        """
        Calculate market dynamics and suggest adjustments
        """
        # Simple supply/demand ratio
        sd_ratio = supply / max(demand, 1)
        
        # Price elasticity estimation
        elasticity = self._estimate_elasticity(price, demand)
        
        # Market health score (0-1)
        health_score = self._calculate_market_health(sd_ratio, elasticity, price)
        
        recommendations = []
        
        if sd_ratio > 2:
            recommendations.append("Reduce token emissions")
        elif sd_ratio < 0.5:
            recommendations.append("Increase token emissions")
        
        if elasticity < 0.5:
            recommendations.append("Market is inelastic - focus on utility")
        elif elasticity > 1.5:
            recommendations.append("Market is elastic - stabilize rewards")
        
        return {
            "supply_demand_ratio": sd_ratio,
            "price_elasticity": elasticity,
            "market_health": health_score,
            "recommendations": recommendations
        }
    
    def _estimate_elasticity(self, price: float, demand: int) -> float:
        """Estimate price elasticity of demand"""
        # Simplified elasticity calculation
        # Real implementation would use historical data
        if price <= 0:
            return 1.0
        
        # Assume 1% price change
        price_change = 0.01
        # Estimate demand change (simplified)
        demand_change = -0.015 * (demand / 1000)  # Higher demand = more elastic
        
        return abs(demand_change / price_change)
    
    def _calculate_market_health(
        self,
        sd_ratio: float,
        elasticity: float,
        price: float
    ) -> float:
        """Calculate overall market health score"""
        health = 1.0
        
        # Penalize extreme supply/demand ratios
        if sd_ratio > 3 or sd_ratio < 0.3:
            health *= 0.5
        elif sd_ratio > 2 or sd_ratio < 0.5:
            health *= 0.7
        
        # Penalize extreme elasticity
        if elasticity > 2 or elasticity < 0.3:
            health *= 0.6
        
        # Penalize very low prices
        if price < 0.01:
            health *= 0.5
        
        return max(0, min(1, health))
    
    async def prevent_gaming(
        self,
        user_address: str,
        recent_rewards: list
    ) -> Dict[str, Any]:
        """
        Detect and prevent gaming of the reward system
        """
        gaming_indicators = []
        risk_score = 0
        
        # Check for reward farming patterns
        if len(recent_rewards) > 20:
            # User claiming too frequently
            gaming_indicators.append("excessive_claims")
            risk_score += 0.4
        
        # Check for coordinated claiming (simplified)
        claim_times = [r["timestamp"] for r in recent_rewards]
        if self._detect_coordinated_pattern(claim_times):
            gaming_indicators.append("coordinated_claiming")
            risk_score += 0.5
        
        # Recommend action
        if risk_score > 0.7:
            action = "reduce_rewards"
            multiplier = 0.3
        elif risk_score > 0.4:
            action = "monitor"
            multiplier = 0.7
        else:
            action = "normal"
            multiplier = 1.0
        
        return {
            "risk_score": min(1.0, risk_score),
            "gaming_indicators": gaming_indicators,
            "action": action,
            "reward_multiplier": multiplier
        }
    
    def _detect_coordinated_pattern(self, timestamps: list) -> bool:
        """Detect coordinated claiming patterns"""
        if len(timestamps) < 3:
            return False
        
        # Check for regular intervals (bot-like behavior)
        intervals = []
        for i in range(1, len(timestamps)):
            intervals.append(timestamps[i] - timestamps[i-1])
        
        # If intervals are too regular, likely coordinated
        if intervals:
            avg_interval = sum(intervals) / len(intervals)
            variance = sum((i - avg_interval) ** 2 for i in intervals) / len(intervals)
            
            # Low variance = regular pattern = suspicious
            return variance < (avg_interval * 0.1) ** 2
        
        return False
    
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing entry point"""
        reward = await self.calculate_reward(
            kwargs.get("action_type", "direct_action"),
            kwargs.get("user_reputation", 50),
            kwargs.get("current_participation", 1000)
        )
        return {"reward": reward}
    
    async def validate(self, **kwargs) -> bool:
        """Validate market parameters"""
        reward = kwargs.get("reward", 0)
        return self.min_reward <= reward <= self.max_reward