"""
Reputation Agent - Builds credibility scores from civic engagement
"""

from typing import Dict, Any, List
from datetime import datetime, timedelta
from agents.base_agent import BaseAgent


class ReputationAgent(BaseAgent):
    """
    Tracks challenge market participation quality
    Coordinates with other agents for reputation scoring
    Writes to ERC-8004 Reputation Registry
    """
    
    def __init__(self):
        super().__init__("reputation_agent")
        self.score_range = self.config["score_range"]
        self.update_frequency = self.config["update_frequency"]
        
    async def update_reputation(
        self,
        user_address: str,
        action_type: str,
        action_quality: int
    ) -> Dict[str, Any]:
        """
        Update user's reputation based on their action
        """
        # Get current reputation
        current = await self._get_current_reputation(user_address)
        
        # Calculate score adjustments
        adjustments = self._calculate_adjustments(action_type, action_quality)
        
        # Apply adjustments
        new_scores = {
            "challenge_score": self._apply_adjustment(
                current.get("challenge_score", 50),
                adjustments.get("challenge_delta", 0)
            ),
            "civic_score": self._apply_adjustment(
                current.get("civic_score", 50),
                adjustments.get("civic_delta", 0)
            ),
            "discourse_score": self._apply_adjustment(
                current.get("discourse_score", 50),
                adjustments.get("discourse_delta", 0)
            )
        }
        
        # Calculate weighted total
        new_scores["total_score"] = self._calculate_total_score(new_scores)
        
        # Determine reputation tier
        new_scores["tier"] = self._get_reputation_tier(new_scores["total_score"])
        
        # Learn from this update
        self.remember(
            decision="update_reputation",
            context={
                "user": user_address,
                "action_type": action_type,
                "quality": action_quality
            },
            outcome={
                "new_scores": new_scores,
                "effectiveness": action_quality / 100
            }
        )
        
        return new_scores
    
    async def _get_current_reputation(self, user_address: str) -> Dict[str, Any]:
        """Get current reputation from memory or blockchain"""
        # Try to recall from memory first
        recent = self.recall_similar({"user": user_address}, n_results=1)
        
        if recent and recent[0]["context"]["user"] == user_address:
            time_diff = datetime.now() - datetime.fromisoformat(recent[0]["timestamp"])
            if time_diff < timedelta(seconds=self.update_frequency):
                return recent[0]["outcome"]["new_scores"]
        
        # Default scores for new users
        return {
            "challenge_score": 50,
            "civic_score": 50,
            "discourse_score": 50,
            "total_score": 50
        }
    
    def _calculate_adjustments(
        self,
        action_type: str,
        action_quality: int
    ) -> Dict[str, float]:
        """Calculate reputation adjustments based on action"""
        adjustments = {}
        
        # Quality-based adjustment (positive or negative)
        quality_delta = (action_quality - 50) / 10  # -5 to +5 range
        
        if action_type == "cwc_message":
            adjustments["civic_delta"] = quality_delta * 2  # Double weight for civic
            adjustments["discourse_delta"] = quality_delta * 0.5
            adjustments["challenge_delta"] = 0
            
        elif action_type == "challenge_market":
            adjustments["challenge_delta"] = quality_delta * 2
            adjustments["discourse_delta"] = quality_delta * 1.5
            adjustments["civic_delta"] = quality_delta * 0.3
            
        elif action_type == "direct_action":
            adjustments["civic_delta"] = quality_delta * 1.5
            adjustments["discourse_delta"] = quality_delta * 0.5
            adjustments["challenge_delta"] = quality_delta * 0.5
            
        else:
            # Default: small adjustment across all scores
            adjustments["civic_delta"] = quality_delta * 0.5
            adjustments["discourse_delta"] = quality_delta * 0.5
            adjustments["challenge_delta"] = quality_delta * 0.5
        
        return adjustments
    
    def _apply_adjustment(self, current: float, delta: float) -> float:
        """Apply adjustment with bounds checking"""
        new_score = current + delta
        
        # Apply exponential decay at extremes to prevent gaming
        if new_score > 90:
            new_score = 90 + (new_score - 90) * 0.5  # Harder to reach 100
        elif new_score < 10:
            new_score = 10 - (10 - new_score) * 0.5  # Harder to reach 0
        
        # Enforce bounds
        return max(self.score_range[0], min(self.score_range[1], new_score))
    
    def _calculate_total_score(self, scores: Dict[str, float]) -> float:
        """Calculate weighted total reputation score"""
        # Weights: 40% challenge, 35% civic, 25% discourse
        total = (
            scores["challenge_score"] * 0.40 +
            scores["civic_score"] * 0.35 +
            scores["discourse_score"] * 0.25
        )
        return round(total, 1)
    
    def _get_reputation_tier(self, total_score: float) -> str:
        """Determine reputation tier"""
        if total_score >= 80:
            return "trusted"
        elif total_score >= 60:
            return "established"
        elif total_score >= 40:
            return "emerging"
        elif total_score >= 20:
            return "novice"
        else:
            return "untrusted"
    
    async def evaluate_discourse_quality(
        self,
        content: str,
        sources: List[str],
        engagement_metrics: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Evaluate quality of discourse contribution
        """
        quality_score = 50  # Base score
        quality_factors = []
        
        # Check source quality
        source_score = self._evaluate_sources(sources)
        quality_score += source_score * 20  # Max +20 points
        if source_score > 0.5:
            quality_factors.append("quality_sources")
        
        # Check content characteristics
        content_score = self._evaluate_content(content)
        quality_score += content_score * 15  # Max +15 points
        if content_score > 0.5:
            quality_factors.append("substantive_content")
        
        # Check engagement quality
        engagement_score = self._evaluate_engagement(engagement_metrics)
        quality_score += engagement_score * 15  # Max +15 points
        if engagement_score > 0.5:
            quality_factors.append("constructive_engagement")
        
        # Cap at 100
        quality_score = min(100, quality_score)
        
        return {
            "quality_score": quality_score,
            "quality_factors": quality_factors,
            "source_quality": source_score,
            "content_quality": content_score,
            "engagement_quality": engagement_score
        }
    
    def _evaluate_sources(self, sources: List[str]) -> float:
        """Evaluate source quality (0-1 scale)"""
        if not sources:
            return 0
        
        quality_domains = [
            ".gov", ".edu", ".org",
            "reuters.com", "apnews.com", "npr.org",
            "wsj.com", "nytimes.com", "washingtonpost.com"
        ]
        
        quality_count = sum(
            1 for source in sources
            if any(domain in source.lower() for domain in quality_domains)
        )
        
        return min(1.0, quality_count / max(len(sources), 1))
    
    def _evaluate_content(self, content: str) -> float:
        """Evaluate content quality (0-1 scale)"""
        if not content:
            return 0
        
        score = 0
        
        # Length check (substantive but not spam)
        if 200 < len(content) < 2000:
            score += 0.3
        elif 100 < len(content) <= 200:
            score += 0.2
        
        # Check for reasoning indicators
        reasoning_terms = [
            "because", "therefore", "however",
            "evidence", "research", "study",
            "according to", "demonstrates", "indicates"
        ]
        
        reasoning_count = sum(
            1 for term in reasoning_terms
            if term.lower() in content.lower()
        )
        
        score += min(0.4, reasoning_count * 0.1)
        
        # Check for constructive tone (simplified)
        if not any(toxic in content.lower() for toxic in ["hate", "stupid", "idiot", "moron"]):
            score += 0.3
        
        return min(1.0, score)
    
    def _evaluate_engagement(self, metrics: Dict[str, Any]) -> float:
        """Evaluate engagement quality (0-1 scale)"""
        score = 0.5  # Base score
        
        # Good faith participation
        if metrics.get("responses_to_challenges", 0) > 0:
            score += 0.2
        
        # Not spamming
        if metrics.get("posts_per_hour", 1) < 5:
            score += 0.1
        
        # Diverse engagement
        if metrics.get("unique_topics", 1) > 3:
            score += 0.2
        
        return min(1.0, score)
    
    async def calculate_credibility_bonus(
        self,
        user_address: str,
        base_reward: int
    ) -> Dict[str, Any]:
        """
        Calculate reward bonus based on credibility
        """
        reputation = await self._get_current_reputation(user_address)
        total_score = reputation.get("total_score", 50)
        
        # Bonus multiplier based on reputation tier
        if total_score >= 80:
            multiplier = 2.0  # 100% bonus
            tier = "trusted"
        elif total_score >= 60:
            multiplier = 1.5  # 50% bonus
            tier = "established"
        elif total_score >= 40:
            multiplier = 1.2  # 20% bonus
            tier = "emerging"
        else:
            multiplier = 1.0  # No bonus
            tier = "standard"
        
        bonus_amount = int(base_reward * (multiplier - 1))
        final_reward = base_reward + bonus_amount
        
        return {
            "base_reward": base_reward,
            "bonus_amount": bonus_amount,
            "final_reward": final_reward,
            "multiplier": multiplier,
            "reputation_tier": tier,
            "reputation_score": total_score
        }
    
    async def detect_reputation_gaming(
        self,
        user_address: str,
        recent_actions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Detect attempts to game the reputation system
        """
        gaming_indicators = []
        risk_score = 0
        
        # Rapid reputation farming
        if len(recent_actions) > 50:
            gaming_indicators.append("excessive_activity")
            risk_score += 0.3
        
        # Low quality mass actions
        avg_quality = sum(a.get("quality", 50) for a in recent_actions) / max(len(recent_actions), 1)
        if avg_quality < 30 and len(recent_actions) > 10:
            gaming_indicators.append("low_quality_spam")
            risk_score += 0.4
        
        # Coordinated reputation boosting
        if self._detect_coordination(recent_actions):
            gaming_indicators.append("coordinated_activity")
            risk_score += 0.5
        
        return {
            "gaming_risk": min(1.0, risk_score),
            "gaming_indicators": gaming_indicators,
            "recommendation": "penalize" if risk_score > 0.7 else "monitor" if risk_score > 0.4 else "normal"
        }
    
    def _detect_coordination(self, actions: List[Dict[str, Any]]) -> bool:
        """Detect coordinated activity patterns"""
        if len(actions) < 5:
            return False
        
        # Check for similar timing patterns
        timestamps = [a.get("timestamp", 0) for a in actions]
        intervals = [timestamps[i] - timestamps[i-1] for i in range(1, len(timestamps))]
        
        if intervals:
            avg_interval = sum(intervals) / len(intervals)
            # Very regular intervals suggest automation
            variance = sum((i - avg_interval) ** 2 for i in intervals) / len(intervals)
            return variance < (avg_interval * 0.05) ** 2
        
        return False
    
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing entry point"""
        return await self.update_reputation(
            kwargs.get("user_address", ""),
            kwargs.get("action_type", ""),
            kwargs.get("action_quality", 50)
        )
    
    async def validate(self, **kwargs) -> bool:
        """Validate reputation parameters"""
        score = kwargs.get("reputation_score", 0)
        return self.score_range[0] <= score <= self.score_range[1]