# Governance

How the VOTER Protocol is maintained, how changes are proposed and ratified, and what users and peer implementations can expect.

## Status (2026-05)

The VOTER Protocol is in pre-launch development. The reference implementation in this repository is maintained by Communiqué PBC, the initial primary author. This is the current state of governance, not the target state.

The target state is a protocol governed by its participants — implementing organizations, peer maintainers, security auditors, and the wider community of users who rely on the substrate. Reaching that target requires both engineering work (formal change management, multi-implementation governance) and trust-building over time. This document records both the current arrangement and the path between now and there.

For an honest accounting of what the substrate currently guarantees by mathematics versus what currently rests on operator integrity, see [specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md](specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md). That document defines the *walkaway test*: the protocol passes when it continues to function safely and remain useful even if its original developers permanently stop contributing. As of launch, this protocol does not pass the walkaway test. Section 7 of `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` describes the engineering path to passing it.

## Repository scope

This governance document covers:

- The cryptographic and architectural specifications under `specs/`
- The smart contracts under `contracts/`
- The TypeScript and Noir packages under `packages/`
- The build and deployment scripts under `scripts/`
- The integration contract documented in `specs/COMMUNIQUE-INTEGRATION-SPEC.md`

Downstream applications (the Communiqué web application, peer applications, third-party tools) are governed by their own maintainers. This document does not bind them, and they do not bind this document.

## Specification change process

Specifications use four lifecycle status fields:

- **NORMATIVE** — load-bearing for protocol correctness. Implementations MUST follow these specs. Changes require a major version bump and a documented migration plan.
- **INFORMATIONAL** — context, rationale, or non-binding guidance. Useful for understanding; not required to implement.
- **EXPERIMENTAL** — proposed but not yet stable. May change without a major version bump.
- **OBSOLETE** — superseded. Retained for historical reference; should not be used in new implementations. Each obsolete spec links to its successor.

Specs declare their status at the top. When a spec changes status (typically EXPERIMENTAL → NORMATIVE, or NORMATIVE → OBSOLETE), the change is recorded in the spec's history section.

### Versioning

Specs use semantic-style version numbers (e.g., `1.0.0`, `1.1.0`, `2.0.0`):

- **Major** (1.x.x → 2.x.x): NORMATIVE behavior changes that break compatibility with prior implementations. Examples: changing a domain-separation tag, adding a required public input to a circuit, replacing a hash function. Major bumps require a documented migration plan.
- **Minor** (1.0.x → 1.1.x): NORMATIVE additions that are backward-compatible with prior implementations. Examples: adding an optional field, defining a new credential type, extending an enum.
- **Patch** (1.0.0 → 1.0.1): editorial corrections, clarifications, INFORMATIONAL updates that do not change implementation behavior.

### How to propose changes

Substantive changes to NORMATIVE specs follow an RFC-style process. The mechanics — directory layout, required sections, lifecycle, and archival — are documented in [specs/proposals/README.md](specs/proposals/README.md).

In summary:

1. Open a draft proposal under `specs/proposals/<short-name>-<sequence>.md` with the sections required by that README.
2. Discuss in a pull request. The proposal is iterated against feedback from maintainers, peer implementations, and security reviewers.
3. When consensus is reached, the proposal is merged, the affected NORMATIVE specs are version-bumped, and the proposal is archived under `specs/proposals/accepted/<year>/`.
4. Implementations roll forward at their own pace. The reference implementation (this repository's packages) typically updates first.

Editorial corrections (typos, clarifications, broken links) skip the proposal step and go directly to a pull request.

## On-chain governance

The protocol uses smart contracts on Scroll L2 for verifier registration, root anchoring, nullifier tracking, and engagement attestation. Several of those contracts share a base contract, [`TimelockGovernance`](contracts/src/TimelockGovernance.sol), which holds the *governance* address and enforces a timelock on transferring ownership of that address.

What the timelocks actually enforce, by contract:

- **`TimelockGovernance`** governs **owner-key transfer only**. The minimum permissible delay is `MIN_GOVERNANCE_TIMELOCK = 10 minutes` ([TimelockGovernance.sol:35](contracts/src/TimelockGovernance.sol#L35)). The actual delay used by a deployment is the immutable `GOVERNANCE_TIMELOCK` set at construction ([TimelockGovernance.sol:39, 54-57](contracts/src/TimelockGovernance.sol#L39)). This contract does **not** govern root or verifier changes.
- **`UserRootRegistry`, `CellMapRegistry`, `EngagementRootRegistry`**: a new tree root is **registered immediately**, with no timelock ([UserRootRegistry.sol:82-83](contracts/src/UserRootRegistry.sol#L82-L83): "*New roots are ACTIVE immediately (no timelock for registration). Deactivation/expiry require 7-day timelock for safety.*"). Subsequent lifecycle changes — deactivation, expiry, reactivation — go through the shared `AbstractRootLifecycle` flow, which uses the same `GOVERNANCE_TIMELOCK` value as owner-key transfer ([AbstractRootLifecycle.sol:87, 123, 158](contracts/src/AbstractRootLifecycle.sol#L87)). The registry docstrings refer to a "7-day timelock"; that is the value the deployer is expected to set, not a contract-enforced minimum. A deployment that set `GOVERNANCE_TIMELOCK = 10 minutes` would honour the docstring expectation only as documentation, not as math.
- **`VerifierRegistry`**: the minimum permissible delay is `MIN_VERIFIER_TIMELOCK = 10 minutes` ([VerifierRegistry.sol:84](contracts/src/VerifierRegistry.sol#L84)); the actual delay is the immutable `VERIFIER_TIMELOCK` set at construction. The 14-day window described in the contract's docstrings ([VerifierRegistry.sol:38, 177, 232](contracts/src/VerifierRegistry.sol#L38)) is a **community-audit expectation**, not an enforced minimum. Whether 14 days is honoured depends on the deployer-supplied constructor argument.
- **`NullifierRegistry`**: caller authorization and revocation use the immutable `CALLER_AUTHORIZATION_TIMELOCK`, with `MIN_CALLER_AUTH_TIMELOCK = 10 minutes` ([NullifierRegistry.sol:105](contracts/src/NullifierRegistry.sol#L105)). The "7-day" references in the docstrings are the same expectation pattern.
- **`RevocationRegistry`**: relayer authorization and revocation use the immutable `RELAYER_AUTHORIZATION_TIMELOCK`, with `MIN_RELAYER_AUTH_TIMELOCK = 10 minutes` ([RevocationRegistry.sol:118](contracts/src/RevocationRegistry.sol#L118)). The on-chain SMT root, by contrast, advances **without timelock** when an authorized relayer calls `emitRevocation` ([RevocationRegistry.sol:228](contracts/src/RevocationRegistry.sol#L228)).
- **`DistrictGate`**: separate immutable timelocks govern campaign-registry changes, action-domain whitelisting, authority-level increases, and revocation-registry pointer changes; each has its own `MIN_*_TIMELOCK = 10 minutes` floor ([DistrictGate.sol:79, 99, 111](contracts/src/DistrictGate.sol#L79)). Action-domain registration uses `ACTION_DOMAIN_TIMELOCK`; revocation-registry pointer changes use `GOVERNANCE_TIMELOCK` ([DistrictGate.sol:610](contracts/src/DistrictGate.sol#L610)). `pause()` is **immediate**, by design, so a defect can be neutralised without waiting.
- **`SnapshotAnchor`**: quarterly Atlas-snapshot updates require only `onlyGovernance`. Epoch numbers must be strictly monotonic, but no timelock applies to publishing a new snapshot ([SnapshotAnchor.sol:69-88](contracts/src/SnapshotAnchor.sol#L69)).
- **`GuardianShield`** (abstract base, **not yet active**): designed for a multi-jurisdiction guardian set with veto power on pending governance actions ([GuardianShield.sol:19-100](contracts/src/GuardianShield.sol#L19)). The contract is **not inherited by any deployed registry** and **no guardians are recruited**, so it carries no on-chain authority today. See *Planned but not yet active* below for scope and the gating conditions before it counts as a trust input.

These delays exist so that affected parties — users, peer implementations, security researchers — have time to inspect proposed changes before they take effect. **They do not eliminate trust in whoever holds the governance key; they make that trust legible and auditable.** A deployment that sets a 10-minute timelock honours the floor but offers no meaningful audit window. Whether a deployment is trustworthy in practice depends on the values its deployer chose.

The deployment runbook [`contracts/DEPLOYMENT-V2.md`](contracts/DEPLOYMENT-V2.md) records the operator's intended values for the v2 deployment: `GOV_TIMELOCK = 604800` (7 days) and `RELAYER_TIMELOCK = 604800` (7 days), with verifier upgrades on a 14-day timelock. As of 2026-05-05, the canonical deployed-addresses record at [`contracts/deployed-addresses.template.json`](contracts/deployed-addresses.template.json) is empty. **No checked-in deployment record yet binds a public address to a configured timelock value.** Producing a canonical, signed deployment manifest — listing each deployed contract address, the constructor arguments used, and the resulting on-chain timelock values — is a Phase 0 follow-up before launch. Reliance parties should consult that manifest, not this section, to confirm what is actually live.

### Current key control

The `governance` address on every deployed registry contract is currently held by Communiqué PBC. This is consistent with the pre-launch single-maintainer posture; it is not the target state.

The question this section is intended to answer is: **what can Communiqué PBC change, ignoring timelocks, today?**

| Contract | Privileged role(s) | Current holder | Untimelocked actions |
|---|---|---|---|
| `TimelockGovernance` (base) | `governance` | Communiqué PBC | Initiate/cancel its own ownership transfer |
| `UserRootRegistry` | `governance` | Communiqué PBC | **Register a new user-tree root** (immediate); initiate root deactivation/expiry/reactivation (timelocked execution) |
| `CellMapRegistry` | `governance` | Communiqué PBC | **Register a new cell-map root** (immediate); initiate deprecation/expiry (timelocked execution) |
| `EngagementRootRegistry` | `governance` | Communiqué PBC | **Register a new engagement root** (immediate, auto-expires after 180 days); initiate deactivation/expiry (timelocked execution) |
| `RevocationRegistry` | `governance`, `authorizedRelayers` | PBC (governance); PBC operator key (relayer) | **Advance the SMT root via `emitRevocation`** (immediate, by relayer); pause/unpause (immediate, by governance); initiate relayer authorization/revocation (timelocked execution) |
| `NullifierRegistry` | `governance`, `authorizedCallers` | PBC (governance); `DistrictGate` (caller) | Pause/unpause (immediate); initiate caller authorization/revocation (timelocked execution) |
| `DistrictGate` | `governance`, `authorizedDerivers` | Communiqué PBC | Pause/unpause (immediate); set genesis configuration before `sealGenesis` (immediate); initiate timelocked changes to action-domain whitelist, registry pointers, derivers, authority floors |
| `SnapshotAnchor` | `governance` | Communiqué PBC | **Publish a new quarterly Atlas snapshot** (immediate); initiate ownership transfer (timelocked) |

In plain terms: today Communiqué PBC can, without warning, **register a new identity-tree, cell-map, engagement, or Atlas-snapshot root**, and **emit a revocation that advances the on-chain revocation root**. PBC cannot, without warning, **transfer the governance key**, **swap a verifier**, **change the action-domain whitelist**, **change the revocation-registry pointer**, or **deactivate an existing root** — those go through the configured timelocks. PBC can pause any of the pausable contracts immediately; a pause halts new submissions but does not change registered state.

#### Planned but not yet active

`GuardianShield` ([`contracts/src/GuardianShield.sol`](contracts/src/GuardianShield.sol)) is an abstract base contract designed for a multi-jurisdiction guardian set with veto power on pending governance actions. **It is not inherited by any deployed registry and no guardians are recruited.** It is intentionally retained in-tree as documentation of the upgrade path; it does not appear in the privileged-roles table above because it carries no live authority today. When recruited and wired into a deployed registry, a single guardian veto would block the targeted action. Until that wiring exists, do not include `GuardianShield` in any reliance-party trust analysis — only the contracts in the table above carry on-chain authority. This document makes no commitment about activation timing.

Per-registry deployed addresses, constructor arguments, and the timelock values they actually carry will be enumerated in the canonical deployment manifest noted above; until that manifest is published, the source of truth for "who holds what key" is this section plus the `governance()` view on each deployed contract.

### Planned transition

Section 7 of `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` describes the intended progression: from single-org operator, to multisignature shared with peer implementations, to permissionless tree building with on-chain dispute resolution. Each transition step is gated on third-party-verifiable criteria, not on PBC's self-assessment.

The criteria for moving to the next phase are:

1. **Independent operator presence.** At least one peer implementation has, for **≥90 consecutive days**, signed and broadcast registry transactions on the canonical Scroll L2 deployment from a key not controlled by Communiqué PBC (verified by on-chain provenance), with **at least 1,000 successful three-tree proof verifications** routed through that peer's relayer over the 90-day window. *Per Section 7 of `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`, ossification is targeted for 12-24 months post-launch; "independent operator presence" is intentionally early on that curve so a single peer can unblock progress without waiting for full Phase 3.*
2. **Successor governance specification merged.** The next-phase governance spec (e.g., a multisig-with-veto specification, or an on-chain governance contract spec) is merged into this repository at **NORMATIVE** status with version **≥1.0.0**, has gone through the proposal lifecycle in [specs/proposals/](specs/proposals/), and has been reviewed in writing by an operator of at least one independent peer implementation as defined in (1).
3. **Independent audit, publicly hosted.** The transition mechanism (the contract changes, the multisig recovery procedure, the key-handover ceremony) is audited by a named auditor under a written engagement, and the audit report is published on a **domain not controlled by Communiqué PBC**. The auditor must not be a current or former PBC employee, contractor, or fund recipient.

If these gates are not met by **24 months after the launch date recorded in `specs/CRYPTOGRAPHY-SPEC.md` §0**, Communiqué PBC commits to reopen this document with a presumption against continued single-org control. Operators meeting *Planned transition* (1) may accept the **standing offer of arbitration** in *Conflict resolution* §"Standing offer" to compel reopening if PBC fails to honor the commitment. "Reopened" means the spec-change process described above is invoked specifically to renegotiate the gates or the timeline; it does not automatically transfer control.

At the **12-month** mark from launch, Communiqué PBC SHALL publish a written progress report comparing actual progress against each of the three gates above. The report has no automatic consequence; its purpose is to expose drift early enough that course correction is possible.

#### Limits on the standing offer of arbitration before a peer implementation arrives

The standing offer of arbitration in *Conflict resolution* §"Standing offer" expressly defines its acceptor class as a peer-implementation operator meeting *Planned transition* (1). The contested-proposal definition in *Conflict resolution* item 2 separately accepts an **independent security researcher unaffiliated with Communiqué PBC** for the narrower purpose of triggering contested-proposal procedure — that route remains available pre-peer for the proposal-review pipeline. The standing offer of arbitration is not yet acceptable by anyone within its expressly defined acceptor class until a peer implementation arrives. The 24-month sunset under *Conflict resolution* item 4 self-terminates PBC's authority over governance disputes; absent peer-implementation arrival, the only mechanisms by which the sunset's deactivation is operative are (a) PBC's own self-restraint and (b) extra-document avenues that this instrument neither creates nor limits. This document does not address what extra-document remedies, if any, may be available to any reliance party; reliance parties should consult their own counsel and form their own view, and PBC neither concedes nor disputes the availability of any specific theory. PBC may, in its sole discretion and without any obligation of consideration or response, propose or decline to propose future revisions of the standing offer; nothing in this section obligates PBC to invoke any particular procedure to decline. Reliance parties expressly disclaim, and shall be deemed to have disclaimed, any reliance on any future extension of the standing offer; PBC makes no representation, express or implied, that the standing offer will ever be extended, and any such reliance is not reasonable as a matter of fact or law.

### Insider-conflict rule (cross-cutting)

Wherever this document specifies a third party — an auditor, a named arbitrator, an emeritus signer, a foundation contact — that party must not be a current or former Communiqué PBC employee, contractor, or fund recipient. Any future foundation or fiscal sponsor accepted as successor must accept the protocol on terms that prohibit PBC controlling more than 25% of the sponsor's board composition or annual budget. The purpose of this rule is to prevent the cleanest acquisition-capture strategy — hire whoever you would otherwise have to dispute against — from working. PBC's good-faith intent is not a substitute; the rule binds even where conflict is unintended.

**Launch-period exemption.** For the first 24 months post-launch (per the date in `specs/CRYPTOGRAPHY-SPEC.md` §0), the emeritus multisig may include up to **2 of 5** signers who were Communiqué PBC employees, contractors, or fund recipients within the prior 24 months, provided no such signer was paid by PBC in the 6 months prior to multisig nomination. The exemption sunsets at the 24-month mark or when the multisig can be constituted with 5 signers fully outside the rule, whichever is earlier. The exemption applies even if `specs/EMERITUS-CHARTER.md` is not yet published; the stewardship license attaches at GOVERNANCE.md publication and the multisig becomes its grantee once charter publication identifies signers. The exemption applies only to the multisig; the named arbitrator (under *Conflict resolution* item 4) is bound by the full rule with no transitional carve-out, because arbitrator independence cannot be partially compromised without compromising the whole.

## Succession

Reliance parties should be able to predict what becomes of the protocol if Communiqué PBC ceases to exist or changes character. This section commits to those predictions.

### Change of control (sale, acquisition, merger)

If Communiqué PBC is sold, acquired, or merged in a transaction that changes who effectively controls the deployed governance keys, the following must occur **before** the transaction closes:

- **Notice.** A written notice is published to this repository, to every peer implementation registered per the criteria in *Planned transition* (1), and to a public mailing list, **at least 60 days** before close.
- **Key transfer.** The deployer keys do not transfer to the acquirer by default. The successor entity is structured as follows.

  *Primary successor.* A **3-of-5 emeritus maintainers multisig**. The five signers are named individuals who have served as protocol maintainers and who are **not** current Communiqué PBC employees, contractors, or fund recipients (the insider-conflict rule below applies). Their charter is published as `specs/EMERITUS-CHARTER.md`, a Phase 0.5 deliverable forward-referenced from this document. The charter MUST enumerate: (a) the signers' duties — key custody, trademark policing, dispute reception; (b) a modest fixed quarterly fee to compensate the fiduciary effort; (c) indemnification by Communiqué PBC for actions taken in good faith within charter scope; and (d) an explicit easy-resignation procedure requiring 30 days written notice plus ratification of any pending action.

  *Interim period (pre-charter).* Until `specs/EMERITUS-CHARTER.md` is published and the five emeritus signers are named, any change-of-control event that triggers under this section routes directly to the designated escrow agent (see *Designated escrow agent* below), bypassing the multisig path. Phase 0.5 closes when the charter is published and the signers are named; until that close, the interim escrow path is the operative succession mechanism, not a fallback. The stewardship license under §"Pre-dissolution stewardship license" attaches at GOVERNANCE.md publication and grants to the designated escrow agent immediately; it grants to the multisig once charter publication identifies signers.

  *Fallback.* If the multisig falls below 3 live signers and is not replenished within 60 days, the deployer keys, repository control, and trademark rights transfer to the designated escrow agent (see *Designated escrow agent* below), serving as escrow agent. The escrow agent's duty is to hold the keys and marks pending re-establishment of a qualifying multisig, distribute under the substrate license grant in §"Dissolution" if PBC subsequently dissolves, and apply distribution rules per §"Asset transfer" below. "Deployed addresses" is a rule of allocation referenced by the agent — the addresses are not themselves the beneficiary.

  *Designated escrow agent.* Communiqué PBC commits, before launch, to secure written acceptance from **Software Freedom Conservancy** (or, if SFC declines, an established civic-tech-aligned 501(c)(3) such as Open Source Initiative, Open Source Collective, or Code for Science & Society) to serve as escrow agent for this section. The acceptance, when secured, is published as `specs/ESCROW-ACCEPTANCE.md` referenced from this section. Until acceptance is secured, the reference to SFC is a forward-looking commitment, not a binding designation; the dependency is tracked as a Phase 0.5 hard launch gate. PBC commits not to launch the protocol substrate as canonical-reference-implementation until either (a) escrow acceptance is published per this section OR (b) this section is amended via the spec-change process to remove the dependency. Launching without one of those conditions is inconsistent with the commitment in this section. Whether such a launch gives rise to any actionable claim, in any forum, is determined by the acceptor and the adjudicator identified below, and not by this document; see *Conflict resolution* §"Standing offer" and *Limits on the standing offer of arbitration before a peer implementation arrives* for who may invoke the named forum and on what terms.

  *Foundation track (encouraged, not gating).* A parallel-track conversation with an established fiscal sponsor — Software Freedom Conservancy, OpenJS Foundation, or a civic-tech-specific umbrella — is encouraged but is not a launch-gating dependency. If a fiscal sponsor is accepted before the 12-month progress report described in *Planned transition*, this section is amended via the spec-change process to name that sponsor as primary successor in place of the emeritus multisig.

  The acquirer may negotiate a license to operate the reference implementation under the successor entity's control, but does not inherit unilateral key authority.
- **Reopening.** Communiqué PBC (and any successor entity acquiring the substrate license under §"Dissolution") commits to reopen this document on the change-of-control date, on the same terms as the *Planned transition* sunset above. Operators meeting *Planned transition* (1) may accept the **standing offer of arbitration** in *Conflict resolution* §"Standing offer" to compel reopening.

### Dissolution

If Communiqué PBC is dissolved, wound up, or its public-benefit purpose is amended out, then:

Under current Delaware law (as amended by HB 341 (82 Del. Laws c. 256, 2020)), the default threshold to amend a §362(a)(1) public-benefit purpose out of a PBC's certificate of incorporation is the §242(b)(1) majority vote of outstanding stock entitled to vote, not a supermajority. (DGCL §363 still exists but was repurposed by HB 341 to address nonprofit-nonstock mergers and is no longer the supermajority gate for PBC purpose deletion.) To restore the supermajority assumption that the rest of this section relies on — that purpose-deletion is harder to engineer than ordinary-course business — Communiqué PBC SHALL amend its Certificate of Incorporation to require a 2/3 stockholder vote for any amendment that deletes or materially alters the §362(a)(1) public-benefit purpose. Until that COI amendment is filed and dated, the supermajority protection invoked by this section is aspirational rather than chartered.

### Pre-dissolution stewardship license

Effective upon publication of this GOVERNANCE.md as the canonical governance record (the date this document is first merged into the `main` branch of the canonical repository at `github.com/communisaas/voter-protocol`), Communiqué PBC grants to the emeritus maintainers multisig (once constituted per *Change of control*) AND to the designated escrow agent named under *Change of control* (Software Freedom Conservancy or accepted alternative) a **perpetual, non-exclusive, royalty-free, irrevocable license** to act as steward of the protocol substrate covered by this document, including: governance authority to coordinate the canonical reference implementation (the contents of `specs/`, the canonical Scroll L2 deployment, the deployer keys for registries operating under those specs); operational continuity of those keys; and exercise of trademark rights under [TRADEMARK.md](TRADEMARK.md) subject to the separate transfer mechanism in *Asset transfer* below.

What this grant adds over the public licenses: the public Apache-2.0 (LICENSE) and CC-BY-4.0 (LICENSE-CC-BY-4.0) licenses cover substrate **use** — anyone may use, modify, sublicense, and develop the protocol under those terms. This grant covers substrate **stewardship** — the authority to act as the canonical-reference-implementation maintainer when Communiqué PBC ceases to play that role. Public licenses survive any dissolution by their own terms (Apache §2 perpetuity; CC-BY-4.0 §6 irrevocability); the stewardship license is independent of and additional to those.

Consideration enumerated: this grant is supported by reasonably equivalent value, as required by 11 U.S.C. §548(a)(1)(B), in the form of the grantees' enumerated obligations under their own constitutive instruments — the emeritus multisig's fiduciary duties under EMERITUS-CHARTER.md (key custody, trademark policing, dispute reception, fixed quarterly fee compensating the fiduciary effort, indemnification by PBC limited to good-faith acts within charter scope, replacement-implementation continuity duties); the designated escrow agent's fiscal-sponsorship-style stewardship duties under its accepted role; and the dispute-reserve fund's mission-bound contribution to peer-protective dispute resolution. Communiqué PBC represents that, as of the date of this grant, it is solvent within the meaning of 11 U.S.C. §101(32) and the value of the consideration above is reasonably equivalent to the value of the rights granted.

Honest acknowledgment of §548 risk. This grant does not attempt to circumvent §548. If a future bankruptcy trustee successfully avoids this grant under §548(a)(1)(B), the public Apache-2.0 and CC-BY-4.0 licenses already in force survive independently. Those public licenses are sufficient to keep the protocol substrate available to anyone who wishes to operate a peer implementation; they do NOT confer canonical-reference-implementation authority, which is what the stewardship license is designed to preserve. In a §548-avoidance scenario, the canonical-reference-implementation authority is auctioned to the highest bidder, but the substrate remains publicly available and any operator may declare a non-canonical fork that follows the spec. This is the worst-case outcome; the purpose of the stewardship license is to make this worst case avoidable, not to claim immunity from it.

- **Notice.** Peer implementations and the public receive **at least 90 days** notice through the channels above. For a §242(b)(1) amendment that would delete the public-benefit purpose, the notice obligation begins when the special-meeting record date is set, not when the vote is taken.
- **Asset transfer.** Deployer keys, repository control, and trademark rights transfer to the successor named in *Change of control* above — the 3-of-5 emeritus maintainers multisig, with the Software Freedom Conservancy escrow as fallback. The successor *entity* (multisig + escrow fallback) is intentionally identical between change-of-control and dissolution to close the structuring loophole described in *Change of control*: an acquirer cannot dissolve the entity to bypass the change-of-control transfer, because both paths route to the same destination. The substrate IP transfers via the stewardship license above (which attaches at GOVERNANCE.md publication, well before any potential insolvency event, and is supported by enumerated consideration; if §548 avoidance succeeds, the public licenses preserve substrate availability but not canonical-reference authority) rather than via post-dissolution asset distribution; the trademark rights transfer post-dissolution per the procedure in this subsection, subject to §281(b) priorities.
- **Reopening.** Communiqué PBC (and any successor entity acquiring the substrate license under §"Dissolution") commits to reopen this document on the dissolution effective date. Operators meeting *Planned transition* (1) may accept the **standing offer of arbitration** in *Conflict resolution* §"Standing offer" to compel reopening.

If no successor entity is named in this repository at the time of dissolution, dissolution does not extinguish the licenses (Apache-2.0 §2 and CC-BY-4.0 grant perpetual rights, non-revocable except as specified in their respective termination clauses — Apache-2.0 §3 patent-litigation termination, CC-BY-4.0 §6 condition-failure termination), but **no one inherits trademark authority**, and the keys transfer to the designated escrow agent identified under §"Change of control" *Designated escrow agent*. Communiqué PBC commits, before launch, to secure written acceptance from **Software Freedom Conservancy** (or, if SFC declines, an established civic-tech-aligned 501(c)(3) such as Open Source Initiative, Open Source Collective, or Code for Science & Society) to serve as escrow agent for this section. The acceptance, when secured, is published as `specs/ESCROW-ACCEPTANCE.md` referenced from this section. Until acceptance is secured, the reference to SFC is a forward-looking commitment, not a binding designation; the dependency is tracked as a Phase 0.5 hard launch gate. PBC commits not to launch the protocol substrate as canonical-reference-implementation until either (a) escrow acceptance is published per this section OR (b) this section is amended via the spec-change process to remove the dependency. Launching without one of those conditions is inconsistent with the commitment in this section. Whether such a launch gives rise to any actionable claim, in any forum, is determined by the acceptor and the adjudicator identified below, and not by this document; see *Conflict resolution* §"Standing offer" and *Limits on the standing offer of arbitration before a peer implementation arrives* for who may invoke the named forum and on what terms. The escrow agent applies the rule-of-allocation referenced in §"Asset transfer" — "deployed addresses" identifies which on-chain assets are governed, not who holds the beneficial interest — and control is then vested in whichever maintainers, peer implementations, or community process the dissolution court approves. This is a worse outcome than a named successor; the purpose of this section is to make that worse outcome avoidable.

### Public-benefit purpose amendment

If PBC's public-benefit charter is amended to remove the public-benefit purpose, that change is treated as a *change of control* for the purposes of this document, even if the legal entity is unchanged. The 60-day notice requirement above applies. Peer implementations may, on their own authority, treat the amendment as grounds to invoke the *Conflict resolution* dispute path described below.

## Federation

Peer implementations of the VOTER Protocol are welcome. The licenses (Apache-2.0 for code; specs dual-licensed under CC-BY-4.0 OR Apache-2.0 — see [LICENSE](LICENSE), [LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0), and [LICENSE-specs](LICENSE-specs)) permit independent implementations.

The following are sufficient for an implementation to claim VOTER Protocol compatibility:

- Implements the cryptographic primitives in `specs/CRYPTOGRAPHY-SPEC.md` exactly as specified — domain tags, Poseidon2 parameters, the public input contract documented in `specs/PUBLIC-INPUT-FIELD-REFERENCE.md`. The canonical FROZEN domain strings are now `voter-protocol-*` (per the [§0 Namespace Amendment](specs/CRYPTOGRAPHY-SPEC.md#0-namespace-amendment-2026-05-05) dated 2026-05-05), so an implementation that ships these strings does not embed the Communiqué brand in its cryptographic context.
- Reads from and writes to the canonical on-chain registries on Scroll L2, or a documented alternative chain with explicit version namespacing.
- Validates anchored Merkle roots through the same on-chain authority as the reference implementation, or a documented compatible authority.
- Documents its trust model honestly per the TRUST-MODEL spec.

Compatibility is determined by the math, not by branding. An implementation that implements the spec correctly is compatible regardless of who maintains it. The §0 amendment was the prerequisite for this sentence to be honest: previously, the FROZEN strings carried `commons` in the substrate, so even a perfectly-compatible peer would have embedded a single implementation's brand in every nullifier it ever produced.

If a peer implementation finds a spec ambiguity, the recommended path is to open a clarification pull request against this repository. The reference implementation is one of several possible; the specs are the source of truth.

## Conflict resolution

### Standing offer of arbitration

Communiqué PBC, by publication of this document, makes a **unilateral standing offer** — enforceable in Delaware Chancery under standard offer-and-acceptance plus reasonable-reliance doctrine — to arbitrate under JAMS Streamlined Arbitration Rules (or AAA Commercial Arbitration Rules as fallback per item 4 below) any dispute raised by a peer-implementation operator meeting the criteria in *Planned transition* (1) about PBC's compliance with the obligations of this document. Acceptance of the offer is established when the peer operator files a JAMS demand citing this section; from that moment forward, the resulting arbitration agreement is bilateral and the asymmetric fee-shifting and dispute-reserve-fund provisions in item 4 apply. The standing offer survives any change of control or dissolution insofar as the obligations of this document survive, because PBC (or any successor entity that holds the stewardship license under §"Pre-dissolution stewardship license") is bound by the offer until it is formally withdrawn under the spec-change process. PBC waives any defense based on the absence of a pre-existing bilateral arbitration contract.

Disputes are resolved as follows:

1. **Routine** — style, organization, non-normative wording: maintainer judgment.

2. **Normative** — security implications, federation impact: RFC-style proposal as above. Maintainers shall not close a contested NORMATIVE proposal without:
   - (a) responding **in writing** to each substantive concern raised by a reviewer, on the proposal's pull request;
   - (b) **waiting at least 14 days** from the most recent substantive comment before merging or closing; and
   - (c) recording the closure rationale in the proposal's archival entry under `specs/proposals/accepted/<year>/` or `specs/proposals/rejected/<year>/`.

   A proposal is **contested** if at least **2 reviewers** — including at least one operator of a deployed peer implementation as defined in *Planned transition* (1), **or** at least one independent security researcher unaffiliated with Communiqué PBC — raise concerns in writing that the maintainers have not addressed at the time of closure. Concerns "raised" means filed as PR comments, GitHub issues, or written communication recorded in the archival entry; oral or private remarks do not count.

3. **Security** — see [SECURITY.md](SECURITY.md). Coordinated disclosure with affected implementations.

4. **Governance** — who can tag releases, who controls keys, who speaks for the protocol: pre-peer-implementation, governance disputes are routed to **JAMS streamlined-arbitration** under the JAMS Streamlined Arbitration Rules in effect at the time of dispute, conducted in writing where possible to reduce cost. The arbitrator's decisions are binding subject to the on-chain timelock windows above. An **asymmetric fee-shifting clause** applies. If the prevailing party is a challenger (defined below) and PBC is the losing party, PBC reimburses the challenger's reasonable attorney fees and JAMS administrative fees. If PBC is the prevailing party against a challenger, PBC bears its own fees regardless of outcome — the challenger's liability is capped at the JAMS administrative fees actually advanced from the dispute-reserve fund (see below), and PBC may not recover its attorney fees from the challenger.

   "**Challenger**" for purposes of this clause means a party that does NOT meet the "PBC-equivalent" criteria below, including individual users, security researchers without sponsoring organizations, peer implementations operated as solo or volunteer projects, and small organizations under the threshold.

   "**PBC-equivalent party**" means an organization with annual operating budget exceeding USD 1,000,000 AND in-house or retained legal counsel exceeding 0.5 FTE. Threshold determination is made by the JAMS arbitrator at preliminary hearing based on the challenger's submitted self-certification (a one-page declaration under penalty of perjury) and PBC's response (filed within 14 days of the self-certification). PBC bears the burden of proof to reclassify a self-certifying challenger as PBC-equivalent. The arbitrator's threshold determination is binding for the duration of the arbitration but does not bind future arbitrations.

   Between two PBC-equivalent parties, standard JAMS Rule 26(c) joint-and-several administrative-fee allocation applies, and JAMS Rule 19(f) attorneys'-fee allocation is per the parties' agreement (here, neither side recovers fees from the other unless the arbitrator finds bad faith or frivolous conduct). Bad-faith or frivolous-conduct findings by the arbitrator may modify this allocation per JAMS Rule 19(f). The asymmetric structure exists because PBC has counsel-cost depth that resource-constrained challengers do not; symmetric fee-shifting would chill exactly the challenges this section is designed to enable. A **dispute-reserve fund** is held by the emeritus maintainers multisig (see *Change of control*) and may be drawn upon to advance prevailing-party costs where the prevailing party is a challenger lacking resources to advance fees. The fund's initial endowment, replenishment policy, and draw procedure are documented in `specs/EMERITUS-CHARTER.md`. The named JAMS arbitrator must satisfy the insider-conflict rule below, with the following scope: no paid engagement with Communiqué PBC exceeding $10,000 (USD) within the prior 5 years; no equity, board, advisory, or fund-recipient relationship within the prior 5 years; full JAMS standard disclosure obligations apply on top of these constraints. If the JAMS roster cannot produce three eligible candidates after standard JAMS Rule 12 selection (list of three), the parties may move to **AAA Commercial Arbitration Rules** as fallback forum, applying the same insider-conflict scope.

   Communiqué PBC's authority over governance disputes **terminates 24 months after the launch date** regardless of peer-implementation status; if no successor mechanism is established by then, Communiqué PBC commits to reopen this document. Operators meeting *Planned transition* (1) may accept the **standing offer of arbitration** in §"Standing offer" above to compel reopening if PBC fails to honor the commitment. Disputes filed under this section before the 24-month sunset complete under the rules in effect at the time of filing, even if final resolution occurs after sunset; the named JAMS arbitrator retains jurisdiction over those pending cases until they conclude. Once at least one peer implementation is operating per *Planned transition* (1), governance disputes move to a maintainer council documented in a future revision of this document, and the named arbitrator is retained for tie-breaking.

## Contact

Repository issues and pull requests are the preferred contact paths. For matters that should not be public — security vulnerabilities, legal questions, governance disputes raised privately — see [SECURITY.md](SECURITY.md).

---

*This document is part of the VOTER Protocol governance record. It is licensed under CC-BY-4.0 OR Apache-2.0; modifications are welcome via pull request.*
