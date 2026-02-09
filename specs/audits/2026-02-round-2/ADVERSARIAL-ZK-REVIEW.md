> [!NOTE]
> **HISTORICAL AUDIT — Findings tracked in IMPLEMENTATION-GAP-ANALYSIS.md Rev 8**
>
> This adversarial ZK review was conducted 2026-02-01. Key findings:
> - HIGH-001 (root validity) → Fixed as SA-004
> - MEDIUM-001 (predictable test secrets) → Code quality, not security vulnerability
>
> All security findings are tracked in the master security document.

---

# Adversarial ZK Security Review

**Date:** 2026-02-01
**Auditor:** ZK Cryptography Security Review
**Scope:** District Membership Circuit, Poseidon2 Hasher, Prover, On-chain Verification
**Commit:** f6664f5 (main branch)

---

## Executive Summary

This adversarial review analyzed the voter-protocol ZK proving system for vulnerabilities across six attack vectors: proof forgery, proof replay, nullifier manipulation, merkle path attacks, field overflow, and domain separation bypass.

The system has been **significantly hardened** with documented CVE fixes (CVE-001, CVE-002, CVE-003), security advisories (SA-011, ISSUE-006, BA-003, BA-007, BA-016), indicating a mature security posture. However, several residual risks and potential attack vectors were identified.

### Summary of Findings

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | - |
| High | 1 | Missing root validity check in DistrictGateV2 |
| Medium | 2 | Predictable secrets in test fixtures, TypeScript/Noir hash divergence risk |
| Low | 3 | Rate limit bypass, authority level truncation edge case, weak entropy guidance |
| Informational | 4 | General observations and hardening recommendations |

---

## Detailed Findings

### HIGH-001: DistrictGateV2 Does Not Check `isValidRoot()` Before Verification

**Severity:** HIGH
**Location:** `/Users/noot/Documents/voter-protocol/contracts/src/DistrictGateV2.sol:236-238`
**Attack Vector:** Proof Replay / Merkle Path Attack

**Description:**

The `verifyAndAuthorizeWithSignature()` function checks that a district is registered and matches the expected country, but it does NOT call `districtRegistry.isValidRoot(districtRoot)` to verify the root is still active and not expired.

```solidity
// Current code (lines 236-238):
(bytes3 actualCountry, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);
if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
if (actualCountry != expectedCountry) revert UnauthorizedDistrict();
// MISSING: if (!districtRegistry.isValidRoot(districtRoot)) revert RootNotValid();
```

The `DistrictRegistry` has a comprehensive root lifecycle system with `isValidRoot()` that checks:
1. Root is registered
2. Root is active (not deactivated)
3. Root is not expired

However, `DistrictGateV2` only checks condition #1 via `getCountryAndDepth()`.

**Impact:**

An attacker could:
1. Generate a valid proof against a merkle root that was later deactivated (e.g., due to redistricting or compromise)
2. Continue submitting proofs using expired roots beyond their intended validity period
3. Bypass governance controls that deactivated a root due to security concerns

**Proof of Concept:**

```solidity
// Governance deactivates root due to compromise
districtRegistry.initiateRootDeactivation(compromisedRoot);
// ... 7 days pass ...
districtRegistry.executeRootDeactivation(compromisedRoot);

// But DistrictGateV2 still accepts proofs against the deactivated root!
// getCountryAndDepth() returns valid data even for deactivated roots
districtGate.verifyAndAuthorizeWithSignature(..., compromisedRoot, ...);
// This succeeds when it should fail
```

**Recommendation:**

Add root validity check in `verifyAndAuthorizeWithSignature()`:

```solidity
// After line 238, add:
if (!districtRegistry.isValidRoot(districtRoot)) revert DistrictNotValid();
```

---

### MEDIUM-001: Predictable Test Secrets Risk Production Leakage

**Severity:** MEDIUM
**Location:** `/Users/noot/Documents/voter-protocol/packages/noir-prover/src/fixtures.ts:210`
**Attack Vector:** Proof Forgery

**Description:**

Test fixtures use predictable secrets:

```typescript
// fixtures.ts:210
const userSecret = options.userSecret ?? '0x1234';

// fixtures.ts:277
const userSecret = '0x' + 'deadbeef'.repeat(8);

// fixtures.ts:311
userSecret: '0x0000000000000000000000000000000000000000000000000000000000001234',
```

While test fixtures are clearly intended for testing, the default value `0x1234` is extremely weak. If any production code path accidentally uses default fixtures or a developer copies fixture patterns without randomizing secrets, the nullifier becomes trivially predictable.

**Impact:**

If `userSecret = 0x1234` were used in production:
- `nullifier = hash(0x1234, actionDomain)` is deterministic
- Any attacker knowing the actionDomain could precompute the nullifier
- Replay detection would still work (nullifier already used), but the identity is compromised

**Proof of Concept:**

```typescript
// Question: Can user_secret = 1 produce predictable nullifiers across users?
// Answer: YES, if the same weak secret is reused

const weakSecret = '0x0000000000000000000000000000000000000000000000000000000000000001';
const actionDomain = '0x04040404...'; // Known public value

// Attacker can compute: hash(weakSecret, actionDomain) = predictable nullifier
// If two users share the same weak secret, their nullifiers are identical
// (though circuit would still work - they'd just be linkable)
```

**Recommendation:**

1. Add runtime guards in production code paths that detect and reject weak secrets:
```typescript
const MINIMUM_ENTROPY_BITS = 128;
function validateSecretEntropy(secret: string): void {
  const leadingZeros = secret.match(/^0x0*/)[0].length - 2;
  const effectiveBits = (64 - leadingZeros) * 4;
  if (effectiveBits < MINIMUM_ENTROPY_BITS) {
    throw new Error('User secret has insufficient entropy');
  }
}
```

2. Mark fixture files with `@internal` JSDoc tags
3. Add CI checks that prevent importing from fixtures in production builds

---

### MEDIUM-002: TypeScript Poseidon2 Domain Tag Mismatch Risk

**Severity:** MEDIUM
**Location:** `/Users/noot/Documents/voter-protocol/packages/crypto/poseidon2.ts:130-148` and `/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/main.nr:30-34`
**Attack Vector:** Domain Separation Bypass

**Description:**

The circuit and TypeScript hasher both use domain separation tags, but with a critical implementation difference:

**Noir Circuit (main.nr:30-34):**
```noir
global DOMAIN_HASH2: Field = 0x48324d;  // "H2M" marker

fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let mut state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];  // Tag in slot 2
    let out = poseidon2_permutation(state, 4);
    out[0]
}
```

**TypeScript Hasher (poseidon2.ts:130-148):**
```typescript
const DOMAIN_HASH2 = '0x' + (0x48324d).toString(16).padStart(64, '0');

async hashPair(left: bigint | string, right: bigint | string): Promise<bigint> {
    const inputs = [
      this.toHex(left),
      this.toHex(right),
      DOMAIN_HASH2,   // Tag in slot 2 - CORRECT
      ZERO_PAD,
    ];
    // ...
}
```

The implementations appear to match. However, the **fixtures.ts** file uses a raw `poseidon()` helper that does NOT include domain tags:

**fixtures.ts:119-140:**
```typescript
async function computeMerkleRoot(
  leaf: string,
  path: string[],
  leafIndex: number
): Promise<string> {
  let node = leaf;
  for (let i = 0; i < path.length; i++) {
    const bit = (leafIndex >> i) & 1;
    const sibling = path[i];
    if (bit === 1) {
      node = await poseidon([sibling, node]);  // NO DOMAIN TAG!
    } else {
      node = await poseidon([node, sibling]);  // NO DOMAIN TAG!
    }
  }
  return node;
}
```

The `poseidon()` function in fixtures.ts pads with zeros, not domain tags.

**Impact:**

The circuit uses `DOMAIN_HASH2 = 0x48324d` in slot 2, but fixtures.ts uses `0` in slot 2. This should cause merkle root computation mismatches between TypeScript and Noir.

However, upon deeper inspection, the fixtures circuit (`/Users/noot/Documents/voter-protocol/packages/crypto/noir/fixtures/src/main.nr`) is a raw permutation without domain tags:

```noir
fn main(inputs: [Field; 4]) -> pub Field {
    let out = poseidon2_permutation(inputs, 4);
    out[0]
}
```

This means the fixtures are passing their own state array directly, and when Poseidon2Hasher uses `DOMAIN_HASH2`, it's passed through to the fixtures circuit correctly. The fixture generator's `poseidon()` function does NOT match the circuit's `poseidon2_hash2()`.

**Question Answered:** Does the TypeScript Poseidon2 output match the Noir circuit for all edge cases?

**Answer:** NO. The `fixtures.ts` poseidon helper computes roots WITHOUT domain tags, while the circuit's `poseidon2_hash2` uses domain tags. This is actually correct behavior because:
1. The fixtures circuit is a raw wrapper
2. `Poseidon2Hasher.hashPair()` correctly adds the domain tag
3. But `fixtures.ts` uses the raw `poseidon()` which does NOT add domain tags

This works because the circuit's merkle root computation also doesn't use explicit domain tags for internal hashing (it just uses the tagged `poseidon2_hash2` directly). The merkle path computation in the circuit at line 49 uses `poseidon2_hash2` which HAS the domain tag.

**Root Cause of Confusion:** The circuit DOES use `poseidon2_hash2` (with domain tag) for merkle computation, but fixtures.ts uses raw poseidon (without explicit domain tag). Looking more carefully:

```noir
// Circuit line 49:
node = if bit { poseidon2_hash2(sibling, node) } else { poseidon2_hash2(node, sibling) };
```

Circuit uses `poseidon2_hash2` which includes `DOMAIN_HASH2 = 0x48324d` in slot 2.

```typescript
// fixtures.ts:130-136
if (bit === 1) {
  node = await poseidon([sibling, node]);  // Raw poseidon, slot 2 = 0
} else {
  node = await poseidon([node, sibling]);  // Raw poseidon, slot 2 = 0
}
```

TypeScript uses raw poseidon which pads slot 2 with 0.

**THIS IS A BUG.** The merkle roots computed by fixtures.ts will NOT match what the circuit expects.

**Wait** - let me verify. The `poseidon()` function:

```typescript
// fixtures.ts:61-91
async function poseidon(inputs: (string | bigint | number)[]): Promise<string> {
  // Pad to 4 inputs
  const paddedInputs = [...inputs];
  while (paddedInputs.length < 4) {
    paddedInputs.push(ZERO_PAD);  // Pads with 0, not DOMAIN_HASH2
  }
```

So for `poseidon([left, right])`:
- Slot 0: left
- Slot 1: right
- Slot 2: ZERO_PAD (0x00...00)
- Slot 3: ZERO_PAD (0x00...00)

But circuit's `poseidon2_hash2(left, right)`:
- Slot 0: left
- Slot 1: right
- Slot 2: 0x48324d (DOMAIN_HASH2)
- Slot 3: 0

**THESE ARE DIFFERENT!**

**Actual Impact:**

If fixtures.ts generates merkle roots without domain tags but the circuit expects domain-tagged hashes, the proofs should FAIL. However, the tests pass according to the test file. This suggests:

1. Either the tests don't actually exercise this path
2. Or there's something else going on

Looking at the test file `district-prover.test.ts`, the test uses `Poseidon2Hasher.hashPair()` directly, NOT the fixtures.ts `poseidon()`:

```typescript
// district-prover.test.ts:66
currentHash = await hasher.hashPair(currentHash, sibling);
```

So the prover tests use the correct domain-tagged hasher, but `fixtures.ts` uses the wrong one. This means:

1. **Direct prover tests work** (they use Poseidon2Hasher correctly)
2. **fixtures.ts generated inputs may fail** (they use wrong hash)
3. **This is a silent bug** in the fixture generation

**Recommendation:**

Fix `fixtures.ts` to use domain-tagged hashing:

```typescript
// Replace poseidon([left, right]) with proper domain-tagged version
const DOMAIN_HASH2 = '0x' + (0x48324d).toString(16).padStart(64, '0');

async function poseidonHash2(left: string, right: string): Promise<string> {
  return poseidon([left, right, DOMAIN_HASH2, ZERO_PAD]);
}

// Then in computeMerkleRoot:
if (bit === 1) {
  node = await poseidonHash2(sibling, node);
} else {
  node = await poseidonHash2(node, sibling);
}
```

---

### LOW-001: Rate Limit Bypass via Multiple Action Domains

**Severity:** LOW
**Location:** `/Users/noot/Documents/voter-protocol/contracts/src/NullifierRegistry.sol:104-107`
**Attack Vector:** Nullifier Manipulation

**Description:**

The rate limit check uses the nullifier as the key:

```solidity
uint256 lastTime = lastActionTime[nullifier];
if (lastTime != 0 && block.timestamp < lastTime + RATE_LIMIT_SECONDS) {
    revert RateLimitExceeded();
}
```

However, nullifiers are scoped by actionDomain: `nullifier = hash(userSecret, actionDomain)`.

If a user has access to N different actionDomains (e.g., multiple valid voting campaigns), they can submit N proofs within the rate limit window because each actionDomain produces a different nullifier.

**Impact:**

Rate limiting doesn't prevent spam across different action domains. A user could submit proofs to 100 different actions within 60 seconds.

**Recommendation:**

Consider adding a second rate limit keyed by user identity (e.g., a hash of the leaf or a separate identity commitment):

```solidity
mapping(bytes32 => uint256) public lastActionTimeByIdentity;
// Track identity-level rate limiting separately from nullifier-level
```

---

### LOW-002: Authority Level Truncation Attack (Mitigated but Edge Case Exists)

**Severity:** LOW
**Location:** `/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/main.nr:91-98`
**Attack Vector:** Field Overflow

**Description:**

The circuit includes BA-007 fix to prevent truncation attacks:

```noir
fn validate_authority_level(authority_level: Field) {
    // BA-007 FIX: Ensure value fits in u8 before casting to prevent truncation attacks.
    // A Field value like 261 (256 + 5) would silently truncate to 5 as u8.
    assert(authority_level as u64 < 256, "Authority level exceeds u8 range");
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8, "Authority level below minimum (1)");
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8, "Authority level above maximum (5)");
}
```

The fix checks that the value fits in u64 < 256 before casting to u8. However, the Field type in BN254 can hold values up to ~2^254. The conversion `authority_level as u64` may have undefined behavior for very large Field values that don't fit in u64.

**Question Answered:** Are there arithmetic operations that can overflow the BN254 field?

**Answer:** The circuit correctly uses Field arithmetic which is modular over BN254. The range check `authority_level as u64 < 256` should reject any value >= 256. However, the behavior of `as u64` for values >= 2^64 is implementation-dependent in Noir.

**Impact:**

If an attacker could provide a Field value `x` where `x mod 2^64 < 256` but `x >= 256`, they might bypass the check. For example:
- `x = 2^64 + 5` would have `x as u64 = 5` (truncation)
- The check `5 < 256` passes
- `level_u8 = 5` passes

**Recommendation:**

Add explicit upper bound check using Field comparison:

```noir
fn validate_authority_level(authority_level: Field) {
    // Check in Field space first to prevent truncation
    assert(authority_level < 256 as Field, "Authority level exceeds u8 range");
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8);
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8);
}
```

---

### LOW-003: No Entropy Guidance for User Secrets

**Severity:** LOW
**Location:** `/Users/noot/Documents/voter-protocol/packages/noir-prover/src/types.ts:117-124`
**Attack Vector:** Proof Forgery

**Description:**

The `userSecret` field documentation mentions it must be kept secret but provides no guidance on required entropy:

```typescript
/**
 * User's secret key for nullifier generation and leaf computation.
 * MUST be kept secret - reveals user identity if exposed.
 */
userSecret: string;
```

The circuit rejects `userSecret = 0` (SA-011 fix), but there's no protection against weak secrets like `1`, `2`, or predictable patterns.

**Impact:**

Developers integrating the prover might use:
- Wallet addresses as secrets (public information)
- Sequential numbers
- Timestamps
- Other low-entropy values

**Recommendation:**

Add entropy requirements to documentation and consider adding a warning in the prover:

```typescript
/**
 * User's secret key for nullifier generation and leaf computation.
 * MUST be kept secret - reveals user identity if exposed.
 *
 * SECURITY: Must have at least 128 bits of entropy.
 * Derive from: keccak256(signMessage("voter-protocol-secret-v1"))
 * DO NOT use: wallet addresses, predictable values, or short secrets.
 */
userSecret: string;
```

---

### INFO-001: Action Domain Whitelist Is Properly Enforced

**Severity:** INFORMATIONAL
**Location:** `/Users/noot/Documents/voter-protocol/contracts/src/DistrictGateV2.sol:242`

**Question Answered:** Is the `action_domain` truly enforced by the contract, or can provers bypass it?

**Answer:** The action_domain IS properly enforced. The SA-001 fix adds:

```solidity
// SA-001 FIX: Validate actionDomain is on the governance-controlled whitelist
if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();
```

This prevents users from:
1. Generating fresh nullifiers by using arbitrary actionDomains
2. Bypassing the intended voting scope
3. Creating multiple valid proofs for the "same" action by varying domain

The whitelist has a 7-day timelock for additions, giving the community time to review new action domains.

---

### INFO-002: Leaf Index Bounds Are Properly Enforced

**Severity:** INFORMATIONAL
**Location:** `/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/main.nr:43`

**Question Answered:** What happens if `leaf_index` is larger than the tree depth allows?

**Answer:** The circuit correctly enforces bounds:

```noir
fn compute_merkle_root(leaf: Field, merkle_path: [Field; DEPTH], leaf_index: u32) -> Field {
    assert(leaf_index < (1u32 << DEPTH)); // range-constrain index
    // ...
}
```

For DEPTH=20, this asserts `leaf_index < 2^20 = 1,048,576`.

The TypeScript prover also validates:

```typescript
// fixtures.ts:228-229
if (leafIndex < 0 || leafIndex >= 2 ** depth) {
    throw new Error(`Leaf index must be 0 to ${2 ** depth - 1}, got ${leafIndex}`);
}
```

---

### INFO-003: All Private Witness Values Are Properly Constrained

**Severity:** INFORMATIONAL
**Location:** Circuit main function

**Question Answered:** Are there any unconstrained witness values that an attacker could manipulate?

**Answer:** All private inputs are properly constrained:

| Input | Constraint |
|-------|-----------|
| `user_secret` | Used in leaf computation AND nullifier; `!= 0` check |
| `district_id` | Used in leaf computation; output as public |
| `authority_level` | Range check [1,5]; used in leaf; output as public |
| `registration_salt` | Used in leaf computation |
| `merkle_path` | Must produce valid root |
| `leaf_index` | Range check < 2^DEPTH; determines path direction |

An attacker cannot:
- Submit arbitrary leaf (computed from user_secret)
- Submit arbitrary nullifier (computed from user_secret + action_domain)
- Claim arbitrary authority (range checked, bound to leaf)
- Use out-of-range indices (assertion fails)

---

### INFO-004: Domain Separation Is Well-Designed

**Severity:** INFORMATIONAL
**Location:** `/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/main.nr:23-34`

The domain separation design (BA-003 fix) prevents cross-arity collisions:

```noir
// hash2: uses [left, right, 0x48324d, 0]
// hash4: uses [a, b, c, d]
```

The tag `0x48324d` ("H2M") in slot 2 ensures `hash2(a, b)` can never equal `hash4(a, b, 0, 0)` because the state arrays differ.

The TypeScript side also correctly implements this pattern for hashPair and hashSingle operations with different domain tags (H2M and H1M).

---

## Attack Vector Analysis Summary

### 1. Proof Forgery
**Status:** MITIGATED with residual risk

- CVE-001/CVE-003 fixes bind leaf to user_secret
- user_secret != 0 prevents trivial forgery (SA-011)
- Residual risk: weak secrets (MEDIUM-001)

### 2. Proof Replay
**Status:** PARTIALLY MITIGATED with HIGH finding

- Nullifiers prevent replay within same action domain
- action_domain whitelist (SA-001) prevents cross-domain replay
- **HIGH-001**: Deactivated/expired roots still accepted

### 3. Nullifier Manipulation
**Status:** MITIGATED

- Nullifier computed inside circuit from user_secret + action_domain
- User cannot manipulate private inputs to generate arbitrary nullifiers
- CVE-002 fix removes user-controlled epoch_id/campaign_id

### 4. Merkle Path Attacks
**Status:** MITIGATED

- Leaf computed from user_secret (attacker must know secret)
- leaf_index properly range-checked
- merkle_path must produce matching root

### 5. Field Overflow
**Status:** MOSTLY MITIGATED with LOW residual

- authority_level has u8 range check (BA-007)
- Field arithmetic is modular by design
- Residual: truncation edge case for extreme values (LOW-002)

### 6. Domain Separation Bypass
**Status:** MITIGATED with MEDIUM bug

- BA-003 fixes hash arity collisions
- SA-007 fixes hashSingle collision
- **MEDIUM-002**: fixtures.ts uses wrong hash domain tags (bug, not attack)

---

## Recommendations Summary

### Critical/High Priority
1. **Add `isValidRoot()` check in DistrictGateV2** - Prevents use of deactivated/expired roots

### Medium Priority
2. **Fix domain tags in fixtures.ts** - Align with circuit's poseidon2_hash2
3. **Add entropy validation for user secrets** - Prevent weak secret usage

### Low Priority
4. **Add identity-based rate limiting** - Complement nullifier-based limits
5. **Clarify authority_level Field comparison** - Use Field-space comparison first
6. **Document entropy requirements** - Guide integrators on secure secret generation

### Testing Recommendations
7. Add fuzz tests for edge case Field values in authority_level
8. Add integration tests using fixtures.ts to catch hash divergence
9. Add tests for expired/deactivated root rejection
10. Add boundary tests for leaf_index at 2^DEPTH - 1

---

## Conclusion

The voter-protocol ZK system demonstrates mature security practices with comprehensive CVE documentation and systematic fixes. The circuit design properly binds identity to membership proofs and prevents the major classes of ZK vulnerabilities.

The most significant finding (HIGH-001) is that deactivated roots are still accepted by the verifier contract, which undermines the governance lifecycle controls in DistrictRegistry. This should be addressed before production deployment.

The MEDIUM-002 finding regarding hash domain tag mismatch in fixtures.ts is a correctness bug that could cause silent failures in fixture-based testing, but does not represent a production security vulnerability since the production code paths use the correct Poseidon2Hasher.

Overall, the system is well-architected for security, with appropriate defense-in-depth through contract-level validation, circuit-level constraints, and governance timelocks.
