# V2 Deployment Runbook (Stage 5 — F1 Closure)

> **Status:** DRAFT, operator-run
> **Spec:** `specs/REVOCATION-NULLIFIER-SPEC.md`, `specs/CIRCUIT-REVISION-MIGRATION.md`
> **Scope:** Operator sequence for bringing the v2 three-tree circuit + RevocationRegistry live on Scroll L2.

Everything in this document is manual. No CI pipeline or automation executes these steps.

---

## 0. Pre-flight checklist

1. Beta-tester comms sent at least **72 hours** before cutover. The v1 → v2 transition requires every user to re-verify exactly once. Sample copy lives in `specs/CIRCUIT-REVISION-MIGRATION.md` §6.5.
2. Stage 1 ships: `verifyAddress` rate limiter + email sybil gate **already live** (completed pre-Stage-5).
3. Stage 2 ships: `action-domain-builder.ts` v2 (binds `district_commitment` into preimage) **already live**.
4. Stage 3 UI handles `CREDENTIAL_MIGRATION_REQUIRED` response and auto-pivots to `IdentityRecoveryFlow`. Verify in staging.
5. Monitoring dashboards subscribed to:
    - `RevocationEmitted(bytes32,bytes32,uint256)` from `RevocationRegistry`
    - `RevocationBlockedSubmission(bytes32,address)` from `DistrictGate`
    - `ThreeTreeProofVerified` (existing) volume — should drop during cutover window and recover as users re-verify.

## 1. Generate v2 verifier contracts

```bash
cd voter-protocol
./scripts/generate-v2-verifier.sh
```

Outputs `contracts/src/verifiers/HonkVerifierV2_{18,20,22,24}.sol`. Commit these to a feature branch.

**Verify:**
- Bytecode sizes under Scroll's deploy ceiling (~24 KB). If a depth variant exceeds this, split-deployment fallback is required (existing pattern for depths 22/24 with v1).
- Run `forge build` — all four new verifier contracts must compile.
- Compare the contract's `verify(bytes,bytes32[])` ABI against what `DistrictGate.verifyThreeTreeProofV2` expects (33 public inputs).

## 2. Deploy RevocationRegistry

```bash
# Parameters — fill in from ops config
export GOVERNANCE=0x...           # Multisig or founder address
export GOV_TIMELOCK=604800         # 7 days
export RELAYER_TIMELOCK=604800     # 7 days
export EMPTY_ROOT=0x...            # Precomputed empty-tree root for Poseidon2, depth 64.
                                   # Compute offline via packages/crypto/sparse-merkle-tree.ts
                                   # with depth=64 and zero-value leaves.

forge create \
  --rpc-url $SCROLL_RPC \
  --private-key $OPS_KEY \
  --broadcast \
  contracts/src/RevocationRegistry.sol:RevocationRegistry \
  --constructor-args $GOVERNANCE $GOV_TIMELOCK $RELAYER_TIMELOCK $EMPTY_ROOT
```

Save the deployment address → `REVOCATION_REGISTRY_ADDR`.

## 3. Deploy v2 HonkVerifiers

One deploy per depth variant:

```bash
for DEPTH in 18 20 22 24; do
  forge create \
    --rpc-url $SCROLL_RPC \
    --private-key $OPS_KEY \
    --broadcast \
    contracts/src/verifiers/HonkVerifierV2_${DEPTH}.sol:HonkVerifierV2_${DEPTH}
done
```

Save four addresses → `V2_VERIFIER_{18,20,22,24}`.

## 4. Register v2 verifiers in VerifierRegistry

The v2 verifiers live alongside v1 until the v1 route is decommissioned.
For each depth, call `proposeThreeTreeVerifierUpgrade(depth, v2Addr)` on the
VerifierRegistry. 14-day timelock. Do not execute yet.

## 5. Deploy a fresh DistrictGate *or* propose registry change on the existing one

Option A (new gate): deploy a second `DistrictGate` with `setRevocationRegistryGenesis(REVOCATION_REGISTRY_ADDR)` and migrate routing. Higher blast-radius but atomic.

Option B (timelocked change on existing gate): call `proposeRevocationRegistry(REVOCATION_REGISTRY_ADDR)` on the live gate. 7-day governance timelock. This is the recommended path — keeps the same address for downstream consumers.

## 6. Authorize the Commons Convex operator as RevocationRegistry relayer

```bash
cast send $REVOCATION_REGISTRY_ADDR \
  "authorizeRelayerGenesis(address)" $COMMONS_RELAYER_SIGNER \
  --rpc-url $SCROLL_RPC --private-key $GOVERNANCE_KEY

# Later (after ops smoke test):
cast send $REVOCATION_REGISTRY_ADDR "sealGenesis()" \
  --rpc-url $SCROLL_RPC --private-key $GOVERNANCE_KEY
```

## 7. Execute verifier upgrades and revocation registry change (after timelocks)

After the 14-day verifier timelock and 7-day registry timelock elapse:

```bash
# Execute v2 verifier activation per depth
for DEPTH in 18 20 22 24; do
  cast send $VERIFIER_REGISTRY \
    "executeThreeTreeVerifierUpgrade(uint8)" $DEPTH \
    --rpc-url $SCROLL_RPC --private-key $OPS_KEY
done

# Execute registry pointer change on DistrictGate
cast send $DISTRICT_GATE "executeRevocationRegistry()" \
  --rpc-url $SCROLL_RPC --private-key $OPS_KEY
```

After this step, any new proof submitted via `verifyThreeTreeProofV2` routes through the v2 verifier + RevocationRegistry gate.

## 8. Run credential cutover

Follow `commons/docs/runbooks/V2-CREDENTIAL-CUTOVER.md`. Sets `revocationStatus: pending` on every existing credential and schedules per-credential on-chain emits. Expected cost: ~$0.12 USD per 10K credentials at Scroll L2 rates.

## 9. Post-cutover monitoring (7 days)

- `RevocationEmitted` volume: expect a one-time spike (one per pre-cutover credential) then a steady-state rate matching re-verification throttle output (~6/user/180d ceiling).
- `RevocationBlockedSubmission` volume: spikes indicate either cached v1 proofs in open browser tabs or replay attempts. Either case is surfaced to ops.
- Convex `districtCredentials` with `revocationStatus='failed'` — any count > 0 requires manual investigation. Stuck-pending cron should keep `pending` count below 100 at steady state.

## Rollback

If a P0 defect surfaces within the 7-day window:
1. `cast send $DISTRICT_GATE "pause()"` (emergency brake).
2. Enqueue `proposeThreeTreeVerifierUpgrade(depth, v1Addr)` for each depth (14 days before live).
3. Enqueue `proposeRevocationRegistry(address(0))` (will fail — zero-address guarded; instead redeploy a mock registry that accepts all roots).
4. Coordinate comms.

**Credentials re-verified during cutover remain valid** in v1 mode because a v1 circuit does not consult `district_commitment` in its action domain. No data loss.
