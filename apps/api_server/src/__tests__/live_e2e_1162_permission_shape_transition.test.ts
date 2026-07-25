/**
 * Live behavioral contract for #1162.
 *
 * Drives the real sandbox API and verifies the projected frontmatter through
 * the real opencode agent registry. A registry entry with the expected
 * model/options/permissions proves the engine parsed the YAML instead of
 * treating the malformed file as prompt text.
 *
 * Run only after the dev-sandbox ports are free:
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=<sandbox-dir>/rhythm.db \
 *   RHYTHM_SANDBOX_HOME=<sandbox-dir>/home \
 *   npx vitest run src/__tests__/live_e2e_1162_permission_shape_transition.test.ts
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const SANDBOX_HOME = process.env.RHYTHM_SANDBOX_HOME ?? '';
const describeLive = LIVE ? describe : describe.skip;
const MODEL = {
  provider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
  id: process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
};

let createdAgentIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

type RegistryAgent = {
  name: string;
  model?: { providerID: string; modelID: string };
  options?: Record<string, unknown>;
  permission?: Array<Record<string, unknown>>;
};

async function registryAgent(id: string): Promise<RegistryAgent> {
  const { agents } = await apiJson<{ agents: RegistryAgent[] }>('/agent-sessions/agents');
  const agent = agents.find((candidate) => candidate.name === id);
  if (!agent) throw new Error(`agent ${id} missing from live engine registry`);
  return agent;
}

afterEach(async () => {
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdAgentIds = [];
});

describeLive('live E2E — #1162 permission shape transitions', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!SANDBOX_HOME) {
      throw new Error('RHYTHM_SANDBOX_HOME must point at the running sandbox HOME');
    }
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') {
      throw new Error(`opencode engine not ready (status=${engine.status})`);
    }
  });

  it(
    'issue-1162-c4: live registry parses every permission shape transition and preserves model/options',
    async () => {
      const suffix = Date.now();
      const id = `e2e-permission-shape-${suffix}`;
      const created = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id,
          label: `E2E Permission Shape ${suffix}`,
          icon: 'shield',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: MODEL.provider,
          modelId: MODEL.id,
          reasoningEffort: 'low',
          allowedMcpsJson: '[]',
          allowedSkillsJson: '[]',
          corePermissionsJson: JSON.stringify({
            external_directory: { '*': 'allow', '/tmp/*': 'ask' },
          }),
        }),
      });
      createdAgentIds.push(created.id);
      const projectedPath = join(
        SANDBOX_HOME,
        '.config',
        'opencode',
        'agents',
        `${id}.md`,
      );

      await apiJson('/system/refresh', { method: 'POST' });
      let registered = await registryAgent(id);
      expect(registered.model).toEqual({
        providerID: MODEL.provider,
        modelID: MODEL.id,
      });
      expect(registered.options).toMatchObject({
        effort: 'low',
        mcpAllowlist: { servers: [], tools: [] },
        skillAllowlist: { skills: [] },
      });

      await apiJson(`/agent-configs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          corePermissionsJson: JSON.stringify({ external_directory: 'allow' }),
        }),
      });
      await apiJson('/system/refresh', { method: 'POST' });

      let projected = await readFile(projectedPath, 'utf8');
      expect(projected).toContain('  external_directory: allow');
      expect(projected).not.toContain('    "*": allow');
      expect(projected).not.toContain('    "/tmp/*": ask');
      registered = await registryAgent(id);
      expect(registered.model).toEqual({
        providerID: MODEL.provider,
        modelID: MODEL.id,
      });
      expect(registered.options).toMatchObject({ effort: 'low' });
      expect(registered.permission).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            permission: 'external_directory',
            pattern: '*',
            action: 'allow',
          }),
        ]),
      );

      await apiJson(`/agent-configs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          corePermissionsJson: JSON.stringify({
            external_directory: { '*': 'ask' },
          }),
        }),
      });
      await apiJson('/system/refresh', { method: 'POST' });
      projected = await readFile(projectedPath, 'utf8');
      expect(projected).toContain(
        '  external_directory:\n    "*": ask',
      );

      await apiJson(`/agent-configs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          corePermissionsJson: JSON.stringify({
            external_directory: { '*': 'deny', '/tmp/*': 'allow' },
          }),
        }),
      });
      await apiJson('/system/refresh', { method: 'POST' });
      projected = await readFile(projectedPath, 'utf8');
      expect(projected).toContain(
        '  external_directory:\n    "*": deny\n    "/tmp/*": allow',
      );
      expect(projected).not.toContain('"*": ask');
      registered = await registryAgent(id);
      expect(registered.model).toEqual({
        providerID: MODEL.provider,
        modelID: MODEL.id,
      });
      expect(registered.options).toMatchObject({ effort: 'low' });
    },
    90_000,
  );
});
