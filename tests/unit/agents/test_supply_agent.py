"""
Unit tests for SupplyAgent - Critical for token economics
Tests optimal supply calculation, mint allowance, and safety bounds
"""

import pytest
import asyncio
from unittest.mock import Mock, patch
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from agents.supply_agent import SupplyAgent
from agents.config import SAFETY_RAILS


class TestSupplyAgent:
    """Comprehensive unit tests for SupplyAgent"""
    
    @pytest.fixture
    def supply_agent(self):
        """Create SupplyAgent instance with test config"""
        with patch('agents.base_agent.BaseAgent.__init__'):
            agent = SupplyAgent()
            agent.config = {
                'min_supply': 1_000_000 * 10**18,  # 1M minimum
                'max_supply': 100_000_000 * 10**18,  # 100M maximum
                'measurement_interval': 3600,
                'target_inflation_rate': 0.05  # 5% annual
            }
            agent.min_supply = agent.config['min_supply']
            agent.max_supply = agent.config['max_supply']
            agent.memory = []  # Mock memory
            return agent
    
    @pytest.mark.asyncio
    async def test_calculate_optimal_supply_normal_participation(self, supply_agent):
        """Test supply calculation with normal participation levels"""
        current_supply = 10_000_000 * 10**18  # 10M tokens
        participation_rate = 0.05  # 5% active users
        
        result = await supply_agent.calculate_optimal_supply(
            current_supply=current_supply,
            participation_rate=participation_rate,
            time_period=86400
        )
        
        assert 'target_daily_mint' in result
        assert 'current_supply' in result
        assert 'supply_utilization' in result
        
        # Should allow reasonable minting
        assert result['target_daily_mint'] > 0
        assert result['target_daily_mint'] <= SAFETY_RAILS['max_daily_mint_protocol']
        
        # Supply utilization should be calculated correctly
        expected_utilization = current_supply / supply_agent.max_supply
        assert abs(result['supply_utilization'] - expected_utilization) < 0.01
    
    @pytest.mark.asyncio
    async def test_calculate_optimal_supply_high_participation(self, supply_agent):
        """Test supply calculation with high participation"""
        current_supply = 10_000_000 * 10**18
        participation_rate = 0.20  # 20% active users - very high
        
        result = await supply_agent.calculate_optimal_supply(
            current_supply=current_supply,
            participation_rate=participation_rate
        )
        
        # Should increase minting for high participation
        normal_rate_result = await supply_agent.calculate_optimal_supply(
            current_supply=current_supply,
            participation_rate=0.05
        )
        
        assert result['target_daily_mint'] > normal_rate_result['target_daily_mint']
        # But still within safety bounds
        assert result['target_daily_mint'] <= SAFETY_RAILS['max_daily_mint_protocol']
    
    @pytest.mark.asyncio
    async def test_calculate_optimal_supply_near_max(self, supply_agent):
        """Test supply calculation when near maximum supply"""
        current_supply = 95_000_000 * 10**18  # 95M of 100M max
        participation_rate = 0.10
        
        result = await supply_agent.calculate_optimal_supply(
            current_supply=current_supply,
            participation_rate=participation_rate
        )
        
        # Should restrict minting when near cap
        remaining = supply_agent.max_supply - current_supply
        assert result['target_daily_mint'] <= remaining
        assert result['supply_utilization'] == 0.95
    
    @pytest.mark.asyncio
    async def test_check_mint_allowed_within_bounds(self, supply_agent):
        """Test mint allowance within safety bounds"""
        amount = 1000 * 10**18  # 1000 tokens
        current_supply = 50_000_000 * 10**18  # 50M tokens
        
        result = await supply_agent.check_mint_allowed(
            amount=amount,
            current_supply=current_supply
        )
        
        assert result['allowed'] == True
        assert result['adjusted_amount'] == amount
        assert 'reason' not in result or result['reason'] == ''
    
    @pytest.mark.asyncio
    async def test_check_mint_allowed_exceeds_daily_limit(self, supply_agent):
        """Test mint rejection when exceeding daily limit"""
        amount = SAFETY_RAILS['max_daily_mint_protocol'] + 10**18  # Over limit
        current_supply = 50_000_000 * 10**18
        
        result = await supply_agent.check_mint_allowed(
            amount=amount,
            current_supply=current_supply
        )
        
        assert result['allowed'] == False
        assert result['adjusted_amount'] == SAFETY_RAILS['max_daily_mint_protocol']
        assert 'exceeds daily' in result['reason'].lower()
    
    @pytest.mark.asyncio
    async def test_check_mint_allowed_exceeds_max_supply(self, supply_agent):
        """Test mint rejection when exceeding maximum supply"""
        current_supply = 99_999_000 * 10**18  # Near max
        amount = 2000 * 10**18  # Would exceed max
        
        result = await supply_agent.check_mint_allowed(
            amount=amount,
            current_supply=current_supply
        )
        
        assert result['allowed'] == False
        expected_max = supply_agent.max_supply - current_supply
        assert result['adjusted_amount'] == expected_max
        assert 'exceeds maximum supply' in result['reason'].lower()
    
    @pytest.mark.asyncio
    async def test_adjust_for_network_conditions(self, supply_agent):
        """Test dynamic adjustment based on network conditions"""
        # Test with high congestion
        high_congestion = {
            'gas_price': 500 * 10**9,  # 500 gwei
            'pending_transactions': 10000,
            'block_utilization': 0.95
        }
        
        base_reward = 10 * 10**18
        adjusted = await supply_agent.adjust_for_network_conditions(
            base_reward=base_reward,
            network_conditions=high_congestion
        )
        
        # Should reduce rewards during congestion
        assert adjusted < base_reward
        
        # Test with normal conditions
        normal_conditions = {
            'gas_price': 30 * 10**9,  # 30 gwei
            'pending_transactions': 100,
            'block_utilization': 0.50
        }
        
        adjusted_normal = await supply_agent.adjust_for_network_conditions(
            base_reward=base_reward,
            network_conditions=normal_conditions
        )
        
        # Should maintain rewards in normal conditions
        assert adjusted_normal == base_reward
    
    @pytest.mark.asyncio
    async def test_estimate_participation(self, supply_agent):
        """Test participation rate estimation"""
        # Mock recent activity data
        with patch.object(supply_agent, 'recall_similar') as mock_recall:
            mock_recall.return_value = [
                {'outcome': {'active_users': 1000}},
                {'outcome': {'active_users': 1200}},
                {'outcome': {'active_users': 1100}}
            ]
            
            rate = await supply_agent.estimate_participation()
            
            # Should calculate average participation
            assert rate > 0
            assert rate <= 1.0  # Percentage
    
    @pytest.mark.asyncio
    async def test_get_current_supply(self, supply_agent):
        """Test current supply retrieval"""
        # This would normally query blockchain
        supply = await supply_agent.get_current_supply()
        
        # Should return a valid supply amount
        assert supply >= 0
        assert supply <= supply_agent.max_supply
    
    def test_memory_storage(self, supply_agent):
        """Test that decisions are stored in memory for learning"""
        supply_agent.remember = Mock()
        
        asyncio.run(supply_agent.calculate_optimal_supply(
            current_supply=10_000_000 * 10**18,
            participation_rate=0.05
        ))
        
        # Should store decision for future learning
        supply_agent.remember.assert_called_once()
        call_args = supply_agent.remember.call_args
        assert call_args[1]['decision'] == 'calculate_supply'
        assert 'context' in call_args[1]
        assert 'outcome' in call_args[1]
    
    def test_safety_rails_enforcement(self, supply_agent):
        """Test that safety rails are always enforced"""
        # Test various edge cases
        test_cases = [
            (0, 0),  # Zero amounts
            (-1000, 0),  # Negative amounts
            (10**30, SAFETY_RAILS['max_daily_mint_protocol']),  # Huge amounts
        ]
        
        for input_amount, expected_max in test_cases:
            result = asyncio.run(supply_agent.check_mint_allowed(
                amount=input_amount,
                current_supply=50_000_000 * 10**18
            ))
            
            if input_amount <= 0:
                assert result['allowed'] == False
            elif input_amount > expected_max:
                assert result['adjusted_amount'] <= expected_max
    
    @pytest.mark.asyncio
    async def test_inflation_rate_control(self, supply_agent):
        """Test that inflation stays within target bounds"""
        current_supply = 50_000_000 * 10**18
        annual_target = 0.05  # 5% annual inflation
        
        # Calculate daily target based on annual rate
        daily_target = current_supply * (annual_target / 365)
        
        result = await supply_agent.calculate_optimal_supply(
            current_supply=current_supply,
            participation_rate=0.05
        )
        
        # Daily mint should approximate target inflation
        # Allow 20% deviation for market conditions
        assert result['target_daily_mint'] <= daily_target * 1.2
        assert result['target_daily_mint'] >= daily_target * 0.8
    
    @pytest.mark.asyncio
    async def test_extreme_scenarios(self, supply_agent):
        """Test agent behavior in extreme scenarios"""
        # Test with zero participation
        result = await supply_agent.calculate_optimal_supply(
            current_supply=10_000_000 * 10**18,
            participation_rate=0.0
        )
        # Should still allow minimal minting
        assert result['target_daily_mint'] > 0
        
        # Test with 100% participation (impossible but should handle)
        result = await supply_agent.calculate_optimal_supply(
            current_supply=10_000_000 * 10**18,
            participation_rate=1.0
        )
        # Should hit safety limit, not crash
        assert result['target_daily_mint'] <= SAFETY_RAILS['max_daily_mint_protocol']
        
        # Test at absolute maximum supply
        result = await supply_agent.calculate_optimal_supply(
            current_supply=supply_agent.max_supply,
            participation_rate=0.1
        )
        # Should prevent any minting
        assert result['target_daily_mint'] == 0