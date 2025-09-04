"""
Communiqué Integration Module for VOTER Protocol

Provides seamless integration between VOTER Protocol's agent-based
certification system and Communiqué's email-based civic engagement platform.

Key Features:
- Deterministic address generation for users without wallets
- Civic action certification through multi-agent consensus
- Carroll Mechanisms for discourse quality evaluation  
- ERC-8004 portable reputation management
- Virtual reward tracking before on-chain claiming
"""

import os
import hashlib
import asyncio
import httpx
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
import logging

# Import VOTER Protocol components
from agents.workflows import (
    certify_civic_action,
    process_challenge,
    migrate_reputation
)
from agents.blockchain_connector import BlockchainConnector
from agents.config import (
    DOMAIN,
    API_BASE_URL,
    EXTERNAL_APIS,
    SAFETY_RAILS,
    get_domain_url
)

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

COMMUNIQUE_API_URL = os.getenv("COMMUNIQUE_API_URL", "https://api.communi.email")
COMMUNIQUE_API_KEY = os.getenv("COMMUNIQUE_API_KEY")
PLATFORM_SALT = os.getenv("PLATFORM_SALT", "communique-voter-protocol-2024")
CHAIN_ID = os.getenv("CHAIN_ID", "1337")  # Monad testnet

# ============================================================================
# Data Models
# ============================================================================

class CommuniqueUser(BaseModel):
    """User model from Communiqué platform"""
    id: str
    email: Optional[str] = None
    name: Optional[str] = None
    
    # Address fields
    derived_address: Optional[str] = None
    connected_address: Optional[str] = None
    address_type: str = "none"  # none, derived, connected, both
    
    # Location (for congressional routing)
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    
    # VOTER Protocol fields
    voter_balance: int = 0
    staked_balance: int = 0
    voting_power: int = 0
    pending_rewards: int = 0
    total_earned: int = 0
    
    # Reputation scores
    challenge_score: int = 0
    civic_score: int = 0
    discourse_score: int = 0
    total_reputation: int = 0
    reputation_tier: str = "novice"
    
    # Timestamps
    created_at: datetime
    last_certification: Optional[datetime] = None

class CivicActionData(BaseModel):
    """Civic action data from Communiqué"""
    user_id: str
    template_id: str
    action_type: str  # cwc_message, petition, direct_action
    
    # Email content
    subject: str
    body: str
    recipients: List[str]
    
    # Delivery confirmation
    delivery_receipt: Optional[str] = None
    routing_email: Optional[str] = None  # For congressional routing
    
    # Metadata
    timestamp: datetime
    source: str = "communique"
    metadata: Dict[str, Any] = Field(default_factory=dict)

class CertificationResult(BaseModel):
    """Result of civic action certification"""
    success: bool
    certification_hash: str
    
    # Verification details
    verified: bool
    consensus_score: float
    verification_agents: List[str]
    
    # Rewards
    reward_amount: int
    reward_status: str  # pending, virtual, claimed
    
    # Reputation changes
    reputation_changes: Dict[str, int]
    new_reputation_tier: str
    
    # Transaction details (if on-chain)
    tx_hash: Optional[str] = None
    block_number: Optional[int] = None
    ipfs_hash: Optional[str] = None
    
    # Error info
    error: Optional[str] = None

# ============================================================================
# Address Generation
# ============================================================================

def generate_user_address(user_id: str, user_email: Optional[str] = None) -> str:
    """
    Generate deterministic Ethereum address for Communiqué user.
    
    This allows users to participate in VOTER Protocol without
    connecting a wallet initially.
    
    Args:
        user_id: Unique user identifier
        user_email: Optional email for additional entropy
    
    Returns:
        Ethereum address (checksummed)
    """
    # Create input with maximum entropy
    email_salt = ""
    if user_email:
        email_salt = hashlib.sha256(user_email.encode()).hexdigest()[:8]
    
    input_str = f"{user_id}-{PLATFORM_SALT}-{CHAIN_ID}-{email_salt}"
    
    # Generate address using SHA256 (in production, use keccak256)
    hash_bytes = hashlib.sha256(input_str.encode()).digest()
    address_bytes = hash_bytes[-20:]  # Last 20 bytes
    
    # Convert to hex and add checksum
    address = "0x" + address_bytes.hex()
    return apply_checksum(address)

def apply_checksum(address: str) -> str:
    """
    Apply EIP-55 checksum to Ethereum address.
    
    Args:
        address: Ethereum address to checksum
    
    Returns:
        Checksummed address
    """
    addr = address.lower().replace("0x", "")
    hash_str = hashlib.sha256(addr.encode()).hexdigest()
    
    result = "0x"
    for i, char in enumerate(addr):
        if char in "0123456789":
            result += char
        else:
            result += char.upper() if int(hash_str[i], 16) >= 8 else char
    
    return result

# ============================================================================
# Certification Service
# ============================================================================

class CommuniqueCertificationService:
    """
    Service for certifying Communiqué civic actions through VOTER Protocol.
    """
    
    def __init__(self):
        self.blockchain = BlockchainConnector()
        self.client = httpx.AsyncClient(
            base_url=COMMUNIQUE_API_URL,
            headers={"X-API-Key": COMMUNIQUE_API_KEY} if COMMUNIQUE_API_KEY else {}
        )
    
    async def certify_civic_action(
        self,
        action_data: CivicActionData,
        user: Optional[CommuniqueUser] = None
    ) -> CertificationResult:
        """
        Certify a civic action from Communiqué.
        
        This triggers the multi-agent workflow to verify the action,
        calculate rewards, update reputation, and record on-chain.
        
        Args:
            action_data: Civic action data
            user: Optional user object (will fetch if not provided)
        
        Returns:
            CertificationResult with details
        """
        try:
            # Fetch user if not provided
            if not user:
                user = await self.get_user(action_data.user_id)
            
            # Determine user address
            user_address = self.get_active_address(user)
            
            # Check rate limits
            if not await self.check_rate_limits(user_address, action_data.action_type):
                return CertificationResult(
                    success=False,
                    certification_hash="",
                    verified=False,
                    consensus_score=0,
                    verification_agents=[],
                    reward_amount=0,
                    reward_status="failed",
                    reputation_changes={},
                    new_reputation_tier=user.reputation_tier,
                    error="Rate limit exceeded"
                )
            
            # Execute certification workflow
            workflow_result = await certify_civic_action(
                user_address=user_address,
                action_type=action_data.action_type,
                action_data={
                    "user_id": action_data.user_id,
                    "template_id": action_data.template_id,
                    "subject": action_data.subject,
                    "body": action_data.body,
                    "recipients": action_data.recipients,
                    "delivery_receipt": action_data.delivery_receipt,
                    "routing_email": action_data.routing_email,
                    "timestamp": action_data.timestamp.isoformat(),
                    **action_data.metadata
                },
                template_id=action_data.template_id,
                recipients=action_data.recipients
            )
            
            # Process workflow result
            if workflow_result["status"] == "verified":
                # Update user balances and reputation
                await self.update_user_state(
                    user,
                    reward_amount=workflow_result["reward_amount"],
                    reputation_changes=workflow_result.get("reputation_update", {})
                )
                
                # Create virtual reward record
                await self.create_virtual_reward(
                    user_id=user.id,
                    user_address=user_address,
                    amount=workflow_result["reward_amount"],
                    source_type="certification",
                    source_id=workflow_result["certification_hash"]
                )
                
                # Pin to IPFS if configured
                ipfs_hash = None
                if EXTERNAL_APIS.get("ipfs"):
                    ipfs_hash = await self.pin_to_ipfs(workflow_result)
                
                return CertificationResult(
                    success=True,
                    certification_hash=workflow_result["certification_hash"],
                    verified=True,
                    consensus_score=workflow_result["consensus_score"],
                    verification_agents=workflow_result.get("verification_result", {}).get("agents", []),
                    reward_amount=workflow_result["reward_amount"],
                    reward_status="virtual",
                    reputation_changes=workflow_result.get("reputation_update", {}),
                    new_reputation_tier=self.calculate_reputation_tier(
                        user.total_reputation + 
                        workflow_result.get("reputation_update", {}).get("total", 0)
                    ),
                    ipfs_hash=ipfs_hash
                )
            
            else:
                return CertificationResult(
                    success=False,
                    certification_hash=workflow_result.get("certification_hash", ""),
                    verified=False,
                    consensus_score=workflow_result.get("consensus_score", 0),
                    verification_agents=[],
                    reward_amount=0,
                    reward_status="failed",
                    reputation_changes={},
                    new_reputation_tier=user.reputation_tier,
                    error=" ".join(workflow_result.get("errors", ["Verification failed"]))
                )
        
        except Exception as e:
            logger.error(f"Certification error: {e}")
            return CertificationResult(
                success=False,
                certification_hash="",
                verified=False,
                consensus_score=0,
                verification_agents=[],
                reward_amount=0,
                reward_status="failed",
                reputation_changes={},
                new_reputation_tier=user.reputation_tier if user else "novice",
                error=str(e)
            )
    
    async def get_user(self, user_id: str) -> CommuniqueUser:
        """
        Fetch user from Communiqué API.
        
        Args:
            user_id: User ID to fetch
        
        Returns:
            CommuniqueUser object
        """
        response = await self.client.get(f"/users/{user_id}")
        response.raise_for_status()
        return CommuniqueUser(**response.json())
    
    def get_active_address(self, user: CommuniqueUser) -> str:
        """
        Get active blockchain address for user.
        
        Prefers connected wallet, falls back to derived address,
        generates new if needed.
        
        Args:
            user: Communiqué user
        
        Returns:
            Ethereum address
        """
        # Prefer connected wallet
        if user.connected_address:
            return user.connected_address
        
        # Use existing derived address
        if user.derived_address:
            return user.derived_address
        
        # Generate new deterministic address
        return generate_user_address(user.id, user.email)
    
    async def check_rate_limits(
        self,
        user_address: str,
        action_type: str
    ) -> bool:
        """
        Check if action is within rate limits.
        
        Args:
            user_address: User's blockchain address
            action_type: Type of action
        
        Returns:
            True if within limits
        """
        # Check safety rails from config
        min_interval = SAFETY_RAILS.get("min_action_interval", 60)
        
        # TODO: Implement actual rate limit checking
        # For now, always allow
        return True
    
    async def update_user_state(
        self,
        user: CommuniqueUser,
        reward_amount: int,
        reputation_changes: Dict[str, Any]
    ) -> None:
        """
        Update user's blockchain state in Communiqué database.
        
        Args:
            user: User to update
            reward_amount: Reward amount earned
            reputation_changes: Reputation score changes
        """
        update_data = {
            "pending_rewards": user.pending_rewards + reward_amount,
            "total_earned": user.total_earned + reward_amount,
            "last_certification": datetime.now().isoformat(),
        }
        
        # Update reputation scores
        if reputation_changes:
            update_data.update({
                "challenge_score": min(100, max(0, user.challenge_score + reputation_changes.get("challenge", 0))),
                "civic_score": min(100, max(0, user.civic_score + reputation_changes.get("civic", 0))),
                "discourse_score": min(100, max(0, user.discourse_score + reputation_changes.get("discourse", 0))),
            })
            
            # Recalculate total reputation
            new_total = (
                update_data.get("challenge_score", user.challenge_score) * 0.4 +
                update_data.get("civic_score", user.civic_score) * 0.4 +
                update_data.get("discourse_score", user.discourse_score) * 0.2
            )
            update_data["total_reputation"] = int(new_total)
            update_data["reputation_tier"] = self.calculate_reputation_tier(new_total)
        
        # Send update to Communiqué API
        await self.client.patch(
            f"/users/{user.id}",
            json=update_data
        )
    
    async def create_virtual_reward(
        self,
        user_id: str,
        user_address: str,
        amount: int,
        source_type: str,
        source_id: str
    ) -> None:
        """
        Create virtual reward record for later claiming.
        
        Args:
            user_id: User ID
            user_address: User's blockchain address
            amount: Reward amount
            source_type: Type of reward source
            source_id: ID of source action
        """
        reward_data = {
            "user_id": user_id,
            "user_address": user_address,
            "amount": amount,
            "source_type": source_type,
            "source_id": source_id,
            "status": "pending",
            "claimable": False,  # Becomes claimable after wallet connection
            "earned_at": datetime.now().isoformat(),
            "available_at": (datetime.now() + timedelta(hours=1)).isoformat()  # 1 hour vesting
        }
        
        await self.client.post("/virtual-rewards", json=reward_data)
    
    async def pin_to_ipfs(self, data: Dict[str, Any]) -> Optional[str]:
        """
        Pin certification data to IPFS.
        
        Args:
            data: Data to pin
        
        Returns:
            IPFS hash if successful
        """
        try:
            ipfs_config = EXTERNAL_APIS.get("ipfs")
            if not ipfs_config:
                return None
            
            # TODO: Implement IPFS pinning
            # For now, return mock hash
            import json
            data_str = json.dumps(data, sort_keys=True)
            return hashlib.sha256(data_str.encode()).hexdigest()[:46]
        
        except Exception as e:
            logger.error(f"IPFS pinning error: {e}")
            return None
    
    def calculate_reputation_tier(self, score: float) -> str:
        """
        Calculate reputation tier from score.
        
        Args:
            score: Reputation score (0-100)
        
        Returns:
            Reputation tier name
        """
        if score >= 80:
            return "trusted"
        elif score >= 60:
            return "established"
        elif score >= 40:
            return "emerging"
        elif score >= 20:
            return "novice"
        else:
            return "untrusted"

# ============================================================================
# Challenge Market Integration (Carroll Mechanisms)
# ============================================================================

class ChallengeMarketIntegration:
    """
    Integration for Carroll Mechanisms information quality markets.
    """
    
    def __init__(self):
        self.cert_service = CommuniqueCertificationService()
    
    async def create_challenge(
        self,
        user_id: str,
        claim_text: str,
        stake_amount: int,
        sources: List[str] = []
    ) -> Dict[str, Any]:
        """
        Create a new challenge in the information market.
        
        Args:
            user_id: Challenger's user ID
            claim_text: Text of the claim
            stake_amount: Amount to stake
            sources: Supporting sources
        
        Returns:
            Challenge details
        """
        user = await self.cert_service.get_user(user_id)
        user_address = self.cert_service.get_active_address(user)
        
        # Generate challenge ID
        challenge_id = hashlib.sha256(
            f"{claim_text}{user_address}{datetime.now()}".encode()
        ).hexdigest()[:16]
        
        # Process through challenge workflow
        result = await process_challenge(
            challenge_id=challenge_id,
            claim_text=claim_text,
            challenger_address=user_address,
            challenger_stake=stake_amount
        )
        
        return {
            "challenge_id": challenge_id,
            "status": "created",
            "challenger": user_address,
            "stake": stake_amount,
            "sources": sources,
            **result
        }
    
    async def support_challenge(
        self,
        user_id: str,
        challenge_id: str,
        stake_amount: int,
        argument: str = ""
    ) -> Dict[str, Any]:
        """
        Support an existing challenge.
        
        Args:
            user_id: Supporter's user ID
            challenge_id: Challenge to support
            stake_amount: Amount to stake
            argument: Supporting argument
        
        Returns:
            Updated challenge details
        """
        # TODO: Implement support logic
        return {
            "challenge_id": challenge_id,
            "action": "supported",
            "stake_added": stake_amount
        }
    
    async def oppose_challenge(
        self,
        user_id: str,
        challenge_id: str,
        stake_amount: int,
        counter_sources: List[str] = [],
        counter_argument: str = ""
    ) -> Dict[str, Any]:
        """
        Oppose an existing challenge.
        
        Args:
            user_id: Opponent's user ID
            challenge_id: Challenge to oppose
            stake_amount: Amount to stake
            counter_sources: Counter sources
            counter_argument: Counter argument
        
        Returns:
            Updated challenge details
        """
        # TODO: Implement opposition logic
        return {
            "challenge_id": challenge_id,
            "action": "opposed",
            "stake_added": stake_amount
        }

# ============================================================================
# Reputation Migration Service (ERC-8004)
# ============================================================================

class ReputationMigrationService:
    """
    Service for migrating reputation across chains using ERC-8004.
    """
    
    def __init__(self):
        self.cert_service = CommuniqueCertificationService()
    
    async def migrate_reputation(
        self,
        user_id: str,
        target_chain: str = "ethereum"
    ) -> Dict[str, Any]:
        """
        Migrate user's reputation to another chain.
        
        Args:
            user_id: User ID
            target_chain: Target blockchain
        
        Returns:
            Migration details
        """
        user = await self.cert_service.get_user(user_id)
        user_address = self.cert_service.get_active_address(user)
        
        # Execute migration workflow
        result = await migrate_reputation(
            user_address=user_address,
            target_chain=target_chain
        )
        
        return {
            "user_address": user_address,
            "source_chain": "monad",
            "target_chain": target_chain,
            "reputation_scores": {
                "challenge": user.challenge_score,
                "civic": user.civic_score,
                "discourse": user.discourse_score,
                "total": user.total_reputation
            },
            "migration_status": result.get("migration_status"),
            "attestation_hash": result.get("attestation_hash"),
            "ipfs_cid": result.get("ipfs_cid")
        }

# ============================================================================
# Main Integration Interface
# ============================================================================

class VoterCommuniqueIntegration:
    """
    Main integration interface between VOTER Protocol and Communiqué.
    """
    
    def __init__(self):
        self.certification = CommuniqueCertificationService()
        self.challenges = ChallengeMarketIntegration()
        self.reputation = ReputationMigrationService()
    
    async def process_email_action(
        self,
        user_id: str,
        template_id: str,
        email_data: Dict[str, Any]
    ) -> CertificationResult:
        """
        Process an email-based civic action from Communiqué.
        
        This is the main entry point for certifying civic engagement.
        
        Args:
            user_id: Communiqué user ID
            template_id: Email template ID
            email_data: Email content and metadata
        
        Returns:
            Certification result
        """
        # Determine action type from template
        action_type = self.determine_action_type(template_id, email_data)
        
        # Create action data
        action_data = CivicActionData(
            user_id=user_id,
            template_id=template_id,
            action_type=action_type,
            subject=email_data.get("subject", ""),
            body=email_data.get("body", ""),
            recipients=email_data.get("recipients", []),
            delivery_receipt=email_data.get("delivery_receipt"),
            routing_email=email_data.get("routing_email"),
            timestamp=datetime.now(),
            metadata=email_data.get("metadata", {})
        )
        
        # Certify through VOTER Protocol
        return await self.certification.certify_civic_action(action_data)
    
    def determine_action_type(
        self,
        template_id: str,
        email_data: Dict[str, Any]
    ) -> str:
        """
        Determine action type from template and email data.
        
        Args:
            template_id: Template ID
            email_data: Email data
        
        Returns:
            Action type string
        """
        # Check for congressional routing
        if email_data.get("routing_email"):
            return "cwc_message"
        
        # Check template patterns
        if "petition" in template_id.lower():
            return "petition"
        
        if "action" in template_id.lower():
            return "direct_action"
        
        # Default to general civic action
        return "civic_action"

# ============================================================================
# Export Main Integration Instance
# ============================================================================

# Create singleton instance
integration = VoterCommuniqueIntegration()

# Export convenience functions
certify_action = integration.process_email_action
create_challenge = integration.challenges.create_challenge
migrate_reputation = integration.reputation.migrate_reputation
