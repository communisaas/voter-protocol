"""
Multi-agent coordinator using LangGraph for VOTER Protocol
"""

from typing import Dict, List, Any, TypedDict, Annotated
from enum import Enum
import asyncio
from datetime import datetime
from langchain_anthropic import ChatAnthropic
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage, AIMessage
import operator

from agents.supply_agent import SupplyAgent
from agents.verification_agent import VerificationAgent
from agents.market_agent import MarketAgent
from agents.impact_agent import ImpactAgent
from agents.reputation_agent import ReputationAgent
from agents.config import CONSENSUS_CONFIG, SAFETY_RAILS


class AgentState(TypedDict):
    """State shared between agents in the graph"""
    messages: Annotated[List[Any], operator.add]
    action_type: str
    user_address: str
    action_data: Dict[str, Any]
    verification_status: bool
    reward_amount: int
    reputation_update: Dict[str, int]
    consensus_reached: bool
    timestamp: datetime
    error: str


class ActionType(Enum):
    """Types of civic actions"""
    CWC_MESSAGE = "cwc_message"
    DIRECT_ACTION = "direct_action"
    CHALLENGE_MARKET = "challenge_market"


class DemocracyCoordinator:
    """
    Orchestrates multiple agents for adaptive democracy
    """
    
    def __init__(self):
        # Initialize agents
        self.supply_agent = SupplyAgent()
        self.verification_agent = VerificationAgent()
        self.market_agent = MarketAgent()
        self.impact_agent = ImpactAgent()
        self.reputation_agent = ReputationAgent()
        
        # Build the workflow graph
        self.workflow = self._build_workflow()
        
    def _build_workflow(self) -> StateGraph:
        """Build the LangGraph workflow for agent coordination"""
        
        # Create the state graph
        workflow = StateGraph(AgentState)
        
        # Add nodes for each agent
        workflow.add_node("verify", self._verify_action)
        workflow.add_node("calculate_reward", self._calculate_reward)
        workflow.add_node("check_supply", self._check_supply)
        workflow.add_node("update_reputation", self._update_reputation)
        workflow.add_node("measure_impact", self._measure_impact)
        workflow.add_node("consensus", self._achieve_consensus)
        workflow.add_node("execute", self._execute_action)
        
        # Define the workflow edges
        workflow.set_entry_point("verify")
        
        # Conditional routing based on verification
        workflow.add_conditional_edges(
            "verify",
            self._route_after_verification,
            {
                "calculate_reward": "calculate_reward",
                "reject": END,
            }
        )
        
        workflow.add_edge("calculate_reward", "check_supply")
        workflow.add_edge("check_supply", "update_reputation")
        workflow.add_edge("update_reputation", "measure_impact")
        workflow.add_edge("measure_impact", "consensus")
        
        # Conditional execution based on consensus
        workflow.add_conditional_edges(
            "consensus",
            self._route_after_consensus,
            {
                "execute": "execute",
                "reject": END,
            }
        )
        
        workflow.add_edge("execute", END)
        
        return workflow.compile()
    
    async def _verify_action(self, state: AgentState) -> AgentState:
        """Verification agent validates the civic action"""
        try:
            verification_result = await self.verification_agent.verify(
                user_address=state["user_address"],
                action_type=state["action_type"],
                action_data=state["action_data"]
            )
            
            state["verification_status"] = verification_result["verified"]
            state["messages"].append(
                AIMessage(content=f"Verification: {verification_result['status']}")
            )
            
            if not verification_result["verified"]:
                state["error"] = verification_result.get("reason", "Verification failed")
                
        except Exception as e:
            state["verification_status"] = False
            state["error"] = str(e)
            
        return state
    
    async def _calculate_reward(self, state: AgentState) -> AgentState:
        """Market agent calculates optimal reward amount"""
        try:
            reward = await self.market_agent.calculate_reward(
                action_type=state["action_type"],
                user_reputation=state.get("reputation_update", {}).get("score", 0),
                current_participation=await self._get_current_participation()
            )
            
            # Apply safety rails
            reward = min(reward, SAFETY_RAILS["max_daily_mint_per_user"])
            state["reward_amount"] = reward
            
            state["messages"].append(
                AIMessage(content=f"Calculated reward: {reward / 10**18} VOTER")
            )
            
        except Exception as e:
            state["error"] = str(e)
            state["reward_amount"] = 0
            
        return state
    
    async def _check_supply(self, state: AgentState) -> AgentState:
        """Supply agent checks if minting is within bounds"""
        try:
            supply_check = await self.supply_agent.check_mint_allowed(
                amount=state["reward_amount"],
                current_supply=await self._get_current_supply()
            )
            
            if not supply_check["allowed"]:
                state["error"] = "Supply limit exceeded"
                state["reward_amount"] = supply_check.get("adjusted_amount", 0)
            
            state["messages"].append(
                AIMessage(content=f"Supply check: {supply_check['status']}")
            )
            
        except Exception as e:
            state["error"] = str(e)
            
        return state
    
    async def _update_reputation(self, state: AgentState) -> AgentState:
        """Reputation agent updates credibility scores"""
        try:
            reputation = await self.reputation_agent.update_reputation(
                user_address=state["user_address"],
                action_type=state["action_type"],
                action_quality=state.get("action_data", {}).get("quality_score", 50)
            )
            
            state["reputation_update"] = {
                "challenge_score": reputation.get("challenge_score", 0),
                "civic_score": reputation.get("civic_score", 0),
                "discourse_score": reputation.get("discourse_score", 0),
                "total_score": reputation.get("total_score", 0),
            }
            
            state["messages"].append(
                AIMessage(content=f"Reputation updated: {reputation['total_score']}")
            )
            
        except Exception as e:
            state["error"] = str(e)
            
        return state
    
    async def _measure_impact(self, state: AgentState) -> AgentState:
        """Impact agent measures real-world outcomes"""
        try:
            impact = await self.impact_agent.measure_impact(
                action_type=state["action_type"],
                action_data=state["action_data"],
                district=state.get("action_data", {}).get("district")
            )
            
            # Adjust reward based on impact
            if impact["score"] < 0.5:
                state["reward_amount"] = int(state["reward_amount"] * 0.8)
            elif impact["score"] > 0.8:
                state["reward_amount"] = int(state["reward_amount"] * 1.2)
            
            state["messages"].append(
                AIMessage(content=f"Impact score: {impact['score']:.2f}")
            )
            
        except Exception as e:
            state["error"] = str(e)
            
        return state
    
    async def _achieve_consensus(self, state: AgentState) -> AgentState:
        """Achieve consensus among agents"""
        try:
            # Collect votes from all agents
            votes = []
            
            # Each agent votes based on their assessment
            if state["verification_status"]:
                votes.append(True)
            if state["reward_amount"] > 0:
                votes.append(True)
            if state.get("reputation_update", {}).get("total_score", 0) > 20:
                votes.append(True)
            
            # Check if consensus threshold is met
            consensus_ratio = sum(votes) / max(len(votes), 1)
            state["consensus_reached"] = consensus_ratio >= CONSENSUS_CONFIG["quorum_threshold"]
            
            state["messages"].append(
                AIMessage(content=f"Consensus: {consensus_ratio:.2%} ({'REACHED' if state['consensus_reached'] else 'FAILED'})")
            )
            
        except Exception as e:
            state["error"] = str(e)
            state["consensus_reached"] = False
            
        return state
    
    async def _execute_action(self, state: AgentState) -> AgentState:
        """Execute the approved action on-chain"""
        try:
            # This would interact with smart contracts
            execution_result = {
                "tx_hash": "0x" + "0" * 64,  # Placeholder
                "reward_minted": state["reward_amount"],
                "reputation_updated": True,
                "timestamp": datetime.now().isoformat()
            }
            
            state["messages"].append(
                AIMessage(content=f"Executed: {execution_result['tx_hash'][:10]}...")
            )
            
        except Exception as e:
            state["error"] = str(e)
            
        return state
    
    def _route_after_verification(self, state: AgentState) -> str:
        """Determine next step after verification"""
        if state["verification_status"] and not state.get("error"):
            return "calculate_reward"
        return "reject"
    
    def _route_after_consensus(self, state: AgentState) -> str:
        """Determine next step after consensus"""
        if state["consensus_reached"] and not state.get("error"):
            return "execute"
        return "reject"
    
    async def _get_current_participation(self) -> int:
        """Get current participation level from chain"""
        # Placeholder - would query blockchain
        return 1000
    
    async def _get_current_supply(self) -> int:
        """Get current token supply from chain"""
        # Placeholder - would query blockchain
        return 50_000_000 * 10**18
    
    async def process_civic_action(
        self,
        user_address: str,
        action_type: str,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Main entry point to process a civic action through the agent network
        """
        initial_state = AgentState(
            messages=[HumanMessage(content=f"Processing {action_type} for {user_address}")],
            action_type=action_type,
            user_address=user_address,
            action_data=action_data,
            verification_status=False,
            reward_amount=0,
            reputation_update={},
            consensus_reached=False,
            timestamp=datetime.now(),
            error=""
        )
        
        # Run the workflow
        result = await self.workflow.ainvoke(initial_state)
        
        return {
            "success": result["consensus_reached"],
            "reward": result["reward_amount"],
            "reputation": result["reputation_update"],
            "messages": [msg.content for msg in result["messages"]],
            "error": result.get("error"),
            "timestamp": result["timestamp"].isoformat()
        }