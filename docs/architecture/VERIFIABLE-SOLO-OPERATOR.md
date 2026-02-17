# Verifiable Solo Operator Architecture

**Status:** Implemented (Wave 39-41, 2026-02-15)
**Implementation:** `packages/shadow-atlas/src/serving/`
**Spec Reference:** REMEDIATION-WAVE-PLAN.md Cycle 10

---

## 1. Problem Statement

Phase 1 operates as a solo operator (single server, no TEE/MPC). Users must be able to verify:

1. **No censorship** — the server didn't refuse to register specific identities
2. **No tampering** — the insertion log hasn't been rewritten after the fact
3. **No equivocation** — the server can't show different logs to different users
4. **Authenticity** — registration receipts are genuine, not forged

Without hardware attestation (TEE) or multi-party consensus (MPC), we achieve ~80% of on-chain trust guarantees at near-zero infrastructure cost through cryptographic auditability.

---

## 2. Solution: Four Integrity Layers

### 2.1 Hash-Chained Insertion Log

Every leaf insertion is recorded in an append-only NDJSON log. Each entry includes `prevHash` = SHA-256(previous entry's JSON line), creating a tamper-evident chain.

**Properties:**
- **Tamper-evident:** Modifying any entry breaks the chain for all subsequent entries
- **Append-only:** Can't insert entries retroactively without recomputing the entire chain
- **Genesis hash:** First entry uses `SHA-256("genesis")` to bootstrap the chain

**Implementation:** `insertion-log.ts` lines 38-39, 173-196

### 2.2 Ed25519 Signed Entries

Each entry includes `sig` = Ed25519.sign(canonical JSON excluding the `sig` field).

**Properties:**
- **Authenticity:** Only the server with the private key can sign entries
- **Public verification:** Anyone with the public key can verify all signatures
- **Non-repudiation:** Server cannot deny having signed an entry

**Implementation:** `signing.ts` (ServerSigner class), `insertion-log.ts` lines 182-185

### 2.3 Attestation Binding

Each entry may include `attestationHash` linking the insertion to an identity verification event.

**Properties:**
- **Anti-censorship provenance:** Proves a specific identity commitment was registered
- **Audit trail:** Links on-chain activity to off-chain registration events
- **No PII exposure:** `attestationHash` is a cryptographic commitment, not raw identity data

**Implementation:** `insertion-log.ts` lines 58-60, `api.ts` line 720

### 2.4 Signed Registration Receipts

Server returns `receipt: { data, sig }` for every registration.

**Properties:**
- **User can prove registration:** If server later denies registration, user has signed receipt
- **Censorship detection:** If receipt is missing from the published log, server is provably censoring
- **Offline verification:** Anyone can verify receipt signature without querying the server

**Implementation:** `api.ts` POST /v1/register response, `api.ts` POST /v1/register/replace response

---

## 3. Log Format (NDJSON v2)

One JSON object per line, with integrity fields:

```json
{
  "leaf": "0x7a3f...",
  "index": 0,
  "ts": 1707600000000,
  "type": "insert",
  "attestationHash": "0xabc...",
  "prevHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sig": "a3b2f1d8e9c3..."
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `leaf` | string | Hex-encoded leaf hash (0x prefix) |
| `index` | number | Sequential index in Tree 1 |
| `ts` | number | Unix timestamp (ms) of insertion |
| `type` | string? | `"insert"` or `"replace"` (default: insert) |
| `oldIndex` | number? | For replace entries: the old leaf index zeroed |
| `attestationHash` | string? | Identity commitment hash (hex) |
| `prevHash` | string | SHA-256 of previous entry's JSON line |
| `sig` | string | Ed25519 signature over canonical JSON (excluding `sig`) |

**Backward compatibility:** Entries without `prevHash`/`sig` are accepted during replay (v1 format). Hash chain verification starts from the first entry that has `prevHash`.

---

## 4. Receipt Format

```json
{
  "data": "{\"leaf\":\"0x7a3f...\",\"index\":0,\"prevHash\":\"e3b0...\",\"attestationHash\":\"0xabc...\"}",
  "sig": "a3b2f1d8e9c3..."
}
```

- `data`: Canonical JSON of the insertion log entry (as written to the log)
- `sig`: Ed25519 signature over `data` using the server's signing key (128 hex chars = 64 bytes)

---

## 5. Public Auditability

`GET /v1/signing-key` returns:

```json
{
  "publicKey": "YpX3kL...",
  "publicKeyHex": "62957b...",
  "fingerprint": "abc123def456...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

Any third party can:
1. Download the full insertion log from IPFS (Storacha/Lighthouse)
2. Fetch the public signing key from the server
3. Verify every entry's Ed25519 signature
4. Verify the SHA-256 hash chain is unbroken
5. Confirm `attestationHash` links to identity verification events
6. Detect any tampering, censorship, or equivocation

---

## 6. Attack Resistance

| Attack | Defense |
|--------|---------|
| **Censor a specific user** | User has signed receipt. If entry missing from published log, provable censorship. |
| **Rewrite history** | Hash chain breaks at tampered entry. Any auditor detects immediately. Signatures no longer verify. |
| **Equivocation** (different logs to different users) | IPFS content addressing: different logs produce different CIDs, detectable divergence. |
| **Forge registration receipts** | Receipts are Ed25519 signed. Forgery requires private key compromise. |
| **Bulk leaf injection** | `attestationHash` binding requires real identity verification events. Injected leaves lack attestation. |

---

## 7. Key Management

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNING_KEY_PATH` | **Yes** (production) | Path to Ed25519 private key (PEM/PKCS#8 format) |

### Production Guardrail

The server **fails closed** in production if `SIGNING_KEY_PATH` is not set (W40-004). Ephemeral keys destroy the integrity chain on restart — all historical receipts become unverifiable.

```
SIGNING_KEY_PATH must be set in production.
Ephemeral signing keys make log signatures unverifiable after restart.
```

### Key Lifecycle

1. **First startup:** If `SIGNING_KEY_PATH` points to a nonexistent file, the server auto-generates an Ed25519 keypair and saves it (mode 0o600).
2. **Subsequent starts:** Loads existing key from PEM file.
3. **Development:** Without `SIGNING_KEY_PATH`, uses an ephemeral key (warning logged).

### Key Rotation

Key rotation is **not currently automated**. To rotate:
1. Generate a new keypair
2. Replace the file at `SIGNING_KEY_PATH`
3. Restart the server
4. Note: historical entries remain verifiable only with the old key. Publish the old public key alongside the new one.

---

## 8. Residual Trust Assumptions

This is a **verifiable solo operator** model, not full decentralization.

| Assumption | Risk | Mitigation |
|------------|------|------------|
| Server doesn't destroy key and restart with new key | Breaks verification continuity | Publish key fingerprint prominently; monitor for changes |
| Server publishes log to IPFS | Publishing not enforced on-chain | Phase 2: on-chain log root commitments |
| Auditors actually download and verify | Requires community vigilance | Automated auditor tooling (planned) |

### Compared to TEE/MPC (Phase 2+)

| Property | Solo Operator (Phase 1) | TEE (Phase 2) | MPC (Phase 3) |
|----------|------------------------|----------------|----------------|
| Hardware attestation | No | Yes (Nitro Enclave PCR) | N/A |
| Multi-party consensus | No | No | Yes (t-of-n) |
| Key protection | OS-level file permissions | Hardware enclave | Threshold shares |
| Cost | ~$0/month | ~$200+/month | Higher coordination |
| Tamper evidence | Hash chain + signatures | + hardware attestation | + Byzantine fault tolerance |

---

## 9. Verification Walkthrough

### Verifying a Registration Receipt

```typescript
import { createPublicKey, verify } from 'crypto';

// 1. Fetch the server's public key
const keyResp = await fetch('https://shadow-atlas.example.com/v1/signing-key');
const { publicKeyPem } = await keyResp.json();
const publicKey = createPublicKey(publicKeyPem);

// 2. Verify the receipt signature
const isValid = verify(
  null,
  Buffer.from(receipt.data, 'utf8'),
  publicKey,
  Buffer.from(receipt.sig, 'hex'),
);
console.log('Receipt valid:', isValid);

// 3. Parse the receipt data and check fields
const entry = JSON.parse(receipt.data);
console.log('Leaf:', entry.leaf);
console.log('Index:', entry.index);
console.log('Attestation:', entry.attestationHash);
```

### Verifying the Full Insertion Log

```typescript
import { createHash, createPublicKey, verify } from 'crypto';

const GENESIS_HASH = createHash('sha256').update('genesis').digest('hex');

let prevHash = GENESIS_HASH;
let valid = 0;
let broken = 0;

for (const line of logLines) {
  const entry = JSON.parse(line);

  // Verify hash chain
  if (entry.prevHash !== prevHash) {
    broken++;
    console.error(`CHAIN BROKEN at index ${entry.index}`);
  } else {
    valid++;
  }

  // Verify signature (reconstruct signable without `sig` field)
  const { sig, ...signable } = entry;
  const isValid = verify(null, Buffer.from(JSON.stringify(signable)), publicKey, Buffer.from(sig, 'hex'));
  if (!isValid) console.error(`INVALID SIGNATURE at index ${entry.index}`);

  // Update chain state
  prevHash = createHash('sha256').update(line).digest('hex');
}

console.log(`Verified: ${valid} valid links, ${broken} broken links`);
```

---

## 10. Implementation Files

| File | Purpose |
|------|---------|
| `packages/shadow-atlas/src/serving/signing.ts` | Ed25519 key management (ServerSigner class) |
| `packages/shadow-atlas/src/serving/insertion-log.ts` | Hash chain + signature logic (v2 format) |
| `packages/shadow-atlas/src/serving/api.ts` | Receipt generation, GET /v1/signing-key |
| `packages/shadow-atlas/src/serving/registration-service.ts` | attestationHash forwarding |
| `packages/shadow-atlas/src/serving/sync-service.ts` | IPFS log publication |

---

## 11. Future Upgrade Path

### Phase 2: TEE Integration
Move signing key into AWS Nitro Enclave. Hardware attestation proves the code running inside the enclave matches published source. Key never leaves the enclave.

### Phase 2+: On-Chain Log Commitments
Publish periodic Merkle roots of the insertion log on-chain. Makes IPFS publishing mandatory (the root commitment is on-chain). Enables on-chain auditability without downloading the full log.

### Phase 3: Multi-Party Threshold Signatures
Replace solo Ed25519 with a t-of-n threshold signature scheme. No single party can censor or tamper. Requires MPC coordinator infrastructure.

---

## 12. Companion Documents

- [TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](../../specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md) — Phase 1-3 trust progression
- [CHALLENGE-MARKET-ARCHITECTURE.md](../CHALLENGE-MARKET-ARCHITECTURE.md) — Economic trust layer (Phase 2)
- [ADVERSARIAL-ATTACK-DOMAINS.md](../../specs/ADVERSARIAL-ATTACK-DOMAINS.md) — Attack surface taxonomy
- [SECURITY.md](../../SECURITY.md) — User-facing security disclosure
