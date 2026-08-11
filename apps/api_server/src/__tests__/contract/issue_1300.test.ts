import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('issue #1300 acceptance contract', () => {
  it('issue-1300-c1: ships a fail-closed, env-gated project live E2E matrix', () => {
    const path = join(root, 'apps/api_server/src/__tests__/research_projects_live_e2e.test.ts');
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('assertLiveE2EIsolation');
    expect(source).toContain("RHYTHM_LIVE_E2E === '1'");
    for (const behavior of [
      'three distinct pass sessions', 'canonical synthesis', 'cancel', 'selective retry',
      'restart resume', 'budget exhaustion', 'same-day aggregation', 'magazine security',
      'grounded discussion', 'ownership isolation', 'backfill preserves the vault',
    ]) expect(source).toContain(behavior);
  });

  it('issue-1300-c2: sandbox can restart without deleting state and accounts for all listeners', () => {
    const source = read('tools/dev/sandbox.sh');
    expect(source).toMatch(/restart\(\)/);
    expect(source).toMatch(/restart\) restart/);
    expect(source).toContain('gateway :%s listener');
    expect(source).toContain('listener "$GATEWAY_PORT"');
  });

  it('issue-1300-c3: rollout is default-off, approval-gated, observable, and recoverable', () => {
    const runbook = read('docs/release/research-projects-rollout.md');
    expect(runbook).toMatch(/default[- ]off/i);
    expect(runbook).toMatch(/AJ.*explicit.*approval/i);
    expect(runbook).toMatch(/abort conditions/i);
    expect(runbook).toMatch(/disable.*recovery/i);
    expect(runbook).toMatch(/cross-owner|ownership leak/i);
    expect(runbook).toMatch(/canonical artifact/i);
    expect(runbook).toMatch(/token.*cost/i);
    expect(runbook).toMatch(/known limitations/i);
  });

  it('issue-1300-c4: manual smoke and testing docs name the real gate and cleanup', () => {
    const smoke = read('docs/testing/manual-smoke.md');
    const guide = read('docs/ai/testing-guide.md');
    expect(smoke).toContain('Research Projects rollout gate');
    expect(smoke).toMatch(/Print.*Save (?:as )?PDF/is);
    expect(guide).toContain('research_projects_live_e2e.test.ts');
    expect(guide).toContain('tools/dev/sandbox.sh restart');
    expect(guide).toContain('4099');
  });

  it('keeps rollout and project routes unavailable with the flag off', () => {
    const live = read('apps/api_server/src/__tests__/research_projects_flag_off_live_e2e.test.ts');
    expect(live).toContain("RHYTHM_LIVE_E2E === '1'");
    expect(live).toContain('assertLiveE2EIsolation');
    expect(live).toContain('/agent-research/projects');
    expect(live).toContain('/agent-research');
  });
});
