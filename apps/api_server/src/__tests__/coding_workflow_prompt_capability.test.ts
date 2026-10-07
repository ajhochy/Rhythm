/**
 * G2 S5-C: the Secretary's server system text states the current Coding
 * Workflow lane capability (exact S7 line), the compact snapshot carries it, and
 * the freshness fingerprint changes when the reviewer profile disappears. Real
 * assembler + real AgentConfigsRepository on migrated SQLite; no engine.
 * Also pins the composed server adapter and B's membership wiring by source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoordinatorConversation } from '../contracts/coordinator_conversation_contract';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { computeCodingWorkflowCapability, renderCodingWorkflowCapabilityLine } from '../services/coding_workflow_capability';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { createCoordinatorConversationContextAdapters } from '../services/coordinator_conversation_runtime_adapters';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';

let db: Database.Database;
const NOW = new Date('2026-10-06T19:00:00.000Z');
const conversation = {
  id: 'conv-1', ownerUserId: 7, projectId: 'proj-main', sessionId: 'root', controlRevision: 1,
  goals: [], continuations: [], commandDedupe: [],
} as unknown as CoordinatorConversation;

function profile(id: string) {
  new AgentConfigsRepository().insert({ id, label: id, icon: 'x', enabled: true, isAgent: true,
    allowedDelegatesJson: id === 'workflow-orchestrator' ? '["verification-gate"]' : null } as never);
}

async function contract() {
  const configs = new AgentConfigsRepository();
  const context = await new CoordinatorConversationContextAssembler({
    ...createCoordinatorConversationContextAdapters({}),
    codingWorkflowCapability: {
      read: () => computeCodingWorkflowCapability({ configs, projectAuthorized: true, enrollmentAvailable: true }),
    },
  }).assemble({ conversation, now: NOW });
  const service = new CoordinatorConversationService({ repository: {} as never, context: {} as never }) as unknown as {
    foregroundSystemContract(c: unknown, x: unknown): string;
    foregroundContextFingerprint(c: unknown, x: unknown): string;
  };
  return {
    context,
    system: service.foregroundSystemContract(conversation, context),
    fingerprint: service.foregroundContextFingerprint(conversation, context),
  };
}

beforeEach(() => { db = new Database(':memory:'); runMigrations(db); db.pragma('foreign_keys = OFF'); setDb(db); });
afterEach(() => { setDb(null); db.close(); });

describe('G2 S5-C capability in the Secretary prompt', () => {
  it('contains the exact capability line and the compact snapshot field', async () => {
    profile('workflow-orchestrator'); profile('verification-gate');
    const { context, system } = await contract();
    expect(system).toContain(renderCodingWorkflowCapabilityLine(context.codingWorkflow!));
    expect(system).toContain('Coding Workflow lane: available; supported checks: selected_reference_summary_v1; cross-project execution: unsupported.');
    expect(system).toContain('"codingWorkflowLane":{"available":true,"reason":null');
  });

  it('changes text and fingerprint when the reviewer profile is missing', async () => {
    profile('workflow-orchestrator'); profile('verification-gate');
    const before = await contract();
    db.prepare("DELETE FROM agent_configs WHERE id='verification-gate'").run();
    const after = await contract();
    expect(after.system).toContain("Coding Workflow lane: UNAVAILABLE (profile missing: 'verification-gate')");
    expect(after.system).not.toBe(before.system);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('server composes the capability adapter and the B membership proof', () => {
    const source = readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
    expect(source).toMatch(/codingWorkflowCapability:\s*\{\s*read:\s*\(scope\)\s*=>\s*computeCodingWorkflowCapability\(\{/);
    expect(source).toMatch(/projectAuthorized:\s*ownerProjectAccess\(scope\.ownerUserId,\s*scope\.projectId\)/);
    const admission = source.slice(source.indexOf('dayflowProviderAdmission = new DayflowProviderAdmissionService({'));
    expect(admission.slice(0, 2500)).toMatch(/workflowMembership:\s*\{\s*hasMember:[\s\S]*?hasCoordinatorWorkflowMember\(/);
  });
});
