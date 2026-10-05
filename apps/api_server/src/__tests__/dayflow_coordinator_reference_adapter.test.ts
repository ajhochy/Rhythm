import { describe, expect, it } from 'vitest';

import type { CoordinatorConversationContextScope } from '../contracts/coordinator_conversation_contract';
import { DayflowCoordinatorReferenceAdapter } from '../services/dayflow_coordinator_reference_adapter';

const now = new Date('2026-10-05T12:00:00.000Z');
const scope: CoordinatorConversationContextScope = {
  ownerUserId: 7,
  projectId: 'project-a',
  conversationId: 'conversation-a',
  now,
};

function reference(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    namespace: 'dayflow',
    sourceInstance: 'instance-a',
    sourceId: 'source-a',
    exporterVersion: 'v1',
    normalizerVersion: 'v1',
    sourceRevision: 'r1',
    sourceHash: 'a'.repeat(64),
    canonicalId: 'canonical-a',
    canonicalVersion: 'v1',
    ownerUserId: scope.ownerUserId,
    projectId: scope.projectId,
    consentGeneration: 'consent-1',
    configurationGeneration: 'config-1',
    observedStart: '2026-10-05T11:00:00.000Z',
    observedEnd: '2026-10-05T11:30:00.000Z',
    expiresAt: '2026-10-05T13:00:00.000Z',
    eligibility: 'active',
    ...overrides,
  };
}

function envelope(references: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    kind: 'available' as const,
    complete: true as const,
    authoritative: true as const,
    observedAt: now.toISOString(),
    sourceVersion: 'dayflow-reader-v1',
    namespace: 'dayflow',
    sourceInstance: 'instance-a',
    sourceRevision: 'envelope-r1',
    sourceHash: 'e'.repeat(64),
    expiresAt: '2026-10-05T13:00:00.000Z',
    ownerUserId: scope.ownerUserId,
    projectId: scope.projectId,
    consentGeneration: 'consent-1',
    configurationGeneration: 'config-1',
    references,
    ...overrides,
  };
}

function reader(references: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    read: async () => envelope(references, overrides),
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'available' as const,
    ownerUserId: scope.ownerUserId,
    projectId: scope.projectId,
    namespace: 'dayflow',
    sourceInstance: 'instance-a',
    sourceVersion: 'dayflow-reader-v1',
    sourceRevision: 'envelope-r1',
    sourceHash: 'e'.repeat(64),
    expiresAt: '2026-10-05T13:00:00.000Z',
    consentGeneration: 'consent-1',
    configurationGeneration: 'config-1',
    ...overrides,
  };
}

function bindingFor(value: ReturnType<typeof envelope>) {
  return binding({
    namespace: value.namespace,
    sourceInstance: value.sourceInstance,
    sourceVersion: value.sourceVersion,
    sourceRevision: value.sourceRevision,
    sourceHash: value.sourceHash,
    expiresAt: value.expiresAt,
    consentGeneration: value.consentGeneration,
    configurationGeneration: value.configurationGeneration,
  });
}

describe('Dayflow coordinator reference consumer', () => {
  it('automatically projects only current scoped opaque identities and handles an incremental update without a manual import', async () => {
    let current = envelope([reference()]);
    const adapter = new DayflowCoordinatorReferenceAdapter(
      { read: async () => current },
      { current: async () => bindingFor(current) },
    );
    const first = await adapter.read(scope);
    expect(first).toMatchObject({
      availability: 'available',
      complete: true,
      items: [{ sourceId: 'canonical-a', expectedVersion: 'v1', state: 'active' }],
    });
    current = envelope([
      reference(), reference({ canonicalId: 'canonical-b', canonicalVersion: 'v2', sourceHash: 'b'.repeat(64) }),
    ], { sourceVersion: 'dayflow-reader-v2', sourceRevision: 'envelope-r2', sourceHash: 'f'.repeat(64) });
    expect(adapter.noteSourceChange({
      kind: 'source_changed', ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      namespace: 'dayflow', sourceInstance: 'instance-a', consentGeneration: 'consent-1',
      configurationGeneration: 'config-1', sourceVersion: 'dayflow-reader-v2', sourceRevision: 'envelope-r2',
      sourceHash: 'f'.repeat(64), observedAt: now.toISOString(), code: 'incremental',
    })).toBe(true);
    const second = await adapter.read(scope);
    expect(second).toMatchObject({ availability: 'available', items: [
      { sourceId: 'canonical-a', expectedVersion: 'v1' },
      { sourceId: 'canonical-b', expectedVersion: 'v2' },
    ] });
    expect(JSON.stringify(second)).not.toContain('title');
    expect(JSON.stringify(second)).not.toContain('body');
  });

  it('fails closed for missing/null/numeric/malformed metadata, foreign/expired/duplicate references, and incomplete evidence while a missing reader is honestly inactive', async () => {
    expect(await new DayflowCoordinatorReferenceAdapter().read(scope)).toMatchObject({ availability: 'not_configured' });
    expect(await new DayflowCoordinatorReferenceAdapter(reader([
      reference({ ownerUserId: 8 }),
    ]), { current: async () => binding() }).read(scope)).toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
    for (const value of [undefined, null, 7]) {
      expect(await new DayflowCoordinatorReferenceAdapter(reader([], { sourceInstance: value }), { current: async () => binding() }).read(scope))
        .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
      expect(await new DayflowCoordinatorReferenceAdapter(reader([], { namespace: value }), { current: async () => binding() }).read(scope))
        .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
      expect(await new DayflowCoordinatorReferenceAdapter(reader([], { consentGeneration: value }), { current: async () => binding() }).read(scope))
        .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
      expect(await new DayflowCoordinatorReferenceAdapter(reader([], { configurationGeneration: value }), { current: async () => binding() }).read(scope))
        .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
    }
    expect(await new DayflowCoordinatorReferenceAdapter(reader([], { namespace: 'other' }), { current: async () => binding() }).read(scope))
      .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
    expect(await new DayflowCoordinatorReferenceAdapter(reader([reference(), reference()]), { current: async () => binding() }).read(scope))
      .toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
    expect(await new DayflowCoordinatorReferenceAdapter(reader([
      reference({ expiresAt: '2026-10-05T11:59:59.000Z' }),
      reference({ canonicalId: 'pending-a', sourceHash: 'c'.repeat(64), eligibility: 'pending_create' }),
      reference({ canonicalId: 'retracted-a', sourceHash: 'd'.repeat(64), eligibility: 'retracted' }),
    ]), { current: async () => binding() }).read(scope)).toMatchObject({ availability: 'available', items: [] });
    const incomplete = new DayflowCoordinatorReferenceAdapter({
      read: async () => ({ kind: 'available' as const, complete: false as const, authoritative: true as const }),
    } as never, { current: async () => binding() });
    expect(await incomplete.read(scope)).toMatchObject({ availability: 'unavailable', reason: 'dependency_unqualified' });
  });

  it('accepts a matching full retraction envelope only as an authoritative empty reference set', async () => {
    let current = envelope([reference()]);
    const adapter = new DayflowCoordinatorReferenceAdapter(
      { read: async () => current },
      { current: async () => bindingFor(current) },
    );
    current = envelope([
      reference({ canonicalId: 'retracted-a', sourceHash: 'b'.repeat(64), eligibility: 'retracted' }),
    ], {
      sourceVersion: 'dayflow-reader-v2', sourceRevision: 'envelope-r2', sourceHash: 'c'.repeat(64),
    });
    expect(adapter.noteSourceChange({
      kind: 'source_changed', ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      namespace: 'dayflow', sourceInstance: 'instance-a', consentGeneration: 'consent-1',
      configurationGeneration: 'config-1', sourceVersion: 'dayflow-reader-v2', sourceRevision: 'envelope-r2',
      sourceHash: 'c'.repeat(64), observedAt: now.toISOString(), code: 'retracted',
    })).toBe(true);
    await expect(adapter.read(scope)).resolves.toMatchObject({
      availability: 'available', complete: true, authoritative: true, items: [],
      dependencyManifest: { sourceRevision: 'envelope-r2', sourceHash: 'c'.repeat(64) },
    });
  });
});
