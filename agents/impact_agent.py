"""
Impact Agent - Measures real-world outcomes
"""

from typing import Dict, Any, List, Set, Tuple
from datetime import datetime, timedelta
from collections import defaultdict
import networkx as nx
import numpy as np
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
        Measure impact of congressional messages using causal models
        """
        message = action_data.get("message", "")
        representative = action_data.get("representative", "")
        template_id = action_data.get("template_id", "")
        
        # Build causal model
        causal_evidence = await self._build_causal_model(template_id, representative)
        
        # Calculate impact score based on causal evidence
        score = 0.5  # Base correlation score
        confidence = "weak"
        causal_type = "correlation"
        
        # Direct causation: Template language appears verbatim
        if causal_evidence.get("direct_citation"):
            score = 0.95
            confidence = "proven"
            causal_type = "direct_causation"
            
        # Strong correlation: Position change after campaign
        elif causal_evidence.get("position_changed") and causal_evidence.get("temporal_alignment"):
            score = 0.8
            confidence = "strong"
            causal_type = "probable_causation"
            
        # Moderate correlation: Thematic alignment
        elif causal_evidence.get("semantic_similarity") > 0.7:
            score = 0.6
            confidence = "moderate"
            causal_type = "correlation"
        
        # Apply quality adjustments
        if len(message) > 500:
            score = min(1.0, score + 0.05)
        if "specific bill" in message.lower() or "hr" in message.lower():
            score = min(1.0, score + 0.1)
        
        # District alignment for credibility
        district_aligned = district and district in action_data.get("district", "")
        if district_aligned:
            score = min(1.0, score + 0.05)
        
        return {
            "score": score,
            "category": "legislative",
            "confidence": confidence,
            "causal_type": causal_type,
            "metrics": {
                "message_quality": score,
                "district_aligned": district_aligned,
                "representative": representative,
                "causal_evidence": causal_evidence
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
    
    async def _build_causal_model(
        self,
        template_id: str,
        representative: str
    ) -> Dict[str, Any]:
        """
        Build causal DAG showing information flow from template to legislative behavior
        """
        # Create directed acyclic graph
        causal_dag = nx.DiGraph()
        
        # Add nodes representing causal variables
        causal_dag.add_node("template_created", type="intervention")
        causal_dag.add_node("campaign_launched", type="intervention")
        causal_dag.add_node("messages_sent", type="mediator")
        causal_dag.add_node("staff_received", type="mediator")
        causal_dag.add_node("legislator_informed", type="mediator")
        causal_dag.add_node("position_changed", type="outcome")
        causal_dag.add_node("speech_citation", type="outcome")
        causal_dag.add_node("vote_changed", type="outcome")
        
        # Add causal edges
        causal_dag.add_edge("template_created", "campaign_launched")
        causal_dag.add_edge("campaign_launched", "messages_sent")
        causal_dag.add_edge("messages_sent", "staff_received")
        causal_dag.add_edge("staff_received", "legislator_informed")
        causal_dag.add_edge("legislator_informed", "position_changed")
        causal_dag.add_edge("legislator_informed", "speech_citation")
        causal_dag.add_edge("position_changed", "vote_changed")
        
        # Query legislative record for evidence
        evidence = await self._query_legislative_record(template_id, representative)
        
        # Calculate causal influence through the DAG
        causal_evidence = {
            "direct_citation": evidence.get("verbatim_match", False),
            "semantic_similarity": evidence.get("semantic_score", 0.0),
            "temporal_alignment": evidence.get("timing_correlation", False),
            "position_changed": evidence.get("vote_flip", False),
            "campaign_volume": evidence.get("message_count", 0),
            "markov_blanket": self._identify_markov_blanket(causal_dag, "vote_changed")
        }
        
        return causal_evidence
    
    async def _query_legislative_record(
        self,
        template_id: str,
        representative: str
    ) -> Dict[str, Any]:
        """
        Query Congressional Record and voting history for causal evidence
        """
        # In production, this would call real APIs
        # For now, return simulated but realistic data
        
        # Recall historical patterns for this template
        historical = self.recall_similar(
            {"template_id": template_id, "representative": representative},
            n_results=50
        )
        
        # Analyze patterns
        verbatim_matches = sum(1 for h in historical if h.get("outcome", {}).get("verbatim_match"))
        vote_changes = sum(1 for h in historical if h.get("outcome", {}).get("vote_changed"))
        
        return {
            "verbatim_match": verbatim_matches > 0,
            "semantic_score": 0.75 if verbatim_matches > 0 else 0.4,
            "timing_correlation": vote_changes > len(historical) * 0.3,
            "vote_flip": vote_changes > 0,
            "message_count": len(historical) * 100  # Estimated campaign size
        }
    
    def _identify_markov_blanket(
        self,
        dag: nx.DiGraph,
        target_node: str
    ) -> List[str]:
        """
        Identify Markov blanket: minimal set of variables that screen off other influences
        """
        if target_node not in dag:
            return []
        
        markov_blanket = set()
        
        # Parents of target
        markov_blanket.update(dag.predecessors(target_node))
        
        # Children of target
        children = list(dag.successors(target_node))
        markov_blanket.update(children)
        
        # Parents of children (co-parents)
        for child in children:
            markov_blanket.update(dag.predecessors(child))
        
        # Remove target itself if present
        markov_blanket.discard(target_node)
        
        return list(markov_blanket)
    
    async def build_correlation_map(
        self,
        district: str,
        time_window: int = 30 * 86400  # 30 days
    ) -> Dict[str, Any]:
        """
        Build correlation map between citizen actions and legislative outcomes
        """
        # Recall all actions in district within time window
        cutoff = datetime.now() - timedelta(seconds=time_window)
        
        district_actions = self.recall_similar(
            {"district": district},
            n_results=1000
        )
        
        recent_actions = [
            a for a in district_actions
            if datetime.fromisoformat(a["timestamp"]) > cutoff
        ]
        
        if not recent_actions:
            return {"correlation_strength": 0, "sample_size": 0}
        
        # Group by representative
        rep_correlations = defaultdict(list)
        for action in recent_actions:
            rep = action.get("context", {}).get("representative")
            impact = action.get("outcome", {}).get("impact_score", 0)
            rep_correlations[rep].append(impact)
        
        # Calculate correlation strengths
        correlations = {}
        for rep, impacts in rep_correlations.items():
            if len(impacts) > 10:  # Need minimum sample
                avg_impact = np.mean(impacts)
                std_impact = np.std(impacts)
                
                # Classify correlation strength
                if avg_impact > 0.7:
                    strength = "strong"
                elif avg_impact > 0.4:
                    strength = "moderate"
                else:
                    strength = "weak"
                
                correlations[rep] = {
                    "average_impact": avg_impact,
                    "std_deviation": std_impact,
                    "correlation_strength": strength,
                    "sample_size": len(impacts),
                    "confidence_interval": (avg_impact - 1.96*std_impact/np.sqrt(len(impacts)),
                                           avg_impact + 1.96*std_impact/np.sqrt(len(impacts)))
                }
        
        return {
            "district": district,
            "time_window_days": time_window // 86400,
            "total_actions": len(recent_actions),
            "representative_correlations": correlations
        }
    
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