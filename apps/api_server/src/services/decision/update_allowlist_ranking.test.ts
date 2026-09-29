import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { OpencodeClientService } from '../opencode_client_service';
import type { McpRoleConfig } from '../agent_profile_scope';
import { setRerankClientForTests } from './decision_client';

const ENV = ['AGENT_DECISION_TOOL_RANKING', 'AGENT_DECISION_TOOL_EAGER_SERVERS'];

describe('updateSessionAllowlist prompt threading', () => {
  let saved: Record<string, string | undefined>;
  let db: Database.Database;
  let prev: Database.Database | null;
  let svc: OpencodeClientService;
  let update: ReturnType<typeof vi.fn>;
  const cfg: McpRoleConfig = {
    role: 'r',
    mcpServers: { gmail: { allowedTools: [] }, github: { allowedTools: [] } },
    allowedToolsJson: '{}',
  };

  beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    db = new Database(':memory:');
    runMigrations(db);
    prev = setDb(db);
    update = vi.fn().mockResolvedValue({ data: {} });
    svc = new OpencodeClientService();
    svc.__setTestV2Client({ session: { update } } as never);
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    setRerankClientForTests({
      rerank: async (_q, docs) => ({
        status: 'ok',
        scores: docs.map((d) => (d.startsWith('github') ? 0.9 : 0.1)),
        latencyMs: 1,
        model: 'fake',
      }),
    });
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    setRerankClientForTests(null);
    setDb(prev);
    db.close();
  });

  const sent = () => (update.mock.calls[0][0] as { mcpAllowlist: { servers: string[] } }).mcpAllowlist;

  it('reorders when a prompt is supplied', async () => {
    await svc.updateSessionAllowlist('s', cfg, 'anthropic', 'open a pull request');
    expect(sent().servers).toEqual(['github', 'gmail']);
  });

  it('behaves as before without a prompt', async () => {
    await svc.updateSessionAllowlist('s', cfg, 'anthropic');
    expect([...sent().servers].sort()).toEqual(['github', 'gmail']);
    expect(sent().servers).toEqual(['gmail', 'github']);
  });
});
