import { afterEach, describe, expect, it, vi } from 'vitest';

describe('#1491-W2 — trigger SQL is safe for deployment roles without webhook tables', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function queriesFor(agentExecutionEnabled: boolean): Promise<string[]> {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    vi.doMock('../config/env', () => ({
      env: { dbClient: 'postgres', agentExecutionEnabled },
    }));
    vi.doMock('../database/db', () => ({
      getPostgresPool: () => ({ query }),
      getDb: vi.fn(),
    }));
    const { ClaudeTriggersRepository } = await import('../repositories/claude_triggers_repository');
    const repo = new ClaudeTriggersRepository();
    await repo.listAllAsync();
    await repo.listForUser(17);
    await repo.findByIdAndUser(23, 17);
    return query.mock.calls.map((call) => call[0] as string);
  }

  for (const role of ['cloud', 'relay']) {
    it(`1491:W2:1 ${role} queries never reference agent_webhook_endpoints`, async () => {
      const sql = await queriesFor(false);
      expect(sql).toHaveLength(3);
      for (const statement of sql) {
        expect(statement).not.toContain('agent_webhook_endpoints');
        expect(statement).toContain('NULL AS webhook_endpoint_name');
        expect(statement).toContain(
          'COALESCE(t.title, st.name, CAST(pct.webhook_endpoint_id AS TEXT)) AS task_title',
        );
      }
    });
  }

  it('1491:W2:2 local/all queries preserve endpoint names and the webhook join', async () => {
    const sql = await queriesFor(true);
    expect(sql).toHaveLength(3);
    for (const statement of sql) {
      expect(statement).toContain('LEFT JOIN agent_webhook_endpoints awe');
      expect(statement).toContain('awe.name AS webhook_endpoint_name');
      expect(statement).toContain(
        'COALESCE(t.title, st.name, awe.name, CAST(awe.id AS TEXT)) AS task_title',
      );
    }
  });
});
