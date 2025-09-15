"""
Blockchain connector for VOTER Protocol agents - STUBBED
Web3 functionality moved to Communiqué or made optional.
"""

import json
import os
from typing import Dict, Any, Optional

# Try to import Web3, but don't fail if not available
try:
    from web3 import Web3
    from web3.middleware import geth_poa_middleware
    from eth_account import Account
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False
    Web3 = None
    Account = None
    print("Warning: Web3 not installed. Blockchain features disabled.")

MONAD_RPC_URL = os.getenv("MONAD_RPC_URL", "https://testnet.monad.xyz")
CHAIN_ID = 1337


class BlockchainConnector:
    """
    Manages blockchain connections and contract interactions
    """
    
    def __init__(self, rpc_url: str = MONAD_RPC_URL, private_key: Optional[str] = None):
        self.w3 = None
        self.account = None
        self.contracts = {}
        
        if WEB3_AVAILABLE:
            try:
                # Initialize Web3
                self.w3 = Web3(Web3.HTTPProvider(rpc_url))
                
                # Add middleware for PoA chains (if needed)
                self.w3.middleware_onion.inject(geth_poa_middleware, layer=0)
                
                # Set up account if private key provided
                if private_key:
                    self.account = Account.from_key(private_key)
                    self.w3.eth.default_account = self.account.address
                
                # Load contract ABIs
                self._load_contracts()
            except Exception as e:
                print(f"Warning: Failed to initialize Web3: {e}")
                self.w3 = None
    
    def _load_contracts(self):
        """Load contract ABIs and addresses"""
        # Contract addresses (would be loaded from config in production)
        addresses = {
            "VOTERToken": "0x0000000000000000000000000000000000000001",
            "VOTERRegistry": "0x0000000000000000000000000000000000000002",
            "CommuniqueCore": "0x0000000000000000000000000000000000000003",
            "AgentParameters": "0x0000000000000000000000000000000000000004",
            "ChallengeMarket": "0x0000000000000000000000000000000000000005",
            "StakedVOTER": "0x0000000000000000000000000000000000000006",
            "IdentityRegistry": "0x0000000000000000000000000000000000000007",
            "ReputationRegistry": "0x0000000000000000000000000000000000000008",
        }
        
        # Load ABIs from compiled contracts
        abi_path = "/Users/noot/Documents/voter-protocol/out"
        
        for name, address in addresses.items():
            abi = self._load_abi(abi_path, name)
            if abi:
                self.contracts[name] = self.w3.eth.contract(
                    address=Web3.to_checksum_address(address),
                    abi=abi
                )
    
    def _load_abi(self, base_path: str, contract_name: str) -> Optional[list]:
        """Load ABI from compiled contract"""
        abi_file = f"{base_path}/{contract_name}.sol/{contract_name}.json"
        
        if os.path.exists(abi_file):
            with open(abi_file, "r") as f:
                data = json.load(f)
                return data.get("abi", [])
        
        # Return minimal ABI if file not found
        return []
    
    async def get_token_supply(self) -> int:
        """Get current VOTER token supply"""
        if not self.w3 or "VOTERToken" not in self.contracts:
            return 1000000 * 10**18  # Return mock supply for demo
        
        try:
            supply = self.contracts["VOTERToken"].functions.totalSupply().call()
            return supply
        except Exception as e:
            print(f"Error getting token supply: {e}")
            return 1000000 * 10**18  # Mock supply
    
    async def get_user_reputation(self, user_address: str) -> Dict[str, Any]:
        """Get user reputation from registry"""
        if not self.w3 or "ReputationRegistry" not in self.contracts:
            return {"total_score": 50}  # Mock reputation
        
        try:
            if WEB3_AVAILABLE:
                reputation = self.contracts["ReputationRegistry"].functions.getReputation(
                    Web3.to_checksum_address(user_address)
                ).call()
                
                return {
                    "challenge_score": reputation[0],
                    "civic_score": reputation[1],
                    "discourse_score": reputation[2],
                    "total_score": reputation[3]
                }
            else:
                return {"total_score": 50}
        except Exception as e:
            print(f"Error getting reputation: {e}")
            return {"total_score": 50}
    
    async def mint_tokens(
        self,
        to_address: str,
        amount: int,
        action_type: str
    ) -> Optional[str]:
        """Mint VOTER tokens for civic action"""
        if "CommuniqueCore" not in self.contracts or not self.account:
            return None
        
        try:
            # Build transaction
            function = self.contracts["CommuniqueCore"].functions.processAction(
                Web3.to_checksum_address(to_address),
                self._action_type_to_enum(action_type),
                amount,
                b""  # metadata
            )
            
            # Estimate gas
            gas_estimate = function.estimate_gas({"from": self.account.address})
            
            # Build transaction
            transaction = function.build_transaction({
                "from": self.account.address,
                "gas": gas_estimate,
                "gasPrice": self.w3.eth.gas_price,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "chainId": CHAIN_ID
            })
            
            # Sign and send
            signed = self.account.sign_transaction(transaction)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            return receipt["transactionHash"].hex()
            
        except Exception as e:
            print(f"Error minting tokens: {e}")
            return None
    
    async def update_reputation(
        self,
        user_address: str,
        category: str,
        score: int
    ) -> Optional[str]:
        """Update user reputation on-chain"""
        if "ReputationRegistry" not in self.contracts or not self.account:
            return None
        
        try:
            # Select appropriate function based on category
            if category == "challenge":
                function = self.contracts["ReputationRegistry"].functions.updateChallengeScore(
                    Web3.to_checksum_address(user_address),
                    score,
                    "Agent update"
                )
            elif category == "civic":
                function = self.contracts["ReputationRegistry"].functions.updateCivicScore(
                    Web3.to_checksum_address(user_address),
                    score,
                    "Agent update"
                )
            else:
                function = self.contracts["ReputationRegistry"].functions.updateDiscourseScore(
                    Web3.to_checksum_address(user_address),
                    score,
                    "Agent update"
                )
            
            # Build and send transaction
            transaction = function.build_transaction({
                "from": self.account.address,
                "gas": 200000,
                "gasPrice": self.w3.eth.gas_price,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "chainId": CHAIN_ID
            })
            
            signed = self.account.sign_transaction(transaction)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            return receipt["transactionHash"].hex()
            
        except Exception as e:
            print(f"Error updating reputation: {e}")
            return None
    
    async def get_agent_parameter(self, param_key: str) -> int:
        """Get parameter from AgentParameters contract"""
        if "AgentParameters" not in self.contracts:
            return 0
        
        try:
            # Convert string key to bytes32
            key_bytes = Web3.keccak(text=param_key)
            
            value = self.contracts["AgentParameters"].functions.getUint(key_bytes).call()
            return value
            
        except Exception as e:
            print(f"Error getting parameter {param_key}: {e}")
            return 0
    
    async def set_agent_parameter(self, param_key: str, value: int) -> Optional[str]:
        """Set parameter in AgentParameters contract"""
        if "AgentParameters" not in self.contracts or not self.account:
            return None
        
        try:
            key_bytes = Web3.keccak(text=param_key)
            
            function = self.contracts["AgentParameters"].functions.setUint(
                key_bytes,
                value
            )
            
            transaction = function.build_transaction({
                "from": self.account.address,
                "gas": 100000,
                "gasPrice": self.w3.eth.gas_price,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "chainId": CHAIN_ID
            })
            
            signed = self.account.sign_transaction(transaction)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            return receipt["transactionHash"].hex()
            
        except Exception as e:
            print(f"Error setting parameter {param_key}: {e}")
            return None
    
    async def create_challenge(
        self,
        claim_hash: bytes,
        defender: str,
        evidence_ipfs: str,
        stake_amount: int
    ) -> Optional[str]:
        """Create a challenge in the challenge market"""
        if "ChallengeMarket" not in self.contracts or not self.account:
            return None
        
        try:
            # Approve token transfer first
            if "VOTERToken" in self.contracts:
                approve_fn = self.contracts["VOTERToken"].functions.approve(
                    self.contracts["ChallengeMarket"].address,
                    stake_amount
                )
                
                approve_tx = approve_fn.build_transaction({
                    "from": self.account.address,
                    "gas": 100000,
                    "gasPrice": self.w3.eth.gas_price,
                    "nonce": self.w3.eth.get_transaction_count(self.account.address),
                    "chainId": CHAIN_ID
                })
                
                signed_approve = self.account.sign_transaction(approve_tx)
                self.w3.eth.send_raw_transaction(signed_approve.rawTransaction)
                self.w3.eth.wait_for_transaction_receipt(signed_approve.hash)
            
            # Create challenge
            function = self.contracts["ChallengeMarket"].functions.createChallenge(
                claim_hash,
                Web3.to_checksum_address(defender),
                evidence_ipfs
            )
            
            transaction = function.build_transaction({
                "from": self.account.address,
                "gas": 300000,
                "gasPrice": self.w3.eth.gas_price,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "chainId": CHAIN_ID
            })
            
            signed = self.account.sign_transaction(transaction)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            return receipt["transactionHash"].hex()
            
        except Exception as e:
            print(f"Error creating challenge: {e}")
            return None
    
    async def get_current_participation(self) -> int:
        """Get current participation metrics"""
        if "VOTERRegistry" not in self.contracts:
            return 0
        
        try:
            stats = self.contracts["VOTERRegistry"].functions.getPlatformStats().call()
            return stats[0]  # Total records as proxy for participation
            
        except Exception as e:
            print(f"Error getting participation: {e}")
            return 0
    
    def _action_type_to_enum(self, action_type: str) -> int:
        """Convert action type string to enum value"""
        mapping = {
            "cwc_message": 0,
            "direct_action": 1,
            "challenge_market": 2
        }
        return mapping.get(action_type.lower(), 1)
    
    async def verify_identity(
        self,
        user_address: str,
        proof_data: bytes
    ) -> Dict[str, Any]:
        """Verify identity through Self Protocol"""
        # TODO: Implement actual Self Protocol verification
        # For now, return mock verification
        return {
            "verified": True,
            "passport_hash": Web3.keccak(text=user_address).hex(),
            "age_threshold": 18,
            "country_code": "US"
        }
    
    def is_connected(self) -> bool:
        """Check if blockchain connection is active"""
        if not WEB3_AVAILABLE or not self.w3:
            return False
        try:
            self.w3.eth.block_number
            return True
        except:
            return False