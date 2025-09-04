"""
Base agent class for VOTER Protocol agents
"""

from typing import Dict, Any, Optional
from abc import ABC, abstractmethod
import chromadb
from chromadb.utils import embedding_functions
from web3 import Web3
from eth_account import Account
import json
import os
from datetime import datetime
from agents.config import CHROMADB_CONFIG, get_agent_config


class BaseAgent(ABC):
    """
    Abstract base class for all VOTER Protocol agents
    """
    
    def __init__(self, agent_name: str):
        self.name = agent_name
        self.config = get_agent_config(agent_name)
        
        # Initialize memory
        self.chroma_client = chromadb.Client()
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=CHROMADB_CONFIG["embedding_model"]
        )
        
        # Get or create collection for this agent
        self.memory = self.chroma_client.get_or_create_collection(
            name=f"{agent_name}_memory",
            embedding_function=self.embedding_fn
        )
        
        # Web3 connection (to be initialized)
        self.w3: Optional[Web3] = None
        self.account: Optional[Account] = None
        
    def connect_blockchain(self, rpc_url: str, private_key: Optional[str] = None):
        """Connect to blockchain"""
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        if private_key:
            self.account = Account.from_key(private_key)
    
    def remember(self, decision: str, context: Dict[str, Any], outcome: Dict[str, Any]):
        """Store decision in memory for future learning"""
        doc_id = f"{self.name}_{datetime.now().timestamp()}"
        
        self.memory.add(
            documents=[json.dumps({
                "decision": decision,
                "context": context,
                "outcome": outcome,
                "timestamp": datetime.now().isoformat()
            })],
            metadatas=[{
                "agent": self.name,
                "effectiveness": outcome.get("effectiveness", 0.5),
                "timestamp": datetime.now().timestamp()
            }],
            ids=[doc_id]
        )
    
    def recall_similar(self, context: Dict[str, Any], n_results: int = 5) -> list:
        """Recall similar past situations"""
        query_text = json.dumps(context)
        
        results = self.memory.query(
            query_texts=[query_text],
            n_results=n_results
        )
        
        if results["documents"] and results["documents"][0]:
            return [json.loads(doc) for doc in results["documents"][0]]
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