"""
API Server for VOTER Protocol
Provides REST endpoints for Communiqué frontend
"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from datetime import datetime
import os
from dotenv import load_dotenv

# Import our agents and blockchain connector
from agents.coordinator import DemocracyCoordinator
from agents.blockchain_connector import BlockchainConnector
from agents.config import DOMAIN, get_domain_url

load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="VOTER Protocol API",
    description="Backend API for Communiqué civic engagement platform",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# Configure CORS for frontend
ALLOWED_ORIGINS = [
    "https://communi.email",
    "https://www.communi.email",
    "http://localhost:3000",  # Local development
    "http://localhost:3001",
    os.getenv("FRONTEND_URL", "https://communi.email")
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Initialize components
coordinator = DemocracyCoordinator()
blockchain = BlockchainConnector(
    rpc_url=os.getenv("MONAD_RPC_URL"),
    private_key=os.getenv("AGENT_PRIVATE_KEY")
)

# ============= Request/Response Models =============

class CivicActionRequest(BaseModel):
    """Request to process a civic action"""
    action_type: str = Field(..., description="Type of action: cwc_message, direct_action, challenge_market")
    user_address: str = Field(..., description="User's wallet address")
    action_data: Dict[str, Any] = Field(..., description="Action-specific data")
    signature: Optional[str] = Field(None, description="User's signature for verification")

class CivicActionResponse(BaseModel):
    """Response after processing civic action"""
    success: bool
    action_hash: str
    reward_amount: int
    reputation_update: Dict[str, Any]
    tx_hash: Optional[str] = None
    error: Optional[str] = None

class ReputationQuery(BaseModel):
    """Query for user reputation"""
    user_address: str

class ReputationResponse(BaseModel):
    """User reputation details"""
    user_address: str
    challenge_score: int
    civic_score: int
    discourse_score: int
    total_score: int
    tier: str
    recent_actions: List[Dict[str, Any]]

class ChallengeRequest(BaseModel):
    """Request to create a challenge"""
    claim_hash: str
    defender_address: str
    evidence_ipfs: str
    stake_amount: int

class TokenStats(BaseModel):
    """Token supply statistics"""
    total_supply: int
    circulating_supply: int
    staked_amount: int
    daily_mint_remaining: int

# ============= Authentication =============

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify JWT token from frontend"""
    token = credentials.credentials
    # TODO: Implement actual JWT verification
    # For now, return mock user
    return "0x" + "0" * 40

# ============= Health & Status Endpoints =============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "blockchain_connected": blockchain.is_connected(),
        "domain": DOMAIN
    }

@app.get("/api/v1/status")
async def get_status():
    """Get system status"""
    supply = await blockchain.get_token_supply()
    participation = await blockchain.get_current_participation()
    
    return {
        "token_supply": supply,
        "total_participation": participation,
        "agents_online": 5,
        "consensus_threshold": 0.66,
        "timestamp": datetime.now().isoformat()
    }

# ============= Civic Action Endpoints =============

@app.post("/api/v1/action", response_model=CivicActionResponse)
async def process_civic_action(
    request: CivicActionRequest,
    current_user: str = Depends(verify_token)
):
    """
    Process a civic action through the agent network
    """
    try:
        # Validate user address matches authenticated user
        if request.user_address.lower() != current_user.lower():
            raise HTTPException(status_code=403, detail="Address mismatch")
        
        # Process through agent coordinator
        result = await coordinator.process_civic_action(
            user_address=request.user_address,
            action_type=request.action_type,
            action_data=request.action_data
        )
        
        # If successful, execute on-chain
        tx_hash = None
        if result["success"]:
            tx_hash = await blockchain.mint_tokens(
                to_address=request.user_address,
                amount=result["reward"],
                action_type=request.action_type
            )
        
        return CivicActionResponse(
            success=result["success"],
            action_hash=result.get("action_hash", ""),
            reward_amount=result["reward"],
            reputation_update=result["reputation"],
            tx_hash=tx_hash,
            error=result.get("error")
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/action/{action_hash}")
async def get_action_details(action_hash: str):
    """Get details of a specific action"""
    # TODO: Implement action lookup from blockchain/database
    return {
        "action_hash": action_hash,
        "status": "completed",
        "timestamp": datetime.now().isoformat()
    }

# ============= Reputation Endpoints =============

@app.get("/api/v1/reputation/{user_address}", response_model=ReputationResponse)
async def get_reputation(user_address: str):
    """Get user's reputation scores"""
    try:
        # Get on-chain reputation
        reputation = await blockchain.get_user_reputation(user_address)
        
        # Determine tier
        total = reputation["total_score"]
        if total >= 80:
            tier = "trusted"
        elif total >= 60:
            tier = "established"
        elif total >= 40:
            tier = "emerging"
        else:
            tier = "novice"
        
        return ReputationResponse(
            user_address=user_address,
            challenge_score=reputation.get("challenge_score", 50),
            civic_score=reputation.get("civic_score", 50),
            discourse_score=reputation.get("discourse_score", 50),
            total_score=total,
            tier=tier,
            recent_actions=[]  # TODO: Fetch from database
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/reputation/update")
async def update_reputation(
    user_address: str,
    category: str,
    score: int,
    current_user: str = Depends(verify_token)
):
    """Update user reputation (agent only)"""
    # TODO: Verify caller is authorized agent
    
    tx_hash = await blockchain.update_reputation(
        user_address=user_address,
        category=category,
        score=score
    )
    
    return {"success": tx_hash is not None, "tx_hash": tx_hash}

# ============= Challenge Market Endpoints =============

@app.post("/api/v1/challenge")
async def create_challenge(
    request: ChallengeRequest,
    current_user: str = Depends(verify_token)
):
    """Create a new challenge in the market"""
    try:
        tx_hash = await blockchain.create_challenge(
            claim_hash=bytes.fromhex(request.claim_hash),
            defender=request.defender_address,
            evidence_ipfs=request.evidence_ipfs,
            stake_amount=request.stake_amount
        )
        
        return {
            "success": tx_hash is not None,
            "tx_hash": tx_hash,
            "challenge_id": None  # TODO: Extract from events
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/challenges")
async def list_challenges(
    status: Optional[str] = "active",
    limit: int = 20
):
    """List challenges from the market"""
    # TODO: Implement challenge listing from blockchain
    return {
        "challenges": [],
        "total": 0,
        "page": 1
    }

# ============= Token Endpoints =============

@app.get("/api/v1/tokens/stats", response_model=TokenStats)
async def get_token_stats():
    """Get VOTER token statistics"""
    supply = await blockchain.get_token_supply()
    
    # TODO: Calculate actual values
    return TokenStats(
        total_supply=supply,
        circulating_supply=int(supply * 0.6),
        staked_amount=int(supply * 0.3),
        daily_mint_remaining=1_000_000 * 10**18
    )

@app.get("/api/v1/tokens/price")
async def get_token_price():
    """Get VOTER token price info"""
    # TODO: Integrate with price oracle
    return {
        "price_usd": 0.10,
        "price_eth": 0.00003,
        "market_cap": 5_000_000,
        "volume_24h": 500_000,
        "change_24h": 0.05
    }

# ============= Governance Endpoints =============

@app.get("/api/v1/governance/proposals")
async def list_proposals(status: Optional[str] = "active"):
    """List governance proposals"""
    # TODO: Fetch from governance contracts
    return {
        "proposals": [],
        "total": 0
    }

@app.post("/api/v1/governance/vote")
async def cast_vote(
    proposal_id: int,
    support: bool,
    current_user: str = Depends(verify_token)
):
    """Cast a vote on a proposal"""
    # TODO: Implement governance voting
    return {
        "success": True,
        "proposal_id": proposal_id,
        "support": support
    }

# ============= Congressional Interface =============

@app.post("/api/v1/congress/message")
async def send_congressional_message(
    representative: str,
    message: str,
    district: str,
    current_user: str = Depends(verify_token)
):
    """
    Send message to congressional representative
    This endpoint is called by the frontend after email client interaction
    """
    action_data = {
        "representative": representative,
        "message": message,
        "district": district,
        "timestamp": datetime.now().isoformat()
    }
    
    # Process as civic action
    result = await coordinator.process_civic_action(
        user_address=current_user,
        action_type="cwc_message",
        action_data=action_data
    )
    
    return {
        "success": result["success"],
        "confirmation_hash": result.get("action_hash"),
        "reward": result["reward"]
    }

# ============= WebSocket for Real-time Updates =============

from fastapi import WebSocket, WebSocketDisconnect
from typing import Set

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time updates"""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and handle messages
            data = await websocket.receive_text()
            # Echo back for now
            await websocket.send_json({
                "type": "pong",
                "timestamp": datetime.now().isoformat()
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ============= Error Handlers =============

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return {
        "error": exc.detail,
        "status_code": exc.status_code,
        "timestamp": datetime.now().isoformat()
    }

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return {
        "error": "Internal server error",
        "detail": str(exc),
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("API_PORT", 8000)),
        reload=True
    )