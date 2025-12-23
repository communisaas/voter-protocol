# Shadow Atlas CI Scripts

CI-specific tooling for GitHub Actions workflows.

## Scripts

### health-check.ts

Runs provider health checks and outputs JSON for GitHub Actions.

**Usage in workflows:**
```yaml
- name: Run health check
  run: npx tsx .github/workflows/scripts/shadow-atlas/health-check.ts > health-output.json
```

**Output format:**
```json
{
  "healthy": true,
  "extractionSuccessRate": 1.0,
  "validationPassRate": 1.0,
  "providerAvailability": {
    "UKBoundaryProvider": true,
    "CanadaBoundaryProvider": true
  },
  "issues": [],
  "checkedAt": "2025-12-18T22:30:00.000Z"
}
```

**Exit codes:**
- `0` - All providers healthy
- `1` - One or more providers unhealthy

**Workflow integration:**
- Used by: `.github/workflows/shadow-atlas-health.yml`
- Schedule: Every 6 hours
- Creates GitHub issue on failure
- Auto-closes issue on recovery

## Development

### Adding New CI Scripts

1. Create script in this directory
2. Use shebang: `#!/usr/bin/env npx tsx`
3. Import from packages: `../../../../packages/crypto/services/shadow-atlas/...`
4. Output JSON for parsing in workflows
5. Use exit codes for workflow conditionals

### Testing CI Scripts

```bash
# Run locally
npx tsx .github/workflows/scripts/shadow-atlas/health-check.ts

# Test in workflow
gh workflow run shadow-atlas-health.yml
```

## Migration

This directory was created to separate CI-specific scripts from the main `/scripts/` directory, which has been deprecated and migrated to `/services/` and `/cli/`.

**Previous location:** `packages/crypto/services/shadow-atlas/scripts/health-check-ci.ts`
**Current location:** `.github/workflows/scripts/shadow-atlas/health-check.ts`

See: `/packages/crypto/services/shadow-atlas/scripts/CLEANUP_REPORT.md`
