# Evidence Provenance Specification

> **Spec ID:** EVP-001
> **Version:** 0.1.0
> **Status:** NEED DOCUMENTED — Design pending
> **Date:** 2026-03-06
> **Companion Documents:** DEBATE-MARKET-SPEC.md, COMMUNIQUE-INTEGRATION-SPEC.md, REPUTATION-ARCHITECTURE-SPEC.md

---

## 1. Problem Statement

The protocol verifies **who you are** (ZK proof of district membership, engagement tier). Nothing verifies **what you're saying**.

A template can cite a CBO score, a voting record, a committee transcript, or an academic paper. The AI evaluator scores reasoning, accuracy, evidence, constructiveness, and feasibility. But there is no spec for how evidence:

1. **Attaches** to a template or debate argument
2. **Gets verified** (is the citation real? does it say what the author claims?)
3. **Flows through** to the decision-maker receiving the message
4. **Persists** as an auditable chain from source to claim

Congressional staffers asked for "small surprising things like bills they may have missed" — informed perspectives they hadn't considered. The verification primitive proves the constituent is real. Evidence provenance proves the *content* is grounded.

Without this layer, verified constituent messages are trusted voices making unverified claims.

---

## 2. What Exists Today

### 2.1 AI Evaluator Scoring

The ai-evaluator package (5-model panel, median aggregation) scores debate arguments on five dimensions:

| Dimension | Weight | Current Capability |
|---|---|---|
| Reasoning quality | 0.30 | Evaluates logical coherence — no source verification |
| Factual accuracy | 0.25 | Models assess plausibility — no ground-truth lookup |
| Evidence strength | 0.20 | Models judge citation quality — no link verification |
| Constructiveness | 0.15 | Subjective assessment — no evidence dependency |
| Feasibility | 0.10 | Subjective assessment — no evidence dependency |

The AI panel evaluates *whether the argument reads as well-evidenced*, not *whether the evidence actually exists and says what the author claims*.

### 2.2 Template Content

Templates are content-addressed (Poseidon2 hash → actionId). The body is stored off-chain (IPFS via campaign metadata). There is no structured evidence field — citations are free-text within the message body.

### 2.3 Debate Arguments

Debate arguments include `body_hash` and `amendment_hash` (IPFS CIDs). The body can reference evidence, but evidence is embedded in prose, not structured as verifiable claims.

---

## 3. What's Needed

### 3.1 Structured Evidence Attachment

Templates and debate arguments need a structured evidence layer:

```
EvidenceItem {
  source_type:    "legislation" | "cbo_score" | "voting_record" | "committee_transcript"
                  | "academic_paper" | "government_report" | "news" | "data"
  source_uri:     string       // canonical URL (congress.gov, scholar, .gov domains)
  claim:          string       // what the author asserts this evidence shows
  excerpt:        string       // relevant passage from source (for verification)
  retrieved_at:   timestamp    // when the author accessed the source
  content_hash:   bytes32      // hash of source content at retrieval time
}
```

A template or argument carries an array of `EvidenceItem`. The items are structured data, not free-text citations.

### 3.2 Evidence Verification

Three levels, deployable incrementally:

**Level 0 (MVP):** Evidence items are self-reported. The AI evaluator can check whether `source_uri` is a known authoritative domain (congress.gov, cbo.gov, scholar.google.com). No content verification. This is better than nothing — it surfaces the claim/source distinction for the decision-maker.

**Level 1:** At template submission time, the server fetches `source_uri`, hashes the content, and compares against `content_hash`. If mismatch: the source changed since the author retrieved it, or the author fabricated the hash. Flag but don't block — sources update legitimately.

**Level 2:** The AI evaluator receives both the argument body and the evidence items' excerpts. The evaluation prompt includes: "Does the cited excerpt from [source_uri] support the claim [claim]? Is the excerpt accurately quoted?" This is AI-assisted verification — not ground truth, but a meaningful check on cherry-picking and misrepresentation.

**Level 3 (future):** Cryptographic content attestation. A web archival service (e.g., Wayback Machine, archive.is) provides a signed timestamp + content hash. The evidence item carries a third-party attestation that the content existed at the claimed URI at the claimed time. This is the full provenance chain.

### 3.3 Evidence in the Decision-Maker View

The staffer receiving a verified constituent message should see:

```
VERIFIED CONSTITUENT MESSAGE
District: TX-18 (ZK proof)
Engagement Tier: 3 (Advocate)
Debate Signal: AMEND 62% (14 participants)

Subject: Medicare Drug Price Negotiation - Section 4(b)

[Message body]

EVIDENCE CITED:
1. CBO Score for H.R. 3337 (cbo.gov) — "Estimated savings of $98.5B over 10 years"
   Status: Source verified, excerpt matches
2. Committee Hearing Transcript, 2026-02-14 (congress.gov) — "Chairman's opening statement..."
   Status: Source verified, excerpt matches
3. JAMA Study (doi:10.1001/jama.2025.xxxxx) — "Insulin rationing affects 1.3M Americans"
   Status: Academic source, not content-verified
```

Evidence items travel with the message. The decision-maker sees what's cited and what's been verified.

### 3.4 Evidence in the Debate Market

When the AI evaluator scores a debate argument, evidence items become structured inputs:

- **Factual accuracy** (0.25 weight): Cross-reference claims against evidence items. Are the claims supported by the cited sources?
- **Evidence strength** (0.20 weight): Are the sources authoritative? Are excerpts representative or cherry-picked? Is the evidence timely?

This transforms AI evaluation from "does this read well" to "does this say true things backed by real sources."

---

## 4. Scope Boundaries

### In Scope
- Evidence data model (structured attachment to templates and arguments)
- Evidence verification levels 0-2 (self-report, content-hash, AI-assisted)
- Evidence display in decision-maker view
- Evidence as structured input to AI evaluator

### Out of Scope (for now)
- Level 3 cryptographic attestation (requires third-party archival integration)
- Real-time legislative monitoring (see agentic-civic-infrastructure)
- Automated evidence discovery (suggesting sources for claims)
- Evidence reputation (tracking which sources are cited most accurately)

---

## 5. Dependencies

- **DEBATE-MARKET-SPEC.md §6**: AI evaluation panel — evidence items become structured inputs to the scoring prompt
- **COMMUNIQUE-INTEGRATION-SPEC.md §2**: Delivery architecture — evidence items must serialize into CWC or accompany the message in the staffer-facing view
- **Shadow Atlas IPFS**: Evidence item arrays stored alongside template/argument bodies in IPFS metadata

---

## 6. Open Questions

1. **Evidence item size limits?** Excerpts could be arbitrarily long. Need a practical bound (500 chars?) that preserves verifiability without bloating storage.
2. **Source domain allowlist vs. open?** Restricting to .gov, .edu, and known research domains increases trust but may exclude legitimate local news, NGO reports, etc.
3. **Content-hash verification timing?** Level 1 fetches the source at submission time. Sources behind paywalls or login walls can't be fetched. How to handle?
4. **Evidence for AMEND arguments?** An amendment proposes new text. Should the amendment itself carry evidence, or does it inherit the original template's evidence plus additions?
5. **Adversarial evidence?** Can a debate participant challenge a specific evidence item (e.g., "this excerpt is taken out of context")? This might be a debate market sub-market or a separate mechanism.
