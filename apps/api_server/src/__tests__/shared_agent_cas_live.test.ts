import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

// Run only during the parent-owned combined campaign against sandbox.sh.
// RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098
// npx vitest run src/__tests__/shared_agent_cas_live.test.ts
const live = process.env.RHYTHM_LIVE_E2E === '1';
(live ? describe : describe.skip)('shared-agent canonical CAS live', () => {
  it('SA2-AC8 real API and engine retain only the winning revision', async () => {
    // Catches an API-only CAS fix that leaves rejected settings in engine cache/files.
    assertLiveE2EIsolation();
    const base = process.env.RHYTHM_LIVE_URL;
    if (!base) throw new Error('Explicit sandbox RHYTHM_LIVE_URL required');
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        ['4000', '4001', '4096'].includes(url.port) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
      throw new Error('Refusing non-sandbox API origin');
    }
    const request = (path: string, method = 'GET', body?: unknown) => fetch(`${url.origin}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const health = await request('/opencode/health');
    expect(health.ok).toBe(true);
    expect(((await health.json()) as { status: string }).status).toBe('ready');
    const id = `sa2-contract-${randomUUID()}`;
    let created = false;
    try {
      const create = await request('/agent-configs', 'POST', { id, label: 'SA2 synthetic contract', icon: 'sparkles',
        enabled: true, isAgent: true, sessionSelectable: true, systemPrompt: `initial ${id}`,
        allowedSkillsJson: '[]', allowedMcpsJson: '[]', corePermissionsJson: '{"*":"deny","task":"deny"}' });
      expect(create.status).toBe(201);
      created = true;
      const before = await create.json() as { revision: number };
      const responses = await Promise.all(['winner-a', 'winner-b'].map(marker =>
        request(`/agent-configs/${id}`, 'PATCH', { expectedRevision: before.revision, systemPrompt: `${marker} ${id}` })));
      expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
      const winner = await responses.find(r => r.status === 200)!.json() as { systemPrompt: string };
      const saved = await request(`/agent-configs/${id}`);
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ revision: before.revision + 1, systemPrompt: winner.systemPrompt });
      const stale = await request(`/agent-configs/${id}`, 'PATCH', { expectedRevision: before.revision, systemPrompt: `REJECTED ${id}` });
      expect(stale.status).toBe(409);
      await expect.poll(async () => {
        const response = await request('/agent-sessions/agents');
        expect(response.ok).toBe(true);
        const data = await response.json() as { agents: { name: string; prompt?: string }[] };
        return data.agents.find(agent => agent.name === id)?.prompt;
      }, { timeout: 20_000, interval: 500 }).toContain(winner.systemPrompt);
      const after = await request(`/agent-configs/${id}`);
      expect(await after.json()).toMatchObject({ revision: before.revision + 1, systemPrompt: winner.systemPrompt });
    } finally {
      if (created) expect((await request(`/agent-configs/${id}`, 'DELETE')).status).toBe(204);
    }
  }, 60_000);
});
