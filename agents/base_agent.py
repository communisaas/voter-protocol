"""
Base agent class for VOTER Protocol agents - STUBBED

Agent functionality moved to Communiqué TypeScript implementation.
See: communique/src/lib/agents/
"""

from typing import Dict, Any, Optional
from abc import ABC, abstractmethod
import json
from datetime import datetime

# Stub warning
MOVED_MESSAGE = "Agent logic moved to Communiqué TypeScript. Use API endpoints instead."


class BaseAgent(ABC):
    """
    Abstract base class for all VOTER Protocol agents
    """
    
    def __init__(self, agent_name: str):
        self.name = agent_name
        self.config = {"name": agent_name}  # Minimal config
        
        # Stubbed - no ChromaDB or Web3
        self.memory = None
        self.w3 = None
        self.account = None
        
        print(f"Warning: {MOVED_MESSAGE}")
        
    def connect_blockchain(self, rpc_url: str, private_key: Optional[str] = None):
        """STUBBED - Blockchain connection handled in Communiqué"""
        pass
    
    def remember(self, decision: str, context: Dict[str, Any], outcome: Dict[str, Any]):
        """STUBBED - Memory stored in Communiqué database"""
        # Would store in Supabase in production
        pass
    
    def recall_similar(self, context: Dict[str, Any], n_results: int = 5) -> list:
        """STUBBED - Query Communiqué database instead"""
        return []
    
    def calculate_effectiveness(self, expected: Any, actual: Any) -> float:
        """Calculate effectiveness score for an outcome"""
        if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
            if expected == 0:
                return 1.0 if actual == 0 else 0.0
            return min(1.0, 1.0 - abs(expected - actual) / expected)
        return 1.0 if expected == actual else 0.0
    
    @abstractmethod
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing method to be implemented by each agent"""
        pass
    
    @abstractmethod
    async def validate(self, **kwargs) -> bool:
        """Validation method to be implemented by each agent"""
        pass