import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:6698';
const configPath = process.env.RHYTHM_SANDBOX_OPENCODE_JSON;
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR;
const inventoryPort = Number(process.env.RHYTHM_LIVE_INVENTORY_PORT ?? '7483');

live('issue-1572 real engine and sandbox API (no inference)', () => {
  const phase1 = process.env.RHYTHM_LIVE_PHASE === '2' ? it.skip : it;
  const phase2 = process.env.RHYTHM_LIVE_PHASE === '2' ? it : it.skip;
  phase1('1572:1572-S1:19 detects added provider drift without claiming activation', async () => {
    if (!configPath || !sandboxDir || !configPath.startsWith(`${sandboxDir}/`)) {
      throw new Error('sandbox-owned config path required');
    }
    const inventory = createServer((request, response) => {
      expect(request.url).toBe('/v1/models');
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'synthetic-chat' }, { id: 'undeclared' }] }));
    });
    await new Promise<void>((resolve) => inventory.listen(inventoryPort, '127.0.0.1', resolve));
    try {
      const before = await fetch(`${base}/agents/models/catalog/full`);
      expect(before.status).toBe(200);
      expect((await before.json() as Array<{ provider: string }>).some((row) => row.provider === 'synthetic-mesh')).toBe(false);
      const configuration = JSON.parse(readFileSync(configPath, 'utf8')) as { provider?: Record<string, unknown> };
      configuration.provider ??= {};
      configuration.provider['synthetic-mesh'] = {
        npm: '@ai-sdk/openai-compatible', name: 'Synthetic mesh',
        options: { baseURL: `http://127.0.0.1:${inventoryPort}/v1`, apiKey: 'synthetic-test-only' },
        models: { 'synthetic-chat': { name: 'Synthetic chat', limit: { context: 8192, output: 1024 },
          capabilities: { input: { text: true }, output: { text: true }, toolcall: true } } },
      };
      writeFileSync(configPath, JSON.stringify(configuration));
      const refresh = await fetch(`${base}/system/refresh`, { method: 'POST' });
      expect(refresh.status).toBe(200);
      const result = await refresh.text();
      expect(result).not.toContain('synthetic-test-only');
      const status = JSON.parse(result) as { restart_required: boolean; refreshed: string[]; status: string };
      expect(status.restart_required).toBe(true);
      expect(status.status).toBe('restart_required');
      expect(status.refreshed).not.toContain('providers');
      const rows = await (await fetch(`${base}/agents/models/catalog/full`)).json() as Array<{ provider: string; modelId: string; available: boolean }>;
      expect(rows.some((row) => row.provider === 'synthetic-mesh' && row.modelId === 'synthetic-chat' && row.available)).toBe(false);
    } finally {
      inventory.close();
    }
  }, 30_000);

  phase2('1572:1572-S1:20 uses local inventory after engine restart and never invents undeclared rows', async () => {
    let inventoryCalls = 0;
    const inventory = createServer((request, response) => {
      inventoryCalls++;
      expect(request.url).toBe('/v1/models');
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'synthetic-chat' }, { id: 'undeclared' }] }));
    });
    await new Promise<void>((resolve) => inventory.listen(inventoryPort, '127.0.0.1', resolve));
    try {
      const health = await fetch(`${base}/opencode/health`);
      expect(health.status).toBe(200);
      const response = await fetch(`${base}/agents/models/catalog/full`);
      expect(response.status).toBe(200);
      let rows = await response.json() as Array<{ provider: string; modelId: string; authorized: boolean; available: boolean }>;
      // A catalog read during restart can cache an empty inventory for 5 s.
      // Keep the live assertion, but allow that bounded cache to expire.
      const deadline = Date.now() + 7_000;
      while (inventoryCalls === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const retry = await fetch(`${base}/agents/models/catalog/full`);
        expect(retry.status).toBe(200);
        rows = await retry.json() as typeof rows;
      }
      expect(inventoryCalls).toBeGreaterThan(0);
      expect(rows).toContainEqual(expect.objectContaining({ provider: 'synthetic-mesh', modelId: 'synthetic-chat', authorized: true, available: true }));
      expect(rows.some((row) => row.provider === 'synthetic-mesh' && row.modelId === 'undeclared')).toBe(false);
      const compatible = await (await fetch(`${base}/agents/models/catalog`)).json() as typeof rows;
      expect(compatible).toContainEqual(expect.objectContaining({ provider: 'synthetic-mesh', modelId: 'synthetic-chat' }));
      const selectable = await (await fetch(`${base}/agents/models?agentId=opencode`)).json() as Array<{ providerId: string; modelId: string }>;
      expect(selectable).toContainEqual(expect.objectContaining({ providerId: 'synthetic-mesh', modelId: 'synthetic-chat' }));
    } finally { inventory.close(); }
  }, 30_000);
});
