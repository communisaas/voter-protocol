# Multi-Agent Wave Orchestration Methodology

> A distinguished engineer's guide to systematic issue remediation using parallel AI agents with context-engineered prompts.

## Table of Contents

1. [Philosophy and Principles](#philosophy-and-principles)
2. [Phase 1: Issue Discovery and Enumeration](#phase-1-issue-discovery-and-enumeration)
3. [Phase 2: Knowledge Capture via Issue Tracking](#phase-2-knowledge-capture-via-issue-tracking)
4. [Phase 3: Wave Planning and Dependency Analysis](#phase-3-wave-planning-and-dependency-analysis)
5. [Phase 4: Context Engineering](#phase-4-context-engineering)
6. [Phase 5: Parallel Agent Execution](#phase-5-parallel-agent-execution)
7. [Phase 6: Inter-Wave Review Gates](#phase-6-inter-wave-review-gates)
8. [Phase 7: Verification and Regression Testing](#phase-7-verification-and-regression-testing)
9. [Anti-Patterns and Failure Modes](#anti-patterns-and-failure-modes)
10. [Appendix: Prompt Templates](#appendix-prompt-templates)

---

## Philosophy and Principles

### The Fundamental Insight

Traditional sequential remediation—one issue at a time—fails to exploit the inherent parallelism in most codebases. Issues rarely share critical sections. A security fix in the API layer does not conflict with a cryptographic validation fix in the prover layer. By recognizing this independence, we unlock order-of-magnitude improvements in remediation velocity.

However, parallel execution without coordination produces chaos. The methodology presented here structures parallelism through **waves**—groups of independent issues that can be addressed simultaneously—separated by **gates**—synchronization points where all parallel work is verified before proceeding.

### Core Principles

1. **Exhaustive Discovery Before Execution**: Never begin remediation until the full scope is understood. Premature fixing often misses systemic patterns or introduces regressions in areas not yet analyzed.

2. **Issue Tracking as Knowledge System**: GitHub issues are not merely task lists. They are the persistent knowledge store that survives context windows, agent restarts, and human memory. Every finding, decision, and rationale belongs in an issue.

3. **Dependency-Driven Wave Formation**: Issues form natural clusters based on their dependencies. A wave contains only issues that share no code paths, data structures, or semantic dependencies with other issues in the same wave.

4. **Context Engineering Over Prompt Engineering**: The quality of agent output correlates directly with the precision of injected context. Reading the exact file sections, extracting the exact line numbers, and providing the exact code snippets transforms generic agents into surgical specialists.

5. **Gates as Non-Negotiable Checkpoints**: No wave begins until the previous wave passes its gate. Gates include test verification, manual review of changes, and confirmation that no regressions were introduced.

6. **Adaptive Re-Targeting**: Reality diverges from plans. An agent may discover that an issue is already fixed, requires design work beyond its scope, or depends on something not yet completed. The methodology must accommodate mid-flight adjustments.

---

## Phase 1: Issue Discovery and Enumeration

### Objective

Produce an exhaustive, prioritized list of all issues requiring remediation. This is the foundation upon which all subsequent work rests.

### Method: Systematic Codebase Analysis

#### Step 1.1: Define Analysis Domains

Partition the codebase into logical domains. Common partitions include:

| Domain | Typical Contents |
|--------|------------------|
| Smart Contracts | Solidity/Vyper, deployment scripts, contract tests |
| Cryptography | Zero-knowledge circuits, hash functions, signature schemes |
| Backend Services | API servers, databases, job queues |
| Client Applications | Web/mobile frontends, SDK libraries |
| Infrastructure | Docker, Kubernetes, CI/CD pipelines |
| Documentation | Specs, README files, API docs |

Each domain may require different analysis techniques and different agent expertise.

#### Step 1.2: Execute Domain-Specific Analysis

For each domain, employ the appropriate analysis:

**Smart Contracts**:
- Static analysis tools (Slither, Mythril, Semgrep)
- Manual audit findings review
- Invariant property verification
- Gas optimization opportunities

**Cryptography**:
- Circuit constraint completeness
- Field element overflow conditions
- Nullifier uniqueness guarantees
- Trusted setup parameter validation

**Backend Services**:
- OWASP Top 10 vulnerability scan
- Authentication/authorization review
- Input validation coverage
- Rate limiting and DoS protection

**Infrastructure**:
- Container security scanning
- Secret management audit
- Network policy verification
- Deployment pipeline integrity

#### Step 1.3: Consolidate and Deduplicate

Analysis tools produce overlapping findings. A single root cause may manifest as multiple symptoms. Deduplicate by identifying the underlying issue rather than treating each symptom independently.

### Output Artifact

A structured enumeration with the following fields per issue:

```
ID: <unique identifier>
Title: <concise description>
Domain: <affected codebase domain>
Priority: <P0/P1/P2/P3>
Files: <list of affected file paths>
Description: <detailed explanation>
Acceptance Criteria: <what "fixed" looks like>
Dependencies: <other issue IDs this depends on>
Blocked By: <external factors blocking work>
```

### Priority Classification

| Priority | Definition | Timeline |
|----------|------------|----------|
| P0 | Active exploitation possible, data loss imminent | Immediate |
| P1 | Significant vulnerability, no known exploit | Days |
| P2 | Defense-in-depth improvement, code quality | Weeks |
| P3 | Nice-to-have, technical debt | Opportunistic |

---

## Phase 2: Knowledge Capture via Issue Tracking

### Objective

Transform the enumeration into persistent, queryable knowledge that survives context loss and enables distributed collaboration.

### Method: Structured Issue Creation

#### Step 2.1: Issue Template Design

Each issue must be self-contained. An agent (or human) reading the issue should have everything needed to begin work without asking clarifying questions.

**Required Sections**:

```markdown
## Summary
One-paragraph description of the issue and its impact.

## Technical Details
- Affected files with line numbers
- Code snippets demonstrating the issue
- Technical explanation of the vulnerability/problem

## Acceptance Criteria
- [ ] Specific, verifiable conditions that indicate completion
- [ ] Test requirements
- [ ] Documentation requirements

## Dependencies
- Blocks: #issue-numbers
- Blocked by: #issue-numbers

## Implementation Notes
Optional guidance on approach, trade-offs, or constraints.
```

#### Step 2.2: Label Taxonomy

Labels encode metadata for filtering and reporting:

| Label Category | Examples |
|----------------|----------|
| Priority | `P0`, `P1`, `P2`, `P3` |
| Domain | `contracts`, `crypto`, `backend`, `infra` |
| Type | `security`, `bug`, `enhancement`, `tech-debt` |
| Status | `needs-triage`, `ready`, `in-progress`, `blocked`, `design` |
| Wave | `wave-1`, `wave-2`, etc. |

#### Step 2.3: Batch Creation

Create all issues in a single session to ensure consistent formatting and cross-referencing. Use the issue tracker's API for programmatic creation when issue counts exceed 10-20.

### Knowledge Preservation Properties

The issue system now serves as:

1. **Persistent Memory**: Survives context window limits
2. **Progress Tracker**: Real-time visibility into remediation status
3. **Audit Trail**: Historical record of what was found and fixed
4. **Collaboration Hub**: Multiple agents or humans can work from the same source of truth

---

## Phase 3: Wave Planning and Dependency Analysis

### Objective

Partition issues into waves that maximize parallelism while respecting dependencies.

### Method: Dependency Graph Construction

#### Step 3.1: Build the Dependency Graph

Represent issues as nodes and dependencies as directed edges. An edge from A to B means "A must complete before B can begin."

Dependencies arise from:

1. **Code Dependencies**: Issue B modifies code that Issue A is changing
2. **Semantic Dependencies**: Issue B's fix assumes Issue A's fix is present
3. **Test Dependencies**: Issue B's tests require Issue A's changes
4. **Build Dependencies**: Issue B's compilation requires Issue A's artifacts

#### Step 3.2: Identify Independent Subgraphs

Issues with no path between them (in either direction) can execute in parallel. These form the candidate pool for a wave.

#### Step 3.3: Wave Formation Algorithm

```
WAVE_FORMATION(issues, dependencies):
    remaining = set(issues)
    waves = []

    while remaining is not empty:
        # Find issues with no unsatisfied dependencies
        ready = {i for i in remaining
                 if all(d not in remaining for d in dependencies[i])}

        if ready is empty:
            ERROR: Circular dependency detected

        # Prioritize P0 > P1 > P2 > P3 within wave
        wave = sort(ready, by=priority)
        waves.append(wave)
        remaining = remaining - ready

    return waves
```

#### Step 3.4: Wave Sizing

Balance parallelism against coordination overhead:

| Factor | Smaller Waves | Larger Waves |
|--------|---------------|--------------|
| Gate Frequency | More checkpoints, safer | Fewer checkpoints, faster |
| Context Load | Less context per gate | More context per gate |
| Failure Blast Radius | Limited | Extensive |
| Human Review | More manageable | Overwhelming |

**Recommended**: 3-5 issues per wave for complex domains, up to 8-10 for simpler domains.

### Output Artifact

```
Wave 1 (P0):
  - Issue A (contracts)
  - Issue B (crypto)
  - Issue C (backend)

Wave 2 (P1):
  - Issue D (contracts) [depends on A]
  - Issue E (crypto)
  - Issue F (infra)

Wave 3 (P2):
  - Issue G (backend) [depends on C, F]
  - Issue H (docs)
```

---

## Phase 4: Context Engineering

### Objective

Transform generic prompts into surgical instructions by injecting precise, relevant context that eliminates ambiguity.

### The Context Engineering Manifesto

> The difference between a prompt that produces useful output and one that produces generic suggestions is not in the instruction—it is in the context. An instruction to "fix the security vulnerability" is useless. An instruction to "add bounds checking at line 47 of src/validator.ts where the unchecked array index `items[userIndex]` can exceed `items.length`" is actionable.

### Method: Deep Context Injection

#### Step 4.1: Pre-Read Target Files

Before constructing the prompt, read every file the agent will need to modify. Extract:

1. **Exact line numbers** of the code to change
2. **Surrounding context** (10-20 lines before and after)
3. **Related code** that informs the fix (e.g., similar patterns elsewhere)
4. **Test files** that will need updates

#### Step 4.2: Construct the Surgical Prompt

**Structure**:

```
## Objective
One sentence stating what must be accomplished.

## Background
2-3 paragraphs providing domain context the agent needs.

## Target Files and Locations

### File: path/to/file.ts
Lines 45-60:
```code
<exact code snippet>
```

The issue is at line 47: <specific explanation>.

### File: path/to/related.ts
Lines 100-115:
```code
<reference implementation showing correct pattern>
```

## Required Changes

1. In `path/to/file.ts`:
   - At line 47, add bounds checking before array access
   - Expected diff:
   ```diff
   - const item = items[userIndex];
   + if (userIndex < 0 || userIndex >= items.length) {
   +   throw new RangeError(`Index ${userIndex} out of bounds`);
   + }
   + const item = items[userIndex];
   ```

2. In `path/to/file.test.ts`:
   - Add test case for out-of-bounds index
   - Add test case for negative index

## Constraints
- Do not modify the function signature
- Preserve existing behavior for valid indices
- Error message must include the invalid index value

## Verification
After changes, the following command should pass:
```bash
npm test -- path/to/file.test.ts
```
```

#### Step 4.3: Eliminate Ambiguity

Every prompt should pass the "cold read" test: Could someone with no prior context execute this prompt correctly? If not, add more context.

**Ambiguous**: "Fix the CORS configuration"
**Precise**: "In `src/api/server.ts` line 23, change the `corsOrigins` default from `['*']` to `[]` and add a production validation check that throws if wildcard is configured when `NODE_ENV=production`"

#### Step 4.4: Include Negative Examples

Tell the agent what NOT to do:

```
## Anti-Patterns to Avoid
- Do NOT add a new configuration file; modify the existing one
- Do NOT change the public API signature
- Do NOT add dependencies; solve with existing imports
```

### Context Engineering Checklist

- [ ] Every file path is absolute and verified to exist
- [ ] Every line number has been confirmed via fresh file read
- [ ] Code snippets are copy-pasted, not reconstructed from memory
- [ ] Expected diffs are provided where possible
- [ ] Test commands are verified to work
- [ ] Constraints are explicit and complete
- [ ] Success criteria are objectively verifiable

---

## Phase 5: Parallel Agent Execution

### Objective

Execute multiple agents simultaneously, each working on an independent issue within the wave.

### Method: Orchestrated Parallelism

#### Step 5.1: Agent Spawning

For each issue in the wave, spawn an agent with:

1. **Specialized system prompt** reflecting the domain (contracts, crypto, etc.)
2. **Issue-specific context** from Phase 4
3. **Isolated working scope** (no agent should touch another's files)

```
For wave N with issues [I1, I2, I3]:
    parallel:
        Agent_1 = spawn(context=I1, domain=I1.domain)
        Agent_2 = spawn(context=I2, domain=I2.domain)
        Agent_3 = spawn(context=I3, domain=I3.domain)
    await all(Agent_1, Agent_2, Agent_3)
```

#### Step 5.2: Monitoring and Progress Tracking

As agents work, track:

- Files modified
- Tests added/changed
- Unexpected discoveries
- Blockers encountered

#### Step 5.3: Handling Agent Findings

Agents may discover situations not anticipated during planning:

| Discovery | Response |
|-----------|----------|
| Issue already fixed | Close the issue, document when it was fixed |
| Issue requires design | Re-label as `design`, defer to later wave |
| Issue depends on unfixed issue | Flag the dependency, defer |
| Issue scope larger than expected | Split into sub-issues |
| New issue discovered | Create new issue, assign to future wave |

#### Step 5.4: Agent Output Collection

Each agent produces:

1. **Code changes** (git diff)
2. **Test results** (pass/fail)
3. **Summary** of what was done
4. **Concerns** or caveats
5. **Recommended follow-up** if any

### Parallelism Boundaries

**Safe to Parallelize**:
- Issues in different directories
- Issues in different domains
- Issues affecting different layers (e.g., contract vs. test)

**Unsafe to Parallelize**:
- Issues modifying the same file
- Issues with semantic dependencies
- Issues where one's test asserts another's fix

---

## Phase 6: Inter-Wave Review Gates

### Objective

Ensure each wave's changes are correct, complete, and regression-free before proceeding to the next wave.

### Method: Structured Gate Protocol

#### Step 6.1: Aggregate Wave Results

Collect all agent outputs from the wave:

```
Wave N Results:
  Issue I1: FIXED (Agent_1)
    - Modified: path/a.ts, path/a.test.ts
    - Tests: 12 passed, 0 failed

  Issue I2: DEFERRED (Agent_2)
    - Reason: Requires design decision on API versioning
    - Action: Re-labeled, moved to Wave N+2

  Issue I3: FIXED (Agent_3)
    - Modified: path/b.ts
    - Tests: 8 passed, 0 failed
    - Note: Found related issue, created #new-issue
```

#### Step 6.2: Run Full Test Suite

Execute the complete test suite, not just tests for modified files:

```bash
# All tests, all domains
npm test
forge test
cargo test
```

#### Step 6.3: Categorize Test Results

| Result | Meaning | Action |
|--------|---------|--------|
| All pass | Gate passed | Proceed to next wave |
| New test fails | Likely regression | Investigate, fix before proceeding |
| Pre-existing fail | Unrelated to wave | Document, proceed with caution |
| Flaky test | Infrastructure issue | Retry, document if persistent |

#### Step 6.4: Review Code Changes

Even with passing tests, review:

1. **Diff coherence**: Do changes match the issue description?
2. **Code quality**: Does the fix introduce new problems?
3. **Documentation**: Are public APIs documented?
4. **Security**: Any new attack vectors introduced?

#### Step 6.5: Gate Decision

```
IF all(tests pass) AND all(reviews approved):
    PROCEED to Wave N+1
ELIF some(fixes incomplete):
    REMEDIATE within wave, re-gate
ELSE:
    ROLLBACK wave, investigate
```

### Gate Artifacts

Produce a gate report:

```markdown
## Wave N Gate Report

### Summary
- Issues attempted: 3
- Issues completed: 2
- Issues deferred: 1
- New issues discovered: 1

### Test Results
- Total: 487 tests
- Passed: 487
- Failed: 0
- Skipped: 4

### Files Modified
- path/a.ts (+45, -12)
- path/a.test.ts (+89, -0)
- path/b.ts (+8, -3)

### Issues Status
- #101: CLOSED (fixed)
- #102: OPEN (deferred - needs design)
- #103: CLOSED (fixed)
- #107: CREATED (follow-up from #103)

### Gate Decision: PASS
Proceeding to Wave N+1.
```

---

## Phase 7: Verification and Regression Testing

### Objective

Confirm that the complete remediation achieves its goals without introducing new problems.

### Method: Multi-Layer Verification

#### Step 7.1: Unit Test Verification

Each fix should have corresponding unit tests:

```
For each closed issue:
    ASSERT test exists that would fail before fix
    ASSERT test passes after fix
    ASSERT test covers edge cases in issue description
```

#### Step 7.2: Integration Test Verification

Cross-component interactions must be tested:

```
For each domain boundary crossed:
    ASSERT integration test exercises the boundary
    ASSERT error conditions are tested
    ASSERT happy path is tested
```

#### Step 7.3: E2E Test Verification

For security issues, end-to-end attack simulations:

```
For each security issue:
    ASSERT exploit attempt is blocked
    ASSERT error is logged appropriately
    ASSERT system remains functional
```

#### Step 7.4: Regression Detection

Compare before/after metrics:

| Metric | Before | After | Threshold |
|--------|--------|-------|-----------|
| Test count | X | Y | Y >= X |
| Test coverage | X% | Y% | Y >= X |
| Build time | Xs | Ys | Y < X * 1.2 |
| Bundle size | X KB | Y KB | Y < X * 1.1 |

#### Step 7.5: Final Security Audit

For security remediations, run security tools again:

```bash
# Re-run the tools that found the issues
slither .
npm audit
semgrep --config auto
```

All originally-reported issues should be absent from the new report.

---

## Anti-Patterns and Failure Modes

### Anti-Pattern 1: Premature Parallelization

**Symptom**: Launching agents before understanding the full scope.
**Consequence**: Discovering mid-wave that issues are interdependent.
**Prevention**: Complete Phase 1-3 before any Phase 5 execution.

### Anti-Pattern 2: Insufficient Context

**Symptom**: Agents produce generic or incorrect fixes.
**Consequence**: Wasted cycles, incorrect code merged.
**Prevention**: Rigorous Phase 4 context engineering with checklist verification.

### Anti-Pattern 3: Skipping Gates

**Symptom**: "The tests passed locally, let's keep going."
**Consequence**: Regressions compound across waves.
**Prevention**: Gates are mandatory. No exceptions.

### Anti-Pattern 4: Monolithic Waves

**Symptom**: Waves containing 20+ issues.
**Consequence**: Gate reviews become overwhelming, failures hard to isolate.
**Prevention**: Cap waves at 5-8 issues; split if necessary.

### Anti-Pattern 5: Ignoring Agent Findings

**Symptom**: Agent reports "this is already fixed" but issue stays open.
**Consequence**: Knowledge drift, future confusion.
**Prevention**: Every agent finding must update the issue tracker.

### Anti-Pattern 6: Context Staleness

**Symptom**: Using file contents from previous sessions without re-reading.
**Consequence**: Line numbers drift, code has changed.
**Prevention**: Always fresh-read files before constructing prompts.

### Anti-Pattern 7: Test-Free Fixes

**Symptom**: "The fix is obvious, no test needed."
**Consequence**: Regression in future work.
**Prevention**: Every fix requires a test that fails without the fix.

---

## Appendix: Prompt Templates

### Template A: Security Fix

```markdown
## Objective
Fix [VULNERABILITY_TYPE] in [COMPONENT].

## Security Context
[Brief explanation of the vulnerability class and its risks]

## Affected Code

### File: [PATH]
Lines [START]-[END]:
```[language]
[CODE_SNIPPET]
```

The vulnerability exists because [SPECIFIC_EXPLANATION].

## Required Fix

1. [SPECIFIC_CHANGE_1]
2. [SPECIFIC_CHANGE_2]

Expected diff:
```diff
[DIFF]
```

## Security Test Requirements

Add tests that verify:
- [ ] Malicious input is rejected
- [ ] Error message does not leak sensitive info
- [ ] System remains functional for valid input

## Constraints
- [CONSTRAINT_1]
- [CONSTRAINT_2]
```

### Template B: Code Quality Fix

```markdown
## Objective
Improve [QUALITY_ASPECT] in [COMPONENT].

## Current State

### File: [PATH]
Lines [START]-[END]:
```[language]
[CODE_SNIPPET]
```

Issue: [EXPLANATION_OF_PROBLEM]

## Desired State

The code should [DESIRED_BEHAVIOR].

Reference implementation:
```[language]
[REFERENCE_CODE]
```

## Required Changes

1. [CHANGE_1]
2. [CHANGE_2]

## Test Requirements

- [ ] Existing tests continue to pass
- [ ] New test for [EDGE_CASE]

## Constraints
- Preserve existing public API
- Do not add new dependencies
```

### Template C: Infrastructure Fix

```markdown
## Objective
Fix [INFRASTRUCTURE_ISSUE] in [COMPONENT].

## Current Configuration

### File: [PATH]
```[language]
[CONFIG_SNIPPET]
```

Problem: [EXPLANATION]

## Required Configuration

```[language]
[CORRECTED_CONFIG]
```

## Validation

After the change:
```bash
[VALIDATION_COMMAND]
```

Expected output:
```
[EXPECTED_OUTPUT]
```

## Rollback Plan

If issues arise:
```bash
[ROLLBACK_COMMAND]
```
```

---

## Conclusion

Multi-agent wave orchestration transforms remediation from a sequential, error-prone process into a parallel, systematic methodology. The keys to success are:

1. **Thorough discovery** before any execution
2. **Precise context** for every agent
3. **Strict gates** between every wave
4. **Adaptive response** to unexpected findings

This methodology scales from small teams addressing a handful of issues to large organizations coordinating dozens of agents across hundreds of issues. The principles remain constant; only the tooling adapts.

---

*Document version: 1.0*
*Methodology developed through iterative refinement across multiple large-scale remediation efforts.*
