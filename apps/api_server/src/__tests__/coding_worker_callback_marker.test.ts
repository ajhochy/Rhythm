/**
 * Regression guard: the coding worker -> manager callback must carry the
 * coordinator callback marker that promptAsync requires.
 *
 * coordinatorDelegationCallbackReason only marks a root waking on its
 * workflow-orchestrator manager. The worker callback (manager parent,
 * coding-agent child) got no marker, so promptAsync refused its
 * coordinator_callback_v1 context before preparing, silently. Live: the worker
 * finished in 61s, its result never reached the manager, and the run was
 * cancelled at its 600s deadline.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { isCoordinatorCallbackProvenance, parseCoordinatorCallbackMarker } from '../contracts/coordinator_callback_marker';

const boundary = vi.hoisted(() => ({ promptAsync: vi.fn(async () => true) }));
vi.mock('../services/opencode_engine', () => ({
  opencodeSessionMap: new Map(),
  opencodeClient: {
    promptAsync: boundary.promptAsync,
    providerSnapshot: async () => ({ providers: [] }),
    getEngineIdentity: async () => null,
    listMessagesPageStrict: async () => null,
  },
}));
vi.mock('../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession: vi.fn(), stopStream: vi.fn() } }));
vi.mock('../services/coordinator_coding_effort', () => ({ codingEffortVariant: () => 'high' }));
vi.mock('../services/coordinator_coding_grant_permission', () => ({
  codingGrantDelegation: () => ({
    role: 'worker', current: () => true,
    proposal: { chain: { manager: { providerId: 'openai', modelId: 'gpt-6.1-sol' } } },
    scope: { sessionId: 'root', ownerUserId: 7, projectId: 'p', commandKey: 'op' },
    journal: { recordCallbackOutcome: vi.fn(), recordCallbackPrepared: () => true },
  }),
  codingGrantPermission: () => null,
}));

import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  boundary.promptAsync.mockClear();
  db.prepare(`INSERT INTO users(id,name,email) VALUES(7,'Owner','owner@example.invalid')`).run();
  new AgentConfigsRepository().insert({ id: 'workflow-orchestrator', label: 'wo', icon: 'agent', enabled: true, isAgent: true,
    modelProvider: 'openai', modelId: 'gpt-6.1-sol', ocAgent: 'workflow-orchestrator' } as never);
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,mcp_role,status,cwd,sdk_session_id,category,owner_user_id,provider_id,model_id)
    VALUES('manager','m','workflow-orchestrator','workflow-orchestrator','idle','/private/tmp/w','ses_manager','chat',7,'openai','gpt-6.1-sol')`).run();
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,parent_session_id,category,owner_user_id)
    VALUES('worker','w','coding-agent','idle','/private/tmp/w','ses_worker','manager','chat',7)`).run();
});
afterEach(() => db.close());

describe('coding worker callback marker', () => {
  it('wakes the manager with provenance that passes the coordinator callback contract', async () => {
    const d = new AgentAsyncDelegationsRepository().create({ parentSessionId: 'manager', childSessionId: 'worker', targetAgentConfigId: 'coding-agent' });
    db.prepare(`UPDATE agent_async_delegations SET status='completed',coding_delivery_mode='coding_worker_v1',
      coding_root_session_id='root',coding_operation_key='op' WHERE id=?`).run(d.id);

    await (new AsyncDelegationCompletionService() as unknown as { flushParent(id: string): Promise<void> }).flushParent('manager');

    expect(boundary.promptAsync).toHaveBeenCalledTimes(1);
    const call = boundary.promptAsync.mock.calls[0] as unknown[];
    const provenance = call[7] as { reasonCode?: string; origin?: string; requestedSource?: string };
    expect(isCoordinatorCallbackProvenance(provenance)).toBe(true);
    expect(parseCoordinatorCallbackMarker(provenance.reasonCode)).toBe(d.id);
    expect((call[10] as { kind?: string }).kind).toBe('coordinator_callback_v1');
  });
});
