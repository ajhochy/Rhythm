import { describe, expect, it } from 'vitest';

// Actual fork + API, never a mock. Run only inside the owned dev sandbox with
// the synthetic quality/absent-artifact fixtures recorded in this run's log.
const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const api = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
const engine = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  expect(response.status, url).toBe(200);
  return await response.json() as T;
}

describe.runIf(enabled)('real sandbox AI repair behavior', () => {
  it('built-in Skills content agrees with the actual compiled engine body', async () => {
    // Catches the API trying to read the virtual <built-in> location as a file.
    expect(new URL(api).hostname).toBe('127.0.0.1');
    expect(new URL(api).port).toBe('4098');
    expect(new URL(engine).hostname).toBe('127.0.0.1');
    expect(new URL(engine).port).toBe('4097');
    const health = await read<{ healthy: boolean; version: string }>(engine + '/global/health');
    expect(health.healthy).toBe(true);
    expect(health.version).toMatch(/^0\.0\.0-rhythm-[a-f0-9]{40}$/);
    const skills = await read<Array<{ name: string; location: string; content: string }>>(engine + '/skill');
    const builtin = skills.find(skill => skill.name === 'customize-opencode');
    expect(builtin?.location).toBe('<built-in>');
    expect(builtin!.content.trim().length).toBeGreaterThan(100);
    const content = await read<{ name: string; content: string }>(api + '/opencode/skills/customize-opencode/content');
    expect(content).toEqual({ name: builtin!.name, content: builtin!.content });
  }, 60_000);

  it('historical empty agent identity remains counted with a useful label', async () => {
    // Catches write-only repairs that leave existing empty-kind runs blank.
    const rollup = await read<{ agents: Array<{ agentKind: string; agentLabel: string; totalRuns: number }> }>(api + '/agents/run-quality');
    const historical = rollup.agents.find(row => row.agentKind === '');
    expect(historical, 'requires the owned synthetic historical run fixture').toBeDefined();
    expect(historical!.agentLabel).toBe('Unknown agent');
    expect(historical!.totalRuns).toBe(1);
  });

  it('missing local Gallery files retain the record without dead preview URLs', async () => {
    // Catches advertising a thumbnail that immediately causes a real 404.
    const designs = await read<Array<{ id: string; artifactUrl?: string | null; thumbnailUrl?: string | null }>>(api + '/agent-designs');
    const missing = designs.find(row => row.id === 'smoke-unavailable-design');
    expect(missing, 'requires the owned synthetic absent-file fixture').toBeDefined();
    expect(missing!.artifactUrl).toBeNull();
    expect(missing!.thumbnailUrl).toBeNull();
    expect(missing).not.toHaveProperty('filePath');
  });
});
