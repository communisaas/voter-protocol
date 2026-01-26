# Documentation Style Guide

Last updated: 2026-01-23

This guide establishes standards for documentation in the voter-protocol repository.

## When to Add Documentation

### Required Documentation Updates

Documentation is not optional. Update docs when you:

- **Add a new feature**: Update the relevant package README.md with usage examples
- **Change public APIs**: Update API reference documentation and migration guides
- **Modify architecture**: Update `ARCHITECTURE.md` with diagrams and rationale
- **Add dependencies**: Document why they were added and their purpose
- **Change configuration**: Update runbooks and deployment guides
- **Deprecate functionality**: Mark deprecated sections and provide migration paths

### Documentation-First Workflow

For significant changes:

1. Draft documentation describing the proposed change
2. Review documentation with stakeholders
3. Implement the change
4. Update documentation to reflect actual implementation

## Document Types and Templates

### README.md (Package Overview)

Every package must have a README.md with these sections:

```markdown
# Package Name

Brief description (1-2 sentences).

## Installation

## Quick Start

## API Reference

## Configuration

## Examples

## Contributing

## License
```

### Specs (Formal Specifications)

Use IEEE-style specifications for protocols and formats:

```markdown
# Specification Name

**Version**: 1.0.0
**Status**: Draft | Stable | Deprecated
**Last updated**: YYYY-MM-DD

## Abstract

## 1. Introduction

### 1.1 Purpose
### 1.2 Scope
### 1.3 Definitions

## 2. Requirements

## 3. Specification

## 4. Test Vectors

## Appendix A: References
```

### Guides (How-To Documents)

Task-oriented guides for common workflows:

```markdown
# How to [Task]

**Audience**: [Role]
**Time**: [Estimated duration]

## Prerequisites

## Steps

### 1. [First step]

### 2. [Second step]

## Troubleshooting

## Related Guides
```

### Runbooks (Operational Procedures)

Step-by-step procedures for operations:

```markdown
# Runbook: [Operation]

**Severity**: P0 | P1 | P2
**On-call**: [Team]
**Last tested**: YYYY-MM-DD

## Symptoms

## Impact

## Resolution Steps

## Validation

## Rollback

## Post-Mortem
```

## Formatting Standards

### Headers

Use ATX-style headers with a space after the hash:

```markdown
# Level 1
## Level 2
### Level 3
```

**Avoid**:
```markdown
Level 1
=======
```

### Code Blocks

Always specify the language for syntax highlighting:

```markdown
\`\`\`typescript
const example = "code";
\`\`\`
```

Not:
```markdown
\`\`\`
const example = "no language tag";
\`\`\`
```

### Tables

Use tables for structured data with clear headers:

```markdown
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id        | string | Yes    | Unique identifier |
| count     | number | No     | Item count (default: 10) |
```

### Diagrams

Use Mermaid for diagrams to ensure they stay in sync with code:

```markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
\`\`\`
```

For complex diagrams, link to external tools but include a text description.

### Lists

Use consistent list markers:

- Unordered lists use `-` (not `*` or `+`)
- Ordered lists use `1.`, `2.`, `3.`
- Indent nested lists by 2 spaces

## Version Headers

### Specification Version Headers

All specification documents must include:

```markdown
**Version**: 1.0.0
**Status**: Draft | Stable | Deprecated
**Last updated**: YYYY-MM-DD
```

Update the version header whenever the spec changes:
- Patch version (0.0.x): Clarifications, typos
- Minor version (0.x.0): Backward-compatible additions
- Major version (x.0.0): Breaking changes

### Marking Incomplete Work

Use consistent markers for incomplete sections:

```markdown
**TODO**: Describe the caching strategy

**DRAFT**: This section is under review

**DEPRECATED**: Use the new API instead (see migration guide)
```

## Cross-References

### Internal Links

Use relative links for files within the repository:

```markdown
See [Architecture Overview](../ARCHITECTURE.md) for details.

Refer to the [API Reference](./packages/core/README.md#api).
```

### External Repository Links

Mark external repositories explicitly:

```markdown
See [communique](https://github.com/user/communique) (external repo) for the communication layer.
```

### Link Validation

Before merging documentation:

1. Validate all internal links work
2. Check that external links are accessible
3. Ensure section anchors exist
4. Verify code examples compile/run

## Maintenance

### Quarterly Documentation Review

Every quarter (Q1, Q2, Q3, Q4):

1. Review all documentation for accuracy
2. Update outdated examples
3. Fix broken links
4. Archive obsolete documents

### Archiving Obsolete Documentation

When documentation becomes obsolete:

1. Move to `docs/archive/YYYY-MM/`
2. Add a redirect in the original location:

```markdown
# [Document Title]

**This document has been archived.**

Moved to: [docs/archive/2026-01/old-doc.md](./archive/2026-01/old-doc.md)

Reason: Replaced by [new-doc.md](./new-doc.md)
```

3. Update any references to point to current documentation

### Documentation Testing

Treat documentation as code:

- Code examples must be tested
- Configuration examples must be valid
- Commands must be runnable
- Include expected output where helpful

## Style and Voice

- Use active voice: "The system validates" not "Validation is performed"
- Be concise: Remove unnecessary words
- Use present tense: "The function returns" not "The function will return"
- Address the reader directly: "You can configure" not "Users can configure"
- Define acronyms on first use: "Message Queue (MQ)"

## Commit Messages for Documentation

Follow conventional commits:

```
docs: add API reference for shadow-atlas
docs(shadow-atlas): update discovery process guide
docs: fix broken links in ARCHITECTURE.md
docs: archive obsolete deployment runbook
```

---

**Questions?** Open an issue or reach out to the documentation maintainers.
