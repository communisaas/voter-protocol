"""
Verification Agent - Validates civic actions and identities
"""

from typing import Dict, Any, List, Optional
import hashlib
import asyncio
from datetime import datetime, timedelta
from agents.base_agent import BaseAgent
from agents.config import EXTERNAL_APIS, CONSENSUS_CONFIG


class VerificationAgent(BaseAgent):
    """
    Coordinates action validation with multiple verification sources
    Learns from verification patterns to improve accuracy
    """
    
    def __init__(self):
        super().__init__("verification_agent")
        self.verification_sources = self.config["verification_sources"]
        self.consensus_threshold = self.config["consensus_threshold"]
        
    async def verify(
        self,
        user_address: str,
        action_type: str,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Verify a civic action through multiple sources
        """
        # Generate action hash
        action_hash = self._generate_action_hash(user_address, action_type, action_data)
        
        # Check if we've seen this action before
        if await self._is_duplicate_action(action_hash):
            return {
                "verified": False,
                "status": "duplicate_action",
                "reason": "This action has already been processed",
                "action_hash": action_hash
            }
        
        # Verify through multiple sources
        verification_results = await self._verify_through_sources(
            user_address, action_type, action_data
        )
        
        # Calculate consensus
        verified_count = sum(1 for r in verification_results if r["verified"])
        consensus_ratio = verified_count / max(len(verification_results), 1)
        
        verified = consensus_ratio >= self.consensus_threshold
        
        # Learn from this verification
        self.remember(
            decision="verify_action",
            context={
                "action_type": action_type,
                "sources_used": len(verification_results)
            },
            outcome={
                "verified": verified,
                "consensus_ratio": consensus_ratio,
                "effectiveness": consensus_ratio
            }
        )
        
        return {
            "verified": verified,
            "status": "verified" if verified else "verification_failed",
            "action_hash": action_hash,
            "consensus_ratio": consensus_ratio,
            "verification_sources": [r["source"] for r in verification_results],
            "timestamp": datetime.now().isoformat()
        }
    
    async def _verify_through_sources(
        self,
        user_address: str,
        action_type: str,
        action_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Verify through multiple sources concurrently"""
        tasks = []
        
        if "self_protocol" in self.verification_sources:
            tasks.append(self._verify_self_protocol(user_address, action_data))
        
        if "cwc_api" in self.verification_sources and action_type == "cwc_message":
            tasks.append(self._verify_cwc_message(action_data))
        
        if "email_verification" in self.verification_sources:
            tasks.append(self._verify_email(user_address, action_data))
        
        # Run all verifications concurrently
        if tasks:
            return await asyncio.gather(*tasks, return_exceptions=True)
        
        # Fallback if no sources available
        return [{"source": "default", "verified": True}]
    
    async def _verify_self_protocol(
        self,
        user_address: str,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify identity through Self Protocol"""
        # TODO: Implement actual Self Protocol API call
        # For now, return mock verification
        
        # Simulate age and citizenship check
        age = action_data.get("user_age", 0)
        country = action_data.get("user_country", "")
        
        verified = age >= 18 and country == "US"
        
        return {
            "source": "self_protocol",
            "verified": verified,
            "passport_hash": hashlib.sha256(f"{user_address}".encode()).hexdigest(),
            "age_verified": age >= 18,
            "citizenship_verified": country == "US"
        }
    
    async def _verify_cwc_message(
        self,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify congressional message through CWC API"""
        # TODO: Implement actual CWC API call
        # For now, validate required fields
        
        required_fields = ["message", "representative", "district", "zip_code"]
        has_all_fields = all(field in action_data for field in required_fields)
        
        # Basic validation
        message_length = len(action_data.get("message", ""))
        valid_length = 100 <= message_length <= 2000
        
        verified = has_all_fields and valid_length
        
        return {
            "source": "cwc_api",
            "verified": verified,
            "submission_id": hashlib.sha256(
                action_data.get("message", "").encode()
            ).hexdigest()[:16],
            "representative": action_data.get("representative", ""),
            "district": action_data.get("district", "")
        }
    
    async def _verify_email(
        self,
        user_address: str,
        action_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify email confirmation"""
        # TODO: Implement actual email verification
        # For now, check if email receipt hash is provided
        
        email_receipt = action_data.get("email_receipt_hash", "")
        verified = len(email_receipt) == 64  # SHA256 hash length
        
        return {
            "source": "email_verification",
            "verified": verified,
            "receipt_hash": email_receipt,
            "email_domain": action_data.get("email_domain", "")
        }
    
    async def _is_duplicate_action(self, action_hash: str) -> bool:
        """Check if action has been processed before"""
        # Query memory for similar action hash
        similar = self.recall_similar({"action_hash": action_hash}, n_results=1)
        
        if similar and similar[0].get("context", {}).get("action_hash") == action_hash:
            time_diff = datetime.now() - datetime.fromisoformat(similar[0]["timestamp"])
            # Allow same action after 24 hours
            return time_diff < timedelta(hours=24)
        
        return False
    
    def _generate_action_hash(
        self,
        user_address: str,
        action_type: str,
        action_data: Dict[str, Any]
    ) -> str:
        """Generate unique hash for an action"""
        content = f"{user_address}:{action_type}:{sorted(action_data.items())}"
        return hashlib.sha256(content.encode()).hexdigest()
    
    async def detect_fraud_patterns(
        self,
        user_address: str,
        recent_actions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Detect potential fraud patterns"""
        fraud_indicators = []
        risk_score = 0
        
        # Check for rapid repeated actions
        if len(recent_actions) > 10:
            time_diffs = []
            for i in range(1, len(recent_actions)):
                t1 = datetime.fromisoformat(recent_actions[i-1]["timestamp"])
                t2 = datetime.fromisoformat(recent_actions[i]["timestamp"])
                time_diffs.append((t2 - t1).total_seconds())
            
            avg_interval = sum(time_diffs) / len(time_diffs)
            if avg_interval < 60:  # Less than 1 minute average
                fraud_indicators.append("rapid_actions")
                risk_score += 0.3
        
        # Check for identical messages
        messages = [a.get("message", "") for a in recent_actions if "message" in a]
        if messages and len(set(messages)) < len(messages) / 2:
            fraud_indicators.append("duplicate_content")
            risk_score += 0.4
        
        # Check for pattern in addresses
        if self._detect_address_pattern(user_address):
            fraud_indicators.append("suspicious_address_pattern")
            risk_score += 0.2
        
        return {
            "risk_score": min(1.0, risk_score),
            "fraud_indicators": fraud_indicators,
            "recommendation": "block" if risk_score > 0.7 else "monitor" if risk_score > 0.4 else "allow"
        }
    
    def _detect_address_pattern(self, address: str) -> bool:
        """Detect suspicious address patterns"""
        # Check for sequential addresses or known bot patterns
        # This is simplified - real implementation would be more sophisticated
        return address.lower().endswith("000") or "deadbeef" in address.lower()
    
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing entry point"""
        return await self.verify(
            kwargs.get("user_address", ""),
            kwargs.get("action_type", ""),
            kwargs.get("action_data", {})
        )
    
    async def validate(self, **kwargs) -> bool:
        """Validation check"""
        result = await self.verify(
            kwargs.get("user_address", ""),
            kwargs.get("action_type", ""),
            kwargs.get("action_data", {})
        )
        return result["verified"]