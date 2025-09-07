"""
Pytest configuration and shared fixtures for VOTER Protocol tests
"""

import pytest
import asyncio
from typing import Dict, Any, List
from unittest.mock import Mock, AsyncMock
import tempfile
import shutil
from pathlib import Path

# Add project root to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from agents.supply_agent import SupplyAgent
from agents.verification_agent import VerificationAgent
from agents.market_agent import MarketAgent
from agents.impact_agent import ImpactAgent
from agents.reputation_agent import ReputationAgent
from agents.coordinator import DemocracyCoordinator


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def temp_dir():
    """Create temporary directory for test files"""
    temp_path = tempfile.mkdtemp()
    yield Path(temp_path)
    shutil.rmtree(temp_path)


@pytest.fixture
def mock_web3():
    """Mock Web3 instance for blockchain interaction tests"""
    mock = Mock()
    mock.eth.get_transaction_count.return_value = 0
    mock.eth.gas_price = 20000000000  # 20 gwei
    mock.eth.send_raw_transaction.return_value = b'0x' + b'0' * 64
    mock.eth.wait_for_transaction_receipt.return_value = {
        'status': 1,
        'transactionHash': '0x' + '0' * 64
    }
    return mock


@pytest.fixture
def mock_agents():
    """Create mock agent instances"""
    return {
        'supply': Mock(spec=SupplyAgent),
        'verification': Mock(spec=VerificationAgent),
        'market': Mock(spec=MarketAgent),
        'impact': Mock(spec=ImpactAgent),
        'reputation': Mock(spec=ReputationAgent)
    }


@pytest.fixture
async def coordinator():
    """Create DemocracyCoordinator instance"""
    return DemocracyCoordinator()


@pytest.fixture
def civic_action_data():
    """Sample civic action data for testing"""
    return {
        'user_address': '0x' + '1' * 40,
        'action_type': 'cwc_message',
        'action_data': {
            'message': 'Test message to Congress about important policy',
            'representative': 'Rep. John Doe',
            'district': 'CA-12',
            'zip_code': '94102',
            'template_id': 'template_123',
            'quality_score': 75
        }
    }


@pytest.fixture
def challenge_data():
    """Sample challenge market data"""
    return {
        'claim_hash': '0x' + 'a' * 64,
        'defender': '0x' + '2' * 40,
        'evidence_ipfs': 'QmTest123',
        'stake_amount': 100 * 10**18
    }


@pytest.fixture
def legislative_record_mock():
    """Mock legislative record data"""
    return {
        'speeches': [
            {
                'date': '2025-01-15',
                'speaker': 'Rep. John Doe',
                'text': 'This policy will create 50,000 jobs in our district',
                'chamber': 'House'
            }
        ],
        'votes': [
            {
                'date': '2025-01-20',
                'bill': 'HR 1234',
                'representative': 'Rep. John Doe',
                'vote': 'Yea',
                'previous_position': 'Nay'
            }
        ],
        'amendments': [
            {
                'date': '2025-01-18',
                'bill': 'HR 1234',
                'sponsor': 'Rep. John Doe',
                'text': 'Amendment to allocate funds for infrastructure'
            }
        ]
    }


@pytest.fixture
def agent_parameters():
    """Default agent parameters for testing"""
    return {
        'reward:CWC_MESSAGE': 10 * 10**18,
        'reward:DIRECT_ACTION': 15 * 10**18,
        'maxDailyMintPerUser': 100 * 10**18,
        'maxDailyMintProtocol': 10000 * 10**18,
        'minActionInterval': 3600,
        'challenge:minStake': 10 * 10**18,
        'challenge:duration': 3 * 24 * 3600,
        'challenge:qualityThreshold': 60,
        'challenge:marketFeeRate': 250
    }


@pytest.fixture
def mock_cwc_api():
    """Mock CWC API responses"""
    mock = AsyncMock()
    mock.submit_message.return_value = {
        'submission_id': 'cwc_123',
        'receipt_hash': '0x' + 'b' * 64,
        'status': 'delivered',
        'timestamp': '2025-01-15T10:00:00Z'
    }
    return mock


@pytest.fixture
def mock_self_protocol():
    """Mock Self Protocol identity verification"""
    mock = AsyncMock()
    mock.verify_identity.return_value = {
        'verified': True,
        'age': 25,
        'citizenship': 'US',
        'passport_hash': '0x' + 'c' * 64
    }
    return mock


class MockCongressionalRecord:
    """Mock Congressional Record API for testing causation tracking"""
    
    def __init__(self):
        self.speeches = []
        self.votes = []
        self.amendments = []
    
    def add_speech(self, date: str, speaker: str, text: str):
        """Add a speech to the mock record"""
        self.speeches.append({
            'date': date,
            'speaker': speaker,
            'text': text,
            'chamber': 'House'
        })
    
    def add_vote_change(self, representative: str, bill: str, 
                       old_position: str, new_position: str):
        """Add a vote change to track position evolution"""
        self.votes.append({
            'representative': representative,
            'bill': bill,
            'previous_position': old_position,
            'current_position': new_position,
            'changed': True
        })
    
    async def search_speeches(self, query: str) -> List[Dict]:
        """Search for speeches containing query text"""
        return [s for s in self.speeches if query.lower() in s['text'].lower()]
    
    async def get_voting_history(self, representative: str) -> List[Dict]:
        """Get voting history for a representative"""
        return [v for v in self.votes if v['representative'] == representative]


@pytest.fixture
def mock_congressional_record():
    """Create mock Congressional Record instance"""
    return MockCongressionalRecord()


@pytest.fixture
def security_test_config():
    """Security testing configuration"""
    return {
        'max_gas_price': 500 * 10**9,  # 500 gwei max
        'min_stake': 1 * 10**18,  # 1 VOTER minimum
        'max_daily_mint': 1000000 * 10**18,  # 1M VOTER daily max
        'rate_limit': 100,  # requests per minute
        'sybil_threshold': 0.8,  # similarity threshold for Sybil detection
    }


@pytest.fixture
def chaos_scenarios():
    """Chaos engineering test scenarios"""
    return [
        {'type': 'agent_crash', 'agent': 'verification', 'duration': 60},
        {'type': 'network_partition', 'duration': 120},
        {'type': 'token_crash', 'percentage': 90},
        {'type': 'ddos_attack', 'rps': 10000},
        {'type': 'data_corruption', 'corruption_rate': 0.1}
    ]