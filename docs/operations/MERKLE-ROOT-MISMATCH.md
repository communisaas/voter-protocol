# Runbook: Merkle Root Mismatch

**Severity:** 🚨 P0 - CRITICAL
**Response Time:** < 5 minutes
**On-Call:** Primary + Secondary (page both immediately)

---

## Symptoms

**How to Detect:**
- ✅ Validation check fails with merkle root mismatch error
- ✅ Monitoring alert: `merkle_root_mismatch_total` counter incremented
- ✅ CI/CD validation step fails
- ✅ User reports: "Proof verification failing"

**Example Error Messages:**
```
ERROR: Merkle root mismatch detected
Expected: 0x1a2b3c4d5e6f7890...
Actual:   0x9876543210fedcba...
State: WI, Layer: congressional
```

---

## Impact

**User-Facing:**
- ❌ **CRITICAL:** Zero-knowledge proof generation HALTED
- ❌ Users cannot prove congressional district membership
- ❌ All ZK proof verifications will FAIL

**System-Facing:**
- 🚨 Data integrity compromised
- 🚨 Shadow Atlas trustworthiness violated
- 🚨 Potential security vulnerability

**Affected Services:**
- Shadow Atlas API
- ZK proof generation service
- On-chain verification contracts

---

## Response Time Targets

| Metric | Target |
|--------|--------|
| **Time to acknowledge** | < 5 minutes |
| **Time to diagnose** | < 15 minutes |
| **Time to mitigate** | < 30 minutes |
| **Time to resolve** | < 2 hours |

---

## Prerequisites

**Before You Begin:**
- [ ] Access to production Kubernetes cluster
- [ ] Access to IPFS gateway
- [ ] Access to Shadow Atlas admin API
- [ ] PagerDuty incident created
- [ ] #shadow-atlas-alerts channel open

**Tools Required:**
- `kubectl` configured for production
- `ipfs` CLI tool
- `tsx` for running validation scripts
- `jq` for JSON parsing

---

## Immediate Actions (< 5 minutes)

### Step 1: HALT Proof Generation

**CRITICAL: Stop all proof generation immediately to prevent invalid proofs.**

```bash
# Scale proof generation service to 0 replicas
kubectl scale deployment shadow-atlas-proof-generator \
  -n shadow-atlas-production \
  --replicas=0

# Verify proof generation stopped
kubectl get pods -n shadow-atlas-production -l app=proof-generator
# Should show: No resources found
```

**Verification:**
- ✅ Zero proof-generator pods running
- ✅ Post to #shadow-atlas-alerts: "Proof generation HALTED - merkle root mismatch"

### Step 2: Update Status Page

```bash
# Update status page
curl -X POST https://status.shadow-atlas.voter-protocol.org/api/incident \
  -H "Authorization: Bearer $STATUS_API_KEY" \
  -d '{
    "status": "critical",
    "title": "Data Integrity Issue - Proof Generation Disabled",
    "message": "We are investigating a data integrity issue. Proof generation is temporarily disabled while we resolve this.",
    "impact": "critical"
  }'
```

**Verification:**
- ✅ Status page shows "Major Outage"
- ✅ Users see notification banner

### Step 3: Notify Stakeholders

```bash
# Post to #shadow-atlas-alerts (already open)
```

**Message Template:**
```
🚨 P0 INCIDENT - Merkle Root Mismatch

**Status:** Investigating
**Impact:** Proof generation HALTED
**Started:** [Current timestamp]
**Responder:** [Your name]
**ETA:** 30 minutes to mitigation

**Action Taken:**
- Proof generation scaled to 0
- Status page updated
- Investigation beginning

**Next Update:** [Current time + 15 minutes]
```

---

## Investigation (< 15 minutes)

### Step 4: Identify Affected State/Layer

```bash
# Get recent merkle root validation logs
kubectl logs -n shadow-atlas-production \
  -l app=shadow-atlas \
  --tail=1000 \
  | grep "merkle_root_mismatch"

# Expected output:
# ERROR: Merkle root mismatch - State: WI, Layer: congressional
#   Expected: 0x1a2b3c...
#   Actual: 0x987654...
```

**Document:**
- State code: ________________
- Layer type: ________________
- Expected root: ________________
- Actual root: ________________

### Step 5: Check IPFS CID

```bash
# Get current IPFS CID for affected state
STATE_CODE="WI"  # Replace with affected state
LAYER="congressional"  # Replace with affected layer

CURRENT_CID=$(curl -s "https://shadow-atlas.voter-protocol.org/api/v1/cid?state=${STATE_CODE}&layer=${LAYER}" \
  | jq -r '.ipfsCid')

echo "Current IPFS CID: $CURRENT_CID"

# Fetch data from IPFS
ipfs cat "$CURRENT_CID" > /tmp/shadow-atlas-current.json

# Verify merkle root in IPFS data
cat /tmp/shadow-atlas-current.json | jq -r '.merkleRoot'
```

**Compare:**
- IPFS merkle root: ________________
- Expected merkle root: ________________
- Match? Yes / No

### Step 6: Check Extraction Logs

```bash
# Get recent extraction logs for affected state
kubectl logs -n shadow-atlas-production \
  -l app=shadow-atlas-extractor \
  --tail=5000 \
  | grep "$STATE_CODE"

# Look for:
# - Extraction errors
# - Count mismatches
# - GEOID format issues
# - Geometry validation failures
```

**Document any errors found:**
- ________________________________
- ________________________________

### Step 7: Determine Root Cause

**Common Causes:**

**1. Data Extraction Error** (Most likely)
- Symptoms: Count mismatch, missing GEOIDs, invalid geometries
- Action: Re-extract from authoritative source

**2. IPFS Data Corruption** (Rare)
- Symptoms: IPFS CID returns different data than expected
- Action: Re-pin to IPFS

**3. Code Bug** (Very rare)
- Symptoms: Consistent mismatch across multiple states
- Action: Rollback to previous version

**4. Malicious Attack** (Extremely rare)
- Symptoms: Unexpected data changes, suspicious activity
- Action: Escalate to security team, preserve logs

**Which cause applies?** ________________

---

## Mitigation (< 30 minutes)

### Scenario A: Data Extraction Error (Most Common)

**Step 8A: Re-Extract Boundaries**

```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto

# Re-extract from authoritative source
npx tsx services/shadow-atlas/providers/state-batch-extractor.ts \
  --state="$STATE_CODE" \
  --layer="$LAYER" \
  --output="/tmp/reextraction.json"

# Validate count
EXPECTED_COUNT=$(npx tsx -e "
  import { getOfficialCount } from './services/shadow-atlas/registry/official-district-counts.js';
  console.log(getOfficialCount('$STATE_CODE', '$LAYER'));
")

ACTUAL_COUNT=$(cat /tmp/reextraction.json | jq '.features | length')

if [ "$EXPECTED_COUNT" -ne "$ACTUAL_COUNT" ]; then
  echo "❌ Count mismatch: expected $EXPECTED_COUNT, got $ACTUAL_COUNT"
  echo "Manual investigation required - escalate to Engineering Lead"
  exit 1
fi

echo "✅ Count validated: $ACTUAL_COUNT districts"
```

**Step 9A: Rebuild Merkle Tree**

```bash
# Rebuild merkle tree with validated data
npx tsx services/shadow-atlas/integration/state-batch-to-merkle.ts \
  --input="/tmp/reextraction.json" \
  --output="/tmp/new-merkle-tree.json"

# Get new merkle root
NEW_ROOT=$(cat /tmp/new-merkle-tree.json | jq -r '.root')
echo "New merkle root: $NEW_ROOT"
```

**Step 10A: Validate Against Ground Truth**

```bash
# Run multi-state validation for affected state
RUN_E2E=true npx tsx services/shadow-atlas/scripts/multi-state-validation.ts \
  --states="$STATE_CODE" \
  --layers="$LAYER"

# Check validation result
if ! grep -q "✅" /tmp/validation-result.txt; then
  echo "❌ Validation failed - manual investigation required"
  exit 1
fi

echo "✅ Validation passed"
```

**Step 11A: Publish to IPFS**

```bash
# Publish new merkle tree to IPFS
NEW_CID=$(ipfs add -Q /tmp/new-merkle-tree.json)
echo "New IPFS CID: $NEW_CID"

# Pin to cluster
ipfs pin add "$NEW_CID"

# Verify accessibility
curl -f "https://ipfs.io/ipfs/$NEW_CID" || {
  echo "❌ IPFS CID not accessible"
  exit 1
}

echo "✅ IPFS CID accessible"
```

**Step 12A: Update Production**

```bash
# Update Shadow Atlas API with new CID
curl -X POST "https://shadow-atlas.voter-protocol.org/api/v1/admin/update-cid" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"state\": \"$STATE_CODE\",
    \"layer\": \"$LAYER\",
    \"ipfsCid\": \"$NEW_CID\",
    \"merkleRoot\": \"$NEW_ROOT\"
  }"

# Verify update
UPDATED_CID=$(curl -s "https://shadow-atlas.voter-protocol.org/api/v1/cid?state=${STATE_CODE}&layer=${LAYER}" \
  | jq -r '.ipfsCid')

if [ "$UPDATED_CID" != "$NEW_CID" ]; then
  echo "❌ CID not updated in API"
  exit 1
fi

echo "✅ API updated with new CID"
```

### Scenario B: IPFS Data Corruption (Rare)

**Step 8B: Verify IPFS Corruption**

```bash
# Fetch from multiple gateways
ipfs cat "$CURRENT_CID" > /tmp/gateway1.json
curl -s "https://ipfs.io/ipfs/$CURRENT_CID" > /tmp/gateway2.json
curl -s "https://dweb.link/ipfs/$CURRENT_CID" > /tmp/gateway3.json

# Compare hashes
sha256sum /tmp/gateway*.json

# If hashes differ, IPFS data is corrupted
```

**Step 9B: Re-Pin from Backup**

```bash
# Get backup CID from database
BACKUP_CID=$(kubectl exec -n shadow-atlas-production \
  deployment/shadow-atlas \
  -- sqlite3 /data/shadow-atlas.db \
  "SELECT previous_cid FROM merkle_trees WHERE state='$STATE_CODE' AND layer='$LAYER' LIMIT 1;"
)

echo "Backup CID: $BACKUP_CID"

# Verify backup data
ipfs cat "$BACKUP_CID" | jq -r '.merkleRoot'

# Re-pin backup
ipfs pin add "$BACKUP_CID"

# Update API to use backup
curl -X POST "https://shadow-atlas.voter-protocol.org/api/v1/admin/rollback-cid" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -d "{\"state\": \"$STATE_CODE\", \"layer\": \"$LAYER\"}"
```

### Scenario C: Code Bug (Very Rare)

**Step 8C: Rollback Deployment**

```bash
# Get previous deployment image
PREVIOUS_IMAGE=$(kubectl get deployment shadow-atlas \
  -n shadow-atlas-production \
  -o jsonpath='{.metadata.annotations.previous-image}')

echo "Rolling back to: $PREVIOUS_IMAGE"

# Rollback deployment
kubectl set image deployment/shadow-atlas \
  shadow-atlas="$PREVIOUS_IMAGE" \
  -n shadow-atlas-production

# Wait for rollout
kubectl rollout status deployment/shadow-atlas \
  -n shadow-atlas-production \
  --timeout=5m

# Verify merkle root after rollback
# ... (repeat Step 5 validation)
```

---

## Resume Proof Generation (< 2 hours)

### Step 13: Verify Fix

```bash
# Run comprehensive validation
npx tsx services/shadow-atlas/scripts/multi-state-validation.ts \
  --states="$STATE_CODE" \
  --layers="$LAYER"

# Check merkle root
FINAL_ROOT=$(curl -s "https://shadow-atlas.voter-protocol.org/api/v1/merkle-root?state=${STATE_CODE}&layer=${LAYER}" \
  | jq -r '.merkleRoot')

echo "Final merkle root: $FINAL_ROOT"

# Verify against expected
if [ "$FINAL_ROOT" != "$NEW_ROOT" ]; then
  echo "❌ Merkle root still incorrect - escalate"
  exit 1
fi

echo "✅ Merkle root validated"
```

### Step 14: Test Proof Generation

```bash
# Generate test proof
TEST_ADDRESS="1600 Pennsylvania Avenue NW, Washington, DC 20500"

curl -X POST "https://shadow-atlas.voter-protocol.org/api/v1/generate-proof" \
  -H "Content-Type: application/json" \
  -d "{
    \"address\": \"$TEST_ADDRESS\",
    \"state\": \"DC\",
    \"layer\": \"congressional\"
  }" > /tmp/test-proof.json

# Verify proof
PROOF_VALID=$(cat /tmp/test-proof.json | jq -r '.valid')

if [ "$PROOF_VALID" != "true" ]; then
  echo "❌ Proof generation still failing"
  exit 1
fi

echo "✅ Proof generation working"
```

### Step 15: Resume Production

```bash
# Scale proof generation back to normal
kubectl scale deployment shadow-atlas-proof-generator \
  -n shadow-atlas-production \
  --replicas=3

# Verify pods healthy
kubectl get pods -n shadow-atlas-production -l app=proof-generator
# Should show: 3 pods running

# Monitor logs for errors
kubectl logs -f -n shadow-atlas-production \
  -l app=proof-generator \
  --tail=50
```

**Verification:**
- ✅ 3 proof-generator pods running
- ✅ No errors in logs for 5 minutes
- ✅ Test proof generation succeeds

### Step 16: Update Status Page

```bash
# Update status page - incident resolved
curl -X POST https://status.shadow-atlas.voter-protocol.org/api/incident \
  -H "Authorization: Bearer $STATUS_API_KEY" \
  -d '{
    "status": "resolved",
    "message": "Data integrity issue resolved. Proof generation restored. All systems operational."
  }'
```

---

## Verification

**Complete Verification Checklist:**

- [ ] Merkle root matches expected value
- [ ] IPFS CID accessible from multiple gateways
- [ ] Multi-state validation passes for affected state
- [ ] Test proof generation succeeds
- [ ] Proof verification on-chain succeeds
- [ ] No errors in logs for 15 minutes
- [ ] Monitoring dashboards show normal metrics
- [ ] Status page updated to "Operational"

**If ALL checks pass:** Incident resolved ✅

**If ANY check fails:** DO NOT resume proof generation. Escalate to Engineering Lead.

---

## Communication

### During Incident (Every 15 minutes)

```
📊 MERKLE ROOT MISMATCH UPDATE - [HH:MM]

**Status:** [Investigating / Mitigating / Resolved]
**Progress:** [What's been done]
**Root Cause:** [If identified]
**Next Steps:** [What's being done next]
**ETA:** [Updated estimate]
```

### Resolution Notification

```
✅ INCIDENT RESOLVED - Merkle Root Mismatch

**Duration:** [Start] - [End] ([Total time])
**Root Cause:** [Brief explanation]
**Resolution:** [What fixed it]

**Impact Summary:**
- Proof generation halted: [Duration]
- States affected: [List]
- Users affected: [Estimate]

**Follow-up:**
- Post-incident review: [Scheduled time]
- Runbook updates: [List any needed changes]
```

---

## Rollback

**If mitigation fails:**

```bash
# Rollback to last known good state

# 1. Get last good IPFS CID from backup
LAST_GOOD_CID=$(kubectl exec -n shadow-atlas-production \
  deployment/shadow-atlas \
  -- sqlite3 /data/shadow-atlas.db \
  "SELECT ipfs_cid FROM merkle_trees_history \
   WHERE state='$STATE_CODE' AND layer='$LAYER' \
   AND validated=1 \
   ORDER BY created_at DESC LIMIT 1;"
)

# 2. Rollback API to last good CID
curl -X POST "https://shadow-atlas.voter-protocol.org/api/v1/admin/rollback-cid" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -d "{\"state\": \"$STATE_CODE\", \"layer\": \"$LAYER\", \"cid\": \"$LAST_GOOD_CID\"}"

# 3. Verify rollback
# ... (repeat verification steps)

# 4. If rollback fails, escalate to Engineering Lead
# DO NOT resume proof generation
```

---

## Post-Incident Actions

**Within 24 hours:**

1. **[ ] Complete post-incident review** (use template in runbooks/README.md)
   - Root cause analysis
   - Timeline of events
   - What went well / what didn't
   - Action items with owners

2. **[ ] Update runbook** if any steps were unclear or missing
   - PR to update this runbook
   - Get review from incident responders
   - Merge after approval

3. **[ ] Add preventive monitoring**
   - New alert for early detection?
   - Validation frequency increase?
   - Automated rollback trigger?

4. **[ ] Communicate to users**
   - Blog post explaining what happened (high-level)
   - Email to affected users (if significant impact)
   - Twitter/social media update

5. **[ ] Schedule runbook drill**
   - Test updated runbook in staging
   - Verify all team members understand procedure
   - Update on-call rotation if needed

---

## Escalation

**Escalate to Engineering Lead if:**
- ❌ Root cause not identified within 15 minutes
- ❌ Mitigation not working after 1 hour
- ❌ Multiple states affected
- ❌ Suspected malicious attack
- ❌ Proof generation cannot be safely resumed

**Contact:**
- Engineering Lead: [PagerDuty]
- CTO: [PagerDuty] (if Engineering Lead unavailable)
- Security Team: security@voter-protocol.org (if malicious attack suspected)

---

**Runbook Version:** 1.0
**Last Updated:** 2025-12-18
**Last Tested:** Never (pending first drill)
**Next Drill:** 2025-10-15
**Owner:** Shadow Atlas Operations Team
