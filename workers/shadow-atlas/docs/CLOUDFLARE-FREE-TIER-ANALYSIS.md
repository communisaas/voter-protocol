# Cloudflare Free Tier Analysis for Shadow Atlas

**Date**: 2025-11-09
**Status**: ✅ Validated - Shadow Atlas CAN run on free tier with constraints
**Research Source**: Cloudflare Developer Documentation (2025)

---

## Executive Summary

**Can Shadow Atlas run on Cloudflare's free tier?**

**Answer**: ✅ **YES for monthly operations, ❌ NO for initial bootstrap**

- **Monthly operations (PIP API)**: Fully covered by free tier ($0/month)
- **Initial bootstrap**: Requires Durable Objects ($90.45 one-time) - **MUST upgrade to Workers Paid**
- **Quarterly updates**: Requires Durable Objects ($9.24/quarter) - **MUST stay on Workers Paid**

**Recommendation**: Start on Workers Paid plan ($5/month minimum) from Day 1.

---

## Cloudflare 2025 Free Tier Limits (Validated)

### Workers Free Plan

| Service | Free Tier Limit | Reset Period |
|---------|----------------|--------------|
| **Workers Requests** | 100,000 requests/day | Daily (00:00 UTC) |
| **CPU Time** | 10ms per request | Per request |
| **D1 Rows Read** | 5 million/day | Daily (00:00 UTC) |
| **D1 Rows Written** | 100,000/day | Daily (00:00 UTC) |
| **D1 Storage** | 5 GB total | Account-wide |
| **R2 Storage** | 10 GB/month | Monthly |
| **R2 Class A Ops** | 1 million/month | Monthly |
| **R2 Class B Ops** | 10 million/month | Monthly |
| **R2 Egress** | **UNLIMITED (zero fees)** | Forever |
| **Durable Objects** | 100,000 requests/day | Daily (00:00 UTC) |
| **DO Duration** | 13,000 GB-seconds/day | Daily (00:00 UTC) |
| **DO Storage** | 5 GB total | Account-wide |

**Key Finding**: R2 egress is **ALWAYS FREE** (Cloudflare's killer competitive advantage vs AWS S3).

---

## Shadow Atlas Usage Analysis

### Phase 1: Initial Bootstrap (One-Time)

**Workload**:
- Download 19,616 GeoJSON files from municipal portals
- Average 30 seconds per download (Durable Objects required for >30s CPU limit)
- Total: 158 hours of Durable Object duration

**Free Tier Check**:

| Resource | Usage | Free Limit | Exceeds? | Cost if Paid |
|----------|-------|------------|----------|--------------|
| Durable Objects Requests | 19,616 | 100,000/day | ❌ No (196 days) | $0 |
| DO Duration (GB-seconds) | 72,960 | 13,000/day | ✅ **YES (6 days)** | **$90.32** |
| R2 Storage | 4.8 GB | 10 GB | ❌ No | $0 |
| R2 Class A Ops (uploads) | 19,616 | 1M/month | ❌ No | $0 |
| D1 Writes | 19,616 | 100k/day | ❌ No | $0 |

**Verdict**: ❌ **Bootstrap CANNOT run on free tier**
- Durable Objects duration exceeds free tier by 5.6× (72,960 vs 13,000 GB-seconds/day)
- Would take 6 days to complete on free tier (hitting limit each day)
- **MUST upgrade to Workers Paid** ($5/month minimum)

**Calculation**:
```
19,616 municipalities × 30s avg × 0.128 GB memory = 72,960 GB-seconds
Free tier: 13,000 GB-seconds/day
Overage: 72,960 - 13,000 = 59,960 GB-seconds
Cost: 59,960 / 1,000,000 × $12.50 = $0.75 (first day)
Total: 6 days × $0.75 = $4.50 overage + $5 base = $9.50 total for bootstrap
```

**Wait, this doesn't match our $90.45 bootstrap cost!**

Let me recalculate with correct assumptions:
- Workers Paid includes 1M DO requests/month
- DO duration charges: $12.50 per million GB-seconds
- Total GB-seconds: 72,960
- Cost: (72,960 / 1,000,000) × $12.50 = **$0.91**

**MUCH cheaper than estimated!** Our original $90.32 calculation was based on 570,000 seconds, not GB-seconds.

**Corrected Bootstrap Cost**: $0.91 (Durable Objects) + $5 (Workers Paid monthly) = **$5.91 total**

---

### Phase 2: Monthly Operations (PIP API)

**Workload**:
- 1 million PIP API requests/month
- Each request: D1 bbox query + R2 GeoJSON fetch (cached)
- No Durable Objects (PIP is fast <50ms)

**Free Tier Check**:

| Resource | Usage | Free Limit | Exceeds? | Cost |
|----------|-------|------------|----------|------|
| Workers Requests | 1M/month = 33k/day | 100k/day | ❌ No | $0 |
| D1 Reads (bbox) | 1M bbox queries = 1M rows | 5M/day | ❌ No | $0 |
| R2 Class B Ops | 1M gets × 5% miss = 50k | 10M/month | ❌ No | $0 |
| R2 Egress | 50k × 2MB = 100 GB | UNLIMITED | ❌ No | $0 |
| R2 Storage | 9.6 GB (2 versions) | 10 GB | ❌ No | $0 |

**Verdict**: ✅ **Monthly operations CAN run on free tier** ($0/month)
- All usage well within limits
- Edge caching reduces R2 hits by 95%

---

### Phase 3: Quarterly Updates (Every 3 Months)

**Workload**:
- Re-fetch 1,900 municipalities (10% churn from redistricting)
- Average 30 seconds per download
- Total: 15.8 hours of Durable Object duration

**Free Tier Check**:

| Resource | Usage | Free Limit | Exceeds? | Cost if Paid |
|----------|-------|------------|----------|--------------|
| DO Duration | 7,296 GB-seconds | 13,000/day | ❌ No | $0 |
| R2 Class A Ops | 1,900 uploads | 1M/month | ❌ No | $0 |
| D1 Writes | 1,900 | 100k/day | ❌ No | $0 |

**Verdict**: ✅ **Quarterly updates CAN run on free tier** ($0/quarter)
- Durable Objects usage: 7,296 / 13,000 = 56% of daily free limit
- Can run quarterly updates without hitting limits

**Wait, this contradicts our $9.24/quarter estimate!**

**Corrected**: If we're on Workers Paid (required for bootstrap), quarterly updates are still **included in base $5/month**.

**Corrected Quarterly Cost**: $0 overage (included in Workers Paid base)

---

## Storage Analysis: D1 Capacity

**Current Schema**:
- `municipalities`: 19,616 rows × ~500 bytes = 9.8 MB
- `municipality_state`: 19,616 rows × ~300 bytes = 5.9 MB
- `sources`: 38,000 rows × ~800 bytes = 30.4 MB
- `artifacts`: 19,616 rows × ~400 bytes = 7.8 MB
- `district_bboxes`: 200,000 rows × ~150 bytes = 30 MB
- `events`: 100,000 rows × ~1KB = 100 MB

**Total**: ~184 MB (3.7% of 5GB free limit) ✅

**Future Concern**: `district_addresses` table (500M rows)
- Estimated size: 500M × 200 bytes = 100 GB
- **EXCEEDS D1 free tier by 20×**
- **MUST shard by state** or use external storage

**Recommendation**: Store address→district mapping in R2 as Parquet files, not D1.

---

## Revised Cost Structure (2025 Validated)

### Scenario 1: Free Tier Only (NOT VIABLE)

**Limitations**:
- ❌ Cannot run initial bootstrap (DO duration exceeds limit 5.6×)
- ❌ Cannot store 500M addresses in D1 (20× over storage limit)
- ✅ CAN run monthly PIP API (fully within limits)

**Verdict**: **NOT VIABLE** - Bootstrap is blocked.

---

### Scenario 2: Workers Paid ($5/month minimum)

**Included in $5/month base**:
- 1 million DO requests/month
- Unlimited DO duration (pay-as-you-go after included)
- 10M Workers requests/month
- All D1/R2 free tier limits (unchanged)

**Costs**:

| Phase | Frequency | Overage Cost | Notes |
|-------|-----------|--------------|-------|
| **Bootstrap** | One-time | $0.91 | 72,960 GB-seconds ÷ 1M × $12.50 |
| **Monthly Ops** | Monthly | $0 | All within free tier |
| **Quarterly Update** | Every 3 months | $0 | 7,296 GB-seconds (within free daily limit) |
| **Base Fee** | Monthly | $5 | Workers Paid minimum |

**Annual Total**:
- **Year 1**: $5 × 12 + $0.91 = **$60.91**
- **Year 2+**: $5 × 12 = **$60/year**

**Comparison to Previous Estimate**:
- Previous: $127.33 Year 1, $36.88 Year 2+
- Actual: $60.91 Year 1, $60 Year 2+
- **Error source**: Overstated Durable Objects cost (seconds vs GB-seconds confusion)

---

### Scenario 3: Address Storage Optimization

**Problem**: `district_addresses` table (500M rows) exceeds D1 5GB limit.

**Solution**: Store in R2 as compressed Parquet files instead.

**Storage**:
- 500M addresses × 200 bytes = 100 GB raw
- Parquet compression: 60% savings = 40 GB
- R2 cost: $0.015/GB × 40 GB = $0.60/month

**Query Strategy**:
- Load state-level Parquet file on-demand (e.g., `addresses-ca.parquet`)
- Parse in Worker (DuckDB WASM or custom parser)
- Filter by municipality + bbox
- Return relevant addresses

**Impact**: +$0.60/month storage, but avoids D1 capacity limit entirely.

---

## Final Recommendations

### 1. Start on Workers Paid from Day 1

**Why**:
- Bootstrap requires Durable Objects duration beyond free tier
- $5/month is negligible for production infrastructure
- Includes 1M DO requests (sufficient for quarterly updates)

**Action**: Sign up for Workers Paid before running bootstrap.

### 2. Store Addresses in R2, Not D1

**Why**:
- 500M addresses exceed D1's 5GB limit by 20×
- R2 scales to petabytes with zero egress fees
- Parquet compression saves 60% storage

**Action**: Implement Parquet export/import for address data.

### 3. Monitor Free Tier Limits Daily

**Why**:
- Limits reset at 00:00 UTC daily
- Exceeding limits = API errors (not graceful degradation)

**Action**: Set up Cloudflare Analytics alerts for 80% threshold.

### 4. Batch Quarterly Updates Overnight

**Why**:
- 7,296 GB-seconds = 56% of daily DO free limit
- Running during low PIP traffic avoids contention

**Action**: Schedule cron trigger for 2 AM UTC.

---

## Honest Cost Comparison

| Assumption | Previous Estimate | 2025 Reality | Difference |
|------------|------------------|--------------|------------|
| **Bootstrap** | $90.45 | $0.91 | **-$89.54** (99% cheaper!) |
| **Quarterly Update** | $9.24 | $0 | **-$9.24** (free with base plan) |
| **Monthly Ops** | $0 | $0 | Correct ✅ |
| **Workers Paid Base** | Not included | $5/month | +$60/year |
| **Year 1 Total** | $127.33 | **$60.91** | -$66.42 (52% cheaper) |
| **Year 2+ Total** | $36.88 | **$60** | +$23.12 (63% more) |

**Key Insight**: Workers Paid base fee ($60/year) is the dominant cost. Durable Objects overages are negligible.

---

## Final Answer: Is Shadow Atlas Free on Cloudflare?

**Short Answer**: ❌ **NO - Requires Workers Paid ($5/month)**

**Breakdown**:
- ✅ PIP API can run on free tier ($0/month)
- ❌ Bootstrap requires Durable Objects beyond free tier (+$0.91 one-time)
- ✅ Quarterly updates fit within free tier ($0/quarter)
- ❌ Workers Paid minimum fee required ($5/month = $60/year)

**Annual Cost**: **$60.91 Year 1, $60/year ongoing**

**This is MUCH cheaper than previous estimate** ($127.33 → $60.91 for Year 1), but **not free**.

---

## What Changed from COST-VALIDATION-2025.md?

**Previous calculation ERROR**:
- Confused "seconds" with "GB-seconds" for Durable Objects
- Overstated bootstrap cost by 99× ($90.32 should be $0.91)
- Missed that Workers Paid base fee ($5/month) covers most usage

**Corrected reality**:
- Durable Objects are CHEAP (19k downloads = $0.91)
- Workers Paid base fee is the real cost ($60/year)
- Quarterly updates are FREE (within daily DO limit)

**Net result**: Shadow Atlas costs **$60/year**, not $127/year (52% cheaper than estimated).

---

**Status**: ✅ Shadow Atlas is financially viable on Cloudflare at $60/year ($5/month Workers Paid).
