# I-Phase Scope

**Status:** spec, drafted 2026-05-04 after H-phase exit (proof-system honesty signed off), I0r-corrected same day
**Companion:** `specs/H-PHASE-SCOPE.md` (H-phase canonical), `specs/CONSTITUENCY-PROOF-SEMANTICS.md` (G-phase canonical)

H-phase certified that the constituency-proof system is honest end-to-end. I-phase certifies the **mDL launch path** specifically — the code gates that must close before the iOS Safari mDL flow can be enabled and the `FEATURES.CONGRESSIONAL` flag flipped with confidence. I0r CRITICAL: this is NOT the same as "all launch work" — civic-api-only template flows are already shippable today; the CONGRESSIONAL flag flip is the actual product launch trigger and has its own preflight checklist (§7). I-phase removes the mDL-specific replay-attack vector and the observability gap; the rest is ops + release engineering.

---

## 1. In-scope — I-phase critical path

| Task | Surfaced by | Why now |
|---|---|---|
| **I1** Raw `org-iso-mdoc` DeviceAuth verification (T3 in `KNOWN-LIMITATIONS.md`, row "Raw `org-iso-mdoc` DeviceAuth/ReaderAuth") | F-1.3 brutalist review (2026-04-25), ISO 18013-5 §9.1.3, KNOWN-LIMITATIONS DC-5 | I1 SCOPE CLARIFICATION: the encrypted `dc_api.jwt` path (used by iOS Safari + Android via the W3C Digital Credentials API) **already** does full SessionTranscript binding via `processOpenId4VpMsoMdocPresentation`. The raw `org-iso-mdoc` path (`MDL_MDOC` flag) currently has only the F-1.3 presence gate. I1 lifts the raw path to the same security guarantee by extracting the DC-API verification logic into a shared helper and calling it from both paths. This is forward investment: it unblocks `MDL_MDOC = true` for Apple-Wallet-on-NFC and Android raw-mdoc deployments, and tightens the security claim across both protocols rather than just one. iOS-Safari-only first-org launch does NOT depend on I1 (already covered by the DC API path), but I-phase ships I1 as part of the launch readiness ledger so the next launch flavor (NFC/BLE) is ready when ABC tooling supports it. |
| **I2** Boundary-cell observability — alert + dashboard | H-PHASE-SCOPE §6, H1 storage closure | H1 stores `cellStraddles` on `districtCredentials`. Storage ≠ monitoring. We need a query/alert that fires on `boundary_cell_send_rate > X%` so a bug pushing every user onto the boundary path is detected within minutes, not via a quarterly metric review. Launch-blocking because the H2 banner copy assumes a low boundary rate; if a regression spikes that, we want to know before staffers do. |
| **I3** Cleanup batch — open #22 IPFS integration tests + KNOWN-LIMITATIONS.md update | various | `#22` (IPFS integration test coverage) has been pending since the storacha migration; closing it gives CI confidence in the chunked-atlas R2 read path before first-org onboarding. KNOWN-LIMITATIONS.md updated to reflect I-phase closures (T3 done) and the J-phase ledger. |

I0r correction: the manifest `currentRoot` task (originally drafted as I3) was moved to OUT-OF-SCOPE (§2). The H-PHASE-SCOPE rationale is honest: without on-chain commitment (Scroll L2 DistrictRegistry), `currentRoot` is just another operator-published string and adding it before the on-chain anchor lands is theatre. The two questions resolve together in the J-phase epic.

I0r correction: the deferred-finding inventory file (originally bundled into I4) was dropped. Audit trail is already captured inline in G/H spec commits, code comments labeled with finding IDs, and the H-PHASE-SCOPE OUT-OF-SCOPE table; a separate ledger duplicates without adding signal. KNOWN-LIMITATIONS.md remains the canonical post-launch ledger.

Each task ships with a brutalist review cycle (`Inr`) per the established G/H-phase pattern.

---

## 2. Out-of-scope with rationale

| Item | Surfaced by | Why deferred |
|---|---|---|
| **Manifest `currentRoot` field + client verification** | G6r, H0r, I0r | Originally drafted as I3. Without on-chain DistrictRegistry commitment, `currentRoot` is another operator-published string the operator could rewrite — adds attack surface (clients hard-fail on legitimate quarterly rotations whose currentRoot transition isn't yet pinned anywhere) without closing operator-control. The honest path: ship I-phase with the documented "atlas freshness is operator-trusted" labeling already in H-PHASE-SCOPE §6, and resolve currentRoot + on-chain anchor together in J-phase. |
| **TEE Nitro Enclave deployment** | G4r, H-PHASE-SCOPE §2 | `LocalConstituentResolver` is the active path and is honestly labeled as "operator-resolved, not enclave-isolated". Replacing it requires AWS Nitro on Graviton + KMS attestation chain + ops runbook. Phase J. Launch with the documented limitation — the security claim today is "address handling never persists past the resolver, but is operator-trusted within the resolver process," which is acceptable for first-org launch where the operator IS Commons. |
| **TEE kill-switch + multi-region** | G4r | Both require Nitro deployment to be meaningful. Phase J. |
| **`TEE_RESOLVER_URL` ↔ `TEE_PUBLIC_KEY_URL` collapse** | G4r | Coordinated change across SvelteKit handler + Convex action + ops; defer until TEE deployment makes the second var meaningful. Phase J. |
| **Merkle inclusion proof for h3Index entries** | G1r/G9 | Residual risk after G2 (boundary-cell mark) + G7r option-c routing is acceptable. Atlas operator already trusted at the same tier as Tree 2 build. Substantial schema + build-pipeline + client-validation lift not justified pre-launch. Phase J. |
| **On-chain DistrictRegistry (Scroll L2)** | G6r, J-phase epic | The actual fix that retires the operator-trusted manifest model. Full epic — contract authoring, deployment, indexer, client integration. Phase J. |
| **ACS population data + per-block centroids** | G3r | ~7 GB Census download; per-block centroids add ~2 GB. G3 ships block-COUNT (lower bound on affected population). Phase 2. |
| **Density-aware K-anonymity** | G3r | Depends on ACS. Phase 2 (with ACS). |
| **SLDU/SLDL/county boundary measurement expansion** | G3r | Mechanical (loop additional BAF files). Hold for one quarter of CD measurement to compare against. Phase 2. |
| **CT BAF/TIGER vintage shim** | H7 | Only relevant if CT is a launch state. Per H7 doc: 2030 BAF cycle is the natural re-peg, otherwise build a per-state shim from the FIPS dissolution crosswalk. Defer until launch state list firms up. |
| **CA/GB/AU country resolvers (currently stubs)** | `CROSS-BORDER-PLAN.md` | Stubs. International launch is post-Phase-2. |
| **Stripe metered overage billing** | monetization-policy.md, memory | Hard plan-limit block is sufficient until first org exceeds plan limit. Convert to metered overage when an org actually wants the higher-tier dynamics. NOT launch-blocking. |
| **Redis-backed rate limiter (production wiring)** | CLAUDE.md memory | `SlidingWindowRateLimiter` constructor throws at boot if `REDIS_URL` unset (unless `RATE_LIMITER_ALLOW_MEMORY=1`). Ops task: provision Redis URL in production environment before launch. Documented as ops dependency, not in-scope code. |
| **SimpleAccount factory for ERC-4337 NEAR gasless path** | memory non-blocking gaps | Factory not populated. Wallet flow falls back to alternative paths. Non-blocking for first-org launch. |
| **SMS recipient filtering by `smsStatus`** | memory non-blocking gaps | TODO; segment query not wired for phone filtering. SMS launch is feature-flagged separately and is not the first-org launch path. |
| **Comprehension test with non-technical reviewers** | G2r/G5 | Process not code. Each I-phase UI change ships to 3-5 staffers/civic ops contacts before merge. Documented as PR-checklist item. |
| **Apple Business Connect enrollment** | KNOWN-LIMITATIONS, monetization | Ops task. Required before iOS Safari mDL flow is usable. NOT code work. Tracked separately on the launch preflight checklist (§7). |
| **`FEATURES.CONGRESSIONAL` flag flip** | `src/lib/config/features.ts` | One-line release decision. Triggered by the launch preflight checklist (§7), not by I-phase exit alone. |
| **Launch-day runbook + on-call rotation** | I0r F9 | Ops scope. Should exist before flag flip; not code work. Acknowledged so the absence doesn't block I-phase exit. |

---

## 3. Critical-path ordering rationale

I-phase has three tasks (post-I0r): I1 (HPKE) is wallet-protocol code, I2 (observability) is metric pipeline + dashboard, I3 (cleanup) is CI tests + doc.

```
I0 → I0r ──┬─→ I1 → I1r
           ├─→ I2 → I2r
           └─→ I3 → I3r
```

Critical path: I0 → I0r → max(I1r, I2r, I3r) (~4 do→review cycles serially, or ~2 with parallelism since the three tasks are independent).

I1 is the only task that may surface protocol-level subtleties (ISO 18013-5 §9.1.3 SessionTranscript reconstruction; HPKE key derivation; mdoc-cbor canonicalization). Allow extra review depth there.

---

## 4. What this spec is NOT pretending

- That I-phase = full launch readiness. I-phase signs off the **mDL launch path** specifically. The civic-api-only path is shippable today; the CONGRESSIONAL flag flip is the actual product-launch trigger (§7 preflight). I-phase removes the mDL replay-attack vector and the boundary-cell observability gap; ABC enrollment, runbook, and the flag flip itself are ops decisions outside this spec.
- That I-phase signs off TEE deployment. The Nitro story is post-launch and we say so plainly. Launch-state TEE security claim is "operator-resolved, address handling never persists past the resolver process" — true for `LocalConstituentResolver`.
- That I-phase eliminates all `KNOWN-LIMITATIONS.md` items. T3 (DeviceAuth HPKE) closes; the remaining items move into the post-launch ledger with current-state language.
- That I-phase opens international launch. Cross-border resolvers stay stubbed; first-org-onboarding is US-only.
- That atlas freshness is fully decentralized. Until the on-chain DistrictRegistry (Scroll L2) ships, atlas freshness is operator-trusted (per H-PHASE-SCOPE §6). I0r explicitly DEFERRED the manifest currentRoot half-step because adding it pre-on-chain would create attack surface without closing operator-control.

---

## 5. Acceptance criteria for I-phase exit

I-phase exit signs off the **mDL launch path** specifically. The exit criteria are:

- **I1 closed:** Both protocols (`org-iso-mdoc` raw and `OPENID4VP_DC_API_PROTOCOL` encrypted) reach the same DeviceAuth verification floor: SessionTranscript reconstructed from (origin, nonce, jwk thumbprint), DeviceAuthenticationBytes encoded per §9.1.3.6, deviceSignature verified against the MSO's deviceKey. A captured raw-mdoc response replayed against `processMdocResponse` after the legitimate session completes is rejected with a SessionTranscript-mismatch error. The DC API path's existing tests stay green; new tests cover the raw-mdoc parity. The shared verification helper means future protocol additions inherit the same floor by construction.
- **I2 closed:** A query running against `districtCredentials` (filtered to rows with `cellStraddles` defined — H1 row, not legacy) computes a 24h `boundary_cell_send_rate`. An alert wired through Sentry (the existing error monitoring surface per memory) fires when the rate exceeds a threshold derived from G3's CA baseline (~16.4%) plus a margin (proposed initial threshold: 28% sustained over 60 min). Alert payload contains aggregate counts only — never user IDs, hashes, or addresses.
- **I3 closed:** `tests/integration/ipfs-chunked-atlas.test.ts` (or named equivalent) exercises the chunked-atlas R2 read path against a real fixture in CI. `KNOWN-LIMITATIONS.md` reflects the post-I-phase ledger: T3 marked closed, post-launch items re-stated with current-state language. The H-PHASE-SCOPE OUT-OF-SCOPE table is referenced as the canonical deferred-finding inventory rather than duplicated.

The brutalist (or self-review against verified file evidence) signs off on each cycle before the next begins.

I0r CRITICAL: these criteria do NOT include "ABC enrolled" or "CONGRESSIONAL=true". Those are §7 preflight items. I-phase exits when the code gates close; the launch trigger is separate.

---

## 6. What remains beyond I-phase (the post-launch ledger)

Documented for the audit trail. Each item is honest about why it isn't blocking launch.

- **TEE Nitro deployment** — security upgrade beyond "operator-resolved". J-phase.
- **TEE kill-switch + multi-region** — operational resilience for TEE. J-phase.
- **On-chain DistrictRegistry (Scroll L2)** — replaces the manifest-root operator-trust with on-chain commitment. J-phase OR own epic.
- **Manifest `currentRoot` field** — bundled with the on-chain anchor work above. Adding it standalone is theatre per I0r.
- **Merkle h3Index inclusion proofs** — residual atlas-operator-trust closure. J-phase.
- **ACS population layer + per-block centroids** — boundary-population precision upgrade. Phase 2.
- **Density-aware K-anonymity** — depends on ACS. Phase 2.
- **SLDU/SLDL/county boundary expansion** — multi-jurisdiction support. Phase 2.
- **Multi-state G3 measurement** — per-state boundary-cell rate beyond CA. Phase 1c (or Phase 2 if delayed).
- **CT BAF/TIGER vintage shim** — only if CT becomes a launch state. Otherwise wait for 2030 cycle.
- **CA/GB/AU country resolvers** — international launch enabler. Post-Phase-2.
- **Stripe metered overage billing** — convert to metered when first org needs it.
- **SimpleAccount factory (ERC-4337 NEAR gasless)** — non-blocking; alternate wallet paths work.
- **SMS recipient filtering** — feature-flagged separately; not first-org launch path.

This list is the agenda for J-phase scoping when I-phase exits.

---

## 7. Launch preflight checklist (NOT I-phase, but referenced)

These are the gates the release engineer + ops must check before flipping `FEATURES.CONGRESSIONAL = true`. They are NOT I-phase work; the spec lists them so I-phase exit is honest about what it does and does not authorize.

- [ ] I-phase exits (§5 criteria all green).
- [ ] Apple Business Connect enrollment confirmed (iOS Safari mDL works in production environment).
- [ ] Production `REDIS_URL` provisioned + smoke-tested (rate-limiter doesn't fall back to in-memory).
- [ ] Sentry alert routes wired to on-call rotation (the I2 alert reaches a human within minutes).
- [ ] Launch-day runbook authored (incident-response paths for: resolver hang, mDL flow break, boundary-cell spike, atlas read failure).
- [ ] G3 measurement valid for the launch state(s). CA is measured today; if launch ≠ CA, run `measure-boundary-population` and confirm exit code 0 for the target state.
- [ ] First-org onboarding flow walked end-to-end against staging in the launch state.
- [ ] `FEATURES.CONGRESSIONAL = true` PR opened, tested in staging, ready to merge at the flip moment.

I-phase signs off only the first item. The remainder is owned by the release engineer + ops; this spec acknowledges them so they aren't accidentally claimed by the engineering team.
