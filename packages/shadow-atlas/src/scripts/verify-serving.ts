#!/usr/bin/env tsx
/**
 * Verify Shadow Atlas Serving — E2E smoke test
 *
 * Hits every endpoint and reports pass/fail.
 * Run against a live server: npx tsx src/scripts/verify-serving.ts [--url http://localhost:3000]
 */

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const baseUrl = urlIdx >= 0 ? args[urlIdx + 1] : 'http://localhost:3000';

interface Check {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  validate: (data: unknown) => string | null; // null = pass, string = failure reason
  optional?: boolean; // true = warn instead of fail
}

const checks: Check[] = [
  {
    name: '1. Health endpoint',
    method: 'GET',
    path: '/v1/health',
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { services?: Record<string, boolean> } };
      if (!d?.success) return 'success !== true';
      if (!d?.data?.services) return 'missing services object';
      return null;
    },
  },
  {
    name: '2. District lookup (SF) — multi-layer',
    method: 'GET',
    path: '/v1/lookup?lat=37.7793&lng=-122.4193',
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { district?: { id?: string }; all_districts?: Record<string, unknown> } };
      if (!d?.success) return 'success !== true';
      if (!d?.data?.district?.id) return 'no district returned';
      if (!d?.data?.all_districts) return 'missing all_districts in response';
      const layers = Object.keys(d.data.all_districts);
      if (layers.length === 0) return 'all_districts is empty';
      // SF should have at minimum congressional + county layers
      const expected = ['congressional', 'county'];
      const missing = expected.filter(e => !layers.includes(e));
      if (missing.length > 0) return `expected layers missing: ${missing.join(', ')} (got: ${layers.join(', ')})`;
      return null;
    },
  },
  {
    name: '3. Resolve with officials (SF) — multi-layer',
    method: 'GET',
    path: '/v1/resolve?lat=37.7793&lng=-122.4193&include_officials=true',
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { district?: { id?: string }; all_districts?: Record<string, unknown>; officials?: unknown } };
      if (!d?.success) return 'success !== true';
      if (!d?.data?.district) return 'no district';
      if (!d?.data?.all_districts) return 'missing all_districts in response';
      return null;
    },
  },
  {
    name: '4. Officials endpoint (CA-11)',
    method: 'GET',
    path: '/v1/officials?district=CA-11',
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { officials?: unknown[] } };
      if (!d?.success) return 'success !== true';
      return null;
    },
  },
  {
    name: '5. Canadian lookup (Ottawa)',
    method: 'GET',
    path: '/v1/lookup?lat=45.4215&lng=-75.6972',
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { district?: { id?: string } } };
      if (!d?.success) return 'success !== true';
      if (!d?.data?.district?.id?.startsWith('can-fed-')) return 'expected Canadian riding ID';
      return null;
    },
    optional: true, // Canadian boundaries may not be built yet
  },
  {
    name: '6. Resolve-address (geocoding)',
    method: 'POST',
    path: '/v1/resolve-address',
    body: {
      street: '1 Dr Carlton B Goodlett Pl',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    },
    validate: (data: unknown) => {
      const d = data as { success?: boolean; data?: { geocode?: unknown } };
      if (!d?.success) return 'success !== true';
      return null;
    },
    optional: true, // Requires Nominatim
  },
  {
    name: '7. Health service flags',
    method: 'GET',
    path: '/v1/health',
    validate: (data: unknown) => {
      const d = data as { data?: { services?: Record<string, boolean> } };
      const svc = d?.data?.services;
      if (!svc) return 'no services in health';
      const missing = [];
      if (!svc.districtLookup) missing.push('districtLookup');
      if (!svc.officials) missing.push('officials');
      if (missing.length > 0) return `services offline: ${missing.join(', ')}`;
      return null;
    },
  },
];

async function run() {
  console.log(`Shadow Atlas Serving Verification`);
  console.log(`  Target: ${baseUrl}`);
  console.log('');

  let passed = 0;
  let failed = 0;
  let warned = 0;

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    try {
      const res = await fetch(url, {
        method: check.method,
        headers: check.body ? { 'Content-Type': 'application/json' } : {},
        body: check.body ? JSON.stringify(check.body) : undefined,
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 501 && check.optional) {
        console.log(`  SKIP  ${check.name} (501 — service not configured)`);
        warned++;
        continue;
      }

      if (!res.ok && check.optional) {
        console.log(`  WARN  ${check.name} (HTTP ${res.status})`);
        warned++;
        continue;
      }

      if (!res.ok) {
        console.log(`  FAIL  ${check.name} — HTTP ${res.status}`);
        failed++;
        continue;
      }

      const data = await res.json();
      const error = check.validate(data);
      if (error) {
        if (check.optional) {
          console.log(`  WARN  ${check.name} — ${error}`);
          warned++;
        } else {
          console.log(`  FAIL  ${check.name} — ${error}`);
          failed++;
        }
      } else {
        console.log(`  PASS  ${check.name}`);
        passed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (check.optional) {
        console.log(`  WARN  ${check.name} — ${msg}`);
        warned++;
      } else {
        console.log(`  FAIL  ${check.name} — ${msg}`);
        failed++;
      }
    }
  }

  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed, ${warned} warnings`);

  if (failed > 0) {
    console.log('\nSome checks failed. Ensure shadow-atlas.db and officials.db are built and the server is running.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
