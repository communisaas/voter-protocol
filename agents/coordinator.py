"""
Simple multi-agent coordinator for VOTER Protocol (N8N Integration)
Removed LangGraph dependencies - N8N handles orchestration
"""

from typing import Dict, Any
from enum import Enum
import asyncio
from datetime import datetime

from agents.supply_agent import SupplyAgent
from agents.verification_agent import VerificationAgent
from agents.market_agent import MarketAgent
from agents.impact_agent import ImpactAgent
from agents.reputation_agent import ReputationAgent
from agents.config import CONSENSUS_CONFIG, SAFETY_RAILS


class ActionType(Enum):
    """Types of civic actions"""
    CWC_MESSAGE = "cwc_message"
    DIRECT_ACTION = "direct_action"
    CHALLENGE_MARKET = "challenge_market"


class SimpleCoordinator:
    """
    Simple coordinator for VOTER Protocol agents
    N8N handles workflow orchestration, this just provides agent access
    """
    
    def __init__(self):
        # Initialize agents
        self.supply_agent = SupplyAgent()
        self.verification_agent = VerificationAgent()
        self.market_agent = MarketAgent()
        self.impact_agent = ImpactAgent()
        self.reputation_agent = ReputationAgent()
    
    async def verify_template(self, template_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Simple template verification for N8N workflow
        Returns approval/rejection with corrections
        """
        try:
            # Use verification agent
            result = await self.verification_agent.verify(
                user_address=template_data.get("user_address", ""),
                action_type="cwc_message",
                action_data=template_data
            )
            
            return {
                "approved": result.get("verified", False),
                "corrections": result.get("corrected_content", {}),
                "severity": result.get("severity_level", 10),
                "reason": result.get("reason", ""),
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                "approved": False,
                "corrections": {},
                "severity": 10,
                "reason": f"Error during verification: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
    
    async def get_agents(self):
        """Return agent instances for direct access"""
        return {
            "verification": self.verification_agent,
            "supply": self.supply_agent,
            "market": self.market_agent,
            "impact": self.impact_agent,
            "reputation": self.reputation_agent
        }


# Legacy compatibility
DemocracyCoordinator = SimpleCoordinator
AgentCoordinator = SimpleCoordinator