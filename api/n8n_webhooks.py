"""
N8N Webhook Endpoints for VOTER Protocol

Provides webhook endpoints for N8N workflow automation.
Handles civic action certification, challenge management,
and reputation updates triggered by external events.
"""

from fastapi import APIRouter, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
import hashlib
import json

# Import workflow orchestrator
from agents.workflows import (
    certify_civic_action,
    process_challenge,
    optimize_token_supply,
    migrate_reputation
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/n8n", tags=["n8n"])

# ============================================================================
# Webhook Request Models
# ============================================================================

class CivicActionWebhook(BaseModel):
    """Webhook payload for civic action certification"""
    workflow_id: str = Field(..., description="N8N workflow ID")
    trigger_id: str = Field(..., description="N8N trigger ID")
    
    # User data
    user_id: str
    user_email: Optional[str] = None
    user_address: Optional[str] = None  # Blockchain address if available
    
    # Action data
    action_type: str = Field(..., description="Type of civic action (cwc_message, petition, etc)")
    template_id: str = Field(..., description="Template ID from Communiqué")
    recipients: List[str] = Field(default_factory=list, description="Email recipients")
    
    # Content
    subject: str
    body: str
    
    # Metadata
    timestamp: datetime = Field(default_factory=datetime.now)
    source: str = Field(default="communique", description="Source system")
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ChallengeWebhook(BaseModel):
    """Webhook payload for Carroll Mechanisms challenge"""
    workflow_id: str
    trigger_id: str
    
    # Challenge data
    challenge_type: str = Field(..., description="create, support, oppose, resolve")
    claim_text: str
    claim_category: str = Field(..., description="Category of claim")
    
    # Participants
    initiator_address: str
    target_address: Optional[str] = None
    
    # Stakes
    stake_amount: int = Field(..., ge=0)
    
    # Sources and arguments
    sources: List[str] = Field(default_factory=list)
    argument: str = Field(default="")
    
    # Metadata
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ReputationUpdateWebhook(BaseModel):
    """Webhook payload for reputation updates"""
    workflow_id: str
    trigger_id: str
    
    # User data
    user_address: str
    update_type: str = Field(..., description="challenge, civic, discourse, migration")
    
    # Score changes
    score_changes: Dict[str, float] = Field(
        default_factory=dict,
        description="Score changes by category"
    )
    
    # Migration data (optional)
    target_chain: Optional[str] = None
    migration_required: bool = False
    
    # Metadata
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class SupplyOptimizationWebhook(BaseModel):
    """Webhook payload for supply optimization triggers"""
    workflow_id: str
    trigger_id: str
    
    # Trigger conditions
    trigger_reason: str = Field(..., description="scheduled, threshold_met, manual")
    
    # Current metrics
    current_metrics: Dict[str, Any] = Field(
        default_factory=dict,
        description="Current platform metrics"
    )
    
    # Thresholds
    thresholds_exceeded: List[str] = Field(
        default_factory=list,
        description="List of exceeded thresholds"
    )
    
    # Metadata
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Dict[str, Any] = Field(default_factory=dict)

# ============================================================================
# Webhook Response Models
# ============================================================================

class WebhookResponse(BaseModel):
    """Standard webhook response"""
    success: bool
    workflow_id: str
    trigger_id: str
    message: str
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)

# ============================================================================
# Webhook Endpoints
# ============================================================================

@router.post("/civic-action", response_model=WebhookResponse)
async def handle_civic_action_webhook(
    webhook: CivicActionWebhook,
    background_tasks: BackgroundTasks,
    x_n8n_signature: Optional[str] = Header(None),
    x_webhook_secret: Optional[str] = Header(None)
):
    """
    Handle civic action certification webhook from N8N.
    
    Triggered when a user completes a civic action through Communiqué.
    Initiates the multi-agent certification workflow.
    """
    try:
        # Validate webhook signature (if configured)
        if x_webhook_secret:
            if not validate_webhook_signature(webhook.dict(), x_n8n_signature, x_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        # Generate deterministic address if not provided
        user_address = webhook.user_address
        if not user_address and webhook.user_id:
            # Import address generation from Communiqué integration
            from integrations.communique import generate_user_address
            user_address = generate_user_address(webhook.user_id, webhook.user_email)
        
        if not user_address:
            raise ValueError("Unable to determine user address")
        
        # Prepare action data
        action_data = {
            "subject": webhook.subject,
            "body": webhook.body,
            "source": webhook.source,
            "workflow_id": webhook.workflow_id,
            "trigger_id": webhook.trigger_id,
            **webhook.metadata
        }
        
        # Execute certification workflow in background
        background_tasks.add_task(
            certify_civic_action,
            user_address=user_address,
            action_type=webhook.action_type,
            action_data=action_data,
            template_id=webhook.template_id,
            recipients=webhook.recipients
        )
        
        return WebhookResponse(
            success=True,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message=f"Civic action certification initiated for {user_address}",
            data={
                "user_address": user_address,
                "action_type": webhook.action_type,
                "template_id": webhook.template_id
            }
        )
    
    except Exception as e:
        logger.error(f"Civic action webhook error: {e}")
        return WebhookResponse(
            success=False,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message="Failed to process civic action webhook",
            error=str(e)
        )

@router.post("/challenge", response_model=WebhookResponse)
async def handle_challenge_webhook(
    webhook: ChallengeWebhook,
    background_tasks: BackgroundTasks,
    x_n8n_signature: Optional[str] = Header(None),
    x_webhook_secret: Optional[str] = Header(None)
):
    """
    Handle Carroll Mechanisms challenge webhook from N8N.
    
    Triggered when users create, support, or oppose challenges.
    Manages information quality markets for discourse evaluation.
    """
    try:
        # Validate webhook signature
        if x_webhook_secret:
            if not validate_webhook_signature(webhook.dict(), x_n8n_signature, x_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        # Generate challenge ID
        challenge_id = generate_challenge_id(
            webhook.claim_text,
            webhook.initiator_address,
            webhook.timestamp
        )
        
        if webhook.challenge_type == "create":
            # Initiate new challenge
            background_tasks.add_task(
                process_challenge,
                challenge_id=challenge_id,
                claim_text=webhook.claim_text,
                challenger_address=webhook.initiator_address,
                challenger_stake=webhook.stake_amount
            )
            
            message = f"Challenge {challenge_id} created"
        
        elif webhook.challenge_type in ["support", "oppose"]:
            # Add stake to existing challenge
            # TODO: Implement stake addition logic
            message = f"Stake added to challenge {challenge_id}"
        
        elif webhook.challenge_type == "resolve":
            # Trigger challenge resolution
            # TODO: Implement resolution logic
            message = f"Challenge {challenge_id} resolution initiated"
        
        else:
            raise ValueError(f"Unknown challenge type: {webhook.challenge_type}")
        
        return WebhookResponse(
            success=True,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message=message,
            data={
                "challenge_id": challenge_id,
                "challenge_type": webhook.challenge_type,
                "initiator": webhook.initiator_address
            }
        )
    
    except Exception as e:
        logger.error(f"Challenge webhook error: {e}")
        return WebhookResponse(
            success=False,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message="Failed to process challenge webhook",
            error=str(e)
        )

@router.post("/reputation-update", response_model=WebhookResponse)
async def handle_reputation_webhook(
    webhook: ReputationUpdateWebhook,
    background_tasks: BackgroundTasks,
    x_n8n_signature: Optional[str] = Header(None),
    x_webhook_secret: Optional[str] = Header(None)
):
    """
    Handle reputation update webhook from N8N.
    
    Triggered when user reputation needs updating or migration.
    Manages ERC-8004 portable reputation across chains.
    """
    try:
        # Validate webhook signature
        if x_webhook_secret:
            if not validate_webhook_signature(webhook.dict(), x_n8n_signature, x_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        if webhook.migration_required and webhook.target_chain:
            # Execute reputation migration workflow
            background_tasks.add_task(
                migrate_reputation,
                user_address=webhook.user_address,
                target_chain=webhook.target_chain
            )
            message = f"Reputation migration initiated for {webhook.user_address}"
        
        else:
            # Update reputation scores
            # TODO: Implement reputation update logic
            message = f"Reputation updated for {webhook.user_address}"
        
        return WebhookResponse(
            success=True,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message=message,
            data={
                "user_address": webhook.user_address,
                "update_type": webhook.update_type,
                "score_changes": webhook.score_changes
            }
        )
    
    except Exception as e:
        logger.error(f"Reputation webhook error: {e}")
        return WebhookResponse(
            success=False,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message="Failed to process reputation webhook",
            error=str(e)
        )

@router.post("/supply-optimization", response_model=WebhookResponse)
async def handle_supply_optimization_webhook(
    webhook: SupplyOptimizationWebhook,
    background_tasks: BackgroundTasks,
    x_n8n_signature: Optional[str] = Header(None),
    x_webhook_secret: Optional[str] = Header(None)
):
    """
    Handle supply optimization webhook from N8N.
    
    Triggered periodically or when thresholds are met.
    Optimizes token supply and reward parameters.
    """
    try:
        # Validate webhook signature
        if x_webhook_secret:
            if not validate_webhook_signature(webhook.dict(), x_n8n_signature, x_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        # Execute supply optimization workflow
        background_tasks.add_task(optimize_token_supply)
        
        return WebhookResponse(
            success=True,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message=f"Supply optimization initiated - Reason: {webhook.trigger_reason}",
            data={
                "trigger_reason": webhook.trigger_reason,
                "thresholds_exceeded": webhook.thresholds_exceeded,
                "metrics": webhook.current_metrics
            }
        )
    
    except Exception as e:
        logger.error(f"Supply optimization webhook error: {e}")
        return WebhookResponse(
            success=False,
            workflow_id=webhook.workflow_id,
            trigger_id=webhook.trigger_id,
            message="Failed to process supply optimization webhook",
            error=str(e)
        )

# ============================================================================
# Batch Processing Endpoints
# ============================================================================

@router.post("/batch/civic-actions", response_model=WebhookResponse)
async def handle_batch_civic_actions(
    actions: List[CivicActionWebhook],
    background_tasks: BackgroundTasks,
    x_n8n_signature: Optional[str] = Header(None),
    x_webhook_secret: Optional[str] = Header(None)
):
    """
    Handle batch civic action certifications.
    
    Processes multiple civic actions in a single webhook call.
    Useful for bulk processing from N8N workflows.
    """
    try:
        # Validate webhook signature
        if x_webhook_secret:
            if not validate_webhook_signature({"actions": [a.dict() for a in actions]}, x_n8n_signature, x_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        processed = 0
        failed = 0
        
        for action in actions:
            try:
                # Generate address if needed
                user_address = action.user_address
                if not user_address and action.user_id:
                    from integrations.communique import generate_user_address
                    user_address = generate_user_address(action.user_id, action.user_email)
                
                if user_address:
                    # Queue certification
                    background_tasks.add_task(
                        certify_civic_action,
                        user_address=user_address,
                        action_type=action.action_type,
                        action_data={
                            "subject": action.subject,
                            "body": action.body,
                            "source": action.source,
                            **action.metadata
                        },
                        template_id=action.template_id,
                        recipients=action.recipients
                    )
                    processed += 1
                else:
                    failed += 1
            
            except Exception as e:
                logger.error(f"Failed to process action for user {action.user_id}: {e}")
                failed += 1
        
        return WebhookResponse(
            success=True,
            workflow_id="batch",
            trigger_id=f"batch_{datetime.now().timestamp()}",
            message=f"Batch processing initiated: {processed} succeeded, {failed} failed",
            data={
                "total": len(actions),
                "processed": processed,
                "failed": failed
            }
        )
    
    except Exception as e:
        logger.error(f"Batch civic actions webhook error: {e}")
        return WebhookResponse(
            success=False,
            workflow_id="batch",
            trigger_id=f"batch_{datetime.now().timestamp()}",
            message="Failed to process batch civic actions",
            error=str(e)
        )

# ============================================================================
# Health Check Endpoint
# ============================================================================

@router.get("/health")
async def webhook_health_check():
    """
    Health check endpoint for N8N webhook monitoring.
    """
    return {
        "status": "healthy",
        "service": "voter-protocol-n8n-webhooks",
        "timestamp": datetime.now().isoformat(),
        "endpoints": [
            "/webhooks/n8n/civic-action",
            "/webhooks/n8n/challenge",
            "/webhooks/n8n/reputation-update",
            "/webhooks/n8n/supply-optimization",
            "/webhooks/n8n/batch/civic-actions"
        ]
    }

# ============================================================================
# Utility Functions
# ============================================================================

def validate_webhook_signature(
    payload: Dict[str, Any],
    signature: Optional[str],
    secret: str
) -> bool:
    """
    Validate N8N webhook signature.
    
    Args:
        payload: Webhook payload
        signature: Signature from N8N
        secret: Webhook secret
    
    Returns:
        True if signature is valid
    """
    if not signature:
        return False
    
    # Calculate expected signature
    payload_json = json.dumps(payload, sort_keys=True)
    expected_signature = hashlib.sha256(
        f"{secret}{payload_json}".encode()
    ).hexdigest()
    
    return signature == expected_signature

def generate_challenge_id(
    claim_text: str,
    initiator: str,
    timestamp: datetime
) -> str:
    """
    Generate unique challenge ID.
    
    Args:
        claim_text: Text of the claim
        initiator: Address of challenge initiator
        timestamp: Challenge creation time
    
    Returns:
        Unique challenge ID
    """
    data = f"{claim_text}{initiator}{timestamp.isoformat()}"
    return hashlib.sha256(data.encode()).hexdigest()[:16]
