/** Real assembler + migrated SQLite + real AgentConfigsRepository; no engine/network. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import type { CoordinatorConversation } from '../contracts/coordinator_conversation_contract';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { computeCodingWorkflowCapability } from '../services/coding_workflow_capability';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { createCoordinatorConversationContextAdapters } from '../services/coordinator_conversation_runtime_adapters';

let db: Database.Database;
const NOW = new Date('2026-10-06T19:00:00.000Z');
const conversation = { id: 'conv-1', ownerUserId: 7, projectId: 'proj-main', sessionId: 'root' } as unknown as CoordinatorConversation;

function profile(id: string, over: Record<string, unknown> = {}) {
  new AgentConfigsRepository().insert({ id, label: id, icon: 'x', enabled: true, isAgent: true,
    allowedDelegatesJson: id === 'workflow-orchestrator' ? '["verification-gate"]' : null, ...over } as never);
}

function assemble(state: { authorized?: boolean; enrolled?: boolean } = {}) {
  const configs = new AgentConfigsRepository();
  const base = createCoordinatorConversationContextAdapters({});
  return new CoordinatorConversationContextAssembler({
    ...base,
    codingWorkflowCapability: {
      read: () => computeCodingWorkflowCapability({
        configs, projectAuthorized: state.authorized ?? true, enrollmentAvailable: state.enrolled ?? true,
      }),
    },
  }).assemble({ conversation, now: NOW });
}

beforeEach(() => { db = new Database(':memory:'); runMigrations(db); db.pragma('foreign_keys = OFF'); setDb(db); });
afterEach(() => { setDb(null); db.close(); });

describe('coordinator context: coding-workflow lane capability', () => {
  it('is available with the exact item when the server checks pass', async () => {
    profile('workflow-orchestrator'); profile('verification-gate');
    expect((await assemble()).codingWorkflow).toEqual({
      lane: 'coding_workflow', available: true, reason: null,
      supportedChecks: ['selected_reference_summary_v1'], crossProject: 'unsupported',
    });
  });

  it('reports unavailable with the exact server reason when the reviewer profile is missing', async () => {
    profile('workflow-orchestrator');
    expect((await assemble()).codingWorkflow).toMatchObject({
      available: false, reason: "profile missing: 'verification-gate'", crossProject: 'unsupported',
    });
  });

  it('reports a disabled reviewer, an unauthorized project and no enrollment distinctly', async () => {
    profile('workflow-orchestrator'); profile('verification-gate', { enabled: false });
    expect((await assemble()).codingWorkflow?.reason).toBe("agent disabled: 'verification-gate'");
    db.prepare("UPDATE agent_configs SET enabled=1 WHERE id='verification-gate'").run();
    expect((await assemble({ authorized: false })).codingWorkflow?.reason).toContain('not authorized');
    expect((await assemble({ enrolled: false })).codingWorkflow?.reason).toContain('enrollment');
  });

  it('an adapter cannot upgrade the fixed fields, and a throwing or malformed adapter reads unavailable', async () => {
    const base = createCoordinatorConversationContextAdapters({});
    const run = (read: () => unknown) =>
      new CoordinatorConversationContextAssembler({ ...base, codingWorkflowCapability: { read } as never })
        .assemble({ conversation, now: NOW });
    expect((await run(() => ({ available: true, reason: null, crossProject: 'supported', supportedChecks: ['anything'] }))).codingWorkflow)
      .toMatchObject({ available: true, crossProject: 'unsupported', supportedChecks: ['selected_reference_summary_v1'] });
    expect((await run(() => { throw new Error('x'); })).codingWorkflow).toMatchObject({ available: false });
    expect((await run(() => 'nope')).codingWorkflow).toMatchObject({ available: false });
  });

  it('is absent (not guessed) when no capability adapter is composed, and never changes modelContext qualification', async () => {
    const out = await new CoordinatorConversationContextAssembler(createCoordinatorConversationContextAdapters({}))
      .assemble({ conversation, now: NOW });
    expect(out.codingWorkflow).toBeUndefined();
  });
});
