# Shadow Atlas Agents

Discovery and classification agents for Shadow Atlas Phase 1 (complete) and Phase 2 (planned). This replaces the older `AGENTS_README.md`; use this page as the entry point for all agent scripts and flows.

---

## Production Scripts (Phase 1)

### enumerate-layers.ts
**Status**: Production-ready
**Purpose**: Enumerate all layers from ArcGIS FeatureServer/MapServer services
**Performance**: 6.48 services/sec with adaptive concurrency (10-20 parallel)

**Usage**:
```bash
npx tsx enumerate-layers.ts data/hub_council_districts_enriched.jsonl data/enumerated_layers.jsonl
```

**Phase 1 Results**:
- Input: 7,194 services (94.5% with no geometry at service level)
- Output: 31,316 layers enumerated in 18m 36s
- Success rate: 99.5%
- Average: 4.3 layers per service

**Known Issue (Phase 2 P0)**:
- Feature counts reflect API maxRecordCount (1000 or 2000), not actual district counts
- Fix: Implement /query?where=1=1&returnCountOnly=true queries

---

### comprehensive-district-classifier.py
**Status**: Production-ready
**Purpose**: Classify layers into 20+ district types using structural pattern matching
**Approach**: Deterministic scoring based on field names, URL patterns, feature counts

**Usage**:
```bash
python3 comprehensive-district-classifier.py data/enumerated_layers.jsonl data/comprehensive_classified_layers.jsonl
```

**Phase 1 Results**:
- Input: 31,316 enumerated layers
- Output: 4,163 elected governance districts (13.3%)
  - 3,282 city councils (GOLD tier)
  - 246 state legislative (SILVER tier)
  - 230 school boards (SILVER tier)
  - 188 congressional (BRONZE tier)
  - 159 county commissions (SILVER tier)
  - 70 special districts (fire, library, utilities)

**Classification Logic**:
- Field validation: DISTRICT_ID, COUNCIL_MEMBER, REPRESENTATIVE fields
- URL patterns: "council", "ward", "district" in service paths
- Feature count heuristics: 5-50 typical for council districts (when fixed in Phase 2)
- Confidence scoring: 0.50-1.00 (structural validation strength)

**Tier System**:
- GOLD: City councils (high-priority for ZK proofs)
- SILVER: State legislative, school boards, county commissions
- BRONZE: Congressional, special districts
- UTILITY: Infrastructure districts (water, police, transit)
- REJECT: Parcels, zoning, census tracts, precincts

---

## Archived Experiments

### experiments/ml-ensemble-2025-11-25/
**Status**: Deferred (not deployed to production)
**Purpose**: ML ensemble (Random Forest + Gradient Boosting + Logistic Regression) for layer classification

**Training Performance**:
- Test accuracy: 94.3% on 432 expert-vetted samples
- AUC: 0.988
- Precision/Recall: 0.94/0.94 (weighted avg)

**Why Deferred**:
- Production confidence issue: 99.9% of predictions <80% confidence on real data
- Root cause: Training set biased toward clear examples, production has ambiguous cases
- Structural classifier: 90.8% agreement with ML on high-confidence subset
- Decision: Ship deterministic classifier (auditable, zero inference cost)

**Future Work**:
- Retrain on production-representative samples with confidence calibration
- Deploy if ML boosts confidence >10% on borderline cases (60-80% structural scores)

**Files**:
- ml_ensemble_metadata.json: Model architecture and feature list
- ml-training-results.log: Training performance metrics
- ml_ensemble_*.pkl: Trained model artifacts (not deployed)

---

### experiments/prototypes-2025-11/
**Status**: Early prototypes (superseded by production scripts)
**Purpose**: Initial exploration of Hub API, layer enumeration, classification heuristics

**Key Learnings**:
- Hub dataset has 94.5% services without geometry at service level
- Layer enumeration unlocks 20,000+ layers from 7,000 services
- Field-based classification is deterministic and auditable
- Feature counts from API are unreliable (maxRecordCount limits)

---

## Phase 2 Scripts (Planned)

See PHASE2_ROADMAP.md for complete implementation plans.

### P0: enumerate-layers-with-counts.ts (CRITICAL)
**Purpose**: Re-enumerate layers with actual feature counts (not API limits)
**Implementation**: Add /query?where=1=1&returnCountOnly=true queries
**Estimated effort**: 2-3 hours + 20 minutes runtime

### P1: census-place-integration.ts
**Purpose**: Fetch TIGER/Line place boundaries and spatial join with districts
**Implementation**: Parse shapefiles, convert to GeoJSON, point-in-polygon tests
**Estimated effort**: 4-6 hours

### P2: direct-city-discovery.ts
**Purpose**: Systematic crawl of top 1,000 US cities by population
**Implementation**: URL pattern generation + service enumeration + classification
**Expected yield**: 2,000-3,000 additional council districts
**Estimated effort**: 6-8 hours

### P3: state-portal-crawlers/
**Purpose**: Crawl all 50 state data portals for municipal datasets
**Implementation**: CKAN API, Socrata API, custom portal scrapers
**Expected yield**: 500-1,000 mid-tier city datasets
**Estimated effort**: 8-12 hours (batched by API type)

---

## Documentation

- **DISCOVERY_STRATEGY.md**: Complete multi-strategy discovery approach with Phase 1 results
- **PHASE2_ROADMAP.md**: Phase 2 implementation plan (P0-P3 priorities, timelines, success metrics)

---

## Data Files

**Production Dataset**:
- data/comprehensive_classified_layers.jsonl (31,316 layers, 4,163 governance districts)

**Intermediate Data**:
- data/enumerated_layers.jsonl (raw layer enumeration output)
- data/classification-results.log (human-readable classification summary)
- data/enumeration-optimized.log (layer enumeration performance log)

**Training Data** (archived):
- data/ml_training_clean_labels.jsonl (432 expert-vetted samples)
- data/ml-training-results.log (ensemble training metrics)
- data/ml_ensemble_metadata.json (model architecture)

---

## Development Notes

**TypeScript Scripts**:
- Use `npx tsx <script>.ts` for execution (TypeScript without compilation)
- Parallel execution: Adaptive concurrency with p-limit (10-20 concurrent by default)
- Error handling: Retry logic with exponential backoff for rate limits

**Python Scripts**:
- Use Python 3.10+ with pandas, scikit-learn, numpy
- Classification output: JSONL format (one layer per line)
- Logging: Human-readable summaries to stdout, structured data to files

**Performance**:
- Layer enumeration: ~6 layers/sec (31,316 layers in 87 minutes)
- Classification: Near-instant (in-memory, deterministic rules)
- Count queries (Phase 2): Expected ~6 queries/sec (31,316 layers in 87 minutes)

---

**Phase 1 Status**: Complete (2025-11-25)
**Phase 2 Target**: 2025-12-08
**Shadow Atlas v1.1.0 Release**: 2025-12-09
