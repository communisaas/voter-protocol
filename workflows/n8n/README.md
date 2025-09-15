# N8N Workflow Definitions

## Overview

These JSON files define N8N workflows that orchestrate the VOTER Protocol's multi-agent system. N8N acts as the coordination layer, triggering TypeScript agents and managing the civic action pipeline.

**Core Philosophy**: "Quality discourse pays. Bad faith costs."

## Workflows

### 1. Congressional Template Moderation (`template-moderation.json`)

**Purpose**: Validates and processes congressional message templates through multi-stage verification.

**Pipeline**:
1. **Webhook Trigger**: Template creation event
2. **Congressional Check**: Routes certified messages only
3. **Stage 1 - Verification Agent**: Grammar, policy, and factuality checks
4. **Stage 2 - Consensus** (if severity ≥ 7): Multi-agent review for high-impact templates
5. **Stage 3 - Communiqué Delegation**: Delegates congressional submission to Communiqué's CWC integration
6. **Stage 4 - Reward Calculation**: Calculates VOTER token rewards

**Key Features**:
- Severity-based routing (consensus only for high-impact)
- Grammar correction before congressional submission
- Automatic rejection for policy violations
- Delegates CWC integration to Communiqué API

### 2. Civic Action Certification (`civic-certification.json`)

**Purpose**: Certifies civic actions and calculates dynamic rewards through parallel agent processing.

**Pipeline**:
1. **Webhook Trigger**: Email sent event (civic action completed)
2. **Parallel Agent Processing**:
   - VerificationAgent: Validates action authenticity
   - SupplyAgent: Calculates reward based on current supply
   - MarketAgent: Checks economic conditions
   - ReputationAgent: Updates credibility scores
   - ImpactAgent: Measures potential civic impact
3. **Multi-Agent Consensus**: Aggregates agent scores
4. **Certification Storage**: Writes to database with hash anchoring
5. **Notifications**: Slack alerts for certified actions

**Key Features**:
- Parallel processing for speed
- Dynamic reward calculation (not hardcoded)
- Reputation tracking via ERC-8004

### 3. Supply Optimization (`supply-optimization.json`)

**Purpose**: Hourly optimization of protocol parameters based on network metrics.

**Pipeline**:
1. **Schedule Trigger**: Runs every hour
2. **Metrics Collection**:
   - Current participation rates
   - Token circulation
   - Challenge market activity
   - Congressional response rates
3. **Agent Analysis**:
   - SupplyAgent: Calculates optimal token supply
   - MarketAgent: Analyzes economic health
   - ImpactAgent: Measures civic effectiveness
4. **Parameter Updates**:
   - Minor changes (≤20%): Direct update
   - Major changes (>20%): Create governance proposal
5. **Safety Checks**: Enforces min/max bounds

**Key Features**:
- "Agent-optimized parameters replace hardcoded tyranny"
- Natural equilibrium through intelligence
- Automatic governance proposals for major changes

### 4. Challenge Market Resolution (`challenge-market.json`)

**Purpose**: Implements Carroll Mechanisms for information quality markets.

**Pipeline**:
1. **Webhook Trigger**: Challenge created against a claim
2. **Parallel Verification**:
   - Verify original claim
   - Verify challenge claim
3. **Severity Check**: Critical challenges trigger consensus
4. **Outcome Determination**:
   - Compare confidence scores
   - Evaluate source quality
   - Multi-agent consensus for critical challenges
5. **Economic Resolution**:
   - Quadratic reward scaling (prevents plutocracy)
   - Reputation updates (portable via ERC-8004)
   - Treasury allocation
6. **Settlement**: Execute payouts and store resolution

**Key Features**:
- "Quality discourse pays. Bad faith costs"
- Quadratic staking to prevent capital dominance
- Reputation impacts beyond just tokens
- Source quality evaluation

## Environment Variables

Required for all workflows:
```bash
COMMUNIQUE_API_URL=https://communique.fly.dev
N8N_WEBHOOK_SECRET=your-webhook-secret
```

Note: CWC integration is handled by Communiqué's API endpoints, not directly by N8N workflows.

## Database Tables

Workflows expect these tables:
- `civic_certifications`: Stores certified actions
- `challenge_resolutions`: Tracks challenge outcomes
- `protocol_parameters`: Dynamic parameter storage
- `governance_proposals`: Parameter change proposals

## Agent Endpoints

Workflows call these agent endpoints:
- `/api/agents/verify`: VerificationAgent
- `/api/agents/consensus`: Multi-agent consensus
- `/api/agents/calculate-reward`: Reward calculation
- `/api/agents/update-reputation`: Reputation updates
- `/api/agents/analyze-metrics`: Metrics analysis
- `/api/agents/execute-payouts`: Payout execution
- `/api/cwc/submit`: CWC congressional submission (delegated to Communiqué)

## Import Instructions

1. Open N8N dashboard
2. Click "Workflows" → "Import"
3. Select JSON file or paste contents
4. Configure credentials:
   - Database connection
   - Slack notifications
   - API authentication
5. Set environment variables
6. Activate workflow

## Safety Rails

All workflows enforce:
- **Min/max parameter bounds**: Prevents runaway values
- **Daily caps**: Limits total issuance
- **Consensus thresholds**: Multi-agent agreement required
- **Human circuit breakers**: Emergency pause capability
- **Audit logging**: Every decision traceable

## Philosophy

**From hardcoded tyranny to adaptive governance:**
- No artificial scarcity - abundance through intelligence
- No fixed parameters - continuous optimization
- No central operators - distributed consensus
- No plutocracy - quadratic mechanisms

**Impact over activity:**
"We don't count messages sent. We count minds changed."

**Quality incentives:**
"Quality discourse pays. Bad faith costs."

## Testing

Test workflows with mock data:
```bash
# Trigger template moderation
curl -X POST http://localhost:5678/webhook/template-moderation \
  -H "Content-Type: application/json" \
  -d '{"templateId": "test-123", "deliveryMethod": "certified"}'

# Trigger civic certification
curl -X POST http://localhost:5678/webhook/civic-certification \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0x...", "templateId": "test-123"}'
```

## Monitoring

- Check execution history in N8N dashboard
- Monitor Slack notifications for alerts
- Review database for certification records
- Track parameter changes over time

## Future Enhancements

- Add more sophisticated consensus mechanisms
- Implement red team adversarial agents
- Enhanced impact measurement with NLP
- Cross-chain attestation support
- Advanced reputation aggregation
