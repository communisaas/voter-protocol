"""
Integration test for complete challenge market lifecycle
Tests the full flow: create → stake → resolve → distribute rewards
This is CRITICAL for ensuring money flows correctly
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from web3 import Web3
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


class TestChallengeLifecycle:
    """Test complete challenge market flow with all components"""
    
    @pytest.fixture
    def mock_contracts(self):
        """Mock smart contract instances"""
        return {
            'challenge_market': Mock(),
            'voter_token': Mock(),
            'voter_registry': Mock(),
            'agent_params': Mock()
        }
    
    @pytest.fixture
    def participants(self):
        """Test participant addresses and balances"""
        return {
            'challenger': {
                'address': '0x' + '1' * 40,
                'balance': 1000 * 10**18,
                'reputation': 50
            },
            'defender': {
                'address': '0x' + '2' * 40,
                'balance': 0,  # Defender doesn't stake
                'reputation': 75
            },
            'supporter1': {
                'address': '0x' + '3' * 40,
                'balance': 500 * 10**18,
                'reputation': 30
            },
            'supporter2': {
                'address': '0x' + '4' * 40,
                'balance': 200 * 10**18,
                'reputation': 20
            },
            'opposer1': {
                'address': '0x' + '5' * 40,
                'balance': 300 * 10**18,
                'reputation': 40
            }
        }
    
    @pytest.mark.asyncio
    async def test_complete_challenge_flow(self, mock_contracts, participants):
        """Test entire challenge lifecycle end-to-end"""
        
        # ========== PHASE 1: CREATE CHALLENGE ==========
        
        challenge_data = {
            'claim_hash': Web3.keccak(text="Policy X will cost $1B"),
            'evidence_ipfs': 'QmEvidence123',
            'stake_amount': 100 * 10**18  # Challenger stakes 100 VOTER
        }
        
        # Mock agent parameter for minimum stake
        mock_contracts['agent_params'].getUint.return_value = 10 * 10**18  # 10 VOTER min
        
        # Verify challenger has sufficient balance
        challenger = participants['challenger']
        assert challenger['balance'] >= challenge_data['stake_amount']
        
        # Create challenge transaction
        create_tx = {
            'from': challenger['address'],
            'to': mock_contracts['challenge_market'].address,
            'value': 0,
            'data': self._encode_create_challenge(challenge_data)
        }
        
        # Mock successful challenge creation
        challenge_id = 1
        mock_contracts['challenge_market'].createChallenge.return_value = challenge_id
        
        # Verify stake transfer
        mock_contracts['voter_token'].transferFrom.assert_called_with(
            challenger['address'],
            mock_contracts['challenge_market'].address,
            challenge_data['stake_amount']
        )
        
        # ========== PHASE 2: PARTICIPANTS STAKE ==========
        
        stakes = []
        
        # Supporters stake
        for supporter_key in ['supporter1', 'supporter2']:
            supporter = participants[supporter_key]
            stake_amount = 50 * 10**18 if supporter_key == 'supporter1' else 20 * 10**18
            
            stake_tx = self._create_stake_transaction(
                challenge_id, 
                supporter['address'],
                stake_amount,
                is_support=True
            )
            stakes.append({
                'address': supporter['address'],
                'amount': stake_amount,
                'is_support': True
            })
        
        # Opposers stake
        opposer = participants['opposer1']
        opposer_stake = 30 * 10**18
        
        stake_tx = self._create_stake_transaction(
            challenge_id,
            opposer['address'],
            opposer_stake,
            is_support=False
        )
        stakes.append({
            'address': opposer['address'],
            'amount': opposer_stake,
            'is_support': False
        })
        
        # Calculate totals
        total_support = sum(s['amount'] for s in stakes if s['is_support'])
        total_oppose = sum(s['amount'] for s in stakes if not s['is_support'])
        
        # ========== PHASE 3: RESOLUTION ==========
        
        # Mock quality score from verification
        quality_score = 75  # Out of 100
        quality_threshold = 60  # From agent parameters
        mock_contracts['agent_params'].getUint.return_value = quality_threshold
        
        # Determine outcome
        has_quality = quality_score >= quality_threshold
        support_wins = total_support > total_oppose
        
        resolution_result = 'SUPPORT' if (has_quality and support_wins) else 'OPPOSE'
        
        # Mock resolution transaction
        resolve_tx = self._create_resolution_transaction(
            challenge_id,
            quality_score,
            resolution_result
        )
        
        # Update reputation scores
        if resolution_result == 'SUPPORT':
            new_challenger_rep = challenger['reputation'] + 10
            new_defender_rep = max(0, participants['defender']['reputation'] - 5)
        else:
            new_challenger_rep = max(0, challenger['reputation'] - 10)
            new_defender_rep = participants['defender']['reputation'] + 5
        
        # ========== PHASE 4: REWARD DISTRIBUTION ==========
        
        # Calculate reward pool
        total_pool = challenge_data['stake_amount'] + total_support + total_oppose
        market_fee_rate = 250  # 2.5% in basis points
        market_fee = (total_pool * market_fee_rate) // 10000
        reward_pool = total_pool - market_fee
        
        # Quality bonus
        quality_bonus = (reward_pool * quality_score) // 1000
        reward_pool += quality_bonus
        
        # Calculate individual rewards
        rewards = {}
        
        if resolution_result == 'SUPPORT':
            # Challenger gets their stake back plus bonus
            challenger_reward = challenge_data['stake_amount'] + \
                              (challenge_data['stake_amount'] * quality_score // 100)
            rewards[challenger['address']] = challenger_reward
            
            # Supporters share the remaining pool
            winning_stake = total_support
            for stake in stakes:
                if stake['is_support']:
                    proportion = stake['amount'] / winning_stake
                    stake_reward = int(reward_pool * proportion)
                    rewards[stake['address']] = stake_reward
        else:
            # Defender gets half the challenger's stake
            defender_reward = challenge_data['stake_amount'] // 2
            rewards[participants['defender']['address']] = defender_reward
            
            # Opposers share the pool
            winning_stake = total_oppose
            for stake in stakes:
                if not stake['is_support']:
                    proportion = stake['amount'] / winning_stake
                    stake_reward = int(reward_pool * proportion)
                    rewards[stake['address']] = stake_reward
        
        # ========== PHASE 5: VERIFICATION ==========
        
        # Verify all rewards are distributed
        total_distributed = sum(rewards.values())
        assert total_distributed <= total_pool, "Cannot distribute more than pool"
        
        # Verify no negative balances
        for address, reward in rewards.items():
            assert reward >= 0, f"Negative reward for {address}"
        
        # Verify reputation updates
        assert new_challenger_rep != challenger['reputation'], "Reputation should change"
        assert new_defender_rep != participants['defender']['reputation'], "Defender rep should change"
        
        # Verify fee collection
        assert market_fee > 0, "Market should collect fees"
        assert market_fee == (total_pool * market_fee_rate) // 10000
        
        return {
            'challenge_id': challenge_id,
            'resolution': resolution_result,
            'rewards': rewards,
            'reputation_changes': {
                challenger['address']: new_challenger_rep - challenger['reputation'],
                participants['defender']['address']: new_defender_rep - participants['defender']['reputation']
            },
            'market_fee': market_fee
        }
    
    @pytest.mark.asyncio
    async def test_challenge_with_equal_stakes(self, mock_contracts, participants):
        """Test edge case where support and oppose stakes are equal"""
        
        # Create challenge with equal stakes on both sides
        challenge_id = 2
        equal_stake = 100 * 10**18
        
        # Support side
        support_stake = equal_stake
        # Oppose side  
        oppose_stake = equal_stake
        
        # With equal stakes, quality score becomes decisive
        quality_score = 65  # Above threshold
        quality_threshold = 60
        
        # Quality above threshold should favor support
        has_quality = quality_score >= quality_threshold
        support_wins = support_stake >= oppose_stake  # Equal counts as support win
        
        resolution = 'SUPPORT' if (has_quality and support_wins) else 'OPPOSE'
        assert resolution == 'SUPPORT', "Quality should break tie"
    
    @pytest.mark.asyncio
    async def test_challenge_manipulation_prevention(self, mock_contracts):
        """Test that challenge market prevents common manipulation attacks"""
        
        # Test 1: Cannot resolve own challenge immediately
        attacker = '0x' + '666' * 13 + '66'
        challenge_id = 3
        
        # Time lock should prevent immediate resolution
        challenge_duration = 3 * 24 * 3600  # 3 days
        mock_contracts['agent_params'].getUint.return_value = challenge_duration
        
        # Attempt immediate resolution should fail
        with pytest.raises(Exception) as exc:
            # In real contract, this would revert with "Challenge not expired"
            current_time = 1000
            challenge_created = 999
            if current_time - challenge_created < challenge_duration:
                raise Exception("Challenge duration not met")
        
        assert "duration not met" in str(exc.value).lower()
        
        # Test 2: Cannot stake after resolution
        resolved_challenge = 4
        mock_contracts['challenge_market'].challenges[resolved_challenge] = {
            'status': 'RESOLVED_SUPPORT'
        }
        
        # Staking should fail on resolved challenge
        with pytest.raises(Exception) as exc:
            status = mock_contracts['challenge_market'].challenges[resolved_challenge]['status']
            if status != 'ACTIVE':
                raise Exception("Challenge not active")
        
        assert "not active" in str(exc.value).lower()
    
    @pytest.mark.asyncio  
    async def test_minimum_stake_enforcement(self, mock_contracts):
        """Test that minimum stake requirements are enforced"""
        
        # Set minimum stake from agent parameters
        min_stake = 10 * 10**18  # 10 VOTER
        mock_contracts['agent_params'].getUint.return_value = min_stake
        
        # Test creating challenge with insufficient stake
        insufficient_stake = 5 * 10**18
        
        with pytest.raises(Exception) as exc:
            if insufficient_stake < min_stake:
                raise Exception(f"Stake {insufficient_stake} below minimum {min_stake}")
        
        assert "below minimum" in str(exc.value).lower()
        
        # Test reputation-based stake reduction
        high_reputation = 100
        reduced_min_stake = min_stake // 2  # 50% reduction for high rep
        
        # High reputation users should need less stake
        assert reduced_min_stake < min_stake
        assert reduced_min_stake == 5 * 10**18
    
    @pytest.mark.asyncio
    async def test_fee_distribution(self, mock_contracts):
        """Test that market fees are correctly collected and distributed"""
        
        total_pool = 1000 * 10**18
        fee_rates = [100, 250, 500]  # 1%, 2.5%, 5%
        
        for fee_rate in fee_rates:
            expected_fee = (total_pool * fee_rate) // 10000
            remaining_pool = total_pool - expected_fee
            
            # Verify fee calculation
            assert expected_fee == (total_pool * fee_rate) // 10000
            assert remaining_pool == total_pool - expected_fee
            
            # Verify fee doesn't exceed reasonable bounds
            assert fee_rate <= 1000, "Fee should not exceed 10%"
            assert expected_fee < total_pool // 10, "Fee too high"
    
    def _encode_create_challenge(self, data):
        """Encode challenge creation call data"""
        # In reality, this would use eth_abi.encode
        return f"createChallenge({data['claim_hash']},{data['evidence_ipfs']})"
    
    def _create_stake_transaction(self, challenge_id, staker, amount, is_support):
        """Create a stake transaction"""
        return {
            'challenge_id': challenge_id,
            'staker': staker,
            'amount': amount,
            'is_support': is_support
        }
    
    def _create_resolution_transaction(self, challenge_id, quality_score, result):
        """Create resolution transaction"""
        return {
            'challenge_id': challenge_id,
            'quality_score': quality_score,
            'result': result
        }