/**
 * Real fork + API MCP inspector gate. Run only through tools/dev/sandbox.sh
 * with tools/dev/sandbox_fixture.mjs inputs; no model or MCP tool is invoked.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const api = 'http://127.0.0.1:4098';
const engine = 'http://127.0.0.1:4097';
const syntheticToken = 'e02-synthetic-session-not-a-secret';

type InspectorEntry = { name: string; status: string; tools: string[] };
type InspectorResult = { http: number; entries?: InspectorEntry[]; code?: string };

function validatedFixture(): { type: 'local'; command: string[]; environment: Record<string, string> } {
  assertLiveE2EIsolation();
  const fixtureRoot = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
  const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? '');
  const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG ?? '');
  const sandbox = resolve(process.env.RHYTHM_SANDBOX_DIR ?? '');
  const root = resolve(__dirname, '../../../..');
  expect(fixtureRoot).toMatch(/^\/private\/tmp\/rhythm-mcp-catalog-fixture-/);
  expect(sourceDb).toBe(join(fixtureRoot, 'rhythm.db'));
  expect(sourceConfig).toBe(join(fixtureRoot, 'opencode.json'));
  expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-mcp-catalog-sandbox-/);
  expect(resolve(process.env.DB_PATH ?? '')).toBe(join(sandbox, 'rhythm.db'));
  expect(statSync(sourceDb).mode & 0o222).toBe(0);
  expect(statSync(sourceConfig).mode & 0o222).toBe(0);
  expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
  expect(process.env.RHYTHM_LIVE_URL).toBe(api);
  expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engine);
  const config = JSON.parse(readFileSync(sourceConfig, 'utf8')) as {
    mcp?: { rhythm?: { type: 'local'; command: string[]; environment: Record<string, string> } };
  };
  const rhythm = config.mcp?.rhythm;
  expect(rhythm).toEqual({
    type: 'local',
    command: ['node', join(root, 'apps/mcp_server/dist/index.js')],
    environment: { RHYTHM_API_URL: api, RHYTHM_API_TOKEN: syntheticToken },
  });
  return rhythm!;
}

async function inspector(): Promise<InspectorResult> {
  const response = await fetch(`${api}/opencode/mcp`, { signal: AbortSignal.timeout(10_000) });
  const body = await response.json() as InspectorEntry[] | { error?: { code?: string } };
  if (response.status === 503) {
    return { http: 503, code: !Array.isArray(body) ? body.error?.code : undefined };
  }
  expect(response.status).toBe(200);
  expect(Array.isArray(body)).toBe(true);
  return { http: 200, entries: body as InspectorEntry[] };
}

function assertCoherent(result: InspectorResult): void {
  if (result.http === 503) {
    expect(result.code).toBe('MCP_CATALOG_UNAVAILABLE');
    return;
  }
  const rhythm = result.entries?.find((entry) => entry.name === 'rhythm');
  expect(rhythm).toBeDefined();
  if (rhythm?.status === 'connected') expect(rhythm.tools).toHaveLength(114);
}

async function waitForCatalog(): Promise<void> {
  const deadline = Date.now() + 30_000;
  do {
    const result = await inspector();
    assertCoherent(result);
    if (result.entries?.find((entry) => entry.name === 'rhythm')?.tools.length === 114) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('sandbox Rhythm MCP did not expose 114 tools within 30 seconds');
}

describe.runIf(live)('real sandbox MCP inspector catalog replacement', () => {
  it('never reports connected with zero tools while the real engine replaces the bundled server', async () => {
    const config = validatedFixture();
    const identity = await fetch(`${api}/auth/me`, {
      headers: { Authorization: `Bearer ${syntheticToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(identity.status).toBe(200);
    expect(JSON.stringify(await identity.json())).toContain('admin@example.invalid');
    const health = await fetch(`${engine}/global/health`, { signal: AbortSignal.timeout(10_000) });
    expect(health.status).toBe(200);
    expect((await health.json() as { healthy: boolean }).healthy).toBe(true);
    await waitForCatalog();

    let observed = 0;
    let connected = 0;
    let configured = 0;
    let unavailable = 0;
    for (let replacement = 0; replacement < 3; replacement++) {
      const add = fetch(`${engine}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'rhythm', config }),
        signal: AbortSignal.timeout(20_000),
      });
      const deadline = Date.now() + 20_000;
      let settled = false;
      void add.then(() => { settled = true; }, () => { settled = true; });
      do {
        const result = await inspector();
        assertCoherent(result);
        if (result.http === 503) unavailable++;
        else if (result.entries?.find((entry) => entry.name === 'rhythm')?.status === 'connected') connected++;
        else configured++;
        observed++;
      } while (!settled && Date.now() < deadline);
      const response = await add;
      expect(response.status, await response.text()).toBe(200);
      await waitForCatalog();
    }
    expect(observed).toBeGreaterThanOrEqual(3);
    const idsResponse = await fetch(`${engine}/mcp/tools`, { signal: AbortSignal.timeout(10_000) });
    expect(idsResponse.status).toBe(200);
    const ids = await idsResponse.json() as string[];
    expect(ids.filter((id) => id.startsWith('rhythm_'))).toHaveLength(114);
    console.info(`MCP catalog live: replacements=3 observations=${observed} connected=${connected} configured=${configured} explicit503=${unavailable} finalTools=114`);
  }, 90_000);
});
