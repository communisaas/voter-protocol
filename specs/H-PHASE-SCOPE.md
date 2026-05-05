# H-Phase Scope

**Status:** spec, ratified 2026-05-04 after G-phase brutalist deferred-finding review
**Companion:** `specs/CONSTITUENCY-PROOF-SEMANTICS.md` (G-phase canonical)

The G-phase brutalist reviews surfaced ~24 valid findings beyond what each cycle directly addressed. Many were marked DEFERRED with documented rationale. This spec brings the launch-blocking and architecture-honest subset into scope as H-phase, and explicitly names what stays deferred with rationale strong enough to defend at audit.

---

## 1. In-scope — H-phase critical path

| Task | Surfaced by | Why now |
|---|---|---|
| **H1** Server schema for trust fields (trustTier, cellStraddles, cellAnchorMode, atlasVersion on `districtCredentials`) — **all fields strictly optional, NO literal defaults for legacy rows** | G5r, G8r, H0r | Unblocks H2 (banner needs cellStraddles client-server symmetry) and H6 (receipt tier exposure). H0r CRITICAL: backfilling `trustTier=3` retroactively manufactures mDL attestation that never happened; backfilling `cellStraddles=false` claims precision the credential never measured. Legacy rows get the field as `undefined`; downstream surfaces handle "unknown" as a first-class state, not a synonym for "false/clean." |
| **H2** Pre-send boundary-cell honesty banner (NON-modal) | G2r, G5r, H0r | Receipt-page honesty is post-hoc — user already submitted. Show the divergence BEFORE the cryptographic commitment, but inline (e.g., above the send button), NOT a blocking modal. H0r CRITICAL: a blocking modal IS a G2 reversal — it gates send on the cellStraddles signal, which is exactly the boundary-cell discrimination G2 was meant to AVOID. Banner copy includes the G3 affected-population number so the user can judge. Modal escalation reserved for explicit affirmative-disclosure flows (e.g., user clicks "tell me more"). |
| **H3** Resolver fetch timeout in convex/submissions.ts:1341 | G4r | One-line bug. Hung resolver ties up delivery; only timeout today is the 15-min worker sweep. Witness TTL is 30 min — a long resolver hang already corrupts the retry path. |
| **H4** Close G7 fail-open fallback in local-resolver | G7r CRITICAL (codex) | Fail-open exactly where security demands fail-closed. The `decode-failure → reconcileResult.districtCode` fallback recreates the cell-splitting attack the G7 fix was meant to close. |
| **H5** Self-attestation cross-check at registration handler | G7r/G8r, H0r | Defense in depth for the cellAnchorMode field. Client-supplied provenance is unverified; structural inference (authorityLevel × h3Cell-presence) catches client bugs and tampering. H0r: depends on H1 (cellAnchorMode lands in schema first); cannot ship in parallel with H3/H4 as originally drafted. |
| **H6** Outbound surface honesty pass + atlas-version rotation surface | G5r, H0r | AttestationFooter, email service footer, /v/[hash] route still over-claim. Single source of truth for tier-display copy via shared helper. Inconsistency between surfaces is itself a trust signal. H0r: also surface atlas-version drift — when `credential.atlasVersion < currentAtlasVersion`, show "verified against earlier atlas (vX), current is vY" on /v/[hash] and on the user's GroundCard so neither user nor staffer is blindsided by silent re-routing. |
| **H7** Cleanup batch | various, H0r | mdl-finalization-internal.test.ts pre-existing failure (CI green); CT BAF/TIGER vintage doc. H0r CRITICAL: drop the attestation-chain `it.todo()` scaffolding originally drafted here — stubbing tests for a feature whose enclave isn't deployed is theatre at best and harmful-noise at worst (greens a "we have coverage" perception against a function that does not exist). Re-add when Nitro deployment lands and there is a real verifyAttestation to test against. |

Each task ships with a brutalist review cycle (Hnr) per the established G-phase pattern.

---

## 2. Out-of-scope with rationale

| Item | Surfaced by | Why deferred |
|---|---|---|
| **Merkle inclusion proof for h3Index entries** | G1r/G9 | Residual risk after G2 (boundary-cell mark) + G7r option-c routing is acceptable. Atlas operator already trusted at the same tier as Tree 2 build. Substantial schema + build-pipeline + client-validation lift not justified pre-launch. |
| **Manifest schema gain `currentRoot`** | G6r, H0r | The gap is operator-control, not "rare bug": today the manifest's version string is the only trust root for atlas freshness, so any operator with R2 write access can rewrite it without touching the cryptographic root the proofs commit to. Quarterly rotation cadence bounds the *failure window*, not the *threat surface*. Defer to the same epic that closes the on-chain anchor (DistrictRegistry contract read), since the two questions resolve together — until then, atlas-freshness is operator-trusted, and we say so plainly in §6 launch decision. |
| **TEE deployment / kill-switch / multi-region** | G4r | All three require Nitro Enclave deployment before they're meaningful. We ship Local at launch; the operational story is post-launch. Documented in spec section 4 G4. |
| **ACS population data + per-block centroids** | G3r | G3 ships block-COUNT (lower bound on affected population). ACS adds ~5 GB Census download + integration; per-block centroids add another ~2 GB. Phase 2 scope; the G3 number is auditable as-is with documented limitations. |
| **SLDU/SLDL/county boundary measurement expansion** | G3r | CD-only ships now. Expansion is mechanical (loop over additional BAF files); we hold for Phase 1c when we have one quarter of CD measurement to compare against. |
| **Density-aware K-anonymity** | G3r | Depends on ACS population data. K=10 in dense urban vs rural has different privacy semantics — fix requires the population layer. Defer with ACS. |
| **Comprehension test with non-technical reviewers** | G2r/G5 | Process not code. Each H-phase UI change should ship to 3-5 staffers/civic ops contacts before merge. Documented as PR-review checklist item, not a code task. |
| **IPFS integration test coverage** | G1r (existing #22) | Pre-existing deferred task. Independent epic; tracked in #22. |
| **TEE_RESOLVER_URL ↔ TEE_PUBLIC_KEY_URL collapse** | G4r | Real concern but requires coordinated change across SvelteKit handler + Convex action + ops. Defer until TEE deployment makes the second var meaningful. |

---

## 3. Critical-path ordering rationale

H1 is foundational — adds the server-side fields that H2/H5/H6 consume. H1 must land first (sequential). After H1r:

- H2 (boundary banner) sequential after H1 — needs server-stored cellStraddles to confirm parity.
- H3, H4 are independent code-only fixes — can run in parallel after H0r (do not depend on H1).
- H5 sequential after H1 — cross-checks the cellAnchorMode field that H1 lands. (H0r correction: was originally drafted parallel.)
- H6 (outbound honesty + atlas-version surface) depends on H1 for tier and atlasVersion exposure; can run in parallel with H2 and H5 once H1 is in.
- H7 (cleanup) is independent.

```
H0 → H0r ──┬─→ H1 → H1r ──┬─→ H2 → H2r
           ├─→ H3 → H3r   ├─→ H5 → H5r
           ├─→ H4 → H4r   └─→ H6 → H6r
           └─→ H7 → H7r
```

Critical path: H0 → H0r → H1 → H1r → {H2, H5, H6 in parallel} → H2r/H5r/H6r (~6 do→review cycles).
Parallel tracks (H3/H4/H7) add ~3 more cycles in flight.

---

## 4. What this spec is NOT pretending

- That H-phase closes every brutalist finding. The OUT-OF-SCOPE list is honest about what's deferred and why.
- That receipt-page honesty was sufficient. H2 (pre-send honesty banner) admits G5 patched the wrong surface — but H2 is itself a banner, not a blocking gate, because gating-on-cellStraddles would be the G2 reversal.
- That cellAnchorMode is forensically sound today. H5 acknowledges client self-attestation is verifiable only structurally; full cryptographic provenance would require server-side trust derivation that doesn't exist.
- That the TEE story is shipped. Local with explicit "operator-resolved" labeling is acceptable interim; Nitro deployment + kill-switch + multi-region are separate post-launch work.

---

## 5. Acceptance criteria for H-phase exit

A T3+ user (mDL-verified, post-G-phase, post-H-phase):
- has districtCredentials row containing trustTier + cellStraddles + cellAnchorMode + atlasVersion when their credential carries those fields; legacy rows show "unknown" rather than a backfilled default (H1)
- sees a pre-send inline banner (NOT a blocking modal) explaining boundary-cell divergence if cellStraddles=true, including the G3 affected-population number (H2)
- their delivery resolver has bounded fetch latency via AbortSignal.timeout (H3)
- their decode-failure path fails closed not open (H4)
- their cellAnchorMode is structurally cross-checked at registration (H5)
- every outbound surface (receipt, email, footer, /v/[hash]) labels their tier with consistent honesty AND surfaces atlas-version drift when `credential.atlasVersion < currentAtlasVersion` (H6)
- the test suite is green; CT BAF/TIGER vintage mismatch is documented; no `it.todo()` placeholders are merged for undeployed features (H7)

The brutalist (or self-review against verified file evidence) signs off on each cycle before the next begins.

---

## 6. Launch decision

H-phase exit is **not synonymous with launch readiness**. The §5 criteria certify that the *constituency-proof system* is honest end-to-end — not that the *product* is ready to take real signups.

Pre-launch gates that remain outside H-phase:
- **Apple Business Connect enrollment** (ops). Without it, iOS Safari mDL flow is a Tier-3 wallet-error wall.
- **DeviceAuth HPKE / SessionTranscript binding** (T3 in `KNOWN-LIMITATIONS.md`). ISO 18013-5 §9.1.3 compliance; required to claim "cryptographically verified mDL" rather than "cryptographically verified mDL up to the OID4VP nonce window."
- **Boundary-cell observability**. H1 stores `cellStraddles`; observability needs a query/alert that fires on `boundary_cell_send_rate > X%` so we notice if a bug pushes everyone onto the boundary path. Storage ≠ monitoring.
- **G3 measurement on the launch state(s)**. CA is measured (16.4% boundary rate, 103 unique pairs); CT depends on a TIGER vintage fix; whichever state ships first must have a non-stale boundary-population number to put in H2 banner copy.
- **On-chain DistrictRegistry / atlas anchor**. Until then, atlas-freshness trust is operator-trusted, and §2's deferred `currentRoot` rationale is the honest accounting of that.

Launch readiness is signed off in a separate I-phase or launch-checklist doc; H-phase signs off the cypherpunk-honesty of the proof system, no more.
