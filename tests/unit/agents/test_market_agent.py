"""
Critical financial security tests for MarketAgent
Tests for catastrophic failure modes in reward calculations and market dynamics
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from agents.market_agent import MarketAgent


class TestMarketAgentFinancialSecurity:
    """Test financial decision-making and security of MarketAgent"""
    
    @pytest.fixture
    def market_agent(self):
        """Create a market agent instance"""
        with patch('agents.base_agent.BaseAgent.__init__'):
            agent = MarketAgent()
            # Mock config
            agent.config = {
                "min_reward": 1 * 10**18,  # 1 VOTER
                "max_reward": 1000 * 10**18,  # 1000 VOTER
            }
            agent.min_reward = agent.config["min_reward"]
            agent.max_reward = agent.config["max_reward"]
            agent.memory = []
            agent.remember = Mock()
            return agent
    
    # ============ OVERFLOW/UNDERFLOW TESTS ============
    
    @pytest.mark.asyncio
    async def test_reward_calculation_overflow_protection(self, market_agent):
        """Test that reward calculations can't overflow"""
        # Maximum possible inputs
        max_reputation = 100
        min_participation = 1  # Low participation = high multiplier
        
        reward = await market_agent.calculate_reward(
            action_type="challenge_market",  # Highest base reward
            user_reputation=max_reputation,
            current_participation=min_participation
        )
        
        # Should be capped at max_reward
        assert reward <= market_agent.max_reward
        assert reward > 0
    
    @pytest.mark.asyncio
    async def test_reward_calculation_underflow_protection(self, market_agent):
        """Test that rewards can't go negative or below minimum"""
        # Worst case inputs
        min_reputation = 0
        max_participation = 10000  # High participation = low multiplier
        
        reward = await market_agent.calculate_reward(
            action_type="direct_action",  # Lowest base reward
            user_reputation=min_reputation,
            current_participation=max_participation
        )
        
        # Should be floored at min_reward
        assert reward >= market_agent.min_reward
        assert reward > 0
    
    # ============ BOUNDARY CONDITION TESTS ============
    
    @pytest.mark.asyncio
    async def test_extreme_market_dynamics(self, market_agent):
        """Test market dynamics with extreme values"""
        # Test with zero demand
        dynamics = await market_agent.calculate_market_dynamics(
            supply=1000000,
            demand=0,
            price=0.001
        )
        
        assert dynamics["supply_demand_ratio"] > 0
        assert 0 <= dynamics["market_health"] <= 1
        assert "Reduce token emissions" in dynamics["recommendations"]
        
        # Test with zero supply
        dynamics = await market_agent.calculate_market_dynamics(
            supply=0,
            demand=1000000,
            price=100
        )
        
        # Should handle division by zero gracefully
        assert dynamics is not None
    
    @pytest.mark.asyncio
    async def test_price_elasticity_edge_cases(self, market_agent):
        """Test elasticity calculation with edge case prices"""
        # Zero price
        elasticity = market_agent._estimate_elasticity(0, 1000)
        assert elasticity == 1.0  # Default value for zero price
        
        # Negative price (shouldn't happen but test defense)
        elasticity = market_agent._estimate_elasticity(-1, 1000)
        assert elasticity == 1.0
        
        # Very high price
        elasticity = market_agent._estimate_elasticity(1000000, 1000)
        assert elasticity >= 0  # Should still be valid
    
    # ============ GAMING PREVENTION TESTS ============
    
    @pytest.mark.asyncio
    async def test_reward_farming_detection(self, market_agent):
        """Test detection of reward farming attempts"""
        # Simulate excessive claiming
        recent_rewards = [
            {"timestamp": i * 60} for i in range(50)  # 50 claims
        ]
        
        result = await market_agent.prevent_gaming(
            user_address="0x" + "1" * 40,
            recent_rewards=recent_rewards
        )
        
        assert result["risk_score"] > 0.3
        assert "excessive_claims" in result["gaming_indicators"]
        assert result["reward_multiplier"] < 1.0
    
    @pytest.mark.asyncio
    async def test_coordinated_attack_detection(self, market_agent):
        """Test detection of coordinated gaming attempts"""
        # Simulate bot-like regular intervals
        base_time = 1000000
        recent_rewards = [
            {"timestamp": base_time + i * 3600}  # Exactly 1 hour apart
            for i in range(10)
        ]
        
        result = await market_agent.prevent_gaming(
            user_address="0x" + "2" * 40,
            recent_rewards=recent_rewards
        )
        
        # Should detect coordinated pattern
        assert "coordinated_claiming" in result["gaming_indicators"]
        assert result["risk_score"] > 0.4
    
    # ============ ECONOMIC MANIPULATION TESTS ============
    
    @pytest.mark.asyncio
    async def test_market_manipulation_resistance(self, market_agent):
        """Test resistance to market manipulation attempts"""
        # Simulate pump scenario
        pump_metrics = {
            "avg_participation": 100,  # Low participation
            "avg_impact": 0.1,  # But also low impact
            "token_velocity": 5.0  # Very high velocity (dumping)
        }
        
        adjustments = await market_agent.optimize_incentives(pump_metrics)
        
        # Should reduce rewards due to high velocity
        assert adjustments["reward_multiplier"] < 1.0
        assert "velocity" in adjustments["reason"].lower()
    
    @pytest.mark.asyncio
    async def test_death_spiral_prevention(self, market_agent):
        """Test prevention of economic death spirals"""
        # Simulate death spiral conditions
        death_spiral_metrics = {
            "avg_participation": 10,  # Very low participation
            "avg_impact": 0.1,  # Very low impact
            "token_velocity": 0.1  # No trading (dead token)
        }
        
        adjustments = await market_agent.optimize_incentives(death_spiral_metrics)
        
        # Should attempt to revive with balanced approach
        assert adjustments["reward_multiplier"] == 1.0
        assert "balanced" in adjustments["reason"].lower()
    
    # ============ MULTIPLIER CALCULATION TESTS ============
    
    def test_reputation_multiplier_bounds(self, market_agent):
        """Test reputation multiplier stays within safe bounds"""
        # Test all reputation ranges
        for reputation in range(0, 101, 10):
            multiplier = market_agent._calculate_reputation_multiplier(reputation)
            assert 0.5 <= multiplier <= 2.0
        
        # Test edge cases
        assert market_agent._calculate_reputation_multiplier(-10) == 0.5
        assert market_agent._calculate_reputation_multiplier(200) == 2.0
    
    def test_participation_multiplier_bounds(self, market_agent):
        """Test participation multiplier stays within safe bounds"""
        participation_levels = [0, 1, 99, 100, 499, 500, 999, 1000, 4999, 5000, 10000]
        
        for participation in participation_levels:
            multiplier = market_agent._calculate_participation_multiplier(participation)
            assert 0.6 <= multiplier <= 1.5
    
    # ============ FINANCIAL INVARIANT TESTS ============
    
    @pytest.mark.asyncio
    async def test_reward_never_exceeds_treasury(self, market_agent):
        """Test that rewards never exceed what treasury can pay"""
        # Simulate scenario where many users claim maximum rewards
        total_rewards = 0
        treasury_balance = 1000000 * 10**18  # 1M VOTER
        
        for _ in range(10000):  # 10k users
            reward = await market_agent.calculate_reward(
                action_type="challenge_market",
                user_reputation=100,  # Max reputation
                current_participation=1  # Min participation for max reward
            )
            total_rewards += reward
            
            # Each individual reward should be reasonable
            assert reward <= market_agent.max_reward
        
        # Average reward should be sustainable
        avg_reward = total_rewards / 10000
        assert avg_reward < treasury_balance / 10000  # Can pay all users
    
    @pytest.mark.asyncio
    async def test_market_health_calculation_bounds(self, market_agent):
        """Test market health score stays normalized"""
        test_cases = [
            (0.1, 0.1, 0.001),  # All bad
            (1.0, 1.0, 1.0),     # All normal
            (10.0, 10.0, 0.001), # Extreme ratios
        ]
        
        for sd_ratio, elasticity, price in test_cases:
            health = market_agent._calculate_market_health(sd_ratio, elasticity, price)
            assert 0 <= health <= 1, f"Health {health} out of bounds for inputs {sd_ratio}, {elasticity}, {price}"
    
    # ============ CONCURRENCY & RACE CONDITION TESTS ============
    
    @pytest.mark.asyncio
    async def test_concurrent_reward_calculations(self, market_agent):
        """Test thread safety of concurrent reward calculations"""
        # Simulate many concurrent reward calculations
        tasks = []
        for i in range(100):
            task = market_agent.calculate_reward(
                action_type="cwc_message",
                user_reputation=i % 100,
                current_participation=i * 10
            )
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        
        # All results should be valid
        for reward in results:
            assert market_agent.min_reward <= reward <= market_agent.max_reward
    
    # ============ INTEGRATION WITH SMART CONTRACTS ============
    
    @pytest.mark.asyncio
    async def test_reward_validation_for_contract(self, market_agent):
        """Test that rewards are valid for smart contract minting"""
        # Test various reward amounts
        test_rewards = [
            market_agent.min_reward,
            market_agent.max_reward,
            100 * 10**18,
            0,  # Should fail
            -100,  # Should fail
            market_agent.max_reward + 1  # Should fail
        ]
        
        for reward in test_rewards:
            is_valid = await market_agent.validate(reward=reward)
            
            if reward == 0 or reward < 0:
                assert not is_valid
            elif reward > market_agent.max_reward:
                assert not is_valid
            else:
                assert is_valid
    
    # ============ EMERGENCY SCENARIOS ============
    
    @pytest.mark.asyncio
    async def test_emergency_market_conditions(self, market_agent):
        """Test agent behavior during emergency market conditions"""
        # Flash crash scenario
        crash_dynamics = await market_agent.calculate_market_dynamics(
            supply=10000000,  # Massive supply
            demand=1,         # No demand
            price=0.00001     # Price crashed
        )
        
        assert crash_dynamics["market_health"] < 0.5
        assert len(crash_dynamics["recommendations"]) > 0
        
        # Supply shock scenario
        shock_dynamics = await market_agent.calculate_market_dynamics(
            supply=1,          # No supply
            demand=10000000,   # Massive demand
            price=10000        # Price mooning
        )
        
        assert shock_dynamics is not None
        assert "Increase token emissions" in shock_dynamics["recommendations"]
    
    @pytest.mark.asyncio
    async def test_parameter_update_safety(self, market_agent):
        """Test that parameter updates respect safety bounds"""
        # Attempt to set invalid bounds
        market_agent.min_reward = -100  # Negative
        market_agent.max_reward = 2**256  # Too large
        
        # Calculate reward with invalid bounds
        reward = await market_agent.calculate_reward(
            action_type="cwc_message",
            user_reputation=50,
            current_participation=1000
        )
        
        # Should still produce valid result (defensive programming)
        assert reward > 0
        assert reward < 2**256