# Humanity Protocol Integration Perspective

> **Status:** DRAFT — Evolving design thinking, not a spec
> **Date:** 2026-02-20
> **Context:** Exploring Humanity Protocol as identity layer replacement/complement to self.xyz

---

## The Provocation

Passkey-based auth in Communique feels awkward because it's a Web2 pattern bolted onto a system whose cryptographic core is wallet-native. The question isn't "how do we improve passkey UX" — it's "what's stopping us from anchoring identity to a wallet + proof of humanity?"

## Current Identity Architecture (self.xyz / Didit.me)

```
Trust anchor: Government-issued document (passport chip / photo ID)
Flow: OAuth login → self.xyz NFC scan → identityCommitment derivation
Formula: SHA-256(passport_hash || nationality || birthYear || salt) mod BN254
Nullifier: H2(identityCommitment, actionDomain)
Sybil resistance: Document uniqueness (one passport = one identity)
Exclusion set: ~30% of Americans without passports (Didit.me photo ID fallback)
```

### What self.xyz gives us that's hard to replace
- **Jurisdiction/citizenship** from passport nationality field → feeds authority_level
- **Address** from MRZ → feeds geocoding → cell_id → district proof
- **ICAO PKI chain** → auditable trust root (government-backed)
- **Sybil resistance** via document uniqueness

### What self.xyz costs us philosophically
- Identity anchored to state permission (passport is a government grant)
- Excludes undocumented residents, refugees, people without valid passports
- NFC hardware requirement (not all phones have it)
- Centralized attestation provider (self.xyz is a company, not a protocol)

## Humanity Protocol: What It Offers

```
Trust anchor: Biological uniqueness (palm vein pattern)
Chain: Own L2 (Polygon CDK zkEVM), settled on Ethereum
Developer surface: vcContract.isVerified(address) → bool
Cross-chain: LayerZero (70+ chains including Scroll)
Status: Mainnet (August 2025), $H token live, $50M+ raised
Privacy: Palm biometric → CNN feature extraction → ZK proof → on-chain attestation
         Raw biometric never stored
```

### What Humanity Protocol gives us
- **Sybil resistance from biology, not bureaucracy** — your body proves you're human
- **Wallet-native** — `isVerified(walletAddress)` is the entire API
- **Inclusive** — no government documents required, anyone with a hand and a phone
- **Cross-chain reach** — LayerZero means we're not locked to one chain
- **Cypherpunk-aligned** — identity from cryptography + biology, not state permission

### What Humanity Protocol doesn't give us
- **No jurisdiction/citizenship** — palm scan doesn't know where you live
- **No address** — can't derive cell_id for district proofs
- **Weaker trust chain for congressional offices** — "biometric uniqueness" is less legible to Hill staffers than "verified passport"
- **Phase 2 palm vein (IR scanner) not yet ubiquitous** — Phase 2 phone camera is less secure
- **Younger developer ecosystem** — thinner docs, fewer examples than self.xyz

## The Layered Architecture: Use Both, Demote self.xyz

The pragmatic cypherpunk move: Humanity Protocol becomes the **entry point**, self.xyz becomes an **optional power-up**.

### Proposed Tier Mapping

| Authority Level | Trust Tier | Identity Source | What It Proves |
|---|---|---|---|
| 0 (conceptual) | 0 | None | Guest — no user object |
| 1 | 1 | Wallet + Humanity Protocol PoH | Unique human (biometric) |
| 2 | 2 | Self-attested location + Shadow Atlas ZK proof | District claim (weaker) |
| 3 | 2+ | Didit.me photo ID | Document-verified (photo) |
| 4 | 3 | self.xyz NFC passport | Document-verified (passport) |
| 5 | 4 | mDL / government credential | Government-issued |

### Key Architectural Insight

The ZK layer (two-tree circuit, Noir/Barretenberg, Scroll contracts) is **already provider-agnostic**. The circuit treats `identityCommitment` as an opaque 254-bit field. The nullifier formula `H2(identityCommitment, actionDomain)` works regardless of what produced the commitment.

The coupling to self.xyz is entirely in:
1. `computeIdentityCommitment()` — the derivation function (one TypeScript function)
2. `verificationMethod: 'self.xyz' | 'didit'` — the SessionCredential enum (one type)
3. Webhook handler in `/api/identity/verify` — the attestation receiver (one endpoint)
4. `ECONOMICS.md` verification_bonus formula — hardcoded provider names

A provider swap is a **3-5 file change**, not an architectural overhaul.

### What Changes with Humanity Protocol

**identityCommitment derivation:**
```typescript
// Current (self.xyz/didit): government document fields
identityCommitment = SHA256(passport_hash || nationality || birthYear || salt) mod BN254

// Proposed (Humanity Protocol): on-chain verification status
identityCommitment = SHA256(humanityProtocol.humanId || chainId || salt) mod BN254
// humanId is the unique, non-transferable on-chain identity from palm verification
```

**Wallet connection replaces OAuth + passkey:**
```
Current:  OAuth login → passkey upgrade → self.xyz scan → ZK proof
Proposed: Connect wallet → Humanity Protocol palm scan → ZK proof
```

**District verification decoupled from identity:**
```
Current:  self.xyz passport MRZ → address extraction → geocode → cell_id
Proposed: Self-attested address (browser-only) → geocode → cell_id → ZK proof
          OR: IP geolocation hint → cell_id (weaker, Tier 1 only)
          UPGRADE: self.xyz passport → verified address → stronger authority_level
```

## Open Questions

1. **Congressional legitimacy**: Will Hill offices accept "biometrically verified human from this district" without a government document? Or does CWC path still require self.xyz/didit at Tier 3+?

2. **Humanity Protocol stability**: Mainnet since August 2025, but the developer ecosystem is thin. Are we comfortable depending on their `isVerified()` oracle? What's our fallback if they go down?

3. **Cross-chain verification cost**: Checking `isVerified()` on Humanity L2 from Scroll L2 via LayerZero adds latency and gas. Is this acceptable in the registration flow, or do we cache the result?

4. **Palm scan Phase 2 vs Phase 3 security**: Phone-camera palm scan (Phase 2, live now) vs IR palm vein scan (Phase 3, rolling out 2026). Phase 2 is more spoofable. Do we gate authority_level based on which scan was used?

5. **Identity commitment stability**: If a user's Humanity Protocol humanId is revoked (false positive, account compromise), the identityCommitment changes, which changes the nullifier, which means all prior actions become unlinkable to the new identity. Is this a feature or a bug?

## Integration Path (If We Proceed)

### Phase A: Wallet-native auth in Communique (no Humanity Protocol yet)
- Replace OAuth + passkey with EIP-4361 (Sign-In With Ethereum)
- Any EVM wallet works (MetaMask, OKX, WalletConnect)
- This alone eliminates the "passkey feels odd" problem
- Users at Tier 1 (authenticated) immediately

### Phase B: Humanity Protocol PoH check
- After wallet connection, check `vcContract.isVerified(walletAddress)`
- If verified: authority_level 1 → unique human, Sybil-resistant
- If not: prompt palm scan via Humanity Protocol app/SDK
- Cross-chain verification via LayerZero or cached attestation

### Phase C: District self-attestation + ZK proof
- User self-attests address (browser-only, never stored)
- Census geocoder → cell_id
- Shadow Atlas ZK proof → district membership
- Authority_level 2 (district claim, self-attested)

### Phase D: Optional self.xyz/didit upgrade
- Users who want Tier 3+ (verified constituent for CWC) scan passport
- Same flow as today, just no longer the gatekeeper
- Congressional messages carry "verified constituent" weight

## Relationship to Existing Specs

This perspective, if adopted, would require changes to:
- `specs/COMMUNIQUE-INTEGRATION-SPEC.md` — SessionCredential schema, registration flow
- `ARCHITECTURE.md` — Identity verification section, onboarding flow
- `QUICKSTART.md` — Complete rewrite of Steps 1-2
- `ECONOMICS.md` — verification_bonus formula
- `SECURITY.md` — New attack vectors (biometric spoofing, palm photo replay)
- `ADVERSARIAL-ATTACK-DOMAINS.md` — Domain 6 identity provider analysis
- `congressional-outreach.md` — Updated value prop for Hill offices

Does NOT require changes to:
- Two-tree ZK circuit (provider-agnostic)
- Smart contracts (DistrictGate, NullifierRegistry — proof-level, not identity-level)
- Shadow Atlas (Tree 2 is cell-district mapping, identity-independent)
- TRUST-MODEL-AND-OPERATOR-INTEGRITY.md (operator trust is identity-agnostic)

---

*This document captures design thinking as of 2026-02-20. It is not a commitment to implement. The Identity Integration Contract spec (to be written) will be the normative document.*
