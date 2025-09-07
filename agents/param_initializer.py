"""
Agent Parameter Initializer - Agents set initial parameter values within bounds
"""

from typing import Dict, Any
from web3 import Web3
from agents.supply_agent import SupplyAgent
from agents.market_agent import MarketAgent
from agents.impact_agent import ImpactAgent
from agents.reputation_agent import ReputationAgent


class ParameterInitializer:
    """
    Coordinates agents to determine initial parameter values
    Death to hardcoded tyranny - agents decide within safety rails
    """
    
    def __init__(self, web3: Web3, agent_params_address: str):
        self.w3 = web3
        self.agent_params_address = agent_params_address
        
        # Initialize agents
        self.supply_agent = SupplyAgent()
        self.market_agent = MarketAgent()
        self.impact_agent = ImpactAgent()
        self.reputation_agent = ReputationAgent()
        
        # Load AgentParameters ABI
        self.agent_params_abi = self._load_agent_params_abi()
        self.agent_params_contract = self.w3.eth.contract(
            address=self.agent_params_address,
            abi=self.agent_params_abi
        )
    
    async def initialize_all_parameters(self) -> Dict[str, Any]:
        """
        Have agents determine all initial parameter values
        """
        initialized_params = {}
        
        # Supply parameters
        supply_params = await self._initialize_supply_params()
        initialized_params.update(supply_params)
        
        # Market parameters (rewards and fees)
        market_params = await self._initialize_market_params()
        initialized_params.update(market_params)
        
        # Challenge market parameters
        challenge_params = await self._initialize_challenge_params()
        initialized_params.update(challenge_params)
        
        # Impact and reputation parameters
        impact_params = await self._initialize_impact_params()
        initialized_params.update(impact_params)
        
        return initialized_params
    
    async def _initialize_supply_params(self) -> Dict[str, int]:
        """
        Supply agent determines initial minting parameters
        """
        # Agent analyzes current conditions to set parameters
        current_supply = await self.supply_agent.get_current_supply()
        participation_rate = await self.supply_agent.estimate_participation()
        
        # Agent calculates optimal initial values
        params = {
            "reward:CWC_MESSAGE": int(10e18),  # Start at 10 VOTER, agent will adjust
            "reward:DIRECT_ACTION": int(15e18),  # Direct action gets more initially
            "maxDailyMintPerUser": int(100e18),  # Conservative daily cap
            "maxDailyMintProtocol": int(10000e18),  # Protocol-wide daily cap
            "minActionInterval": 3600,  # 1 hour between actions
        }
        
        # Adjust based on supply conditions
        if current_supply > 50_000_000e18:
            # Reduce rewards if supply is high
            params["reward:CWC_MESSAGE"] = int(5e18)
            params["reward:DIRECT_ACTION"] = int(8e18)
        
        if participation_rate < 0.01:  # Less than 1% participation
            # Increase rewards to boost participation
            params["reward:CWC_MESSAGE"] = int(20e18)
            params["reward:DIRECT_ACTION"] = int(30e18)
        
        return params
    
    async def _initialize_market_params(self) -> Dict[str, int]:
        """
        Market agent determines economic parameters
        """
        # Agent analyzes market conditions
        volatility = await self.market_agent.calculate_volatility()
        
        params = {
            "epistemicLeverageMultiplier": 150,  # 1.5x bonus for high credibility
            "minCredibilityForBonus": 60,  # Need 60+ credibility for bonus
            "doubtingPenaltyRate": 20,  # 20% penalty for low credibility claims
            "minEpistemicReputationForAction": 10,  # Minimum rep to participate
        }
        
        # Adjust based on market volatility
        if volatility > 0.5:
            # Higher volatility needs stronger incentives
            params["epistemicLeverageMultiplier"] = 200  # 2x bonus
            params["doubtingPenaltyRate"] = 30  # Stronger penalty
        
        return params
    
    async def _initialize_challenge_params(self) -> Dict[str, int]:
        """
        Determine challenge market parameters based on expected activity
        """
        expected_challenges = await self.market_agent.estimate_challenge_volume()
        
        params = {
            "challenge:minStake": int(10e18),  # 10 VOTER minimum stake
            "challenge:duration": 3 * 24 * 3600,  # 3 days
            "challenge:qualityThreshold": 60,  # 60/100 quality score needed
            "challenge:marketFeeRate": 250,  # 2.5% fee
        }
        
        # Adjust based on expected volume
        if expected_challenges > 100:  # High expected volume
            params["challenge:minStake"] = int(5e18)  # Lower barrier
            params["challenge:duration"] = 2 * 24 * 3600  # Faster resolution
        elif expected_challenges < 10:  # Low expected volume
            params["challenge:minStake"] = int(20e18)  # Higher barrier for quality
            params["challenge:marketFeeRate"] = 500  # 5% fee to build treasury
        
        return params
    
    async def _initialize_impact_params(self) -> Dict[str, int]:
        """
        Impact agent sets thresholds for measuring effectiveness
        """
        # Agent determines what constitutes meaningful impact
        baseline_impact = await self.impact_agent.calculate_baseline_impact()
        
        params = {
            "minImpactForReward": int(baseline_impact * 0.5),  # 50% of baseline
            "highImpactMultiplier": 200,  # 2x reward for high impact
            "impactMeasurementWindow": 7 * 24 * 3600,  # 7 day window
        }
        
        return params
    
    async def set_parameters_on_chain(
        self,
        params: Dict[str, Any],
        admin_key: str
    ) -> Dict[str, str]:
        """
        Write agent-determined parameters to chain
        """
        account = self.w3.eth.account.from_key(admin_key)
        tx_hashes = {}
        
        for key, value in params.items():
            # Convert string key to bytes32
            key_bytes = Web3.keccak(text=key)
            
            # Build transaction
            tx = self.agent_params_contract.functions.setUint(
                key_bytes,
                value
            ).build_transaction({
                'from': account.address,
                'nonce': self.w3.eth.get_transaction_count(account.address),
                'gas': 100000,
                'gasPrice': self.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.w3.eth.account.sign_transaction(tx, admin_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            tx_hashes[key] = tx_hash.hex()
            
            # Wait for confirmation
            self.w3.eth.wait_for_transaction_receipt(tx_hash)
        
        return tx_hashes
    
    def _load_agent_params_abi(self) -> list:
        """Load AgentParameters contract ABI"""
        # Simplified ABI for setUint and getUint functions
        return [
            {
                "inputs": [
                    {"internalType": "bytes32", "name": "key", "type": "bytes32"},
                    {"internalType": "uint256", "name": "value", "type": "uint256"}
                ],
                "name": "setUint",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"internalType": "bytes32", "name": "key", "type": "bytes32"}
                ],
                "name": "getUint",
                "outputs": [
                    {"internalType": "uint256", "name": "", "type": "uint256"}
                ],
                "stateMutability": "view",
                "type": "function"
            }
        ]


async def initialize_protocol_parameters(
    web3_provider: str,
    agent_params_address: str,
    admin_key: str = None
) -> Dict[str, Any]:
    """
    Main entry point to initialize all protocol parameters
    """
    w3 = Web3(Web3.HTTPProvider(web3_provider))
    initializer = ParameterInitializer(w3, agent_params_address)
    
    # Have agents determine parameters
    params = await initializer.initialize_all_parameters()
    
    print("Agent-determined initial parameters:")
    for key, value in params.items():
        if isinstance(value, int) and value > 10**15:
            # Format large numbers as VOTER tokens
            print(f"  {key}: {value / 10**18:.2f} VOTER")
        else:
            print(f"  {key}: {value}")
    
    # If admin key provided, set on chain
    if admin_key:
        print("\nSetting parameters on chain...")
        tx_hashes = await initializer.set_parameters_on_chain(params, admin_key)
        print("Parameters set successfully!")
        for key, tx_hash in tx_hashes.items():
            print(f"  {key}: {tx_hash}")
    
    return params