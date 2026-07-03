/**
 * Shadow Atlas Change-Check Workflow Tests
 *
 * Asserts the .github/workflows/shadow-atlas-change-check.yml workflow parses
 * as valid YAML and wires the existing `changes:check` script. Reuses the
 * readFileSync + join(__dirname, ...) fixture-loading pattern from
 * validation-integration.test.ts, resolving up to the voter-protocol repo
 * root (five levels up from this src/__tests__/unit/ directory).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

const WORKFLOW_PATH = join(
  __dirname,
  '../../../../../.github/workflows/shadow-atlas-change-check.yml',
);

function loadWorkflow(): unknown {
  const content = readFileSync(WORKFLOW_PATH, 'utf-8');
  return parse(content);
}

describe('shadow-atlas-change-check workflow', () => {
  it('parses as valid YAML into a non-null object', () => {
    const workflow = loadWorkflow();
    expect(workflow).not.toBeNull();
    expect(typeof workflow).toBe('object');
  });

  it('exposes a workflow_dispatch trigger', () => {
    const workflow = loadWorkflow() as Record<string, any>;
    // YAML parses the `on:` key; `true` is a YAML 1.1 alias for `on`, so the
    // key may surface as the boolean `true` rather than the string "on".
    const on = workflow.on ?? workflow[true as unknown as string];
    expect(on).toBeDefined();
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('invokes the existing changes:check script in a step', () => {
    const workflow = loadWorkflow() as Record<string, any>;
    const runStrings: string[] = [];
    for (const job of Object.values(workflow.jobs ?? {}) as any[]) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.run === 'string') {
          runStrings.push(step.run);
        }
      }
    }
    expect(runStrings.some((run) => run.includes('changes:check'))).toBe(true);
  });
});
