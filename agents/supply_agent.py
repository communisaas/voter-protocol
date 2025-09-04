"""
Supply Agent - Manages token supply dynamics
"""

from typing import Dict, Any
from agents.base_agent import BaseAgent
from agents.config import SAFETY_RAILS
import math


class SupplyAgent(BaseAgent):
    """
    Calculates optimal token supply within defined bounds
    Monitors participation patterns and adjusts supply accordingly
    """
    
    def __init__(self):
        super().__init__("supply_agent")
        self.min_supply = self.config["min_supply"]
        self.max_supply = self.config["max_supply"]
        
    async def calculate_optimal_supply(
        self,
        current_supply: int,
        participation_rate: float,
        time_period: int = 86400  # 24 hours
    ) -> Dict[str, Any]:
        """
        Calculate optimal supply based on participation patterns
        """
        # Recall similar situations
        similar = self.recall_similar({
            "participation_rate": participation_rate,
            "time_period": time_period
        })
        
        # Base calculation: higher participation = more supply needed
        target_daily_mint = self._calculate_target_mint(participation_rate)
        
        # Learn from past decisions
        if similar:
            avg_effectiveness = sum(s["outcome"]["effectiveness"] for s in similar) / len(similar)
            if avg_effectiveness < 0.7:
                # Past decisions were ineffective, adjust
                target_daily_mint *= 0.8
        
        # Apply safety rails
        target_daily_mint = min(
            target_daily_mint,
            SAFETY_RAILS["max_daily_mint_protocol"]
        )
        
        # Check if we're approaching max supply
        remaining_supply = self.max_supply - current_supply
        if remaining_supply < target_daily_mint:
            target_daily_mint = remaining_supply
        
        decision = {
            "target_daily_mint": target_daily_mint,
            "current_supply": current_supply,
            "supply_utilization": current_supply / self.max_supply,
            "participation_adjustment": participation_rate
        }
        
        # Store decision for learning
        self.remember(
            decision="calculate_supply",
            context={"participation_rate": participation_rate},
            outcome={"target": target_daily_mint, "effectiveness": 0.5}  # Updated later
        )
        
        return decision
    
    async def check_mint_allowed(
        self,
        amount: int,
        current_supply: int
    ) -> Dict[str, Any]:
        """
        Check if minting amount is within bounds
        """
        allowed = True
        adjusted_amount = amount
        status = "approved"
        
        # Check against max supply
        if current_supply + amount > self.max_supply:
            allowed = False
            adjusted_amount = max(0, self.max_supply - current_supply)
            status = "exceeds_max_supply"
        
        # Check against daily protocol limit
        if amount > SAFETY_RAILS["max_daily_mint_protocol"]:
            allowed = False
            adjusted_amount = SAFETY_RAILS["max_daily_mint_protocol"]
            status = "exceeds_daily_limit"
        
        return {
            "allowed": allowed,
            "adjusted_amount": adjusted_amount,
            "status": status,
            "current_supply": current_supply,
            "remaining_capacity": self.max_supply - current_supply
        }
    
    def _calculate_target_mint(self, participation_rate: float) -> int:
        """
        Calculate target mint based on participation
        Uses logarithmic curve to prevent inflation
        """
        # Base amount: 100,000 VOTER per day at 50% participation
        base_daily = 100_000 * 10**18
        
        # Logarithmic scaling: more participation = more tokens, but diminishing
        if participation_rate > 0:
            multiplier = math.log10(participation_rate * 10 + 1)
        else:
            multiplier = 0.1
        
        return int(base_daily * multiplier)
    
    async def adjust_supply_curve(
        self,
        feedback: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Adjust supply curve based on impact feedback
        """
        impact_score = feedback.get("impact_score", 0.5)
        participation_change = feedback.get("participation_change", 0)
        
        # If impact is low but participation is high, reduce supply
        # If impact is high but participation is low, increase incentives
        adjustment_factor = 1.0
        
        if impact_score < 0.4 and participation_change > 0.1:
            adjustment_factor = 0.9  # Reduce by 10%
        elif impact_score > 0.7 and participation_change < -0.1:
            adjustment_factor = 1.1  # Increase by 10%
        
        return {
            "adjustment_factor": adjustment_factor,
            "reason": self._get_adjustment_reason(impact_score, participation_change)
        }
    
    def _get_adjustment_reason(self, impact: float, participation: float) -> str:
        """Get human-readable reason for adjustment"""
        if impact < 0.4:
            return "Low impact despite participation - reducing supply"
        elif impact > 0.7:
            return "High impact achieved - optimizing supply"
        elif participation < -0.1:
            return "Declining participation - increasing incentives"
        else:
            return "Stable conditions - maintaining current supply"
    
    async def process(self, **kwargs) -> Dict[str, Any]:
        """Main processing entry point"""
        return await self.calculate_optimal_supply(
            kwargs.get("current_supply", 0),
            kwargs.get("participation_rate", 0.5)
        )
    
    async def validate(self, **kwargs) -> bool:
        """Validate supply parameters"""
        amount = kwargs.get("amount", 0)
        current = kwargs.get("current_supply", 0)
        result = await self.check_mint_allowed(amount, current)
        return result["allowed"]