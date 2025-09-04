"""
Agent configuration for VOTER Protocol
"""

import os
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

# Domain configuration
DOMAIN = os.getenv("DOMAIN", "communi.email")
API_BASE_URL = os.getenv("API_BASE_URL", f"https://api.{DOMAIN}")

# Blockchain configuration
MONAD_RPC_URL = os.getenv("MONAD_RPC_URL", "https://testnet.monad.xyz")
CHAIN_ID = 1337  # Monad testnet

# Agent configuration
AGENT_CONFIG = {
    "supply_agent": {
        "model": os.getenv("SUPPLY_AGENT_MODEL", ""),  # Model specified at runtime
        "temperature": 0.3,
        "max_tokens": 1000,
        "capabilities": ["supply_calculation", "mint_optimization", "economic_modeling"],
        "min_supply": 0,
        "max_supply": 1_000_000_000 * 10**18,  # 1B tokens max
    },
    "verification_agent": {
        "model": os.getenv("VERIFICATION_AGENT_MODEL", ""),  # Model specified at runtime
        "temperature": 0.1,  # Low temperature for accuracy
        "max_tokens": 500,
        "capabilities": ["identity_verification", "action_validation", "fraud_detection"],
        "consensus_threshold": 0.8,
        "verification_sources": ["self_protocol", "cwc_api", "email_verification"],
    },
    "market_agent": {
        "model": os.getenv("MARKET_AGENT_MODEL", ""),  # Model specified at runtime
        "temperature": 0.5,
        "max_tokens": 800,
        "capabilities": ["reward_optimization", "incentive_design", "market_dynamics"],
        "min_reward": 1 * 10**18,  # 1 VOTER minimum
        "max_reward": 100 * 10**18,  # 100 VOTER maximum
    },
    "impact_agent": {
        "model": os.getenv("IMPACT_AGENT_MODEL", ""),  # Model specified at runtime
        "temperature": 0.4,
        "max_tokens": 1200,
        "capabilities": ["impact_measurement", "outcome_tracking", "effectiveness_analysis"],
        "measurement_interval": 3600,  # 1 hour
        "impact_threshold": 0.6,
    },
    "reputation_agent": {
        "model": os.getenv("REPUTATION_AGENT_MODEL", ""),  # Model specified at runtime
        "temperature": 0.2,
        "max_tokens": 600,
        "capabilities": ["credibility_scoring", "discourse_evaluation", "reputation_tracking"],
        "score_range": (0, 100),
        "update_frequency": 1800,  # 30 minutes
    }
}

# Memory configuration
CHROMADB_CONFIG = {
    "host": os.getenv("CHROMADB_HOST", "localhost"),
    "port": int(os.getenv("CHROMADB_PORT", 8000)),
    "collection_name": "voter_protocol_memory",
    "embedding_model": "all-MiniLM-L6-v2",
}

# Consensus configuration
CONSENSUS_CONFIG = {
    "min_agents": 3,
    "quorum_threshold": 0.66,  # 2/3 majority
    "timeout": 30,  # seconds
    "max_retries": 3,
}

# Safety rails
SAFETY_RAILS = {
    "max_daily_mint_per_user": 10000 * 10**18,
    "max_daily_mint_protocol": 1_000_000 * 10**18,
    "min_action_interval": 60,  # 1 minute between actions
    "max_verification_attempts": 5,
    "emergency_pause_threshold": 0.9,  # 90% anomaly detection
}

# External integrations
EXTERNAL_APIS = {
    "cwc": {
        "url": os.getenv("CWC_API_URL", "https://www.house.gov/htbin/formproc"),
        "api_key": os.getenv("CWC_API_KEY"),
        "timeout": 10,
    },
    "self_protocol": {
        "url": os.getenv("SELF_PROTOCOL_URL", "https://api.self.id"),
        "api_key": os.getenv("SELF_PROTOCOL_KEY"),
        "timeout": 15,
    },
    "ipfs": {
        "gateway": os.getenv("IPFS_GATEWAY", "https://ipfs.io"),
        "api_url": os.getenv("IPFS_API_URL", "http://localhost:5001"),
    }
}

def get_agent_config(agent_name: str) -> Dict[str, Any]:
    """Get configuration for specific agent"""
    if agent_name not in AGENT_CONFIG:
        raise ValueError(f"Unknown agent: {agent_name}")
    return AGENT_CONFIG[agent_name]

def get_domain_url(path: str = "") -> str:
    """Get full URL for domain path"""
    base = f"https://{DOMAIN}" if not DOMAIN.startswith("localhost") else f"http://{DOMAIN}"
    return f"{base}/{path.lstrip('/')}" if path else base