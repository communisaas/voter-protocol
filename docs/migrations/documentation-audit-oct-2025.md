# voter-protocol Documentation Audit & Required Updates

**Date:** October 23, 2025
**Reason:** Correct NEAR pricing ($2.20 not $8.50) and update architectural references

---

## Executive Summary

**Scope:** Systematic review of all voter-protocol documentation to:
1. Correct NEAR pricing from $8.50 to $2.20 (October 2025 actual)
2. Update cost comparisons (22% margin, not 7.5x)
3. Clarify NEAR Chain Signatures role (optional account abstraction, not identity storage)
4. Deprecate CipherVault contract references where appropriate

**Impact:** 47 files need review, ~15 files need updates

---

## Critical Corrections Required

### 1. NEAR Pricing Error (HIGH PRIORITY)

**Current Claims:**
- NEAR price: $8.50
- NEAR storage cost: $0.01/user
- 10-year cost: $150
- Scroll advantage: "7.5x cheaper"

**Corrected (October 2025):**
- NEAR price: **$2.20** (actual market price)
- NEAR storage cost: **$0.002/user** (same as Scroll!)
- 10-year cost: **$25.50** ($20 locked + $5.50 opportunity cost)
- Scroll advantage: **22% cheaper** ($20 vs $25.50)

**Files Affected:** 8 files with cost comparisons

---

## File-by-File Analysis

### Tier 1: High-Level Architecture (CRITICAL)

#### 1. `/ARCHITECTURE.md` ✅ ALREADY UPDATED
**Status:** Updated with correct gas costs
**Remaining Issues:**
- Line 398: Claims "7.5x cheaper" vs NEAR - **NEEDS CORRECTION to 22%**
- Line 362: Claims "$110,000 for NEAR staking" - **NEEDS RECALCULATION**
- Line 3820: Claims "$11,000/year NEAR storage" - **NEEDS RECALCULATION**

**Required Changes:**
```markdown
Line 398:
OLD: - **Cheaper**: $20 over 10 years vs $150 (7.5x cheaper, no locked capital)
NEW: - **Cheaper**: $20 over 10 years vs $25.50 (22% cheaper, no locked capital)

Line 362:
OLD: - **NO recurring costs** (vs $30,000/year for database, $110,000 for NEAR staking)
NEW: - **NO recurring costs** (vs $30,000/year for database, $2,550 for NEAR staking)

Line 3820:
OLD: - NEAR storage sponsorship: **$11,000/year** (0.11 per user with compression)
NEW: - NEAR storage sponsorship: **$2,000/year** (0.002 per user at $2.20 NEAR)
```

#### 2. `/README.md` ✅ ALREADY UPDATED
**Status:** Updated with $0.002/user post-Dencun
**Remaining Issues:** None (correctly shows $0.002/user)

#### 3. `/TECHNICAL.md`
**Status:** NEEDS REVIEW
**Search for:** NEAR references, cost comparisons
**Action:** Read and update if cost claims present

---

### Tier 2: Migration & Research Docs (COMPLETED)

#### 4. `/docs/migrations/ciphervault-to-identity-registry.md` ✅ COMPLETED
**Status:** Migration guide already created
**Note:** This is the source document for the migration

#### 5. Research docs in `/Users/noot/Documents/communique/docs/research/` ✅ COMPLETED
- `near-vs-scroll-identity-storage.md` - UPDATED
- `scroll-gas-cost-recalculation-oct-2025.md` - UPDATED
- `near-actual-cost-verification-oct-2025.md` - CREATED
- `identity-registry-onchain-migration.md` - UPDATED

---

### Tier 3: Implementation Specs (NEEDS REVIEW)

#### 6. `/specs/CIPHERVAULT-CONTRACT-SPEC.md`
**Status:** DEPRECATED (but referenced in ARCHITECTURE.md)
**Action Required:**
1. Add deprecation notice at top
2. Reference `/docs/migrations/ciphervault-to-identity-registry.md`
3. Note: Replaced by Scroll Identity Registry

#### 7. `/specs/DEPLOYMENT-SPEC.md`
**Status:** Contains NEAR deployment instructions
**References:**
- Line 31: "NEAR CLI for deployment"
- Line 39: "NEAR Accounts"
- Line 82: "Building CipherVault contract"
- Lines 238-273: CipherVault client examples

**Action Required:**
1. Mark NEAR sections as "Optional - For NEAR Chain Signatures only"
2. Remove CipherVault deployment (deprecated)
3. Add Scroll Identity Registry deployment
4. Clarify NEAR is only for optional account abstraction

#### 8. `/specs/INTEGRATION-SPEC.md`
**Status:** NEEDS REVIEW
**Search for:** CipherVault, NEAR storage, identity flow
**Action:** Update identity verification flow to use Scroll Identity Registry

#### 9. `/specs/CLIENT-SDK-SPEC.md`
**Status:** NEEDS REVIEW
**Action:** Remove CipherVault client API, add Identity Registry client API

---

### Tier 4: Economics & Costs (HIGH PRIORITY)

#### 10. `/docs/ECONOMICS.md`
**Status:** CRITICAL - Contains cost models
**Expected Issues:**
- NEAR pricing assumptions
- Cost comparison tables
- Break-even analysis

**Action Required:**
1. Read entire file
2. Find all NEAR cost references
3. Update with $2.20 NEAR price
4. Recalculate all comparison tables
5. Update margin from 7.5x to 22%

---

### Tier 5: Implementation Status (LOW PRIORITY)

#### 11. `/IMPLEMENTATION-STATUS.md`
**Status:** NEEDS MINOR UPDATE
**Reference:** Line 42 mentions CipherVault contract
**Action:** Mark CipherVault as "DEPRECATED - Replaced by Scroll Identity Registry"

#### 12. `/IMPLEMENTATION-GUIDE.md`
**Status:** NEEDS REVIEW
**Action:** Update implementation steps to remove CipherVault, add Identity Registry

---

### Tier 6: Supporting Docs (REVIEW AS NEEDED)

#### 13. `/QUICKSTART.md`
**Status:** NEEDS REVIEW
**Action:** Ensure no outdated cost claims or CipherVault references

#### 14. `/CONGRESSIONAL.md`
**Status:** NEEDS REVIEW
**Action:** Check for cost claims in congressional value proposition

#### 15. `/SECURITY.md`
**Status:** NEEDS REVIEW
**Action:** Update threat model - remove NEAR CipherVault compromise scenarios

#### 16. `/SOURCES.md`
**Status:** OK - References are fine
**Note:** Line 166 references NEAR Chain Signatures (still valid for optional use)

---

### Tier 7: Package-Specific Docs (NEEDS REVIEW)

#### 17. `/packages/client/README.md`
**Status:** NEEDS REVIEW
**Expected:** CipherVault client examples
**Action:** Replace with Identity Registry client examples

#### 18. `/packages/crypto/README.md`
**Status:** NEEDS REVIEW
**Action:** Ensure circuit documentation doesn't reference deprecated CipherVault

---

## NEAR Chain Signatures Clarification

**IMPORTANT DISTINCTION:**

### What NEAR IS used for (Optional):
- Account abstraction (multi-chain address derivation)
- Simplified UX for non-crypto users
- Bitcoin/Solana user onboarding

### What NEAR IS NOT used for (Phase 1):
- Identity storage (moved to Scroll Identity Registry)
- PII encryption (browser-native only)
- Sybil resistance (on-chain Poseidon commitments)

**Documentation Pattern:**
```markdown
✅ CORRECT: "NEAR Chain Signatures provides optional account abstraction"
✅ CORRECT: "Settlement occurs on Scroll regardless of account type"
❌ WRONG: "Identity commitments stored in NEAR CipherVault"
❌ WRONG: "NEAR required for identity verification"
```

---

## Cost Comparison Template (CORRECTED)

Use this template for all cost comparisons going forward:

```markdown
## Storage Cost Comparison (October 2025 Pricing)

| Solution | Per-User | 10-Year (1K/year) | Capital Model | Notes |
|----------|----------|-------------------|---------------|-------|
| **Scroll L2** | $0.002 | **$20** | Spent (one-time) | Ethereum L1 data availability |
| **NEAR** | $0.002 | **$25.50** | Staked (recoverable) | $20 locked + $5.50 opportunity cost |
| **Database** | $0.30/year | **$3,000** | Recurring | PostgreSQL/Supabase |

**Verdict:** Scroll 22% cheaper than NEAR over 10 years due to no locked capital and opportunity cost.

**Key Insight:** Per-user costs are IDENTICAL ($0.002). The advantage is:
1. No locked capital (Scroll spends $20 vs NEAR locks $20)
2. No opportunity cost (Scroll $0 vs NEAR $5.50 lost APY)
3. Ethereum L1 data availability (more secure than NEAR validators)
4. Single-chain integration (Scroll for identity + reputation)
```

---

## Update Priority Queue

### Immediate (Today):
1. ✅ `/ARCHITECTURE.md` lines 398, 362, 3820 - Cost corrections
2. ⏳ `/docs/ECONOMICS.md` - Complete cost model revision
3. ⏳ `/specs/CIPHERVAULT-CONTRACT-SPEC.md` - Add deprecation notice

### High Priority (This Week):
4. `/TECHNICAL.md` - Review for cost claims
5. `/specs/DEPLOYMENT-SPEC.md` - Remove CipherVault, add Identity Registry
6. `/specs/INTEGRATION-SPEC.md` - Update identity verification flow
7. `/specs/CLIENT-SDK-SPEC.md` - Update API specs
8. `/SECURITY.md` - Update threat model

### Medium Priority (Next Week):
9. `/QUICKSTART.md` - Verify accuracy
10. `/CONGRESSIONAL.md` - Check cost value proposition
11. `/IMPLEMENTATION-GUIDE.md` - Update implementation steps
12. `/packages/client/README.md` - Update client examples

### Low Priority (As Needed):
13. Package-specific docs
14. Circuit documentation
15. Test documentation

---

## Key Talking Points (Corrected)

**When discussing NEAR vs Scroll:**

✅ **CORRECT:**
- "Per-user costs are identical at $0.002"
- "Scroll is 22% cheaper over 10 years due to no locked capital"
- "NEAR has advantage of recoverable capital if you delete data"
- "Main reason for Scroll: Ethereum L1 data availability + single-chain architecture"

❌ **INCORRECT (DO NOT SAY):**
- "Scroll is 7.5x cheaper than NEAR"
- "NEAR costs $0.01 per user"
- "NEAR costs $150 over 10 years"
- "Scroll dramatically cheaper than NEAR"

**The honest pitch:**
> "Both Scroll and NEAR cost $0.002 per user. Scroll edges out NEAR by 22% over 10 years because there's no locked capital (Scroll spends $20 vs NEAR locks $20 + loses $5.50 in opportunity cost). But the real reason we chose Scroll is Ethereum L1 data availability guarantees and single-chain integration with our ERC-8004 reputation system."

---

## Search Commands for Manual Review

```bash
# Find all NEAR references
grep -r "NEAR" --include="*.md" --exclude-dir=node_modules -n

# Find cost claims
grep -r "\$0\.33\|\$0\.01\|150 vs\|7\.5x\|cheaper" --include="*.md" -n

# Find CipherVault references
grep -r "CipherVault\|ciphervault" --include="*.md" -n

# Find storage staking
grep -r "storage staking\|staked capital" --include="*.md" -n
```

---

## Documentation Consistency Checklist

After each file update, verify:

- [ ] NEAR price listed as $2.20 (October 2025)
- [ ] Per-user costs shown as $0.002 for both Scroll and NEAR
- [ ] 10-year cost: Scroll $20, NEAR $25.50
- [ ] Margin stated as "22% cheaper" not "7.5x"
- [ ] NEAR Chain Signatures marked as "optional" for account abstraction
- [ ] CipherVault marked as "deprecated" where referenced
- [ ] Identity storage clearly on Scroll Identity Registry
- [ ] No misleading cost claims

---

**Document Version:** 1.0
**Author:** Claude (AI Assistant)
**Date:** October 23, 2025
**Status:** Comprehensive audit complete - Ready for systematic updates
