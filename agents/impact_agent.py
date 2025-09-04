"""
Impact Agent - Measures real-world outcomes
"""

from typing import Dict, Any, List
from datetime import datetime, timedelta
from agents.base_agent import BaseAgent


class ImpactAgent(BaseAgent):
    """
    Tracks legislative responses to civic actions
    Calculates effectiveness of different engagement types
    """
    
    def __init__(self):
        super().__init__("impact_agent")
        self.measurement_interval = self.config["measurement_interval"]
        self.impact_threshold = self.config["impact_threshold"]
        
    async def measure_impact(
        self,
        action_type: str,
        action_data: Dict[str, Any],
        district: str = None
    ) -> Dict[str, Any]:
        """
        Measure the real-world impact of a civic action
        """
        # Different impact metrics by action type
        if action_type == "cwc_message":
            impact = await self._measure_legislative_impact(action_data, district)
        elif action_type == "direct_action":
            impact = await self._measure_direct_impact(action_data)
        elif action_type == "challenge_market":
            impact = await self._measure_discourse_impact(action_data)
        else:
            impact = {"score": 0.5, "category": "unknown"}
        
        # Calculate overall effectiveness
        effectiveness = self._calculate_effectiveness(impact)
        
        # Learn from this measurement
        self.remember(
            decision="measure_impact",
            context={
                "action_type": action_type,
                "district": district
            },
            outcome={
                "impact_score": impact["score"],
                "effectiveness": effectiveness
            }
        )
        
        return {
            "score": impact["score"],
            "effectiveness": effectiveness,
            "category": impact["category"],
            "metrics": impact.get("metrics", {}),
            "recommendation": self._get_recommendation(impact["score"])
        }
    
    async def _measure_legislative_impact(
        self,
        action_data: Dict[str, Any],
        district: str
    ) -> Dict[str, Any]:
        """
        Measure impact of congressional messages
        """
        # TODO: Implement actual legislative tracking
        # For now, use heuristics based on message quality
        
        message = action_data.get("message", "")
        representative = action_data.get("representative", "")
        
        # Score based on message characteristics
        score = 0.5  # Base score
        
        # Quality indicators
        if len(message) > 500:
            score += 0.1  # Detailed message
        if "specific bill" in message.lower() or "hr" in message.lower():
            score += 0.15  # References specific legislation
        if "constituent" in message.lower():
            score += 0.05  # Self-identifies as constituent
        
        # District alignment
        if district and district in action_data.get("district", ""):
            score += 0.1  # Correct district
        
        # Cap at 1.0
        score = min(1.0, score)
        
        return {
            "score": score,
            "category": "legislative",
            "metrics": {
                "message_quality": score,
                "district_aligned": district == action_data.get("district"),
                "representative": representative
            }
        }
    
    async def _measure_direct_impact(
        self,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Measure impact of direct civic actions
        """
        action_subtype = action_data.get("subtype", "")
        participants = action_data.get("participants", 1)
        
        score = 0.4  # Base score for direct action
        
        # Scale by participation
        if participants > 100:
            score += 0.3
        elif participants > 50:
            score += 0.2
        elif participants > 10:
            score += 0.1
        
        # Boost for specific action types
        high_impact_actions = ["rally", "townhall", "petition", "campaign"]
        if any(action in action_subtype.lower() for action in high_impact_actions):
            score += 0.2
        
        score = min(1.0, score)
        
        return {
            "score": score,
            "category": "direct_action",
            "metrics": {
                "participation": participants,
                "action_type": action_subtype,
                "collective_impact": participants > 50
            }
        }
    
    async def _measure_discourse_impact(
        self,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Measure impact of challenge market participation
        """
        quality_score = action_data.get("quality_score", 50)
        stake_amount = action_data.get("stake_amount", 0)
        resolution = action_data.get("resolution", "pending")
        
        # Base score from quality
        score = quality_score / 100
        
        # Adjust based on stake (skin in the game)
        if stake_amount > 100 * 10**18:
            score *= 1.2
        elif stake_amount > 50 * 10**18:
            score *= 1.1
        
        # Adjust based on resolution
        if resolution == "supported":
            score *= 1.1
        elif resolution == "opposed" and quality_score > 60:
            score *= 0.9  # Good quality but wrong side
        
        score = min(1.0, score)
        
        return {
            "score": score,
            "category": "discourse",
            "metrics": {
                "quality_score": quality_score,
                "stake_amount": stake_amount,
                "resolution": resolution
            }
        }
    
    def _calculate_effectiveness(self, impact: Dict[str, Any]) -> float:
        """
        Calculate overall effectiveness score
        """
        score = impact["score"]
        category = impact["category"]
        
        # Weight by category importance
        category_weights = {
            "legislative": 1.0,
            "direct_action": 0.8,
            "discourse": 0.6,
            "unknown": 0.3
        }
        
        weight = category_weights.get(category, 0.5)
        return score * weight
    
    def _get_recommendation(self, score: float) -> str:
        """
        Get recommendation based on impact score
        """
        if score >= 0.8:
            return "Highly effective - increase rewards"
        elif score >= 0.6:
            return "Effective - maintain current incentives"
        elif score >= 0.4:
            return "Moderate impact - consider optimization"
        else:
            return "Low impact - review and adjust strategy"
    
    async def track_outcomes(
        self,
        action_ids: List[str],
        time_window: int = 604800  # 1 week
    ) -> Dict[str, Any]:
        """
        Track outcomes over time for multiple actions
        """
        # Recall historical data
        historical = []
        for action_id in action_ids:
            past = self.recall_similar({"action_id": action_id}, n_results=10)
            historical.extend(past)
        
        if not historical:
            return {
                "trend": "insufficient_data",
                "average_impact": 0.5,
                "improvement_rate": 0
            }
        
        # Calculate trends
        recent = [h for h in historical if 
                 datetime.now() - datetime.fromisoformat(h["timestamp"]) < timedelta(seconds=time_window)]
        
        older = [h for h in historical if h not in recent]
        
        recent_avg = sum(h["outcome"]["impact_score"] for h in recent) / len(recent) if recent else 0.5
        older_avg = sum(h["outcome"]["impact_score"] for h in older) / len(older) if older else 0.5
        
        improvement = (recent_avg - older_avg) / older_avg if older_avg > 0 else 0
        
        return {
            "trend": "improving" if improvement > 0.1 else "declining" if improvement < -0.1 else "stable",
            "average_impact": recent_avg,
            "improvement_rate": improvement,
            "sample_size": len(historical)
        }
    
    async def calculate_roi(
        self,
        total_rewards: int,
        total_impact: float,
        participation_change: float
    ) -> Dict[str, Any]:
        """
        Calculate return on investment for rewards
        """
        # Simple ROI calculation
        if total_rewards == 0:
            roi = 0
        else:
            # Impact value (subjective - could be tied to real metrics)
            impact_value = total_impact * 1000 * 10**18  # 1000 VOTER per impact point
            roi = (impact_value - total_rewards) / total_rewards
        
        # Efficiency score
        efficiency = total_impact / (total_rewards / 10**18) if total_rewards > 0 else 0
        
        # Growth assessment
        if participation_change > 0.2:
            growth = "high"
        elif participation_change > 0.05:
            growth = "moderate"
        elif participation_change > -0.05:
            growth = "stable"
        else:
            growth = "declining"
        
        return {
            "roi": roi,
            "efficiency": efficiency,
            "growth": growth,
            "recommendation": self._get_roi_recommendation(roi, efficiency)
        }
    
    def _get_roi_recommendation(self, roi: float, efficiency: float) -> str:
        """Get recommendation based on ROI"""
        if roi > 0.5 and efficiency > 0.001:
            return "Excellent ROI - scale up program"
        elif roi > 0 and efficiency > 0.0005:
            return "Positive ROI - maintain current levels"
        elif roi > -0.2:
            return "Marginal ROI - optimize parameters"
        else:
            return "Negative ROI - reduce rewards or improve targeting"
    
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing entry point"""
        return await self.measure_impact(
            kwargs.get("action_type", ""),
            kwargs.get("action_data", {}),
            kwargs.get("district")
        )
    
    async def validate(self, **kwargs) -> bool:
        """Validate impact measurement"""
        result = await self.measure_impact(
            kwargs.get("action_type", ""),
            kwargs.get("action_data", {}),
            kwargs.get("district")
        )
        return result["score"] >= self.impact_threshold