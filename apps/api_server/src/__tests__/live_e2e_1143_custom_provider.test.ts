/**
 * Live E2E test for #1143 — a custom openai-compatible provider defined only
 * in opencode.json surfaces in the Rhythm model picker (catalog) against the
 * real running engine + api_server.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Targets the dev sandbox on :4098 (AGENT_LOCAL=true → no bearer token).
 *
 * Run it (against a sandbox built from THIS branch's source):
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     RHYTHM_SANDBOX_OPENCODE_JSON="$SB/home/.config/opencode/opencode.json" \
 *     npx vitest run src/__tests__/live_e2e_1143_custom_provider.test.ts
 *
 * Deterministic seam: inject a custom openai-compatible provider (with an
 * INLINE models map so no live inference endpoint is needed) into the sandbox
 * engine's opencode.json, POST /system/refresh so the engine reloads its
 * config catalog (the same catalog `opencode models` reads), then assert the
 * provider's model appears in GET /agents/models/catalog as an `opencode`-kind
 * direct row. The injected block is removed and the config reloaded again in
 * afterEach.
 *
 * What it proves, end to end against the real running backend:
 *   1. A provider present only in opencode.json (absent from the hardcoded
 *      PROVIDER_TO_AGENT_KIND / ROUTE_FALLBACKS_BY_AGENT maps) is enumerated
 *      from the live engine catalog and merged into the picker response —
 *      the #1143 bug (it was invisible) is fixed.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const CONFIG = process.env.RHYTHM_SANDBOX_OPENCODE_JSON ?? '';

const describeLive = LIVE ? describe : describe.skip;

// A distinctive provider id unlikely to collide with anything real.
const PROVIDER_ID = 'e2e-mesh-1143';
const MODEL_ID = 'e2e-model-4.6';

let originalConfig: string | null = null;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

afterEach(async () => {
  if (originalConfig !== null) {
    writeFileSync(CONFIG, originalConfig, 'utf8');
    originalConfig = null;
    await api('/system/refresh', { method: 'POST' }).catch(() => {});
  }
});

describeLive('live E2E — #1143 custom opencode.json provider appears in the picker', () => {
  beforeAll(async () => {
    if (!CONFIG) throw new Error('set RHYTHM_SANDBOX_OPENCODE_JSON to the running engine config path');
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
  });

  it(
    'a custom openai-compatible provider surfaces as an opencode-kind direct row',
    async () => {
      originalConfig = readFileSync(CONFIG, 'utf8');
      const cfg = JSON.parse(originalConfig) as { provider?: Record<string, unknown> };
      cfg.provider = cfg.provider ?? {};
      // openai-compatible provider with an INLINE models map — no live endpoint
      // needed for config.providers() to enumerate it (mirrors glm-mesh's shape).
      cfg.provider[PROVIDER_ID] = {
        npm: '@ai-sdk/openai-compatible',
        name: 'E2E Mesh (#1143)',
        options: { baseURL: 'http://127.0.0.1:59999/v1', apiKey: 'e2e-test-key' },
        models: {
          [MODEL_ID]: { name: 'E2E Model 4.6', limit: { context: 131072, output: 8192 } },
        },
      };
      writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');

      // Reload the engine config so the live catalog includes the new provider.
      const refresh = await api('/system/refresh', { method: 'POST' });
      expect(refresh.ok, 'system/refresh should succeed').toBe(true);

      // The bug: this provider used to be absent from the catalog entirely.
      const res = await api('/agents/models/catalog');
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const row = rows.find((r) => r.provider === PROVIDER_ID && r.modelId === MODEL_ID);
      expect(row, `expected ${PROVIDER_ID}/${MODEL_ID} in the catalog`).toBeDefined();
      expect(row?.agent).toBe('opencode');
      expect(row?.route).toBe('direct');
    },
    30_000,
  );
});
