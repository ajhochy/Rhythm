/**
 * First-boot OpenAI catalog through the real sandbox API and fork. The sandbox
 * opt-in creates an inert account inside its private HOME before API launch;
 * this test makes metadata GETs only and never sends a model request.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_LIVE_OPENAI_FIRST_BOOT_CATALOG === '1';
const api = 'http://127.0.0.1:4098';
const engine = 'http://127.0.0.1:4097';

describe.runIf(live)('first-boot OpenAI catalog from a synthetic sandbox account', () => {
  it('advertises real fork OpenAI models on the first API read without restart or inference', async () => {
    assertLiveE2EIsolation();
    expect(process.env.RHYTHM_SANDBOX_SYNTHETIC_OPENAI_CATALOG).toBe('1');
    expect(process.env.RHYTHM_LIVE_URL).toBe(api);
    expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engine);
    const fixture = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
    const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? '');
    const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG ?? '');
    const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR ?? '');
    expect(fixture).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sourceDb).toBe(join(fixture, 'rhythm.db'));
    expect(sourceConfig.startsWith(`${fixture}${sep}`)).toBe(true);
    expect(statSync(sourceDb).mode & 0o222).toBe(0);
    expect(statSync(sourceConfig).mode & 0o222).toBe(0);
    expect(realpathSync(process.env.DB_PATH ?? '')).toBe(join(sandbox, 'rhythm.db'));
    const accountPath = join(sandbox, 'home/Library/Application Support/Rhythm/openai-accounts.json');
    expect(statSync(accountPath).mode & 0o777).toBe(0o600);
    const accountFile = JSON.parse(readFileSync(accountPath, 'utf8')) as {
      defaultAccountId: string; accounts: Array<{ id: string; access: string; refresh: string; expires: number }>;
    };
    expect(accountFile.defaultAccountId).toBe('synthetic-catalog-only');
    expect(accountFile.accounts).toEqual([expect.objectContaining({
      id: 'synthetic-catalog-only', access: 'synthetic-catalog-only-do-not-use', refresh: '',
      expires: 4102444800000,
    })]);
    const health = await fetch(`${engine}/global/health`, { signal: AbortSignal.timeout(10_000) });
    expect(health.status).toBe(200);
    expect((await health.json() as { healthy: boolean }).healthy).toBe(true);

    const response = await fetch(`${api}/agents/models/catalog/full`, { signal: AbortSignal.timeout(15_000) });
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<{ provider: string; modelId: string; authorized: boolean }>;
    // The sandbox pins test/tool/fixtures/models-api.json, whose actual first
    // boot catalog advertises these 5.x models (not the installed 6.x set).
    for (const modelId of ['gpt-5.5', 'gpt-5.4']) {
      expect(rows).toContainEqual(expect.objectContaining({ provider: 'openai', modelId, authorized: true }));
    }
    const grid = await fetch(`${api}/agent-decisions/config`, { signal: AbortSignal.timeout(15_000) });
    expect(grid.status).toBe(200);
    const config = await grid.json() as { catalog: { source: string; models: Array<{ providerID: string; modelID: string }> } };
    expect(config.catalog.source).toBe('live');
    expect(config.catalog.models).toContainEqual(expect.objectContaining({ providerID: 'openai', modelID: 'gpt-5.5' }));
  }, 30_000);
});
