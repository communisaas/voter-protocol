# VOTER Protocol - Service Provider Architecture

## Overview

VOTER Protocol now serves as a **specialized service provider** for Communiqué's congressional template moderation pipeline, eliminating redundancy and fragmentation.

## Unified Architecture

```
Communiqué Template → N8N Webhook (Primary) → VOTER Protocol Services (Optional) → CWC Submission
```

### Role Separation

- **Communiqué**: Primary orchestrator with complete moderation pipeline
- **VOTER Protocol**: Specialized service provider for complex cases
- **N8N**: Workflow orchestration (runs in Communiqué)

## Architecture Benefits

✅ **No Redundancy**: Single N8N workflow in Communiqué  
✅ **Clear Roles**: Communiqué orchestrates, VOTER Protocol provides specialized services  
✅ **Scalability**: VOTER Protocol can enhance any template verification  
✅ **Maintainability**: Each system focuses on its strengths  
✅ **Integration**: Optional calls to VOTER Protocol when needed  

## Available Services

### 1. Advanced Consensus (`POST /api/consensus`)
Enhanced multi-agent consensus for severity 7+ templates:

**Request:**
```json
{
  "verification_id": "ver_123",
  "template_data": { "message": "...", "representative": "..." },
  "severity_level": 8,
  "existing_votes": { "openai": { "approved": true, "confidence": 0.8 }}
}
```

**Response:**
```json
{
  "consensus_score": 0.82,
  "approved": true,
  "agent_votes": { "voter_verification": {...}, "civic_impact": {...} },
  "diversity_score": 0.8,
  "recommendation": "VOTER Protocol recommends approval with monitoring"
}
```

### 2. Reputation Calculation (`POST /api/reputation`)
Quadratic reputation scaling with behavioral analysis:

**Request:**
```json
{
  "user_address": "0x123...",
  "verification_id": "ver_123", 
  "consensus_result": { "consensus_score": 0.8 },
  "template_quality": 75
}
```

**Response:**
```json
{
  "reputation_delta": 8.5,
  "total_reputation": 83.5,
  "tier_change": "promoted_to_established",
  "explanation": "Quadratic calculation: 0.80² × 10 × quality_factor(0.25)"
}
```

### 3. Verification Enhancement (`POST /api/enhance`)
Additional VOTER Protocol-specific checks:

**Request:**
```json
{
  "template_id": "template_123",
  "verification_id": "ver_123",
  "template_data": { "message": "..." },
  "current_severity": 6
}
```

**Response:**
```json
{
  "enhanced_severity": 5,
  "additional_checks": {
    "political_authenticity": 0.9,
    "civic_value": 0.8,
    "constitutional_alignment": 0.85
  },
  "recommendations": ["Template meets high democratic standards"],
  "confidence": 0.87
}
```

## Integration with Communiqué

### When VOTER Protocol Gets Called

1. **Severity 7+ Templates**: Communiqué N8N workflow can call `/api/consensus` for additional agent opinions
2. **Reputation Updates**: Post-approval calls to `/api/reputation` for quadratic calculations  
3. **Complex Cases**: Optional calls to `/api/enhance` for deeper analysis

### Integration Points

**Communiqué N8N Workflow Enhancement:**
```yaml
# Optional enhancement node in existing workflow
- name: "VOTER Protocol Enhancement"
  type: "HTTP Request"  
  url: "http://voter-protocol:8000/api/consensus"
  condition: "{{ severity_level >= 7 }}"
  method: "POST"
  body: {
    verification_id: "{{ verification.id }}",
    template_data: "{{ template }}",
    severity_level: "{{ severity }}",
    existing_votes: "{{ agent_votes }}"
  }
```

## Quick Start

### 1. Start VOTER Protocol Service

```bash
cd voter-protocol
python start_server.py
```

Service available at: http://localhost:8000

### 2. Test Service Health

```bash
curl http://localhost:8000/health
```

### 3. Test Advanced Consensus

```bash
curl -X POST http://localhost:8000/api/consensus \
  -H "Content-Type: application/json" \
  -d '{
    "verification_id": "test_123",
    "template_data": {"message": "Test congressional message"},
    "severity_level": 8,
    "existing_votes": {}
  }'
```

## Demo Flow

1. **User creates congressional template** in Communiqué (`deliveryMethod = 'certified'`)
2. **Communiqué N8N webhook** processes template through existing pipeline:
   - Stage 1: Auto-correction (severity 1-6) 
   - Stage 2: Multi-agent consensus (severity 7+)
   - Stage 3: Reputation updates
3. **Optional enhancement**: For complex cases, N8N calls VOTER Protocol services:
   - `/api/consensus` for additional agent opinions
   - `/api/reputation` for quadratic reputation calculations
   - `/api/enhance` for deeper verification analysis
4. **Result**: Template approved/rejected with enhanced insights
5. **CWC Submission**: Approved templates submitted to Congressional API

## Removed Redundancy

❌ **Removed from VOTER Protocol:**
- Duplicate N8N workflow JSON
- Database polling logic  
- Template creation triggers
- Primary moderation pipeline
- LangChain/LangGraph orchestration

✅ **Kept in VOTER Protocol:**
- Specialized agent services
- Advanced consensus algorithms
- Quadratic reputation calculations
- Verification enhancement logic

## Environment Configuration

```env
# Service Provider Mode
OPENAI_API_KEY=your_api_key_here
COMMUNIQUE_API_KEY=shared-secret-key
COMMUNIQUE_API_BASE=https://communi.app

# Server Config
API_HOST=0.0.0.0
API_PORT=8000
LOG_LEVEL=info
```

## Testing Integration

### Test VOTER Protocol Service
```bash
# Health check
curl http://localhost:8000/health

# List services  
curl http://localhost:8000/api/services

# Test consensus
curl -X POST http://localhost:8000/api/consensus \
  -H "Content-Type: application/json" \
  -d '{"verification_id":"test","template_data":{},"severity_level":8}'
```

### Test Communiqué Integration
1. Create congressional template in Communiqué
2. Monitor N8N workflow execution
3. Check for optional VOTER Protocol service calls
4. Verify enhanced moderation results

## Monitoring

- **Communiqué**: Primary moderation pipeline logs
- **VOTER Protocol**: Service call logs and performance metrics
- **N8N**: Workflow execution history and service integration status

This architecture eliminates fragmentation while preserving both systems' strengths, creating a scalable and maintainable solution for congressional template moderation.