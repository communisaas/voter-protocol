# Contributing to VOTER Protocol

Thanks for considering a contribution. VOTER Protocol is public-good
substrate for verified civic communication, and the project survives only
if peers can build, fork, audit, and replace the reference implementation
without permission. The rules below exist to keep that posture honest.

## Inbound licensing

The repository is dual-licensed: code under Apache License 2.0
([LICENSE](LICENSE)); specs and design documents under your choice of
Creative Commons Attribution 4.0 International
([LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0)) OR Apache License 2.0
([LICENSE](LICENSE)), with the per-document dual-license notice in
[LICENSE-specs](LICENSE-specs). Inbound contributions follow the same split:

- **Code contributions** (anything outside `specs/`, including `contracts/`,
  `packages/`, `scripts/`, configuration, build tooling, and CI) are
  contributed under Apache License 2.0 per §5 of that license. By submitting
  a code contribution you are licensing it to the project under those
  terms. No additional CLA is required.
- **Spec, architecture, and design contributions** (anything under `specs/`,
  plus top-level docs such as `ARCHITECTURE.md`, `README.md`,
  `GOVERNANCE.md`, `TRADEMARK.md`, `CONTRIBUTING.md`, and in-repo design
  records) are contributed under BOTH CC-BY-4.0 AND Apache-2.0
  simultaneously, so that downstream recipients retain the same
  per-use election the project offers. By submitting a spec or design
  contribution you are granting both licenses to the project and to
  downstream recipients. The Apache-2.0 grant covers the patent license
  in §3, which CC-BY-4.0 does not contain; both grants are needed for
  the dual-license offer to be honest. Any commit that touches `specs/`,
  `GOVERNANCE.md`, `README.md`, `ARCHITECTURE.md`, or other identified
  specs/docs files MUST include a per-commit `License-grant` trailer in
  addition to the DCO `Signed-off-by:` line:

  ```
  License-grant: Apache-2.0 OR CC-BY-4.0
  ```

  The DCO certifies that you have authority to contribute. The
  `License-grant` trailer makes the dual-license inbound grant per-commit
  and explicit, removing reliance on interpretive reading of DCO §1(a)
  ("the open source license indicated in the file" — singular). The
  trailer is in addition to the `Signed-off-by:` line, not a replacement.
  PR templates SHOULD remind contributors of both trailers for
  spec-affecting commits.

If you cannot grant either license for some portion of your work, do not
submit it. Open an issue describing the constraint instead.

## Developer Certificate of Origin (DCO)

All commits must be signed off under the Developer Certificate of Origin:
<https://developercertificate.org/>. The DCO is a lightweight assertion
that you wrote the code or otherwise have the right to contribute it under
the project's license. There is no separate CLA.

To sign off, append a line to each commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Or run `git commit -s` and let git add the line for you. Configure
`git config user.name` and `git config user.email` once, ahead of time.

For commits that touch spec or design files (see *Inbound licensing*
above), append the per-commit license-grant trailer in addition to the
DCO sign-off:

```
Signed-off-by: Your Name <your.email@example.com>
License-grant: Apache-2.0 OR CC-BY-4.0
```

PRs without DCO sign-off on every commit will be asked to amend before
merge. PRs that touch spec/docs files without the `License-grant` trailer
on the affected commits will likewise be asked to amend.

The repository runs a `License-grant trailer check` workflow on every PR
that fails when a spec-affecting commit (touching `specs/`,
`GOVERNANCE.md`, `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, or
license files) lacks the trailer. The check is evidentiary, not
constitutive (see *Default-fallback policy if trailer is missing* below);
maintainers retain authority to merge without the trailer and the
workflow's purpose is to keep the evidentiary record clean. To amend an
existing commit message, use `git commit --amend` (last commit) or
`git rebase -i <base>` and `reword` the commits, then force-push the
branch.

### Default-fallback policy if trailer is missing

If a spec-affecting commit is merged into the canonical repository
without the required `License-grant: Apache-2.0 OR CC-BY-4.0` trailer
(whether through maintainer oversight, bot automation, hot-fix urgency,
or otherwise), the absence of the trailer creates **no presumption
against dual-license inbound**. The project's inbound-licensing policy —
that all spec-affecting contributions are licensed under both Apache-2.0
AND CC-BY-4.0 — is the default; the trailer is **evidentiary** (it
strengthens the record), not **constitutive** (it is not the act of
granting). A contributor who later asserts they intended single-license
inbound bears the burden of proving that intent was communicated to
maintainers at the time of contribution by means other than the trailer.

Communiqué PBC commits, as a Phase 0.5 deliverable, to add a CI workflow
that warns on (and optionally blocks) spec-affecting commits without the
trailer. Until that CI is in place, this default-fallback clause is the
operative protection.

## Pull request etiquette

- One concern per PR. If a refactor, a feature, and a bug fix are tangled,
  split them.
- Tests required for behavior changes. Cryptographic or governance changes
  require golden vectors and a documented rationale.
- Spec changes (PRs touching `specs/`) require an entry in
  `specs/proposals/` describing the proposal and rationale before merge.
  See [GOVERNANCE.md](GOVERNANCE.md) for the spec change process and
  status fields (`NORMATIVE | INFORMATIONAL | EXPERIMENTAL | OBSOLETE`).
- Adding a new third-party dependency requires updating
  [LICENSE-thirdparty](LICENSE-thirdparty) and [NOTICE](NOTICE) in the
  same PR.
- Use plain English. Avoid marketing register, especially in spec text.

## Issue tagging

When opening an issue, please tag it with at least one of:

- `bug` — verifiable defect against current behavior or spec
- `spec` — proposed change to a NORMATIVE specification (link the
  `specs/proposals/` entry once filed)
- `docs` — documentation correction or improvement
- `governance` — affects GOVERNANCE.md, transition gates, or registry
  control
- `security` — see Security disclosures below; do not open public issues
  for unfixed vulnerabilities

## Security disclosures

Do not file public issues or PRs for unfixed security vulnerabilities.
Follow the disclosure process in [SECURITY.md](SECURITY.md). If
SECURITY.md is missing or out of date, email the maintainers privately
before disclosing publicly.

## Governance and spec changes

For anything beyond a localized code change — the spec change process,
on-chain governance posture, transition criteria toward federation — see
[GOVERNANCE.md](GOVERNANCE.md). It is the source of truth for how
substantial proposals are filed, reviewed, and ratified.

## Code of Conduct

Participation in this project is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Trademarks

"VOTER Protocol" and "Communiqué" are word marks claimed by Communiqué
PBC. Contributing code or docs does not grant trademark rights. See
[TRADEMARK.md](TRADEMARK.md) for permitted nominative use and brand
restrictions.
