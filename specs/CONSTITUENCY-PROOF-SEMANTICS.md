# Constituency Proof Semantics

**Status:** spec, ratified G-phase 2026-05-03 (commits pending)
**Audience:** anyone touching the Tree 2 cell→district map, mDL verify flow, witness-encryption resolver, or the Tier-* receipt UI
**Companion:** `commons/memory/cypherpunk_static_bundles.md` (the "ship the data, drop the queries" principle for boundaries)

---

## 1. The bugs

### Bug A — mDL flow discards ZIP-derived cellId

`POST /api/identity/verify-mdl/verify` derives a cellId from the wallet's postal+city+state via Nominatim (`mdl-verification.ts:401`) and returns it to the client (`verify/+server.ts:208`). **The wallet does NOT disclose street address** — `mdl-verification.ts:1353-1357` calls `resolveAddress({ street: '', city, state, zip })`. The cellId is therefore the H3 cell containing the geocoded ZIP/city centroid, not the user's actual residence.

The client throws it away anyway. `IdentityVerificationFlow.svelte:154` calls `findDistrictHex(verifiedDistrict)` (looking up by *district*, not cell), then `getFullCellDataFromBrowser({ districtHex, slot: 0 })` which routes to `findCellForDistrict` (`browser-client.ts:124`). That function picks a **random** chunk associated with the district (`browser-client.ts:168-169`: `// Pick a random chunk to maximize anonymity`) and returns the first cell entry in that chunk that's mapped to the user's district.

The leaf is then `Poseidon2_H4(userSecret, randomCellId, registrationSalt, authorityLevel=5)` — bound to a random cell of the right district, **not the user's ZIP-derived cell**. The constituency anchor is severed.

### Bug A.1 — boundary-cell mismatch hidden (and limited in what it can detect)

If we plumb the ZIP-derived cellId through (G1), then check whether Tree 2's slot[0] for that cellId matches the district returned by the same geocoder pass, we surface a specific failure mode: **the H3 quantization at boundaries.** The geocoder returns (district, cellId) from one polygon-hit operation. Tree 2's slot[0] for that cellId is whatever district was assigned to the cell at build time (centroid-based). When the ZIP centroid sits in a sliver of cell C that's mapped to district D, but the centroid itself polygon-hits district D', the two answers disagree.

This is **NOT a "two oracles disagree" signal.** It's H3 quantization noise at boundaries, derived from a single dataset. What it catches: "this user's ZIP centroid is in a hex whose Tree 2 mapping doesn't match where the centroid actually polygon-hits." That's still useful — it tells us when our cell→district mapping is wrong for this user — but the spec must not overclaim it as cross-credential reconciliation.

### Bug B — Tier-0 has no oracle at all

For unverified users, the cell→district mapping *is* the district claim. Lat/lng → H3 cell → Tree 2 slot[0] → district. If the cell straddles a boundary, the proof is sound at the cell level but the constituency claim may be wrong. There is no second polygon-hit to cross-check against. Bug B is real but addressing it requires either (a) a measurement to size the impact (G3) or (b) accepting a probabilistic-claim label and surfacing it (G5).

---

## 2. Tier semantics (corrected, honest)

| Tier | Constituency anchor | What's actually attested | Epistemic status |
|---|---|---|---|
| **T0 (anonymity-cell)** | User's H3 res-7 cell → Tree 2 slot[0] mapping | Lat/lng provided by client; we map it to a cell and Tree 2 says which district that cell belongs to. | **Geocoded, cell-approximate.** Sound at the cell level; constituency claim approximate at boundaries. No external attestation of the address. |
| **T3+ (ZIP-attested)** | mDL/passkey-attested ZIP+city+state → Nominatim → H3 cell, AND Tree 2 slot[0] for that cell == Nominatim's polygon-hit district | State-issued credential attests the ZIP+city+state was on the user's ID *at issuance time* (driver's license renewal cadence: 4-8 years). District is derived from that ZIP+city+state via the same geocoder. | **ZIP-attested (issuance-vintage).** Stronger than T0: the ZIP+city+state has an admin signature. Weaker than the spec previously claimed: the user's *current address* is not attested; ZIP centroids span congressional districts in many cases. |

### What T3+ does NOT mean

- It does NOT mean "your real-time street address is admin-attested." mDL fields are ZIP+city+state. Street is empty in the geocoder call.
- It does NOT mean "your address is current as of today." mDL is bound to your last DL renewal. People move.
- It does NOT mean "two independent oracles agreed on your district." Both the district and cellId come from one Nominatim call.

### What T3+ DOES mean (the actually-true statement)

- The ZIP+city+state on the wallet's mDL was admin-signed at issuance.
- The cell→district mapping in Tree 2 for the cell containing that ZIP centroid is consistent with where that centroid polygon-hits in the same atlas.
- The user's leaf binds to that specific cell (not a random cell in the district).

That's all. We sell that, not more.

---

## 3. Privacy model (corrected)

The previous draft claimed "intersection: nothing new" comparing the parent-chunk fetch to what the wallet has already disclosed. That's wrong about the threat model. The wallet discloses to the *proof verifier* (downstream); the parent-chunk fetch is observable by the *atlas-server operator* (us). Different adversaries.

Honest statement of what changes when we move T3+ from random-chunk to real-chunk:

| Adversary | Random-chunk (today) | Real-chunk (G1) | Net change for T3+ |
|---|---|---|---|
| Wallet issuer | sees nothing about chunk fetch | sees nothing | unchanged |
| Proof verifier (smart contract) | sees public inputs: districts[24], authorityLevel, etc. | sees public inputs: districts[24], authorityLevel, etc. | unchanged (proof shape identical) |
| Atlas operator (R2 logs) | sees IP fetched chunk-of-some-cell-in-district-X | sees IP fetched chunk-of-cell-containing-this-ZIP-centroid (chunk = H3 res-3 parent ≈ 12,400 km², state-sized) | **leaks more** to atlas operator at chunk granularity, but the chunk is so coarse that the new linkage is "user is somewhere in this state-sized region" |
| Network observer between user and CDN | sees TLS-wrapped fetch, parent-chunk URL pattern | sees TLS-wrapped fetch, parent-chunk URL pattern | unchanged for opaque content |

The trade we accept: atlas operator (us) sees the user's ZIP-centroid parent chunk for T3+. The parent is at H3 resolution 3 (`cellToParent(h3Cell, 3)` in `browser-client.ts:222`), which is roughly state-sized (~12,400 km²). The new linkage is "user is somewhere in this state-sized region" — strictly weaker than what the user's *next CWC delivery* will reveal anyway (street address forwarded to Congress). We commit to bounded log retention regardless (state in operator-runbook + UI). The previous draft of this spec said "~1 km² parent area" — that was wrong by 4 orders of magnitude; the actual privacy story is far better than the wrong number suggested.

For T0 (no wallet attestation), random-chunk pattern is preserved — the privacy concern there is genuine.

---

## 4. The fix shape

### G1 — plumb cellId end-to-end (T3+ only)

- `IdentityVerificationFlow.svelte` already has `data.cellId` from verify-mdl. Pass it into `triggerShadowAtlasRegistration` as a typed parameter. **Canonicalize encoding** at the boundary: the server returns an H3 cell string (per `client.ts:401` returning `cell_id: cellIndex` from `latLngToCell`); the chunk index uses BN254 field hex; the `h3Index` reverse-lookup map bridges them.
- New `getFullCellDataFromBrowser({ cellId: <H3 string> })` lookup mode in `browser-client.ts`: derive parent chunk key, fetch chunk, use `chunk.h3Index` to resolve internal cellId, return that entry.
- `triggerShadowAtlasRegistration`: T3+ uses cellId path; T0 keeps random-chunk path. Branch on `authorityLevel`, not on cellId presence (defense-in-depth: a future bug shouldn't downgrade T3+ to T0 silently).
- Leaf `Poseidon2_H4(userSecret, cellId, registrationSalt, authorityLevel)` binds to the user's ZIP-derived cell. Constituency anchor is real (within the limits of "ZIP-derived").

### G2 — boundary-cell mismatch detection, MARK don't BLOCK

Brutalist finding: hard-fail without a recovery path is structural denial-of-service for boundary residents. Spec changes from earlier draft.

- After `getFullCellDataFromBrowser({ cellId })` returns the entry, verify `entry.d[0] === expectedDistrictHex`.
- On mismatch, **DO NOT block registration.** Instead:
  - Set a `cellStraddles: true` field on the credential (stored alongside `cellId` in the user's IndexedDB credential and in the server-side `shadowAtlasRegistrations` row).
  - Continue registration using the geocoder's polygon-hit district (which is the more precise one for the user's ZIP centroid) and the cellId (binds the leaf to the user's actual hex).
  - The leaf's `districts[0]` public input commits to the polygon-hit district. The Tree 2 path proves the cellId is in slot[0]=Tree2-district. **These can disagree in the proof.** The verifier learns "this cell is in T2-district, but the proof asserts polygon-district." That's a tell — but it's an honest tell: the user IS in a boundary cell.
  - Receipt UI surfaces `cellStraddles: true` as "boundary-cell" tier-modifier (G5).
- Why this is the right shape: it preserves T3+ for boundary residents (no DoS), it makes the disagreement *visible in the proof* (verifier can downweight), and it gives G3's measurement a real surface (boundary registrations are tagged in the audit log).
- Hard-fail mode kept ONLY when the cellId itself is invalid or unfindable (chunk fetch returns null). That's a different class of failure (atlas data corruption) and rightly blocks.

### G3 — Tier-0 boundary-population measurement (per-boundary-pair, parallel)

Brutalist finding: per-district aggregates double-count cross-boundary populations.

- Cross TIGER blocks × H3 res-7 cells × district polygons. For each cell whose member blocks span ≥2 districts, compute the unique pair `(district_A, district_B)` (or N-tuple if the cell crosses 3+).
- Output: `source/v{tag}/us/cd-boundary-population.json` listing per-pair affected populations + ACS vintage + TIGER vintage for reproducibility.
- Apply k-anonymity threshold: pairs with <k=10 affected residents collapsed into "minor pair" aggregate. Rationale: a pair `(CA-12, CA-13)` with 3 affected residents is too narrow to publish.
- This is the audit number for "is the H3 sliver problem real, and where is it concentrated?" Without it, T0-side decisions (G5 labeling, future fix prioritization) are speculation.

### G4 — TEE migration interface (launch-optional, with operational SPOF acknowledgment)

- Formalize `ConstituentResolver` interface in `tee/types.ts`: `(witness, expectedDistrict) → AuthoritativeDistrict`. Make it explicit; `LocalConstituentResolver` already conforms implicitly.
- `NitroEnclaveResolver` skeleton: HTTP client to `TEE_PUBLIC_KEY_URL` + attestation-chain verification (deferred). **Throws clearly when enclave is unreachable**, no silent fallback. (Brutalist: this is correct semantics — falling back undermines the attestation contract.)
- `tee/index.ts:24` selects via env: `TEE_PUBLIC_KEY_URL` set → Nitro, unset → Local. Single-line swap.
- **Operational SPOF acknowledged in spec, not hidden in code.** Single Nitro endpoint = all T3+ submissions blocked during outage. 30-min witness TTL (`submissions.ts:20`) means a 45-min outage expires queued witnesses. Mitigation paths (NOT all required at launch, but documented):
  - Multi-region active-active enclaves with attestation pinning.
  - Witness TTL extension during declared TEE outages (operator switch).
  - Receipt-tier modifier: T3+ proofs verified against Local resolver labeled "operator-attested"; against Nitro labeled "TEE-attested." Different epistemic claims; receipts must distinguish.
- Trust model in doc-comments:
  - **Local:** "in-process plaintext handling. JS strings cannot be reliably zeroed. Trust the operator not to log/persist. Verifiable via reproducible Tree 2 build from public TIGER inputs. Atlas inputs publicly auditable; resolver computation is not."
  - **Nitro:** "hardware-isolated, attested. Trust the attestation chain AND the input snapshot CID + deterministic logic. Attestation says the code ran; verifiers can independently rebuild the inputs."

### G5 — UI honesty pass (with corrected labels)

Brutalist finding: "anonymity-cell (probabilistic)" implies the proof is uncertain (it's not — the proof is sound). Re-word to describe what's actually probabilistic (the constituency claim).

| Tier | Receipt label |
|---|---|
| T0 | "verified constituent (geocoded-district, cell-approximate)" |
| T3+ Local resolver, no boundary-straddle | "verified constituent (ZIP-attested, operator-resolved)" |
| T3+ Local resolver, boundary-straddle | "verified constituent (ZIP-attested, boundary-cell)" |
| T3+ Nitro resolver, no boundary-straddle | "verified constituent (ZIP-attested, TEE-resolved)" |
| T3+ Nitro resolver, boundary-straddle | "verified constituent (ZIP-attested, boundary-cell, TEE-resolved)" |

Receipt copy includes a one-liner explanation of the modifiers, accessible by hover/click. The cell→district mapping documentation surfaces "approximate, not legal-sound" wherever users actually see it.

User-facing copy validation: ship a draft to 3-5 non-technical reviewers (campaign staffers, civic ops contacts) before final landing. "Honest" without comprehension-testing is just self-deception.

---

## 5. Atlas-version migration (NEW SECTION — was missing)

Brutalist finding: spec assumed one-shot registration. Tree 2 rotates quarterly; existing leaves bind to old roots; users must re-register. This compounds with G2's boundary-mismatch handling.

### Lifecycle

- Tree 2 root has 4 states (per SA-004 SnapshotAnchor): PENDING → ACTIVE → DEPRECATED → REVOKED.
- During DEPRECATED, the proof verifier accepts both old and new roots; users have a window (TBD: 30-90 days) to re-register against the new root.
- After REVOKED, only the new root is accepted. Un-migrated users must re-verify via mDL or address.

### What G1+G2 ship for migration

- The credential row (server-side `shadowAtlasRegistrations` and client IndexedDB) stores `atlasVersion: 'v20260503'` alongside `cellId` and `cellStraddles`.
- On atlas update (e.g., `v20260801` lands), the client compares the user's stored `atlasVersion` to the manifest's `currentVersion`. If different and the prior version is DEPRECATED:
  - **Auto-prompt re-verify** (mDL re-presentation; new leaf in Tree 1 against new Tree 2 root).
  - The new registration carries forward the user's `identityCommitment` (sybil-stable across atlas versions; same commitment hash).
  - If `cellStraddles` was true in v_n and false in v_{n+1}, that's a *correction* — the new atlas resolved the boundary issue, and the user moves to the un-straddled tier. Worth signaling.
  - If `cellStraddles` was false in v_n and true in v_{n+1}, the atlas changed assignment. User isn't penalized for atlas drift; they re-register transparently.
- Re-registration that hits a *new* `BOUNDARY_CELL_MISMATCH` is handled per G2 (mark, don't block). Quarterly atlas isn't a blocker for boundary residents because we don't block at all.

### Acceptance criterion (added)

- Re-registration UX is specified for atlas v_n → v_{n+1} transition, including: stale credential detection, identity-commitment carry-forward, cellStraddles delta surfacing, and rate-limit reset (so the prior verification's session counter doesn't block the new attempt).

---

## 6. The brutalist reframe (informational, sharper)

Constituency is a legal/administrative fact, not a geographic one. State Secretary of State offices maintain address → precinct → district registries on a different cadence than Census redistricting. **Polygons are an approximation**; mDL+ZIP+geocoder is an approximation of an approximation; H3 cells are a quantization of that approximation. We are several layers from the actual administrative truth.

The right primitive at higher tiers (research direction) is **mDL-attested address → state precinct registry → district id**, with the registry root committed quarterly via SnapshotAnchor. Geography becomes visualization, not proof.

This reframe is **not roadmap.** Year-plus horizon. State SOS APIs are heterogeneous and politically fraught. G-phase ships against the polygon-hit oracle and is honest about what it ships. G4's interface reserves the swap point — `(witness, expectedDistrict) → AuthoritativeDistrict` doesn't promise polygon-hit; it promises *some* attested resolution.

### Tactical debt: G2's reconciliation logic IS polygon-specific

If we ever swap to registry lookup, G2's `entry.d[0] === expectedDistrictHex` comparison becomes nonsensical (registry is sovereign; Tree 2 is the wrong oracle). The G2 boundary-mark logic must be redesigned at that point. Document it: G2 is current-resolver-specific; registry resolver requires its own reconciliation policy or removes the spatial constraint entirely.

---

## 7. What this spec doesn't cover

- **Registry integration with state SOS offices** (research direction, year+ horizon).
- **H3 cell deprecation in favor of district-membership ZK** (research direction, ~10-50x current circuit cost; not roadmap).
- **Tier-0 sliver fix.** Deferred to G3 measurement first. The fix shape (if any) depends on the per-boundary-pair numbers G3 produces.
- **Non-US districts.** `ca/`, `gb/`, `au/` reserved in path scheme but unpopulated. Same fix shape applies when those layers light up.
- **Nitro Enclave actual deployment.** G4 ships the swap point; the enclave is an ops effort beyond this spec.
- **mDL street-level disclosure.** Some wallets/states support it; AAMVA mDL standard's `resident_address` is optional. If we ever request it, T3+ semantics shift from ZIP-attested to address-attested. Out of scope for G-phase.
- **Real-time address verification** (e.g., utility-bill OCR). Different oracle; different security model.

---

## 8. Acceptance criteria

A user with a fresh mDL verification:
- Receives `cellId` (H3 cell containing ZIP centroid) in the verify-mdl response (✅ already today).
- The client uses *that* cellId, not a random one (G1).
- Encoding canonicalization: H3 string → BN254 field hex via `chunk.h3Index` (G1).
- The fetch traffic reveals the parent chunk of the user's ZIP-centroid cell (G1, with corrected privacy framing in §3).
- The leaf binds to the user's ZIP-derived cell (G1).
- If the cell's Tree 2 slot[0] disagrees with the geocoder's polygon-hit district, registration **continues with cellStraddles=true marker**, NOT hard-fail (G2 corrected).
- The receipt label distinguishes ZIP-attested (T3+) from geocoded-district (T0), AND surfaces resolver type (Local vs Nitro), AND surfaces boundary-cell modifier (G5).
- The system documentation describes the trust model honestly: today, resolver is non-TEE; deployment of Nitro is a swap-in (G4).
- Atlas v_n → v_{n+1} re-registration UX is specified (§5).
- Observability: BOUNDARY_CELL marker rate is monitorable; ops can detect when X% of T3+ verifications surface as boundary-cell.

A measurement artifact exists answering "how many users does the H3 sliver problem affect at T0, by boundary pair?" before any T0-side fix is scoped (G3, per-boundary-pair aggregates).

The brutalist (or self-review against verified file evidence) signs off on each cycle before the next begins.

---

## 9. h3Index trust assumption (G9)

The chunk's `h3Index` reverse-map (H3 string → cellId entry key) and `cells` map (entry key → CellEntry with BN254 hex) are both **unauthenticated server input**. A compromised atlas operator could swap `h3Index["872..."]` to point at a different cell's entry, redirecting the user's leaf to bind to a different cellId than their actual H3 cell.

**Trust tier**: same as the operator's trust to publish correct Tree 2 SMT data. The atlas is operator-built quarterly; a compromised pipeline could equally publish a malicious Tree 2 root, malicious district polygons, or malicious h3Index entries. h3Index is not a separately-attackable surface beyond the existing trust assumption.

**Mitigations in place**:
- **G2 visibility**: if h3Index redirects to a cell whose slot[0] disagrees with the verified district, the credential is marked `cellStraddles=true`. The user sees the divergence in receipts (G5). Not silently exploitable.
- **G7r option-(c) routing**: delivery routes from `witness.districts[0]` (cryptographically bound to cellId via SMT inclusion), so a redirected entry routes to whatever district the atlas claimed. Combined with G2, the user is already informed.
- **Reproducibility**: the atlas build is reproducible from public TIGER inputs. Anyone can rebuild and verify the chunks against an alternative source.

**Real fix (deferred)**: Merkle inclusion proofs over h3Index entries against the chunk's cellMapRoot. The browser client would verify the (H3, BN254-cellId) tuple against an inclusion proof rooted at cellMapRoot. Schema + build-pipeline + client-validation lift; not justified by the residual risk after G2+G7r.

This trust assumption is documented in `commons/src/lib/core/shadow-atlas/browser-client.ts:findCellByH3Index` so future contributors don't have to re-derive it.

## 10. Pre-existing bug surfaced by G1r — encoding split in TEE delivery

`resolver-gates.ts:330` compares `derivedCellId` (H3 string from `resolveAddress`) to `witnessCellId` (BN254 field hex from `credential.cellId` = `entry.c`) as strings. They will never match. **Real T3+ submissions through the TEE delivery path would fail `CELL_MISMATCH`.** This bug pre-dates G1 — pre-G1's random-cell entry.c was BN254 hex too. G1 made it visible because the constituency anchor flowing through this path is now "real."

Tracked as G7. Three resolution paths under consideration:
- (a) Resolver canonicalizes derivedCellId from H3 → BN254 via the same chunk h3Index lookup the client uses.
- (b) Witness carries both encodings (h3Cell + bn254CellId); resolver picks the right comparison.
- (c) Credential schema migrates to one canonical encoding; existing rows back-filled.

Each has trade-offs. CRITICAL severity — blocks production T3+ delivery through TEE path. May need to land before G1 reaches users in production.

## 10. What this spec is NOT pretending

- That mDL gives us street-level address.
- That T3+ has cross-credential attestation.
- That polygon-hit and Tree 2 slot[0] are independent oracles.
- That H3 sliver users are <1% of population.
- That hard-fail on boundary mismatch is a fix.
- That a single TEE endpoint is fault-tolerant.
- That registration is one-shot; quarterly atlas updates force re-registration.
- That mDL = current address. mDL = address-at-issuance.

The previous draft pretended several of these. Brutalist landed; spec corrected.
