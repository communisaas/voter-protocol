# District Membership Circuit Specification (Redirect)

> **SUPERSEDED.** This document no longer contains active specification content.
>
> **Canonical cryptographic specification:** [`CRYPTOGRAPHY-SPEC.md`](CRYPTOGRAPHY-SPEC.md)
>
> **Historical content:** [`archive/DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md`](archive/DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md) preserves the v2.3.0 single-tree specification for historical reference.

The single-tree `district_membership` circuit (2 public inputs `merkle_root`, `action_domain`; 5-tuple public return) was the original ZK construction. It is dead code on the current protocol:

- Nullifier uses `user_secret` (pre-NUL-001), vulnerable to Sybil via re-registration.
- `DistrictProver` test suite gates proof generation behind `SKIP_HASH4_MISMATCH = true`.
- Not imported by any Commons live path.

The current civic action proof is `three_tree_membership` — see CRYPTOGRAPHY-SPEC §5.1. Retirement details in §11.1.
