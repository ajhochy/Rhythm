import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dayflowCanonicalVersion, type DayflowQualifiedEvidenceCandidate } from '../contracts/dayflow_coordinator_reader_contract';
import { DayflowConfigStore } from '../integrations/dayflow/config_store';
import { freshDayflowConfig } from '../integrations/dayflow/config_validation';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { AuthenticatedDayflowMemoryClient } from '../integrations/dayflow/authenticated_memory_client';
import { DayflowPersistedQualificationAuthority } from '../integrations/dayflow/persisted_qualification_authority';
import { deriveDayflowQualificationBinding } from '../integrations/dayflow/qualification_binding';
import { DayflowIntegrationService } from '../integrations/dayflow/service';
import { installManagedWorkstreamContextSchema } from '../database/managed_workstream_context_schema';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { resolveAuthenticatedDayflowConsentScope } from '../routes/dayflow_authenticated_management_routes';
import { DayflowReceivingContextAuthorityService } from '../services/dayflow_receiving_context_authority';
import { DayflowReceivingHistoryGuard } from '../services/dayflow_receiving_history_guard';
import { createDayflowCoordinatorReferenceAdapter } from '../services/dayflow_coordinator_reference_adapter';
import { DayflowCanonicalEvidenceResolver, DayflowQualifiedEvidenceService, type DayflowQualifiedReader } from '../services/dayflow_qualified_evidence_service';
import { MemoryIndexService } from '../services/memory_index_service';
import { createObservationIfAbsentInVault, generateUlid } from '../services/memoryVaultWriteService';
import { OpencodeClientService } from '../services/opencode_client_service';
import { ManagedWorkstreamContextRepository } from '../repositories/managed_workstream_context_repository';
import { env } from '../config/env';
import { createApp } from '../app';

const roots: string[] = [];
const CROSS_NOW = Date.parse('2026-10-05T00:01:00.000Z');
afterEach(() => {
  vi.useRealTimers();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function canonicalCandidate(): DayflowQualifiedEvidenceCandidate {
  return {
    reference: {
      schemaVersion: 1,
      namespace: 'namespace:1', sourceInstance: 'source:1', sourceId: 'card:1',
      exporterVersion: 'v2.6.0', normalizerVersion: 'v2.6.0', sourceRevision: 'revision:1',
      sourceHash: 'a'.repeat(64), canonicalId: '01H00000000000000000000000',
      canonicalVersion: `sha256:${'b'.repeat(64)}`, ownerUserId: 7, projectId: 'project:1',
      consentGeneration: 'consent:1', configurationGeneration: 'config:1',
      observedStart: '2026-10-05T00:00:00.000Z', observedEnd: '2026-10-05T01:00:00.000Z',
      expiresAt: '2030-10-05T01:00:00.000Z', eligibility: 'active',
    },
    canonicalContentHash: 'b'.repeat(64),
    contentHash: 'c'.repeat(64),
    canonicalSourceKey: 'memory/context/import-01h00000000000000000000000.md',
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function consentedAuthority(): { store: DayflowConfigStore; ledger: MemoryLedger; authority: DayflowPersistedQualificationAuthority } {
  const root = mkdtempSync(join(tmpdir(), 'dayflow-shared-'));
  roots.push(root);
  const store = new DayflowConfigStore(join(root, 'config.json'));
  const ledger = new MemoryLedger(join(root, 'ownership-ledger.json'));
  const config = freshDayflowConfig();
  config.enabled = true;
  config.automaticImport = true;
  config.timezone = 'UTC';
  config.journalPath = '/private/tmp/dayflow.sqlite';
  config.journalBinding = { fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
  const binding = deriveDayflowQualificationBinding(config)!;
  config.sourceConsent = {
    schemaVersion: 1, ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:1',
    namespace: binding.namespace, sourceInstance: binding.sourceInstance,
    configurationGeneration: binding.configurationGeneration, consentGeneration: 'consent:1',
    grantedAt: '2026-10-05T00:00:00.000Z',
  };
  store.write(config);
  return { store, ledger, authority: new DayflowPersistedQualificationAuthority(store, ledger, () => Date.parse('2026-10-05T00:01:00.000Z')) };
}

function receivingDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, sdk_session_id TEXT,
    parent_session_id TEXT, cwd TEXT, is_system INTEGER, category TEXT
  );
  CREATE TABLE agent_turn_dispatches (
    id TEXT PRIMARY KEY, session_id TEXT, sdk_session_id TEXT, sdk_user_message_id TEXT,
    route_authed INTEGER, outcome TEXT
  );`);
  installManagedWorkstreamContextSchema(db);
  db.prepare(`INSERT INTO agent_sessions
    (id, owner_user_id, project_id, sdk_session_id, parent_session_id, cwd, is_system, category)
    VALUES ('session:1', 7, 'project:1', 'sdk:1', NULL, '/safe/project', 0, 'chat')`).run();
  db.prepare(`INSERT INTO agent_turn_dispatches
    (id, session_id, sdk_session_id, sdk_user_message_id, route_authed, outcome)
    VALUES ('dispatch:1', 'session:1', 'sdk:1', 'user:1', 1, 'accepted')`).run();
  return db;
}

/** Real proposal-01 source/consent/ledger producer; only the Dayflow fixture
 * record and canonical resolver content below are invented test edges. */
async function qualifiedProducerForCrossAuthority(records = [
  { id: 'cross-authority-card', start: '2026-10-05T00:00:00Z', summary: 'Synthetic qualified handoff detail.' },
]) {
  const root = mkdtempSync(join(tmpdir(), 'dayflow-cross-authority-'));
  roots.push(root);
  const store = new DayflowConfigStore(join(root, 'config.json'));
  const ledger = new MemoryLedger(join(root, 'ledger.json'));
  const config = freshDayflowConfig();
  config.enabled = true;
  config.automaticImport = true;
  config.timezone = 'UTC';
  config.journalPath = '/private/tmp/sanitized-dayflow-cross-authority.sqlite';
  config.journalBinding = { fileIdentity: '1:3', schemaFingerprint: 'd'.repeat(64) };
  store.write(config);
  const journal = {
    canonicalPath: config.journalPath,
    fileIdentity: config.journalBinding.fileIdentity,
    schemaFingerprint: config.journalBinding.schemaFingerprint,
  };
  const fixtureSource = {
    read: async () => ({
      contractVersion: 'fixture-v1',
      sourceInstanceId: 'cross-authority-fixture',
      records,
    }),
    hasVerifiedBinding: () => true,
  };
  const authority = new DayflowPersistedQualificationAuthority(store, ledger, () => CROSS_NOW);
  const producer = new DayflowIntegrationService({
    source: fixtureSource as never,
    memoryClient: {
      create: async (input: { id: string }) => ({ id: input.id }),
      createOnly: async (input: { id: string }) => ({
        id: input.id,
        disposition: 'created' as const,
        canonicalContentHash: 'b'.repeat(64),
        canonicalSourceKey: `memory/context/import-${input.id.toLowerCase()}.md`,
      }),
      remove: async () => undefined,
    } as never,
    configStore: store,
    ledger,
    now: () => CROSS_NOW,
    qualificationAuthority: authority,
    journalVerifier: { verify: () => journal } as never,
    sourceForJournal: () => fixtureSource as never,
  });
  producer.grantAuthenticatedSourceConsent({ ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:1' });
  const preview = await producer.previewDate('2026-10-05');
  await producer.commit(preview.token, preview.candidates.map((candidate) => candidate.candidateId));
  return { producer, store, ledger, authority };
}

function activeDayflowTool() {
  return {
    sdkSessionId: 'sdk:1', assistantId: 'turn:1', userMessageId: 'user:1', partId: 'part:1',
    toolCallId: 'tool:1', toolKey: 'rhythm_search_dayflow_activity', agentName: 'agent:1',
    serverName: 'rhythm', toolName: 'rhythm_search_dayflow_activity',
  };
}

/**
 * This is deliberately a real migration-backed dispatch database rather than
 * a mocked prompt helper.  The managed prompt path reads its current
 * workstream/session/dispatch binding from these existing tables immediately
 * before native SDK exposure.
 */
function promptBoundaryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare(`INSERT INTO users (id, name, email)
    VALUES (7, 'Dayflow owner', 'dayflow-owner@example.test')`).run();
  db.prepare(`INSERT INTO projects (id, name, cwd, created_at)
    VALUES ('project:1', 'Dayflow project', '/safe/project', '2026-10-05T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO agent_workstreams (
    id, owner_user_id, project_id, goal, constraints_text, criteria_text,
    checkpoint_json, state, closed_reason, revision, create_key, payload_hash,
    created_at, updated_at
  ) VALUES ('workstream:1', 7, 'project:1', 'goal', 'constraints', 'criteria',
    '{}', 'running', NULL, 1, 'create:1', ?, '2026-10-05T00:00:00.000Z',
    '2026-10-05T00:00:00.000Z')`).run('1'.repeat(64));
  db.prepare(`INSERT INTO agent_sessions (
    id, agent_kind, status, cwd, name, owner_user_id, project_id, sdk_session_id
  ) VALUES ('session:managed', 'build', 'running', '/safe/project', 'managed',
    7, 'project:1', 'sdk:managed')`).run();
  db.prepare(`INSERT INTO agent_sessions (
    id, agent_kind, status, cwd, name, owner_user_id, project_id, sdk_session_id
  ) VALUES ('session:ordinary', 'build', 'running', '/safe/project', 'ordinary',
    7, 'project:1', 'sdk:ordinary')`).run();
  return db;
}

describe('Dayflow authenticated shared composition', () => {
  it('projects only a current persisted qualified producer into coordinator metadata, never task-completion evidence', async () => {
    const { producer, authority } = await qualifiedProducerForCrossAuthority();
    try {
      const adapter = createDayflowCoordinatorReferenceAdapter({
        reader: () => producer,
        authority: () => authority,
      });
      const context = await adapter.read({
        ownerUserId: 7,
        projectId: 'project:1',
        conversationId: 'coordinator:1',
        now: new Date(CROSS_NOW),
      });
      expect(context).toMatchObject({
        availability: 'available',
        complete: true,
        authoritative: true,
        items: [{ state: 'active', namespace: expect.any(String), canonicalId: expect.any(String) }],
        dependencyManifest: {
          namespace: expect.any(String), sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourceRevision: expect.stringMatching(/^qualified:[A-Za-z0-9_-]+$/),
        },
      });
      expect(JSON.stringify(context)).not.toContain('Synthetic qualified handoff detail.');
      expect(JSON.stringify(context)).not.toContain('criterionState');

      await expect(adapter.read({
        ownerUserId: 9,
        projectId: 'project:other',
        conversationId: 'coordinator:foreign',
        now: new Date(CROSS_NOW),
      })).resolves.toMatchObject({ availability: 'unavailable', reason: 'authorization_unavailable', items: [] });

      producer.revokeAuthenticatedSourceConsent({
        ownerUserId: 7,
        projectId: 'project:1',
        authorizingSessionId: 'session:later',
      });
      await expect(adapter.read({
        ownerUserId: 7,
        projectId: 'project:1',
        conversationId: 'coordinator:revoked',
        now: new Date(CROSS_NOW),
      })).resolves.toMatchObject({ availability: 'not_configured', items: [] });
    } finally {
      producer.dispose();
    }
  });

  it('bounds a complete 27-reference persisted qualified producer page without treating it as partial', async () => {
    const records = Array.from({ length: 27 }, (_, index) => ({
      id: `cross-authority-card-${String(index).padStart(2, '0')}`,
      start: '2026-10-05T00:00:00Z',
      summary: `Synthetic bounded qualified handoff detail ${index}.`,
    }));
    const { producer, authority } = await qualifiedProducerForCrossAuthority(records);
    try {
      const page = await producer.readQualifiedReferences({ ownerUserId: 7, projectId: 'project:1', limit: 3_000 });
      expect(page).toMatchObject({ status: 'available', nextCursor: null });
      expect(page.references).toHaveLength(27);

      const adapter = createDayflowCoordinatorReferenceAdapter({
        reader: () => producer,
        authority: () => authority,
      });
      const context = await adapter.read({
        ownerUserId: 7,
        projectId: 'project:1',
        conversationId: 'coordinator:bounded',
        now: new Date(CROSS_NOW),
      });
      if (context.availability !== 'available' || context.complete !== true || context.authoritative !== true) {
        throw new Error('expected a current qualified bounded context');
      }
      expect(context.coverage).toEqual({
        strategy: 'bounded_relevance', totalItems: 27, selectedItems: 25, maxItems: 25,
      });
      expect(context.items).toHaveLength(25);
      expect(context.dependencyManifest?.references).toHaveLength(25);
      expect(JSON.stringify(context)).not.toContain('Synthetic bounded qualified handoff detail');
    } finally {
      producer.dispose();
    }
  });

  it('requires durable explicit source consent and rechecks it around canonical import', async () => {
    const { store, authority } = consentedAuthority();
    const active = authority.activeScope()!;
    const candidate = canonicalCandidate();
    candidate.reference.namespace = active.binding.namespace;
    candidate.reference.sourceInstance = active.binding.sourceInstance;
    candidate.reference.configurationGeneration = active.binding.configurationGeneration;
    const receipt = await authority.qualify({
      namespace: active.binding.namespace, sourceInstance: active.binding.sourceInstance,
      sourceId: candidate.reference.sourceId, exporterVersion: 'v2.6.0', normalizerVersion: 'v2.6.0',
      sourceRevision: candidate.reference.sourceRevision, sourceHash: candidate.reference.sourceHash,
      canonicalId: candidate.reference.canonicalId, canonicalVersion: candidate.reference.canonicalVersion,
      configurationGeneration: active.binding.configurationGeneration,
      observedStart: candidate.reference.observedStart, observedEnd: candidate.reference.observedEnd,
      canonicalContentHash: candidate.canonicalContentHash, canonicalSourceKey: candidate.canonicalSourceKey,
    });
    expect(receipt?.reference.ownerUserId).toBe(7);
    expect(receipt?.reference.projectId).toBe('project:1');

    let scopedOwner: number | undefined;
    const client = new AuthenticatedDayflowMemoryClient(authority, {
      indexForOwner: (ownerUserId) => { scopedOwner = ownerUserId; return {} as never; },
      claimOwner: async (_source, _sourceId, ownerUserId) => ownerUserId === 7,
      createOnly: async () => ({
        id: candidate.reference.canonicalId, path: candidate.canonicalSourceKey, kind: 'context',
        disposition: 'created', canonicalContentHash: candidate.canonicalContentHash,
        sourceRevision: candidate.reference.sourceHash, normalizerVersion: 'v2.6.0',
      }),
    });
    await client.createOnly({
      operationId: 'dayflow_operation_0001', id: candidate.reference.canonicalId,
      content: 'synthetic qualified observation', sourceId: 'card-1',
      observation: { sourceInstanceId: 'fixture', recordId: 'card-1', revisionHash: candidate.reference.sourceHash,
        observedStart: candidate.reference.observedStart, observedEnd: candidate.reference.observedEnd,
        dayKey: '2026-10-05', summary: 'synthetic', exportVersion: 'v2.6.0' },
    });
    expect(scopedOwner).toBe(7);

    const raced = new AuthenticatedDayflowMemoryClient(authority, {
      indexForOwner: () => ({} as never),
      claimOwner: async () => true,
      createOnly: async () => {
        const changed = store.read();
        changed.sourceConsent = { ...changed.sourceConsent!, revokedAt: '2026-10-05T00:02:00.000Z' };
        store.write(changed);
        return {
          id: candidate.reference.canonicalId, path: candidate.canonicalSourceKey, kind: 'context' as const,
          disposition: 'already_present' as const, canonicalContentHash: candidate.canonicalContentHash,
          sourceRevision: candidate.reference.sourceHash, normalizerVersion: 'v2.6.0',
        };
      },
    });
    await expect(raced.createOnly({
      operationId: 'dayflow_operation_0002', id: candidate.reference.canonicalId,
      content: 'synthetic qualified observation', sourceId: 'card-1',
      observation: { sourceInstanceId: 'fixture', recordId: 'card-1', revisionHash: candidate.reference.sourceHash,
        observedStart: candidate.reference.observedStart, observedEnd: candidate.reference.observedEnd,
        dayKey: '2026-10-05', summary: 'synthetic', exportVersion: 'v2.6.0' },
    })).rejects.toThrow('source consent changed');

    await expect(authority.current({ ...active.binding })).resolves.toBeNull();
    await expect(authority.qualify({
      namespace: active.binding.namespace, sourceInstance: active.binding.sourceInstance,
      sourceId: candidate.reference.sourceId, exporterVersion: 'v2.6.0', normalizerVersion: 'v2.6.0',
      sourceRevision: candidate.reference.sourceRevision, sourceHash: candidate.reference.sourceHash,
      canonicalId: candidate.reference.canonicalId, canonicalVersion: candidate.reference.canonicalVersion,
      configurationGeneration: active.binding.configurationGeneration,
      observedStart: candidate.reference.observedStart, observedEnd: candidate.reference.observedEnd,
      canonicalContentHash: candidate.canonicalContentHash, canonicalSourceKey: candidate.canonicalSourceKey,
    })).resolves.toBeNull();
  });

  it('keeps the real authenticated canonical writer receiver on a first import', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-first-import-receiver-'));
    roots.push(root);
    const store = new DayflowConfigStore(join(root, 'config.json'));
    const ledger = new MemoryLedger(join(root, 'ledger.json'));
    const config = freshDayflowConfig();
    config.enabled = true;
    config.automaticImport = true;
    config.timezone = 'UTC';
    config.journalPath = '/private/tmp/sanitized-dayflow-first-import.sqlite';
    config.journalBinding = { fileIdentity: '1:4', schemaFingerprint: 'e'.repeat(64) };
    store.write(config);
    const journal = {
      canonicalPath: config.journalPath,
      fileIdentity: config.journalBinding.fileIdentity,
      schemaFingerprint: config.journalBinding.schemaFingerprint,
    };
    const fixtureSource = {
      read: async () => ({
        contractVersion: 'fixture-v1',
        sourceInstanceId: 'first-import-receiver-fixture',
        records: [{ id: 'first-import-card', start: '2026-10-05T00:00:00Z', summary: 'Synthetic first import detail.' }],
      }),
      hasVerifiedBinding: () => true,
    };
    const authority = new DayflowPersistedQualificationAuthority(store, ledger, () => CROSS_NOW);
    let writerCalls = 0;
    const memoryClient = new AuthenticatedDayflowMemoryClient(authority, {
      indexForOwner: (ownerUserId) => {
        expect(ownerUserId).toBe(7);
        return {} as never;
      },
      claimOwner: async (_source, _sourceId, ownerUserId) => ownerUserId === 7,
      createOnly: async (input) => {
        writerCalls++;
        return {
          id: input.id,
          path: `memory/context/import-${input.id.toLowerCase()}.md`,
          kind: 'context' as const,
          disposition: 'created' as const,
          canonicalContentHash: createHash('sha256').update(input.content).digest('hex'),
          sourceRevision: input.sourceRevision,
          normalizerVersion: input.normalizerVersion,
        };
      },
    });
    const producer = new DayflowIntegrationService({
      source: fixtureSource as never,
      memoryClient,
      configStore: store,
      ledger,
      now: () => CROSS_NOW,
      qualificationAuthority: authority,
      journalVerifier: { verify: () => journal } as never,
      sourceForJournal: () => fixtureSource as never,
    });
    producer.grantAuthenticatedSourceConsent({ ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:1' });

    const preview = await producer.previewDate('2026-10-05');
    const result = await producer.commit(preview.token, preview.candidates.map((candidate) => candidate.candidateId));

    expect(result.imported).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(writerCalls).toBe(1);
    const [entry] = ledger.currentEntries();
    expect(entry?.pendingCreateAt).toBeUndefined();
    expect(entry?.qualification?.reference.ownerUserId).toBe(7);
    producer.dispose();
  });

  it('allows the same authenticated owner/project to revoke from a later root chat', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-source-consent-'));
    roots.push(root);
    const store = new DayflowConfigStore(join(root, 'config.json'));
    const config = freshDayflowConfig();
    config.enabled = true;
    config.automaticImport = true;
    config.timezone = 'UTC';
    config.journalPath = '/private/tmp/dayflow.sqlite';
    config.journalBinding = { fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
    store.write(config);
    const ledger = new MemoryLedger(join(root, 'ownership-ledger.json'));
    const journal = { canonicalPath: config.journalPath, fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
    const service = new DayflowIntegrationService({
      source: { read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'fixture', records: [] }) },
      memoryClient: { create: async () => ({ id: '01H00000000000000000000000' }), remove: async () => undefined },
      configStore: store,
      ledger,
      journalVerifier: { verify: () => journal } as never,
      sourceForJournal: () => ({ read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'fixture', records: [] }) }),
    });
    const authority = new DayflowPersistedQualificationAuthority(store, ledger);
    service.grantAuthenticatedSourceConsent({ ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:old' });
    expect(authority.activeScope()?.scope.ownerUserId).toBe(7);
    service.revokeAuthenticatedSourceConsent({ ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:new' });
    expect(authority.activeScope()).toBeNull();
    service.dispose();
  });

  it('keeps old on-disk consent closed when explicit revocation cannot rename config', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-revocation-fence-'));
    roots.push(root);
    const store = new DayflowConfigStore(join(root, 'config.json'));
    const ledger = new MemoryLedger(join(root, 'ownership-ledger.json'));
    const config = freshDayflowConfig();
    config.enabled = true;
    config.automaticImport = true;
    config.timezone = 'UTC';
    config.journalPath = '/private/tmp/dayflow.sqlite';
    config.journalBinding = { fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
    const binding = deriveDayflowQualificationBinding(config)!;
    config.sourceConsent = {
      schemaVersion: 1, ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:1',
      namespace: binding.namespace, sourceInstance: binding.sourceInstance,
      configurationGeneration: binding.configurationGeneration, consentGeneration: 'consent:revocation-failure',
      grantedAt: '2026-10-05T00:00:00.000Z',
    };
    store.write(config);
    const journal = { canonicalPath: config.journalPath, fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
    const service = new DayflowIntegrationService({
      source: { read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'fixture', records: [] }) },
      memoryClient: { create: async () => ({ id: '01H00000000000000000000000' }), remove: async () => undefined },
      configStore: {
        readWithState: () => store.readWithState(),
        write: () => { throw new Error('synthetic config rename failure'); },
      } as never,
      ledger,
      journalVerifier: { verify: () => journal } as never,
      sourceForJournal: () => ({ read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'fixture', records: [] }) }),
    });
    const authority = new DayflowPersistedQualificationAuthority(store, ledger);
    expect(authority.activeScope()).not.toBeNull();
    expect(() => service.revokeAuthenticatedSourceConsent({
      ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:2',
    })).toThrow('SOURCE_CONSENT_PERSISTENCE_FAILED');
    expect(store.read().sourceConsent?.revokedAt).toBeUndefined();
    expect(authority.activeScope()).toBeNull();
    service.dispose();
  });

  it('resolves consent only from the authenticated owner root chat and server project', () => {
    const session = { id: 'session:1', ownerUserId: 7, projectId: 'project:1', parentSessionId: null, isSystem: false, category: 'chat' };
    const project = { id: 'project:1', archivedAt: null };
    const body = { schemaVersion: 1, action: 'grant', sessionId: 'session:1', projectId: 'project:1' };
    expect(resolveAuthenticatedDayflowConsentScope(7, body,
      { findById: () => session } as never, { findById: () => project } as never,
    )).toMatchObject({ scope: { ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:1' } });
    expect(resolveAuthenticatedDayflowConsentScope(8, body,
      { findById: () => session } as never, { findById: () => project } as never,
    )).toBeNull();
    expect(resolveAuthenticatedDayflowConsentScope(7, { ...body, ownerUserId: 7 },
      { findById: () => session } as never, { findById: () => project } as never,
    )).toBeNull();
  });

  it('restores the scoped canonical projection after generic index rebuild without trusting null owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-owner-rebuild-'));
    roots.push(root);
    const memoryDir = join(root, 'memory');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const previous = setDb(db);
    try {
      db.prepare(`INSERT INTO users (id, name, email) VALUES (7, 'Dayflow owner', 'dayflow-owner@example.test')`).run();
      const repo = new AgentMemoryRepository();
      const ownerIndex = new MemoryIndexService(repo, 7);
      const canonicalId = generateUlid(Date.parse('2026-10-05T00:00:00.000Z'));
      const content = 'Synthetic Dayflow canonical content retained after rebuild.';
      const sourceHash = 'a'.repeat(64);
      const receipt = await createObservationIfAbsentInVault({
        id: canonicalId, kind: 'context', content, source: 'dayflow',
        tags: ['dayflow', 'activity-observation'],
        sources: [{ id: 'dayflow_rebuild_fixture', resource: 'dayflow://card/rebuild', origin: 'dayflow', revision: sourceHash, normalizer_version: 'v2.6.0' }],
        usageWindow: { from: '2026-10-05', to: '2026-10-05' },
        sourceRevision: sourceHash, normalizerVersion: 'v2.6.0',
      }, { memoryDir, index: ownerIndex });

      await new MemoryIndexService(repo).rebuildIndexFromVault(root);
      const before = await repo.findBySourceIdsAsync('obsidian-memory', [receipt.path], 7);
      expect(before).toHaveLength(1);
      expect(before[0].ownerUserId).toBeNull();

      const base = canonicalCandidate();
      const candidate: DayflowQualifiedEvidenceCandidate = {
        ...base,
        reference: {
          ...base.reference,
          canonicalId,
          canonicalVersion: dayflowCanonicalVersion(receipt.canonicalContentHash),
          sourceHash,
          exporterVersion: 'v2.6.0',
          normalizerVersion: 'v2.6.0',
        },
        canonicalSourceKey: receipt.path,
        canonicalContentHash: receipt.canonicalContentHash,
        contentHash: createHash('sha256').update(content).digest('hex'),
      };
      const resolver = new DayflowCanonicalEvidenceResolver({ memory: repo, memoryRoot: () => memoryDir });
      await expect(resolver.resolve({ ownerUserId: 7, projectId: 'project:1', candidate })).resolves.toEqual({ content });
      const after = await repo.findBySourceIdsAsync('obsidian-memory', [receipt.path], 7);
      expect(after).toHaveLength(1);
      expect(after[0].ownerUserId).toBe(7);
    } finally {
      setDb(previous);
      db.close();
    }
  });

  it('persists full private candidate dependencies and makes retracted history nonreusable', async () => {
    const db = receivingDb();
    try {
      const records = new DayflowReceivingContextRepository(db);
      const binding = records.findByActiveTool({ ownerUserId: 7, sdkSessionId: 'sdk:1', sdkTurnId: 'turn:1', sdkUserMessageId: 'user:1' })!;
      const candidate = canonicalCandidate();
      expect(records.append(binding, [candidate])).toBe(true);
      expect(records.listSdkHistory('sdk:1')?.[0].candidates[0]).toEqual(candidate);

      let requestedDirectory: string | undefined;
      const receiver = new DayflowReceivingContextAuthorityService({
        engine: { getCurrentTrustedMcpToolCall: async (_sessionId: string, _turnId: string, _toolCallId: string, directory?: string) => {
          requestedDirectory = directory;
          return {
          sdkSessionId: 'sdk:1', assistantId: 'turn:1', userMessageId: 'user:1', partId: 'part:1',
          toolCallId: 'tool:1', toolKey: 'rhythm_search_dayflow_activity', agentName: 'agent:1',
          serverName: 'rhythm', toolName: 'rhythm_search_dayflow_activity',
          };
        } } as never,
        records,
      });
      const auth = { sessionToken: 'signed', user: { id: 7 } } as never;
      const verified = { context: { sdkSessionId: 'sdk:1', turnId: 'turn:1', agentName: 'agent:1', toolCallId: 'tool:1' }, arguments: { q: 'synthetic' } };
      const context = await receiver.resolve(auth, verified, 'rhythm_search_dayflow_activity');
      expect(context?.dispatchId).toBe('dispatch:1');
      expect(requestedDirectory).toBe('/safe/project');

      const guard = new DayflowReceivingHistoryGuard({
        records,
        authority: {} as never,
        reader: {
          readQualifiedEvidence: async () => ({ schemaVersion: 1, status: 'unavailable', candidates: [] }),
          readQualifiedEvidenceWithAdmission: async () => ({ page: { schemaVersion: 1, status: 'unavailable', references: [], candidates: [], nextCursor: null }, admission: null }),
          isQualifiedEvidenceAdmissionCurrent: () => false,
          isReferenceWithinAutomaticWindow: () => true,
        },
      });
      await expect(guard.revalidateBeforeSdk('sdk:1')).resolves.toBe(false);
      expect(db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get()).toMatchObject({ code: 'dayflow_dependency_revalidation_failed' });
    } finally {
      db.close();
    }

    const markerDb = receivingDb();
    try {
      const markerRecords = new DayflowReceivingContextRepository(markerDb);
      expect(markerRecords.markUnsafe({ dispatchId: 'dispatch:1' }, 'dayflow_dependency_persistence_failure')).toBe(true);
      expect(markerRecords.listSdkHistory('sdk:1')).toBeNull();
      const markerGuard = new DayflowReceivingHistoryGuard({
        records: markerRecords,
        authority: {} as never,
        reader: {
          readQualifiedEvidence: async () => { throw new Error('must not read marker-only history'); },
          readQualifiedEvidenceWithAdmission: async () => { throw new Error('must not read marker-only history'); },
          isQualifiedEvidenceAdmissionCurrent: () => false,
          isReferenceWithinAutomaticWindow: () => true,
        },
      });
      await expect(markerGuard.revalidateBeforeSdk('sdk:1')).resolves.toBe(false);
    } finally {
      markerDb.close();
    }
  });

  async function beginCrossAuthorityRead() {
    vi.useFakeTimers();
    vi.setSystemTime(CROSS_NOW);
    const { producer } = await qualifiedProducerForCrossAuthority();
    const db = receivingDb();
    const records = new DayflowReceivingContextRepository(db);
    const finalEngineEntered = deferred();
    const finalEngineGate = deferred();
    const events: string[] = [];
    let engineActive = true;
    let finalEngineUsed = false;
    let postManifestAdmissions = 0;
    let afterFinalSourceProof: (() => void) | undefined;
    const reader: DayflowQualifiedReader = {
      readQualifiedEvidence: (input) => producer.readQualifiedEvidence(input),
      readQualifiedEvidenceWithAdmission: async (input) => {
        const result = await producer.readQualifiedEvidenceWithAdmission(input);
        const persisted = db.prepare(`SELECT dayflow_context_manifest_revision AS revision
          FROM agent_turn_dispatches WHERE id='dispatch:1'`).get() as { revision: number | null };
        if (persisted.revision === 1) {
          postManifestAdmissions++;
          events.push('producer-admission-post-manifest');
        }
        return result;
      },
      isQualifiedEvidenceAdmissionCurrent: (input, page, admission) => {
        const current = producer.isQualifiedEvidenceAdmissionCurrent(input, page, admission);
        // This models the exact external handoff witness: a queued mutation is
        // scheduled only after a real producer proof returned, while the
        // response still has its live receiver await and final proof pair.
        if (postManifestAdmissions > 0) {
          events.push('producer-admission-sync');
          afterFinalSourceProof?.();
        }
        return current;
      },
      isReferenceWithinAutomaticWindow: (reference) => producer.isReferenceWithinAutomaticWindow(reference),
    };
    const receiver = new DayflowReceivingContextAuthorityService({
      engine: { getCurrentTrustedMcpToolCall: async () => {
        const persisted = db.prepare(`SELECT dayflow_context_manifest_revision AS revision
          FROM agent_turn_dispatches WHERE id='dispatch:1'`).get() as { revision: number | null };
        if (persisted.revision === 1 && !finalEngineUsed) {
          finalEngineUsed = true;
          expect(postManifestAdmissions).toBe(1);
          events.push('final-engine-enter');
          finalEngineEntered.resolve();
          await finalEngineGate.promise;
          events.push('final-engine-return');
        }
        return engineActive ? activeDayflowTool() : null;
      } } as never,
      records,
    });
    const service = new DayflowQualifiedEvidenceService({
      reader,
      receiver,
      canonical: { resolve: async () => ({ content: 'Synthetic useful handoff detail.' }) },
      verify: async () => ({
        context: { sdkSessionId: 'sdk:1', turnId: 'turn:1', agentName: 'agent:1', toolCallId: 'tool:1' },
        arguments: { q: 'handoff', limit: 1 },
      }),
    });
    const result = service.search({ sessionToken: 'signed', user: { id: 7 } } as never, { trustedCall: {} });
    return {
      producer,
      db,
      result,
      events,
      finalEngineEntered,
      finalEngineGate,
      setEngineActive: (value: boolean) => { engineActive = value; },
      afterFinalSourceProof: (callback: () => void) => { afterFinalSourceProof = callback; },
      revokeReceiving: () => records.markUnsafe(
        { dispatchId: 'dispatch:1' },
        'dayflow_receiving_context_changed',
      ),
      postManifestAdmissions: () => postManifestAdmissions,
    };
  }

  it('holds a real qualified producer admission when the live receiving tool is revoked during its final await', async () => {
    const stage = await beginCrossAuthorityRead();
    try {
      await stage.finalEngineEntered.promise;
      stage.setEngineActive(false);
      stage.finalEngineGate.resolve();

      await expect(stage.result).resolves.toEqual({ schemaVersion: 1, status: 'unavailable', text: '', blocked: false });
      expect(stage.events).toEqual([
        'producer-admission-post-manifest', 'producer-admission-sync', 'final-engine-enter',
        'final-engine-return', 'producer-admission-sync',
      ]);
      expect(stage.postManifestAdmissions()).toBe(1);
      expect(stage.db.prepare(`SELECT dayflow_context_manifest_revision AS revision FROM agent_turn_dispatches WHERE id='dispatch:1'`).get())
        .toEqual({ revision: 1 });
      expect(stage.db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get())
        .toEqual({ code: 'dayflow_receiving_context_changed' });
    } finally {
      stage.producer.dispose();
      stage.db.close();
    }
  });

  it('holds when authenticated source consent changes during the final live receiving await', async () => {
    const stage = await beginCrossAuthorityRead();
    try {
      await stage.finalEngineEntered.promise;
      stage.producer.revokeAuthenticatedSourceConsent({ ownerUserId: 7, projectId: 'project:1', authorizingSessionId: 'session:2' });
      stage.finalEngineGate.resolve();

      await expect(stage.result).resolves.toEqual({ schemaVersion: 1, status: 'unavailable', text: '', blocked: false });
      expect(stage.events).toEqual([
        'producer-admission-post-manifest', 'producer-admission-sync', 'final-engine-enter',
        'final-engine-return', 'producer-admission-sync',
      ]);
      expect(stage.postManifestAdmissions()).toBe(1);
      expect(stage.db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get())
        .toEqual({ code: 'dayflow_receiving_context_changed' });
    } finally {
      stage.producer.dispose();
      stage.db.close();
    }
  });

  it('admits useful fenced content when both actual current authorities remain unchanged', async () => {
    const stage = await beginCrossAuthorityRead();
    try {
      await stage.finalEngineEntered.promise;
      stage.finalEngineGate.resolve();

      await expect(stage.result).resolves.toMatchObject({
        schemaVersion: 1,
        status: 'available',
        blocked: false,
        text: expect.stringContaining('Synthetic useful handoff detail.'),
      });
      expect(stage.events).toEqual([
        'producer-admission-post-manifest', 'producer-admission-sync', 'final-engine-enter',
        'final-engine-return', 'producer-admission-sync',
      ]);
      expect(stage.postManifestAdmissions()).toBe(1);
      expect(stage.db.prepare(`SELECT dayflow_context_manifest_revision AS revision FROM agent_turn_dispatches WHERE id='dispatch:1'`).get())
        .toEqual({ revision: 1 });
      expect(stage.db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get())
        .toEqual({ code: null });
    } finally {
      stage.producer.dispose();
      stage.db.close();
    }
  });

  it('holds when a queued receiving-turn revoke follows a true source preflight before the final response boundary', async () => {
    const stage = await beginCrossAuthorityRead();
    let queued = false;
    try {
      stage.afterFinalSourceProof(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          expect(stage.revokeReceiving()).toBe(true);
          stage.events.push('queued-receiver-revoke');
        });
      });
      await stage.finalEngineEntered.promise;
      stage.finalEngineGate.resolve();

      await expect(stage.result).resolves.toEqual({ schemaVersion: 1, status: 'unavailable', text: '', blocked: false });
      expect(queued).toBe(true);
      expect(stage.events).toContain('queued-receiver-revoke');
      expect(stage.events.filter((event) => event === 'producer-admission-sync')).toHaveLength(2);
      expect(stage.postManifestAdmissions()).toBe(1);
      expect(stage.db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get())
        .toEqual({ code: 'dayflow_receiving_context_changed' });
    } finally {
      stage.producer.dispose();
      stage.db.close();
    }
  });

  it('holds when a queued source-consent revoke follows a true source preflight before the final response boundary', async () => {
    const stage = await beginCrossAuthorityRead();
    let queued = false;
    try {
      stage.afterFinalSourceProof(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          stage.producer.revokeAuthenticatedSourceConsent({
            ownerUserId: 7,
            projectId: 'project:1',
            authorizingSessionId: 'session:queued',
          });
          stage.events.push('queued-source-revoke');
        });
      });
      await stage.finalEngineEntered.promise;
      stage.finalEngineGate.resolve();

      await expect(stage.result).resolves.toEqual({ schemaVersion: 1, status: 'unavailable', text: '', blocked: false });
      expect(queued).toBe(true);
      expect(stage.events).toContain('queued-source-revoke');
      expect(stage.events.filter((event) => event === 'producer-admission-sync')).toHaveLength(2);
      expect(stage.postManifestAdmissions()).toBe(1);
      expect(stage.db.prepare(`SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id='session:1'`).get())
        .toEqual({ code: 'dayflow_receiving_context_changed' });
    } finally {
      stage.producer.dispose();
      stage.db.close();
    }
  });
});

describe('Dayflow SDK-history dispatch fence', () => {
  it.each(['prompt', 'promptAsync'] as const)(
    'rechecks retained Dayflow history for both ordinary and managed %s paths immediately before native exposure',
    async (method) => {
      const db = promptBoundaryDb();
      const previousDb = setDb(db);
      const previousExports = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
      const mutableEnv = env as unknown as { dbClient: 'sqlite' | 'postgres' };
      const previousDbClient = mutableEnv.dbClient;
      mutableEnv.dbClient = 'sqlite';
      process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
      try {
        // This marker models retained qualified content whose revalidation
        // just failed. It is separate from the managed ledger deliberately:
        // moving the Dayflow check back into the ordinary-only branch would
        // let the managed call below reach the fake SDK.
        db.prepare(`UPDATE agent_sessions SET
          dayflow_context_nonreuse_code='dayflow_dependency_revalidation_failed',
          dayflow_context_nonreuse_at='2026-10-05T00:01:00.000Z'
          WHERE id IN ('session:managed', 'session:ordinary')`).run();

        const records = new ManagedWorkstreamContextRepository(db, {
          enabled: () => true, dbClient: 'sqlite', role: 'local',
        });
        const managedPrompt = vi.fn(async () => ({ data: { info: {}, parts: [] } }));
        const managedPromptAsync = vi.fn(async () => ({ response: { status: 204 } }));
        const managed = new OpencodeClientService();
        managed.__setTestClient({ session: { prompt: managedPrompt, promptAsync: managedPromptAsync } } as never);
        (managed as unknown as { server: { url: string; close(): void } }).server = {
          url: 'http://synthetic-engine.invalid', close() {},
        };
        const managedRecheck = vi.fn(async () => false);
        managed.setDayflowSdkHistoryGuard({
          shouldBindPrompt: async () => false,
          revalidateBeforeSdk: managedRecheck,
        });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
          JSON.stringify({ messageID: 'msg:managed' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )));

        const provenance = {
          sessionId: 'session:managed', sdkSessionId: 'sdk:managed',
          origin: 'prompt_api' as const, requestedSource: 'caller' as const,
        };
        const managedContext = {
          auth: { sessionToken: 'signed', user: { id: 7 } } as never,
          scope: {
            sessionId: 'session:managed', ownerUserId: 7, projectId: 'project:1',
            workstreamId: 'workstream:1', workstreamRevision: 1, role: 'parent' as const,
            hostEpoch: 'epoch:1', sdkSessionId: 'sdk:managed',
          },
          records,
          policy: {
            enabled: () => true, dbClient: 'sqlite' as const, role: 'local' as const,
            currentHostEpoch: () => 'epoch:1',
          },
          captureReady: true,
        };
        const managedResult = method === 'prompt'
          ? await managed.prompt('sdk:managed', 'synthetic', undefined, '/safe/project', undefined,
            undefined, provenance, managedContext)
          : await managed.promptAsync('sdk:managed', 'synthetic', undefined, '/safe/project', undefined,
            undefined, undefined, provenance, managedContext);
        expect(managedResult).toBe(method === 'prompt' ? null : false);
        expect(managedRecheck).toHaveBeenCalledWith('sdk:managed');
        expect(managedPrompt).not.toHaveBeenCalled();
        expect(managedPromptAsync).not.toHaveBeenCalled();

        const ordinaryPrompt = vi.fn(async () => ({ data: { info: {}, parts: [] } }));
        const ordinaryPromptAsync = vi.fn(async () => ({ data: {} }));
        const ordinary = new OpencodeClientService();
        ordinary.__setTestClient({ session: { prompt: ordinaryPrompt, promptAsync: ordinaryPromptAsync } } as never);
        const ordinaryRecheck = vi.fn(async () => false);
        ordinary.setDayflowSdkHistoryGuard({
          shouldBindPrompt: async () => false,
          revalidateBeforeSdk: ordinaryRecheck,
        });
        const ordinaryResult = method === 'prompt'
          ? await ordinary.prompt('sdk:ordinary', 'synthetic')
          : await ordinary.promptAsync('sdk:ordinary', 'synthetic');
        expect(ordinaryResult).toBe(method === 'prompt' ? null : false);
        expect(ordinaryRecheck).toHaveBeenCalledWith('sdk:ordinary');
        expect(ordinaryPrompt).not.toHaveBeenCalled();
        expect(ordinaryPromptAsync).not.toHaveBeenCalled();
      } finally {
        mutableEnv.dbClient = previousDbClient;
        if (previousExports === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
        else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previousExports;
        vi.unstubAllGlobals();
        setDb(previousDb);
        db.close();
      }
    },
  );

  it.each([
    { label: 'the exact pre-migration missing-column error', error: 'no such column: dayflow_context_schema_version', reachesSdk: true },
    { label: 'a generic unreadable-ledger error', error: 'synthetic database lock', reachesSdk: false },
  ])('treats $label according to the closed database-error policy', async ({ error, reachesSdk }) => {
    const previousDb = setDb({
      prepare: (sql: string) => {
        if (sql.includes('managed_context_')) return { all: () => [] };
        if (sql.includes('dayflow_context_')) throw new Error(error);
        throw new Error(`unexpected synthetic query: ${sql}`);
      },
    } as never);
    const mutableEnv = env as unknown as { dbClient: 'sqlite' | 'postgres' };
    const previousDbClient = mutableEnv.dbClient;
    mutableEnv.dbClient = 'sqlite';
    try {
      const prompt = vi.fn(async () => ({ data: { info: {}, parts: [] } }));
      const promptAsync = vi.fn(async () => ({ data: {} }));
      const service = new OpencodeClientService();
      service.__setTestClient({ session: { prompt, promptAsync } } as never);

      const synchronous = await service.prompt('sdk:classifier', 'synthetic');
      const asynchronous = await service.promptAsync('sdk:classifier', 'synthetic');
      if (reachesSdk) expect(synchronous).toEqual(expect.any(Object));
      else expect(synchronous).toBeNull();
      expect(asynchronous).toBe(reachesSdk);
      expect(prompt).toHaveBeenCalledTimes(reachesSdk ? 1 : 0);
      expect(promptAsync).toHaveBeenCalledTimes(reachesSdk ? 1 : 0);
    } finally {
      mutableEnv.dbClient = previousDbClient;
      setDb(previousDb);
    }
  });
});

describe('Dayflow app composition defaults', () => {
  it('does not mount either authenticated Dayflow surface without its concrete authority', () => {
    const app = createApp();
    const stack = (app as unknown as {
      _router?: { stack?: Array<{ regexp?: RegExp }> };
      router?: { stack?: Array<{ regexp?: RegExp }> };
    })._router?.stack ?? (app as unknown as {
      router?: { stack?: Array<{ regexp?: RegExp }> };
    }).router?.stack ?? [];
    const mounted = stack.map((layer) => String(layer.regexp));
    expect(mounted.some((expression) => expression.includes('dayflow-agent'))).toBe(false);
    expect(mounted.some((expression) => expression.includes('dayflow-integration'))).toBe(false);
  });
});
