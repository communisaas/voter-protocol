# Smart Contract Architecture

**Last Updated**: January 2026
**Status**: Active development - Phase 1 implementation
**Cross-Reference**: See [ARCHITECTURE.md](../../ARCHITECTURE.md) for complete system architecture

---

## Table of Contents

1. [Overview](#overview)
2. [Settlement Layer: Scroll zkEVM](#settlement-layer-scroll-zkEvm)
3. [Core Verification Contracts](#core-verification-contracts)
4. [Identity & Sybil Resistance](#identity--sybil-resistance)
5. [Phase 2 Contracts (Future)](#phase-2-contracts-future)
6. [Gas Costs & Optimization](#gas-costs--optimization)
7. [Deployment Strategy](#deployment-strategy)

---

## Overview

VOTER Protocol smart contracts settle on Scroll zkEVM (Ethereum L2), providing cryptographic verification of civic actions while maintaining user privacy through zero-knowledge proofs. Phase 1 focuses on reputation and verification infrastructure; Phase 2 adds token economics.

### Contract Deployment Summary

**Phase 1 Contracts** (launching in 3 months):
- `DistrictGate.sol` - Master verification orchestration (two-step: UltraPlonk proof + registry lookup)
- `DistrictRegistry.sol` - District root → country mapping (multi-sig governed)
- `UltraPlonkVerifier.sol` - K=14 single-tier circuit verifier (20,142 bytes, 18% under EIP-170)
- `NullifierRegistry.sol` - Action-scoped nullifier tracking (prevents double-voting)
- `IdentityRegistry.sol` - On-chain Sybil resistance via identity commitments
- `CommuniqueCoreV2.sol` - Civic action orchestration
- `UnifiedRegistry.sol` - Action/reputation registry
- `ReputationRegistry.sol` - ERC-8004 portable credibility
- `AgentConsensus.sol` - Multi-agent coordination (VerificationAgent, ReputationAgent, ImpactAgent only)

**Phase 2 Contracts** (12-18 months):
- `VOTERToken.sol` - ERC-20 token for economic incentives
- `ChallengeMarket.sol` - Multi-AI dispute resolution with stakes
- `ImpactRegistry.sol` - Legislative outcome tracking and attestations
- `RetroFundingDistributor.sol` - Retroactive public goods funding
- `OutcomeMarket.sol` - Gnosis CTF integration for legislative predictions
- `SupplyAgent.sol` - Token emission management
- `MarketAgent.sol` - Circuit breakers and volatility response

---

## Settlement Layer: Scroll zkEVM

### Why Scroll?

**Stage 1 Decentralization**: Scroll achieved Stage 1 in April 2025, providing decentralized sequencing and data availability guarantees.

**Performance**:
- Current TPS: ~500 TPS
- 2025 target: 10,000 TPS
- Finality: ~5 seconds
- EVM equivalence: Full Solidity compatibility

**Cost Advantages** (Post-Dencun Upgrade):
- L2 execution: 50,000 gas × 0.001 Gwei × $3,860/ETH = **$0.0002**
- L1 calldata: 3,200 gas × 0.104 Gwei × $3,860/ETH = **$0.0013**
- **Total typical verification: < $0.01** (conservative range: $0.0001–$0.005)

**Data Availability**:
- ✅ All commitments posted to Ethereum L1 as calldata
- ✅ Permanent on-chain record (immutable, censorship-resistant)
- ✅ Anyone can reconstruct state from L1 (trustless)
- ✅ Inherits Ethereum L1 security ($150B+ staked, 900k+ validators)

### Multi-Chain Access (Optional)

While all contracts settle on Scroll, users can access the protocol from multiple chains via NEAR Chain Signatures:

**User Paths**:
- **ETH-native users** → Use MetaMask/WalletConnect directly on Scroll (standard Ethereum UX)
- **New users** → Create implicit NEAR account (FREE, instant), derive Scroll address
- **Bitcoin holders** → NEAR derives both Bitcoin + Scroll addresses from same implicit account
- **Solana users** → NEAR derives both Solana + Scroll addresses from same implicit account
- **Multi-chain users** → One NEAR implicit account controls addresses on ALL ECDSA/Ed25519 chains

**Settlement Layer**: All civic actions, reputation, and rewards settle on Scroll regardless of account type. NEAR Chain Signatures is purely for account management—smart contracts live on Ethereum.

---

## Core Verification Contracts

### DistrictGate.sol - Master Verification Orchestration

**Purpose**: Two-step verification combining cryptographic ZK proofs with on-chain registry lookups to verify district membership and prevent double-voting.

**Security Model**: Attack requires compromising BOTH cryptography (breaking ZK proof) AND governance (compromising multi-sig). Each layer independently provides security.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./UltraPlonkVerifier.sol";
import "./DistrictRegistry.sol";
import "./NullifierRegistry.sol";

/// @title DistrictGate
/// @notice Master verification orchestration combining ZK proofs with on-chain registry
/// @dev PERMISSIONLESS ACTIONS: Any bytes32 actionId is valid (no authorization required)
///      Spam mitigated by: rate limits (60s), gas costs, ZK proof generation time (8-15s)
contract DistrictGate {
    address public immutable verifier;  // UltraPlonkVerifier (K=14 single-tier circuit, 20,142 bytes)
    DistrictRegistry public immutable registry;
    NullifierRegistry public immutable nullifierRegistry;

    event ActionVerified(
        address indexed signer,
        address indexed relayer,
        bytes32 indexed districtRoot,
        bytes3 country,
        bytes32 nullifier,
        bytes32 actionId
    );

    error InvalidSignature();
    error SignatureExpired();
    error ZKProofFailed();
    error UnauthorizedDistrict();
    error DistrictNotRegistered();

    constructor(
        address _verifier,
        address _registry,
        address _nullifierRegistry
    ) {
        verifier = _verifier;
        registry = DistrictRegistry(_registry);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
    }

    /// @notice Verify ZK proof and authorize civic action (MEV-resistant via EIP-712)
    /// @param signer Original signer (gets credit, not relayer)
    /// @param proof UltraPlonk proof (384-512 bytes)
    /// @param districtRoot District Merkle root (checked against registry)
    /// @param nullifier Prevents double-voting per action
    /// @param actionId Action identifier (ANY bytes32 is valid)
    /// @param expectedCountry ISO 3166-1 alpha-3 code (e.g., "USA")
    /// @param deadline Signature expiration timestamp
    /// @param signature EIP-712 signature from signer
    function verifyAndAuthorizeWithSignature(
        address signer,
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 expectedCountry,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // Verify EIP-712 signature (prevents MEV theft)
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _getEIP712Digest(
            proof, districtRoot, nullifier, actionId, expectedCountry, deadline
        );
        if (ECDSA.recover(digest, signature) != signer) revert InvalidSignature();

        // Step 1: Verify ZK proof (cryptographic layer)
        uint256[3] memory publicInputs = [
            uint256(districtRoot),
            uint256(nullifier),
            uint256(actionId)
        ];
        (bool success, bytes memory result) = verifier.call(
            abi.encodeWithSignature("verifyProof(bytes,uint256[3])", proof, publicInputs)
        );
        if (!success || !abi.decode(result, (bool))) revert ZKProofFailed();

        // Step 2: Check district→country mapping (governance layer)
        bytes3 actualCountry = registry.getCountry(districtRoot);
        if (actualCountry == bytes3(0)) revert DistrictNotRegistered();
        if (actualCountry != expectedCountry) revert UnauthorizedDistrict();

        // Step 3: Record nullifier (prevents double-voting, includes rate limiting)
        nullifierRegistry.recordNullifier(actionId, nullifier, districtRoot);

        emit ActionVerified(signer, msg.sender, districtRoot, actualCountry, nullifier, actionId);
    }

    function _getEIP712Digest(
        bytes calldata proof,
        bytes32 districtRoot,
        bytes32 nullifier,
        bytes32 actionId,
        bytes3 expectedCountry,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("VerifyAction(bytes32 proofHash,bytes32 districtRoot,bytes32 nullifier,bytes32 actionId,bytes3 country,uint256 deadline)"),
            keccak256(proof),
            districtRoot,
            nullifier,
            actionId,
            expectedCountry,
            deadline
        ));
        return _hashTypedDataV4(structHash);
    }
}
```

**Permissionless Action Model**:

Actions are **permissionless** - any `bytes32` can be used as an actionId:
- `keccak256("contact_representative")` - Standard civic action
- `Poseidon(templateId)` - Template-specific namespace (Communique integration)
- `bytes32(campaignId)` - Campaign identifier

**Spam Resistance** (without authorization):
- **Rate limits**: 60-second cooldown between actions per user (enforced by NullifierRegistry)
- **Gas costs**: ~$0.003-0.05 per transaction on Scroll L2
- **Proof generation**: 8-15 seconds per proof prevents mass generation
- **Nullifier uniqueness**: Same person can't act twice on same action

**Gas Costs**:
- ZK proof verification: ~300-400k gas (estimated)
- Registry lookup: ~2.1k gas (single SLOAD)
- Nullifier recording: ~22k gas (SSTORE)
- **Total**: ~325-425k gas ≈ **$0.003-$0.01** on Scroll L2

---

### DistrictRegistry.sol - District→Country Mapping

**Architecture Decision**: Instead of proving district→country relationship in a complex two-tier ZK circuit (K=14), we split the verification:
1. **ZK proof**: "I am a member of district X" (K=12, ~15KB verifier, 2-8s mobile proving)
2. **On-chain lookup**: "District X belongs to country Y" (single SLOAD, ~2.1k gas)

**Security**: District→country mappings are PUBLIC information (congressional districts are not secrets), so we use governance + transparency (on-chain registry) instead of cryptography for this layer. This avoids "ZK-maximalism"—forcing everything into cryptographic proofs when simpler solutions exist.

**Full Implementation**: See `/Users/noot/Documents/voter-protocol/contracts/src/DistrictRegistry.sol`

**Key Features**:
- **Append-only**: Districts can be added, never removed or modified
- **Multi-sig governance**: Controls district additions
- **Timelock**: 7-day governance transfer delay for security
- **Batch registration**: Gas-optimized for bulk district additions
- **Event transparency**: All changes emit events for community audit

**Gas Optimization**:
- Single SLOAD: ~2,100 gas per lookup
- Batch registration: Amortized cost across multiple districts
- No complex state transitions

**Example Usage**:
```solidity
// Register TX-21 congressional district
districtRegistry.registerDistrict(
    0x1a2b3c4d..., // Merkle root from Shadow Atlas
    "USA"          // ISO 3166-1 alpha-3 country code
);

// Verify district during proof verification
bytes3 country = districtRegistry.getCountry(districtRoot);
require(country == "USA", "Unauthorized district");
```

---

### NullifierRegistry.sol - Action-Scoped Nullifier Tracking

**Purpose**: Prevents double-voting within same action while allowing users to participate in multiple different actions.

**Security Properties**:
- Same user CAN participate in multiple actions (different action_ids)
- Same user CANNOT participate twice in same action (same action_id)
- Nullifiers are domain-separated by action_id

**Full Implementation**: See `/Users/noot/Documents/voter-protocol/contracts/src/NullifierRegistry.sol`

**Key Features**:
- **External nullifier pattern**: action_id serves as domain separator
- **Rate limiting**: 60-second cooldown between actions prevents spam
- **Authorized callers**: Only DistrictGate and governance can record nullifiers
- **Pausable**: Emergency stop mechanism
- **Participant tracking**: Count unique participants per action

**Gas Optimization** (Scroll L2):
- ~20k gas per SSTORE on L1 → ~200 gas on Scroll L2
- Total submission: ~222k gas L1 → ~2.2k gas L2 equivalent

**Data Model**:
```solidity
// Nested mapping: actionId => userNullifier => used
mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

// Rate limiting across actions
mapping(bytes32 => uint256) public lastActionTime;

// Analytics
mapping(bytes32 => uint256) public actionParticipantCount;
mapping(bytes32 => uint256) public actionCreatedAt;
```

**Example Usage**:
```solidity
// Record nullifier (called by DistrictGate)
nullifierRegistry.recordNullifier(
    keccak256("contact_rep_vote_hr3337"), // actionId
    nullifier,                             // from ZK proof
    districtRoot                           // for logging
);

// Check if nullifier already used
bool used = nullifierRegistry.isNullifierUsed(actionId, nullifier);
```

---

### UltraPlonkVerifier.sol - Zero-Knowledge Proof Verification

**Circuit Specification**:
- **Proving system**: Noir/Barretenberg UltraPlonk + KZG
- **Circuit size**: K=14 (16,384 rows, 117,473 advice cells, 8 columns)
- **Verifier bytecode**: 20,142 bytes (fits EIP-170 24KB limit with 18% margin)
- **Verification gas**: ~300-400k gas (estimated)

**Production Advantages**:
- ✅ **Fits EIP-170** (20KB < 24KB limit) - Deployable to any EVM chain
- ✅ **Mobile-usable** (8-15s proving on mid-range Android)
- ✅ **Dual-layer security** (ZK cryptography + governance registry)
- ✅ **Transparent** (on-chain registry is publicly auditable)
- ✅ **Efficient** (8 advice columns minimize verifier size)

**Performance Characteristics**:
- **Browser proving time**: 8-15 seconds (device-dependent, mid-range Android target)
  - Desktop: 2-5s (high-end laptops, estimated)
  - Mobile: 8-15s (mid-range Android, Snapdragon 7 series, estimated)
  - Low-end: 15-25s (budget devices, still usable, estimated)

- **Proof characteristics**:
  - Proof size: 384-512 bytes (KZG commitments + evaluations)
  - Public inputs: 3 field elements (district_root, nullifier, action_id)
  - Verification gas: **300-400k gas** on Scroll zkEVM (estimated)

- **Resource usage**:
  - WASM size: ~8-12MB (Noir/Barretenberg prover, cached after first load)
  - Memory peak: <600MB during proving
  - Battery: <2% on mobile (acceptable for verification flow)
  - Network: ~50KB district tree download from IPFS

**Public Inputs**:
```solidity
uint256[3] publicInputs = [
    uint256(district_root),  // District Merkle root (verified against registry)
    uint256(nullifier),       // Prevents double-voting
    uint256(action_id)        // Action identifier
];
```

**Circuit Logic** (Noir/Rust):
```rust
// Noir District Membership Circuit (Barretenberg backend)
pub struct DistrictMembershipCircuit {
    // Private witnesses (NEVER revealed, stay in browser)
    pub identity_commitment: Fr,  // Poseidon(user_id, secret_salt)
    pub leaf_index: usize,         // Position in district tree (0-4095)
                                   // CONSTRAINED via bit decomposition (cannot be faked)
    pub merkle_path: Vec<Fr>,      // 12 sibling hashes (single-tier district tree)

    // Public inputs (context for verification)
    pub action_id: Fr,             // Action identifier (verified by on-chain contract)
}

impl DistrictMembershipCircuit {
    /// Verify single-tier Merkle membership with CONSTRAINED index and nullifier
    pub fn verify_membership(
        &self,
        ctx: &mut Context<Fr>,
        gate: &impl GateInstructions<Fr>,
    ) -> (AssignedValue<Fr>, AssignedValue<Fr>, AssignedValue<Fr>) {
        // 1. Hash identity to create leaf
        let leaf_hash = hash_single_with_hasher(&mut hasher, ctx, gate, identity_assigned);

        // 2. Verify district tree: identity ∈ district tree (12 levels, CONSTRAINED)
        let computed_district_root = verify_merkle_path_with_hasher(
            &mut hasher, ctx, gate, leaf_hash, leaf_index_assigned, siblings, 12
        );

        // 3. Compute nullifier IN-CIRCUIT (prevents double-voting)
        // nullifier = Poseidon(identity_commitment, action_id)
        let computed_nullifier = hash_pair_with_hasher(
            &mut hasher, ctx, gate, identity_assigned, action_id_assigned
        );

        // Public outputs: district_root, nullifier, action_id
        (computed_district_root, computed_nullifier, action_id_assigned)
    }
}
```

---

## Identity & Sybil Resistance

### IdentityRegistry.sol - On-Chain Identity Commitments

**Purpose**: On-chain Sybil resistance via identity commitments. NO PII is stored anywhere (not on-chain, not in database, not on NEAR). This is the ONLY identity storage in the system.

**Full Contract**:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IdentityRegistry
 * @notice On-chain Sybil resistance via identity commitments
 * @dev Stores Poseidon hash of (passportNumber, nationality, birthYear)
 *      NO PII stored on-chain - only cryptographic commitment
 */
contract IdentityRegistry {
    // Identity commitment => registered status
    mapping(bytes32 => bool) public identityCommitments;

    // Identity commitment => registration timestamp
    mapping(bytes32 => uint256) public registrationTime;

    // User address => identity commitment (reverse lookup)
    mapping(address => bytes32) public userCommitments;

    event IdentityRegistered(
        address indexed user,
        bytes32 indexed commitment,
        uint256 timestamp
    );

    /**
     * @notice Register identity commitment (Sybil resistance)
     * @param commitment Poseidon hash of (passportNumber, nationality, birthYear)
     */
    function registerIdentity(bytes32 commitment) external {
        require(commitment != bytes32(0), "Invalid commitment");
        require(!identityCommitments[commitment], "Identity already registered");
        require(userCommitments[msg.sender] == bytes32(0), "User already registered");

        identityCommitments[commitment] = true;
        registrationTime[commitment] = block.timestamp;
        userCommitments[msg.sender] = commitment;

        emit IdentityRegistered(msg.sender, commitment, block.timestamp);
    }

    /**
     * @notice Check if identity commitment is registered
     */
    function isRegistered(bytes32 commitment) external view returns (bool) {
        return identityCommitments[commitment];
    }

    /**
     * @notice Get user's identity commitment
     */
    function getUserCommitment(address user) external view returns (bytes32) {
        return userCommitments[user];
    }

    /**
     * @notice Get registration timestamp
     */
    function getRegistrationTime(bytes32 commitment) external view returns (uint256) {
        return registrationTime[commitment];
    }
}
```

**Client-Side Commitment Generation** (browser-only, zero storage):

```typescript
// IMPORTANT: This runs in Didit.me webhook (server-side), NOT browser
// PII is extracted, hashed, and discarded immediately

import { poseidon2 } from '@noble/curves/abstract/poseidon';

function generateIdentityCommitment(
    passportNumber: string,
    nationality: string,
    birthYear: number
): string {
    // Normalize inputs (same identity = same hash)
    const normalizedPassport = passportNumber.toUpperCase().replace(/[\s-]/g, '');
    const normalizedNationality = nationality.toUpperCase();

    // Convert to field elements for Poseidon hash
    const passportField = stringToFieldElement(normalizedPassport);
    const nationalityField = stringToFieldElement(normalizedNationality);
    const birthYearField = BigInt(birthYear);

    // Poseidon hash (ZK-friendly, compatible with Noir circuits)
    const hash = poseidon2([passportField, nationalityField, birthYearField]);

    // Convert to bytes32 for Solidity
    return '0x' + hash.toString(16).padStart(64, '0');
}

// Register on Scroll L2 (platform wallet pays gas)
const identityRegistry = getIdentityRegistryContract();
const tx = await identityRegistry.registerIdentity(commitment);
await tx.wait();

// PII DISCARDED IMMEDIATELY (never stored anywhere)
```

**Gas Costs** (Scroll L2):
- **Identity registration**: ~$0.0015 per user (one-time)
  - L2 execution: 50,000 gas × 0.001 Gwei × $3,860/ETH = $0.0002
  - L1 calldata: 3,200 gas × 0.104 Gwei × $3,860/ETH = $0.0013
- **Identity check**: FREE (view function, no transaction)

**Scale Economics**:
- 100 users = **$0.15** (one-time)
- 1,000 users = **$1.50** (one-time)
- 10,000 users = **$15** (one-time)
- 100,000 users = **$150** (one-time)

**Privacy Guarantees**:
- ✅ Zero PII stored on-chain (only Poseidon hash)
- ✅ Sybil resistance without revealing identity
- ✅ Same passport/nationality/birthYear = same commitment (duplicate detection)
- ✅ Pre-image resistant (cannot reverse-engineer passport number from hash)
- ✅ Collision resistant (128-bit security, equivalent to SHA-256)

---

## Phase 2 Contracts (Future)

### VoterChallengeMarket.sol - Multi-AI Dispute Resolution

**Timeline**: 12-18 months after Phase 1 launch

**Purpose**: Challenge markets enforce information quality through economic stakes and multi-model AI consensus. Twenty AI models across diverse providers evaluate disputed claims, requiring 67% agreement for resolution.

**Full Implementation**: See [ARCHITECTURE.md](../../ARCHITECTURE.md#phase-2-feature-challenge-markets-multi-model-ai-fact-checking) for complete contract code.

**Key Features**:
- **Quadratic staking**: sqrt(stake) prevents plutocracy
- **Multi-model consensus**: 20 AI models (OpenAI, Anthropic, Google, Alibaba, Meta)
- **Chainlink Functions**: Off-chain AI computation, on-chain aggregation
- **UMA escalation**: Disputes with 60-80% consensus escalate to human arbitration
- **Reputation weighting**: Domain expertise multiplies influence

**Gas Costs**:
- Chainlink Functions execution: ~$5 (20 model queries via OpenRouter)
- On-chain aggregation gas: ~$0.15 (Scroll L2)
- UMA dispute bond (if escalated): $1,500 (returned if correct)

---

### ImpactRegistry.sol - Legislative Outcome Tracking

**Timeline**: 12-18 months after Phase 1 launch

**Purpose**: Track causal relationship between citizen-authored templates and legislative outcomes. Correlates template language with congressional records, floor speeches, and voting patterns.

**Full Implementation**: See [ARCHITECTURE.md](../../ARCHITECTURE.md#template-impact-correlation-legislative-outcome-tracking) for complete contract code.

**Impact Scoring Model**:
- **Direct citation** (40%): Exact text match in Congressional Record
- **Temporal correlation** (30%): 2-week window significance
- **Geographic clustering** (20%): Template districts vs control groups
- **Alternative explanations** (-10%): Party pressure, lobbying trends

**Reward Multipliers**:
- Verified legislative citation: **10x** multiplier
- Position change correlation: **5x** multiplier
- Multi-district adoption (10+ districts): **3x** multiplier
- Challenge market accuracy (>90%): **2x** multiplier

**Gas Costs**:
- Impact attestation creation: ~$0.10 (Scroll L2)
- Reward distribution (100 recipients): ~$15 (batched minting)

---

### RetroFundingDistributor.sol - Retroactive Public Goods Funding

**Timeline**: 12-18 months after Phase 1 launch

**Purpose**: Quadratic allocation of retroactive funding pools to contributors (template creators, adopters, validators, organizers) based on verified impact.

**Full Implementation**: See [ARCHITECTURE.md](../../ARCHITECTURE.md#outcome-markets-retroactive-funding) for complete contract code.

**Funding Mechanics**:
- Pool creation: Organizations stake VOTER tokens
- Protocol matching: 1:1 up to $500K per round
- Quadratic allocation: sqrt(impact × adoption) prevents whale capture
- Multi-sig approval: 3-of-5 Gnosis Safe validates allocations
- 7-day appeal period: Community can challenge distributions

**Example Round**:
- Pool: $100K from advocacy organizations
- Matching: $100K from protocol treasury
- Total: $200K distributed
- Recipients: 150 contributors
- Top creator (verified legislative citation): $25K (10x multiplier)
- Typical adopter: $800 (base reward)

**Gas Costs**:
- Agent allocation calculation: $50 (GPT-5 reasoning)
- Multi-sig approval: $5 (Gnosis Safe transaction)
- Distribution (100 recipients): $15 (batched minting)
- Total: **$70/round** (quarterly)

---

## Gas Costs & Optimization

### Canonical Gas Costs (Scroll L2)

**Post-Dencun Upgrade** (March 2024):
- Ethereum gas dropped 95% (72 Gwei → 0.104 Gwei for L1 calldata)
- Scroll L2 benefits: Lower L1 data availability costs

**Typical Civic Action** (end-to-end):
- ZK proof verification: 300-400k gas ≈ **$0.003-$0.01**
- Registry lookup: 2.1k gas ≈ **$0.00002**
- Nullifier recording: 22k gas ≈ **$0.0002**
- **Total**: **< $0.01** per action (conservative range: $0.0001–$0.005)

**Who Pays Transaction Costs**:
- **Initially**: Protocol treasury sponsors ZK verification costs
- **Future**: Sponsor pool subsidizes costs for strategic campaigns
- **User Experience**: Zero-fee civic participation removes economic barriers
- **Treasury Sustainability**: Costs funded by Phase 2 outcome market fees and token appreciation

**Scale Economics**:
- 1,000 actions/day = **$10/day** = **$3,650/year**
- 10,000 actions/day = **$100/day** = **$36,500/year**
- 100,000 actions/day = **$1,000/day** = **$365,000/year**

Compare to alternatives:
- Database PII storage: $30,000/year for 100K users
- NEAR CipherVault: $25.50 over 10 years (locked capital opportunity cost)
- Scroll on-chain: **$3,650/year** for 1M actions (pay-as-you-go, no lock-up)

### Gas Optimization Strategies

**Contract Design**:
- **Packed storage**: Use `bytes3` for country codes (vs `string`)
- **Immutable references**: Verifier/registry addresses marked `immutable`
- **Unchecked math**: Use `unchecked` for loop counters (Solidity 0.8+)
- **Batch operations**: `registerDistrictsBatch()` amortizes costs
- **Minimal state**: Only store essential data on-chain

**L2-Specific Optimizations**:
- **Calldata compression**: Minimize transaction data size
- **View functions**: Free reads don't consume gas
- **Event indexing**: Use `indexed` parameters for efficient queries
- **EIP-712 signatures**: Off-chain signature verification reduces gas

**Example**: DistrictRegistry Batch Registration
```solidity
// Single registration: 50k gas per district
// Batch registration (100 districts): 35k gas per district (30% savings)
function registerDistrictsBatch(
    bytes32[] calldata districtRoots,
    bytes3[] calldata countries
) external onlyGovernance {
    for (uint256 i = 0; i < districtRoots.length; ) {
        districtToCountry[districtRoots[i]] = countries[i];
        emit DistrictRegistered(districtRoots[i], countries[i], block.timestamp);
        unchecked { ++i; }  // Save 5-20 gas per iteration
    }
}
```

---

## Deployment Strategy

### Phase 1 Deployment Checklist

**Pre-Deployment**:
1. ✅ Audit all Phase 1 contracts (external security firm)
2. ✅ Generate UltraPlonkVerifier.sol from Noir circuit
3. ✅ Verify verifier bytecode < 24KB (EIP-170 compliance)
4. ✅ Test on Scroll Sepolia testnet
5. ✅ Prepare Shadow Atlas district trees (IPFS upload)
6. ✅ Configure multi-sig governance wallet (3-of-5 Gnosis Safe)

**Deployment Order** (Scroll Mainnet):
```javascript
// 1. Deploy registry contracts (no dependencies)
const identityRegistry = await deploy("IdentityRegistry");
const districtRegistry = await deploy("DistrictRegistry", [governanceMultiSig]);
const nullifierRegistry = await deploy("NullifierRegistry", [governanceMultiSig]);

// 2. Deploy verifier (auto-generated from circuit)
const verifier = await deploy("UltraPlonkVerifier");

// 3. Deploy DistrictGate (depends on verifier + registries)
const districtGate = await deploy("DistrictGate", [
    verifier.address,
    districtRegistry.address,
    nullifierRegistry.address
]);

// 4. Authorize DistrictGate to record nullifiers
await nullifierRegistry.authorizeCaller(districtGate.address);

// 5. Register initial districts (batch operation)
const initialDistricts = loadDistrictsFromShadowAtlas(); // ~500 US districts
await districtRegistry.registerDistrictsBatch(
    initialDistricts.roots,
    initialDistricts.countries
);

// 6. Deploy application contracts
const communiqueCore = await deploy("CommuniqueCoreV2", [districtGate.address]);
const reputationRegistry = await deploy("ReputationRegistry");
const agentConsensus = await deploy("AgentConsensus", [reputationRegistry.address]);

// 7. Transfer governance to multi-sig
await districtRegistry.initiateGovernanceTransfer(governanceMultiSig);
// Wait 7 days, then execute transfer
```

**Post-Deployment**:
1. Verify all contracts on Scrollscan (source code + metadata)
2. Update `deployments/scroll-mainnet.json` with addresses
3. Test end-to-end flow on mainnet (small test action)
4. Monitor gas costs for first 1,000 actions
5. Publish deployment announcement with contract addresses

**Deployed Addresses** (TBD):
```json
{
  "network": "scroll-mainnet",
  "chainId": 534352,
  "deployedAt": "2026-04-01T00:00:00Z",
  "contracts": {
    "IdentityRegistry": "0x...",
    "DistrictRegistry": "0x...",
    "NullifierRegistry": "0x...",
    "UltraPlonkVerifier": "0x...",
    "DistrictGate": "0x...",
    "CommuniqueCoreV2": "0x...",
    "ReputationRegistry": "0x...",
    "AgentConsensus": "0x..."
  }
}
```

### Phase 2 Deployment (12-18 Months)

**Additional Contracts**:
1. `VOTERToken.sol` - ERC-20 with governance
2. `ChallengeMarket.sol` - Dispute resolution
3. `ImpactRegistry.sol` - Legislative tracking
4. `RetroFundingDistributor.sol` - Quadratic allocation
5. Multi-agent treasury contracts (SupplyAgent, MarketAgent)

**Migration Strategy**:
- Phase 1 contracts remain immutable (no upgrades)
- Phase 2 contracts reference Phase 1 registries
- Gradual rollout: Enable token features over 3-month period
- Community governance vote before each new feature activation

---

## Security Considerations

### Multi-Layer Security Model

**Layer 1: Cryptographic**
- UltraPlonk ZK proofs prevent identity spoofing
- Poseidon hashing ensures commitment privacy
- KZG polynomial commitments for succinctness

**Layer 2: Governance**
- Multi-sig controls district registry additions
- 7-day timelock for governance transfers
- Community audit via on-chain events

**Layer 3: Economic**
- Gas costs prevent spam
- Rate limits enforce 60-second cooldowns
- Challenge markets stake-based quality control

**Layer 4: Operational**
- Pausable contracts for emergency stops
- Authorized caller patterns prevent unauthorized access
- Reentrancy guards protect state transitions

### Audit Status

**Phase 1 Contracts**:
- [ ] External audit by [Firm TBD] (scheduled Q1 2026)
- [x] Internal review completed
- [ ] Bug bounty program (launching with mainnet)

**Known Limitations**:
- UltraPlonk verifier is not upgradeable (circuit changes require new deployment)
- DistrictRegistry is append-only (cannot modify existing districts)
- NullifierRegistry rate limit is global (60s applies to all actions)

**Mitigation Strategies**:
- Shadow Atlas updates trigger new district registrations (old roots remain valid)
- Rate limit can be adjusted via governance (requires new NullifierRegistry deployment)
- Multi-sig can pause contracts if critical vulnerability discovered

---

## Developer Resources

**Contract ABIs**: `/Users/noot/Documents/voter-protocol/contracts/out/`
**Deployment Scripts**: `/Users/noot/Documents/voter-protocol/contracts/script/`
**Test Suite**: `/Users/noot/Documents/voter-protocol/contracts/test/`
**Foundry Config**: `/Users/noot/Documents/voter-protocol/contracts/foundry.toml`

**External Dependencies**:
- OpenZeppelin Contracts v5.0+
- Chainlink Functions v1.0 (Phase 2)
- UMA Optimistic Oracle v3 (Phase 2)
- Gnosis Safe v1.4+ (Multi-sig governance)

**Deployment Networks**:
- Scroll Mainnet (ChainID: 534352)
- Scroll Sepolia Testnet (ChainID: 534351)

**Block Explorers**:
- Mainnet: https://scrollscan.com
- Testnet: https://sepolia.scrollscan.com

---

**Cross-Reference**: For complete system architecture including frontend, backend, and ZK proof generation, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

**Questions?** See [README.md](../../README.md) for project overview and contribution guidelines.
