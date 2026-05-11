# Report Attestation Hash Specification

> **Spec ID:** REPORT-ATTESTATION-SPEC-001
> **Version:** 1.0.0
> **Status:** NORMATIVE
> **Date:** 2026-05-07
> **Audience:** Receiving staffers, third-party verifiers, peer implementers
> **Scope:** Canonical preimage construction, hash algorithm, verification procedure for the SHA-256 attestation hash printed in the footer of every Commons verification report email.

## §1 Purpose

A Commons verification report makes claims about a campaign's recipient cohort: how many constituents are verified, how their identities decompose, how their districts distribute, what time window the submissions span. The report's footer carries an attestation hash derived from those claims so the reader can recompute it from the same canonical inputs and confirm that the rendered email has not been silently altered downstream of generation.

This document specifies the exact preimage construction and hash algorithm. Any implementation — the reference operator's, a peer implementer's, or a third-party verifier — that follows this spec arrives at the same hash for the same inputs.

## §2 Hash Algorithm

`SHA-256` over the canonical preimage. Hash is rendered as the lowercase hex digest. Length: 64 hex characters.

```
attestationHash = sha256(canonicalPreimage)
```

## §3 Canonical Preimage

The preimage is a UTF-8 byte string formed by joining the following fields, in order, with the literal separator `\n---\n` (newline, three hyphens, newline) between fields. The first field is a domain prefix; field count and order are fixed under this version.

| # | Field | Notes |
|---|-------|-------|
| 1 | `voter-protocol-report-v1` | Domain prefix. Identifies this spec version. |
| 2 | `campaign:{convexId}` | Stable canonical campaign identifier — the Convex doc id of the campaign the report concerns. **NOT** the env-coupled URL. |
| 3 | `campaignTitle` | Author-supplied campaign title, raw UTF-8. |
| 4 | `orgName` | The sending org's display name, raw UTF-8. |
| 5 | `verified` | Decimal integer, the headline verified-contact count. |
| 6 | `districtCount` | Decimal integer, the count of unique districts represented. |
| 7 | `identityBreakdown` | `{govId}\|{addressVerified}\|{emailOnly}` — three integers separated by `\|`. Empty string if no identity breakdown is available. |
| 8 | `authorship` | `{individual}\|{shared}\|{0 or 1}` — three values; the third is `1` if `explicit` was captured at submission time, `0` otherwise. |
| 9 | `dateRange` | `{earliest}\|{latest}\|{spanDays}` — ISO-8601 dates and integer day-count. |
| 10 | `geography` | Sorted comma-separated list of `{districtHash}={count}`. **Sort order:** count desc, then districtHash asc as tiebreaker (matches the visible bar-chart). |

### §3.1 Worked example

For a report with:
- campaignId `kn1abcdef`
- title `Floor vote on HR-1`
- orgName `Sample Coalition`
- verified `1234`, districtCount `12`
- identityBreakdown `{govId: 300, addressVerified: 700, emailOnly: 234}`
- authorship `{individual: 800, shared: 434, explicit: true}`
- dateRange `{earliest: 2026-01-01, latest: 2026-02-15, spanDays: 45}`
- geography `[{aaaa1111, 400}, {bbbb2222, 300}, {cccc3333, 200}]`

The preimage string is:

```
voter-protocol-report-v1
---
campaign:kn1abcdef
---
Floor vote on HR-1
---
Sample Coalition
---
1234
---
12
---
300|700|234
---
800|434|1
---
2026-01-01|2026-02-15|45
---
aaaa1111=400,bbbb2222=300,cccc3333=200
```

The SHA-256 hex digest of this string is the value rendered in the email footer as `sha256:{...}`.

### §3.2 Notes on field semantics

- **Field 2 is intentionally deployment-decoupled.** The visible "verify these claims independently" URL in the email body uses the operator's `PUBLIC_BASE_URL`; that URL is NOT in the preimage. Same data on staging vs production yields the same hash.
- **Field 7 may be empty.** Reports rendered before the trustTier denormalization landed, or where the cohort has no identity-breakdown data, omit this field's content but retain its position. Empty content is the literal empty string between separators.
- **Field 10 sort is canonical.** Two reports computed in different runs over the same data must produce byte-identical preimages. The geography sort (count desc, hash asc tiebreaker) is the canonicalization step that makes this true.

## §4 Verification Procedure

A staffer or third-party verifier MAY recompute and check the attestation:

1. Click the report's "Verify these claims independently" link to reach the operator's verification page.
2. Read the rendered fields. The verification page MUST surface every field listed in §3.
3. Construct the canonical preimage following §3.
4. Compute `sha256(preimage)` and compare to the hash in the email footer.

If the hashes match, the email body has not been altered relative to the verification page's view of the substrate. If they differ, either the email or the verification page is inconsistent — the substrate has changed, the email has been tampered with, or the operator's pipeline has a bug. In any case, the inconsistency is real and worth reporting.

## §5 Versioning

The domain prefix `voter-protocol-report-v1` declares this preimage version. Field count, order, and separator are FROZEN within v1. Any change to:

- the set of fields,
- their order,
- the separator,
- the field-7/8 sub-format,
- the geography sort,

constitutes a breaking change and MUST bump the prefix to `voter-protocol-report-v2`. A v2 spec amendment lands under §0 of this document (versioning history) before any implementation ships.

## §6 Reference Implementation

The canonical preimage builder ships at `commons/src/lib/server/email/report-template.ts`'s `canonicalPreimage()` export. The function is exported specifically to enable third-party fixture testing (`commons/tests/unit/email-report-template.test.ts` pins the invariants).

A peer implementer producing reports under this spec MUST emit the same preimage construction. Drift in any field's serialization is a non-conformance.

## §0 Versioning history

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | 2026-05-07 | Initial publication. Field set and separator FROZEN under domain prefix `voter-protocol-report-v1`. |
