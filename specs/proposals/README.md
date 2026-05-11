# Proposals

This directory holds RFC-style proposals for substantive changes to NORMATIVE specifications under [`../`](..). It is the formal entry point for the change process described in [`../../GOVERNANCE.md`](../../GOVERNANCE.md).

Editorial corrections (typos, clarifications, broken links) do not need a proposal; open a pull request directly.

## When a proposal is required

Open a proposal when a change would:

- Alter a domain-separation tag, hash function, curve choice, or any byte that becomes part of a cryptographic preimage.
- Add, remove, or reorder a circuit's public inputs.
- Change the on-chain interface of a deployed registry contract.
- Change the lifecycle, status field, or version-bump rules in [`../../GOVERNANCE.md`](../../GOVERNANCE.md).
- Introduce or retire a NORMATIVE specification.

If you are unsure whether a change qualifies, open a draft proposal anyway — it is the fastest route to a clear answer.

## Filename convention

`<short-name>-<sequence>.md`, where `<short-name>` is a stable kebab-case identifier and `<sequence>` is a three-digit zero-padded number scoped to the short-name (e.g. `noir-circuit-v3-001.md`, `noir-circuit-v3-002.md`). The sequence allows a topic to span multiple proposals without renumbering.

## Required sections

Every proposal MUST include, in this order:

1. **Status** — one of `NORMATIVE`, `INFORMATIONAL`, `EXPERIMENTAL`, `OBSOLETE`, plus a draft/discussion/accepted/rejected lifecycle marker.
2. **Motivation** — what problem this solves, who is affected, why now.
3. **Specification** — the proposed change, in sufficient detail that an independent implementer could reproduce it. Cite the lines of the specs the proposal modifies.
4. **Security analysis** — what attack surface changes, what soundness/liveness/privacy properties are affected, and what new assumptions are introduced.
5. **Migration plan** — for changes that affect deployed contracts, circuits, or persisted client state, the operational sequence (timelocks, key regeneration, golden-vector regeneration, comms windows).
6. **Compatibility** — backward and forward compatibility with prior implementations; a clear statement of whether the change is a major, minor, or patch version bump.
7. **References** — issues, prior proposals, audit findings, external research.

## Lifecycle

1. **Draft** — author opens a pull request adding `<short-name>-<seq>.md` with status `EXPERIMENTAL` and a `Lifecycle: draft` line at the top.
2. **Discussion** — review happens on the pull request. Lifecycle becomes `discussion` when the draft is ready for substantive review.
3. **Decision** — when consensus is reached (per [`../../GOVERNANCE.md`](../../GOVERNANCE.md) §"Conflict resolution"), the proposal is merged. If accepted, the affected NORMATIVE specs are version-bumped in the same merge or a follow-up PR. If rejected, the proposal is moved to `rejected/<year>/` with the closure rationale recorded inline.
4. **Archive** — accepted proposals move to `accepted/<year>/<short-name>-<seq>.md` once the corresponding NORMATIVE change has shipped. The archived copy is read-only; subsequent changes go through a new proposal that supersedes it.

A proposal is **contested** if reviewers raise concerns in writing that maintainers have not addressed; the closure procedure for contested proposals is in [`../../GOVERNANCE.md`](../../GOVERNANCE.md) §"Conflict resolution" item 2.

## See also

- [`../../GOVERNANCE.md`](../../GOVERNANCE.md) — surrounding governance process.
- [`../CRYPTOGRAPHY-SPEC.md`](../CRYPTOGRAPHY-SPEC.md) — the spec whose §0 namespace amendment was the first proposal-shaped change executed against this directory's intended workflow.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — DCO sign-off requirements and inbound licensing.
