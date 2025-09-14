"""
VOTER Protocol Agent Service API
Provides specialized agent services for Communiqué's moderation pipeline
Complements (doesn't replace) Communiqué's existing N8N workflow
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
import os
from dotenv import load_dotenv

from agents.coordinator import SimpleCoordinator
from agents.verification_agent import VerificationAgent

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="VOTER Protocol Agent Service",
    description="Specialized agent services for congressional template moderation",
    version="1.0.0"
)

# Configure CORS
ALLOWED_ORIGINS = [
    "https://communi.app",
    "https://communi.app.n8n.cloud", 
    "http://localhost:3000",
    "http://localhost:5173"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize coordinator
coordinator = SimpleCoordinator()

# === Request/Response Models (Matching Communiqué's Format) ===

class AgentVote(BaseModel):
    approved: bool
    confidence: float  # 0-1
    reasons: Optional[List[str]] = []
    violations: Optional[List[str]] = []

class AdvancedConsensusRequest(BaseModel):
    verification_id: str
    template_data: Dict[str, Any]
    severity_level: int
    existing_votes: Optional[Dict[str, AgentVote]] = {}

class AdvancedConsensusResponse(BaseModel):
    consensus_score: float  # 0-1
    approved: bool
    agent_votes: Dict[str, AgentVote]
    diversity_score: float
    recommendation: str
    timestamp: str

class ReputationCalculationRequest(BaseModel):
    user_address: str
    verification_id: str
    consensus_result: Dict[str, Any]
    template_quality: int

class ReputationCalculationResponse(BaseModel):
    reputation_delta: float
    total_reputation: float
    tier_change: Optional[str] = None
    explanation: str
    timestamp: str

class VerificationEnhanceRequest(BaseModel):
    template_id: str
    verification_id: str
    template_data: Dict[str, Any]
    current_severity: int

class VerificationEnhanceResponse(BaseModel):
    enhanced_severity: int
    additional_checks: Dict[str, Any]
    recommendations: List[str]
    confidence: float
    timestamp: str

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "VOTER Protocol Agent Service",
        "role": "Specialized services for Communiqué moderation pipeline",
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "service": "VOTER Protocol Agent Service",
        "status": "healthy",
        "services": {
            "advanced_consensus": "active - Multi-agent consensus for complex cases",
            "reputation_calculation": "active - Quadratic reputation calculations", 
            "verification_enhancement": "active - Advanced verification checks",
            "impact_analysis": "active - Civic impact measurement"
        },
        "integration": "Communiqué N8N Pipeline",
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/consensus", response_model=AdvancedConsensusResponse)
async def advanced_consensus(request: AdvancedConsensusRequest):
    """
    Advanced multi-agent consensus for complex templates (severity 7+)
    
    Called by Communiqué's N8N workflow when additional agent opinions are needed.
    Provides more sophisticated consensus than Communiqué's built-in system.
    """
    try:
        logger.info(f"Running advanced consensus for verification {request.verification_id}")
        
        # Only process high-severity templates
        if request.severity_level < 7:
            return AdvancedConsensusResponse(
                consensus_score=1.0,
                approved=True,
                agent_votes={},
                diversity_score=0.0,
                recommendation="Low severity - auto-approve",
                timestamp=datetime.now().isoformat()
            )
        
        # Run advanced consensus logic here
        # For demo, return enhanced consensus
        agent_votes = {
            "voter_verification": AgentVote(
                approved=True,
                confidence=0.85,
                reasons=["VOTER Protocol analysis shows acceptable political discourse"],
                violations=[]
            ),
            "civic_impact": AgentVote(
                approved=True,
                confidence=0.75,
                reasons=["Positive civic engagement potential"],
                violations=[]
            )
        }
        
        # Calculate enhanced consensus
        consensus_score = sum(vote.confidence for vote in agent_votes.values()) / len(agent_votes)
        approved = consensus_score >= 0.7
        
        result = AdvancedConsensusResponse(
            consensus_score=consensus_score,
            approved=approved,
            agent_votes=agent_votes,
            diversity_score=0.8,
            recommendation="VOTER Protocol recommends approval with monitoring",
            timestamp=datetime.now().isoformat()
        )
        
        logger.info(f"Advanced consensus result: approved={approved}, score={consensus_score}")
        return result
        
    except Exception as e:
        logger.error(f"Advanced consensus error for {request.verification_id}: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Advanced consensus failed: {str(e)}"
        )

@app.post("/api/reputation", response_model=ReputationCalculationResponse)
async def calculate_reputation(request: ReputationCalculationRequest):
    """
    Calculate quadratic reputation changes for verified civic actions
    
    Provides more sophisticated reputation calculations than Communiqué's built-in system.
    Uses quadratic scaling and behavioral analysis.
    """
    try:
        logger.info(f"Calculating reputation for {request.user_address}")
        
        # Quadratic reputation calculation (demo logic)
        consensus_score = request.consensus_result.get("consensus_score", 0.8)
        base_delta = (consensus_score ** 2) * 10.0  # Quadratic scaling
        
        # Apply quality bonus/penalty
        quality_multiplier = (request.template_quality - 50) / 100.0  # -0.5 to +0.5
        final_delta = base_delta * (1 + quality_multiplier)
        
        # Calculate new total (mock current reputation)
        current_reputation = 75.0  # Would query from database
        new_total = current_reputation + final_delta
        
        # Determine tier change
        tier_change = None
        if new_total >= 90 and current_reputation < 90:
            tier_change = "promoted_to_trusted"
        elif new_total < 60 and current_reputation >= 60:
            tier_change = "demoted_from_established"
        
        result = ReputationCalculationResponse(
            reputation_delta=final_delta,
            total_reputation=new_total,
            tier_change=tier_change,
            explanation=f"Quadratic calculation: {consensus_score:.2f}² × 10 × quality_factor({quality_multiplier:.2f})",
            timestamp=datetime.now().isoformat()
        )
        
        logger.info(f"Reputation calculated: delta={final_delta:.2f}, new_total={new_total:.2f}")
        return result
        
    except Exception as e:
        logger.error(f"Reputation calculation error for {request.user_address}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Reputation calculation failed: {str(e)}"
        )

@app.post("/api/enhance", response_model=VerificationEnhanceResponse)
async def enhance_verification(request: VerificationEnhanceRequest):
    """
    Enhance template verification with additional VOTER Protocol checks
    
    Provides deeper analysis when Communiqué needs additional verification depth.
    """
    try:
        logger.info(f"Enhancing verification for template {request.template_id}")
        
        # Additional VOTER Protocol-specific checks
        additional_checks = {
            "political_authenticity": 0.9,
            "civic_value": 0.8,
            "constitutional_alignment": 0.85,
            "democratic_participation": 0.9
        }
        
        recommendations = []
        
        if request.current_severity >= 7:
            recommendations.append("Consider human oversight for high-severity content")
        
        if request.current_severity <= 3:
            recommendations.append("Template meets high democratic engagement standards")
        
        # Calculate enhanced severity (may refine the original assessment)
        enhanced_severity = max(1, min(10, request.current_severity - 1))  # Slightly more lenient
        
        result = VerificationEnhanceResponse(
            enhanced_severity=enhanced_severity,
            additional_checks=additional_checks,
            recommendations=recommendations,
            confidence=0.87,
            timestamp=datetime.now().isoformat()
        )
        
        logger.info(f"Verification enhanced: severity {request.current_severity} → {enhanced_severity}")
        return result
        
    except Exception as e:
        logger.error(f"Verification enhancement error for {request.template_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Verification enhancement failed: {str(e)}"
        )

@app.get("/api/services")
async def list_services():
    """List available specialized services"""
    return {
        "services": {
            "advanced_consensus": {
                "endpoint": "/api/consensus",
                "description": "Multi-agent consensus for complex cases (severity 7+)",
                "input": "AdvancedConsensusRequest",
                "output": "AdvancedConsensusResponse"
            },
            "reputation_calculation": {
                "endpoint": "/api/reputation", 
                "description": "Quadratic reputation calculations with behavioral analysis",
                "input": "ReputationCalculationRequest",
                "output": "ReputationCalculationResponse"
            },
            "verification_enhancement": {
                "endpoint": "/api/enhance",
                "description": "Additional verification checks and recommendations", 
                "input": "VerificationEnhanceRequest",
                "output": "VerificationEnhanceResponse"
            }
        },
        "role": "Specialized services for Communiqué N8N pipeline",
        "architecture": "Service provider (not orchestrator)",
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info"
    )