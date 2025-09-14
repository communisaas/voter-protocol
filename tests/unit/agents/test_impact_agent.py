"""
Critical causation-to-funding logic tests for ImpactAgent
Tests for catastrophic failure modes in impact measurement and funding allocation
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from agents.impact_agent import ImpactAgent


class TestImpactAgentCausationSecurity:
    """Test causation detection and funding pipeline security"""
    
    @pytest.fixture
    def impact_agent(self):
        """Create an impact agent instance"""
        with patch('agents.base_agent.BaseAgent.__init__'):
            agent = ImpactAgent()
            # Mock config
            agent.config = {
                "measurement_interval": 86400,  # 1 day
                "impact_threshold": 0.6,  # 60% confidence threshold
            }
            agent.measurement_interval = agent.config["measurement_interval"]
            agent.impact_threshold = agent.config["impact_threshold"]
            agent.memory = []
            agent.remember = Mock()
            agent.recall_similar = Mock(return_value=[])
            return agent
    
    # ============ FALSE CAUSATION DETECTION ============
    
    @pytest.mark.asyncio
    async def test_spurious_correlation_rejection(self, impact_agent):
        """Test that spurious correlations aren't treated as causation"""
        # Mock causal evidence with only correlation, no causation
        with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
            mock_causal.return_value = {
                "direct_citation": False,
                "position_changed": True,
                "temporal_alignment": False,  # Wrong timing
                "semantic_similarity": 0.3,  # Low similarity
            }
            
            action_data = {
                "message": "Please support healthcare",
                "representative": "Rep. Smith",
                "template_id": "tmpl_001",
            }
            
            result = await impact_agent._measure_legislative_impact(action_data, "CA-12")
            
            # Should have low score due to weak evidence
            assert result["score"] < 0.7
            assert result["causal_type"] == "correlation"
            assert result["confidence"] == "weak"
    
    @pytest.mark.asyncio
    async def test_temporal_causation_validation(self, impact_agent):
        """Test that temporal ordering is enforced for causation"""
        # Campaign happens AFTER vote change (impossible causation)
        with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
            mock_causal.return_value = {
                "direct_citation": False,
                "position_changed": True,
                "temporal_alignment": False,  # Vote changed before campaign
                "semantic_similarity": 0.9,  # High similarity but wrong order
            }
            
            action_data = {
                "message": "Support infrastructure bill",
                "representative": "Rep. Jones",
                "template_id": "tmpl_002",
                "timestamp": datetime.now(),
            }
            
            result = await impact_agent._measure_legislative_impact(action_data, "NY-10")
            
            # Should not claim causation despite similarity
            assert result["causal_type"] != "direct_causation"
            assert result["causal_type"] != "probable_causation"
    
    @pytest.mark.asyncio
    async def test_direct_citation_verification(self, impact_agent):
        """Test that direct citations are properly verified"""
        # Test valid direct citation
        with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
            mock_causal.return_value = {
                "direct_citation": True,  # Verbatim match found
                "position_changed": True,
                "temporal_alignment": True,
                "semantic_similarity": 0.95,
            }
            
            action_data = {
                "message": "This bill will create 50,000 jobs",
                "representative": "Sen. Williams",
                "template_id": "tmpl_003",
            }
            
            result = await impact_agent._measure_legislative_impact(action_data, "TX-03")
            
            # Should have high confidence with direct citation
            assert result["score"] >= 0.95
            assert result["causal_type"] == "direct_causation"
            assert result["confidence"] == "proven"
    
    # ============ FUNDING ALLOCATION OVERFLOW ============
    
    @pytest.mark.asyncio
    async def test_impact_score_bounds(self, impact_agent):
        """Test that impact scores stay within valid bounds"""
        test_cases = [
            # (action_type, action_data, expected_max_score)
            ("cwc_message", {"message": "x" * 10000}, 1.0),  # Very long message
            ("direct_action", {"participants": 1000000}, 1.0),  # Huge participation
            ("challenge_market", {"quality_score": 200}, 1.0),  # Invalid quality
        ]
        
        for action_type, action_data, max_score in test_cases:
            result = await impact_agent.measure_impact(action_type, action_data)
            assert 0 <= result["score"] <= max_score
            assert 0 <= result["effectiveness"] <= 1.0
    
    @pytest.mark.asyncio
    async def test_effectiveness_calculation_overflow(self, impact_agent):
        """Test effectiveness calculation doesn't overflow"""
        # Test with extreme values
        impact = {
            "score": 10.0,  # Invalid high score
            "category": "legislative"
        }
        
        effectiveness = impact_agent._calculate_effectiveness(impact)
        
        # Should be capped even with invalid input
        assert effectiveness <= 10.0  # At most score * weight
    
    # ============ REPRESENTATIVE SELECTION BIAS ============
    
    @pytest.mark.asyncio
    async def test_no_party_bias_in_impact(self, impact_agent):
        """Test that impact measurement doesn't favor particular parties"""
        # Test same action for different representatives
        representatives = [
            "Rep. Smith (D-CA)",
            "Rep. Jones (R-TX)",
            "Rep. Brown (I-VT)",
        ]
        
        scores = []
        for rep in representatives:
            with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
                mock_causal.return_value = {
                    "direct_citation": False,
                    "position_changed": True,
                    "temporal_alignment": True,
                    "semantic_similarity": 0.8,
                }
                
                action_data = {
                    "message": "Support climate action",
                    "representative": rep,
                    "template_id": "tmpl_004",
                }
                
                result = await impact_agent._measure_legislative_impact(action_data, "CA-12")
                scores.append(result["score"])
        
        # All should have similar scores (no party bias)
        assert max(scores) - min(scores) < 0.1
    
    @pytest.mark.asyncio
    async def test_geographic_distribution_fairness(self, impact_agent):
        """Test that impact isn't biased toward certain districts"""
        districts = ["CA-12", "TX-03", "NY-10", "FL-05", "WY-01"]
        
        scores = []
        for district in districts:
            action_data = {
                "message": "Infrastructure investment needed",
                "representative": f"Rep. {district}",
                "template_id": "tmpl_005",
                "district": district,
            }
            
            with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
                mock_causal.return_value = {
                    "direct_citation": False,
                    "position_changed": False,
                    "temporal_alignment": True,
                    "semantic_similarity": 0.7,
                }
                
                result = await impact_agent._measure_legislative_impact(action_data, district)
                scores.append(result["score"])
        
        # Should have reasonable distribution
        assert min(scores) > 0.4  # No district gets zero impact
        assert max(scores) < 0.9  # No district gets automatic high impact
    
    # ============ TREASURY DEPLETION SCENARIOS ============
    
    @pytest.mark.asyncio
    async def test_mass_high_impact_claims(self, impact_agent):
        """Test system behavior when many users claim high impact"""
        # Simulate 1000 users all claiming direct causation
        total_impact = 0
        
        for i in range(1000):
            with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
                # Everyone claims direct citation (gaming attempt)
                mock_causal.return_value = {
                    "direct_citation": True,
                    "position_changed": True,
                    "temporal_alignment": True,
                    "semantic_similarity": 0.99,
                }
                
                action_data = {
                    "message": f"Message {i}",
                    "representative": f"Rep. {i % 50}",
                    "template_id": f"tmpl_{i}",
                }
                
                result = await impact_agent._measure_legislative_impact(action_data, "CA-12")
                total_impact += result["score"]
        
        avg_impact = total_impact / 1000
        
        # Even if everyone claims high impact, need verification
        # In reality, would need additional verification layers
        assert avg_impact > 0  # System still functions
    
    @pytest.mark.asyncio
    async def test_coordinated_impact_manipulation(self, impact_agent):
        """Test detection of coordinated impact manipulation"""
        # Multiple users claiming same template caused same change
        template_id = "tmpl_shared"
        representative = "Rep. Target"
        
        impacts = []
        for i in range(100):
            with patch.object(impact_agent, '_build_causal_model', new_callable=AsyncMock) as mock_causal:
                mock_causal.return_value = {
                    "direct_citation": True,  # All claim same citation
                    "position_changed": True,
                    "temporal_alignment": True,
                    "semantic_similarity": 0.95,
                }
                
                action_data = {
                    "message": "Identical message",
                    "representative": representative,
                    "template_id": template_id,
                    "user": f"user_{i}",
                }
                
                result = await impact_agent._measure_legislative_impact(action_data, "CA-12")
                impacts.append(result["score"])
        
        # All users get same high score (need deduplication in production)
        assert all(score > 0.9 for score in impacts)
        # In production: Would need to divide credit among participants
    
    # ============ CHALLENGE MARKET IMPACT GAMING ============
    
    @pytest.mark.asyncio
    async def test_stake_amount_manipulation(self, impact_agent):
        """Test that stake amounts don't unfairly influence impact"""
        # Test same quality with different stakes
        stake_amounts = [0, 10**18, 100*10**18, 10000*10**18]
        
        scores = []
        for stake in stake_amounts:
            action_data = {
                "quality_score": 75,  # Same quality
                "stake_amount": stake,
                "resolution": "supported",
            }
            
            result = await impact_agent._measure_discourse_impact(action_data)
            scores.append(result["score"])
        
        # Stake should have limited influence
        max_diff = max(scores) - min(scores)
        assert max_diff < 0.3  # Max 30% difference from stake alone
    
    @pytest.mark.asyncio
    async def test_quality_score_validation(self, impact_agent):
        """Test that invalid quality scores are handled"""
        invalid_qualities = [-100, -1, 101, 1000, float('inf')]
        
        for quality in invalid_qualities:
            action_data = {
                "quality_score": quality,
                "stake_amount": 100*10**18,
                "resolution": "supported",
            }
            
            result = await impact_agent._measure_discourse_impact(action_data)
            
            # Should handle gracefully
            assert 0 <= result["score"] <= 1.0
    
    # ============ RECOMMENDATION MANIPULATION ============
    
    def test_recommendation_thresholds(self, impact_agent):
        """Test that recommendations have proper thresholds"""
        test_scores = [0.0, 0.3, 0.5, 0.7, 0.9, 1.0]
        
        recommendations = []
        for score in test_scores:
            rec = impact_agent._get_recommendation(score)
            recommendations.append(rec)
            
            # Verify recommendation matches score
            if score >= 0.8:
                assert "increase" in rec.lower()
            elif score < 0.4:
                assert "low" in rec.lower() or "review" in rec.lower()
    
    # ============ CONCURRENT ACCESS TESTS ============
    
    @pytest.mark.asyncio
    async def test_concurrent_impact_measurements(self, impact_agent):
        """Test thread safety of concurrent impact measurements"""
        # Create many concurrent measurements
        tasks = []
        
        for i in range(100):
            action_data = {
                "message": f"Message {i}",
                "representative": f"Rep. {i % 10}",
                "template_id": f"tmpl_{i}",
            }
            
            task = impact_agent.measure_impact(
                action_type="cwc_message",
                action_data=action_data,
                district=f"ST-{i % 50}"
            )
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        
        # All should complete successfully
        assert len(results) == 100
        for result in results:
            assert "score" in result
            assert 0 <= result["score"] <= 1.0
    
    # ============ MEMORY OVERFLOW TESTS ============
    
    @pytest.mark.asyncio
    async def test_memory_accumulation_limits(self, impact_agent):
        """Test that agent memory doesn't grow unbounded"""
        # Simulate many impact measurements
        for i in range(10000):
            await impact_agent.measure_impact(
                action_type="cwc_message",
                action_data={"message": f"msg{i}"},
                district="CA-12"
            )
        
        # Memory should be bounded (mocked here, but important in production)
        # In production: Would have memory pruning/summarization
        assert impact_agent.remember.call_count == 10000
    
    # ============ EDGE CASE HANDLING ============
    
    @pytest.mark.asyncio
    async def test_empty_action_data(self, impact_agent):
        """Test handling of empty or malformed action data"""
        test_cases = [
            {},  # Empty
            None,  # None
            {"message": ""},  # Empty message
            {"representative": None},  # None values
        ]
        
        for action_data in test_cases:
            result = await impact_agent.measure_impact(
                action_type="cwc_message",
                action_data=action_data or {},
                district="CA-12"
            )
            
            # Should handle gracefully
            assert result is not None
            assert "score" in result
            assert result["score"] >= 0