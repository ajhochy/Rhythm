import { describe, expect, it } from 'vitest';

import type { CoordinatorConversationContextScope } from '../contracts/coordinator_conversation_contract';
import type { DayflowQualifiedReferencePage } from '../contracts/dayflow_coordinator_reader_contract';
import {
  createDayflowCoordinatorReferenceAdapter,
  DayflowCoordinatorReferenceAdapter,
  type DayflowCoordinatorReferenceProducerPorts,
} from '../services/dayflow_coordinator_reference_adapter';

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

function qualifiedPage(references: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    status: 'available' as const,
    references,
    nextCursor: null,
    ...overrides,
  };
}

function currentAuthority(overrides: Record<string, unknown> = {}) {
  return {
    binding: {
      namespace: 'dayflow',
      sourceInstance: 'instance-a',
      configurationGeneration: 'config-1',
    },
    scope: {
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      namespace: 'dayflow',
      sourceInstance: 'instance-a',
      consentGeneration: 'consent-1',
      configurationGeneration: 'config-1',
    },
    ...overrides,
  };
}

function qualifiedPorts(input: {
  page: () => unknown;
  active?: () => ReturnType<typeof currentAuthority> | null;
  onRead?: (request: { ownerUserId: number; projectId: string; limit?: number; cursor?: string }) => void;
}): DayflowCoordinatorReferenceProducerPorts {
  const reader = {
    readQualifiedReferences: async (request: { ownerUserId: number; projectId: string; limit?: number; cursor?: string }) => {
      input.onRead?.(request);
      return input.page() as DayflowQualifiedReferencePage;
    },
  };
  const authority = {
    activeScope: () => input.active ? input.active() : currentAuthority(),
  };
  return { reader: () => reader, authority: () => authority };
}

describe('Dayflow coordinator reference consumer', () => {
  it('converts only a complete current qualified producer page into a metadata-only context manifest', async () => {
    const adapter = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage([reference()]),
    }));
    const result = await adapter.read(scope);
    expect(result).toMatchObject({
      availability: 'available',
      complete: true,
      authoritative: true,
      sourceVersion: 'v1',
      items: [{ canonicalId: 'canonical-a', state: 'active' }],
      dependencyManifest: {
        namespace: 'dayflow', sourceInstance: 'instance-a', consentGeneration: 'consent-1',
        configurationGeneration: 'config-1', expiresAt: '2026-10-05T13:00:00.000Z',
      },
    });
    if (result.availability !== 'available' || result.complete !== true || result.authoritative !== true) {
      throw new Error('expected a qualified Dayflow context');
    }
    expect(result.dependencyManifest?.sourceRevision).toMatch(/^qualified:[A-Za-z0-9_-]+$/);
    expect(result.dependencyManifest?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('summary');
    expect(JSON.stringify(result)).not.toContain('criterion');
  });

  it('projects a complete 27-reference qualified scan into a deterministic 25-reference context window', async () => {
    const requests: Array<{ ownerUserId: number; projectId: string; limit?: number; cursor?: string }> = [];
    const references = Array.from({ length: 27 }, (_, index) => reference({
      sourceId: `source-${String(index).padStart(2, '0')}`,
      canonicalId: `canonical-${String(index).padStart(2, '0')}`,
      canonicalVersion: `v${index}`,
    }));
    const adapter = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage(references),
      onRead: (request) => requests.push(request),
    }));
    const result = await adapter.read(scope);
    expect(requests).toEqual([
      { ownerUserId: 7, projectId: 'project-a', limit: 3_000 },
      { ownerUserId: 7, projectId: 'project-a', limit: 3_000 },
    ]);
    if (result.availability !== 'available' || result.complete !== true || result.authoritative !== true) {
      throw new Error('expected a qualified bounded Dayflow context');
    }
    expect(result.coverage).toEqual({
      strategy: 'bounded_relevance', totalItems: 27, selectedItems: 25, maxItems: 25,
    });
    expect(result.items.map((item) => item.canonicalId)).toEqual(
      Array.from({ length: 25 }, (_, index) => `canonical-${String(index).padStart(2, '0')}`),
    );
    expect(result.dependencyManifest?.references).toHaveLength(25);
    expect(result.dependencyManifest?.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    // The omitted tail remains part of the source dependency: changing it
    // cannot leave the same selected context with a stale aggregate receipt.
    const changedTail = [...references];
    changedTail[26] = reference({
      sourceId: 'source-26', canonicalId: 'canonical-26', canonicalVersion: 'v26', sourceHash: 'b'.repeat(64),
    });
    const changed = await createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage(changedTail),
    })).read(scope);
    if (changed.availability !== 'available' || changed.complete !== true || changed.authoritative !== true) {
      throw new Error('expected a changed qualified bounded Dayflow context');
    }
    expect(changed.items.map((item) => item.canonicalId)).toEqual(result.items.map((item) => item.canonicalId));
    expect(changed.dependencyManifest?.sourceHash).not.toEqual(result.dependencyManifest?.sourceHash);
    expect(changed.dependencyManifest?.sourceRevision).not.toEqual(result.dependencyManifest?.sourceRevision);
  });

  it('withholds an incomplete, foreign, revoked, changed, or source-unavailable producer page', async () => {
    const partial = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage([reference()], { nextCursor: 'next:1' }),
    }));
    await expect(partial.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'dependency_unqualified', items: [],
    });

    const overbounded = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage(Array.from({ length: 3_001 }, () => reference())),
    }));
    await expect(overbounded.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'dependency_unqualified', items: [],
    });

    const empty = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({ page: () => qualifiedPage([]) }));
    await expect(empty.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'dependency_unqualified', items: [],
    });

    const foreign = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => qualifiedPage([reference()]),
      active: () => currentAuthority({ scope: { ...currentAuthority().scope, ownerUserId: 8 } }),
    }));
    await expect(foreign.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'authorization_unavailable', items: [],
    });

    const unavailable = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => ({ schemaVersion: 1, status: 'unavailable', references: [], nextCursor: null }),
    }));
    await expect(unavailable.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'source_unavailable', items: [],
    });

    let active: ReturnType<typeof currentAuthority> | null = currentAuthority();
    let reads = 0;
    const revoked = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => {
        if (++reads === 2) active = null;
        return qualifiedPage([reference()]);
      },
      active: () => active,
    }));
    await expect(revoked.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'authorization_unavailable', items: [],
    });

    active = currentAuthority();
    reads = 0;
    const changed = createDayflowCoordinatorReferenceAdapter(qualifiedPorts({
      page: () => {
        if (++reads === 2) {
          active = currentAuthority({
            binding: { ...currentAuthority().binding, sourceInstance: 'instance-b' },
            scope: { ...currentAuthority().scope, sourceInstance: 'instance-b' },
          });
        }
        return qualifiedPage([reference()]);
      },
      active: () => active,
    }));
    await expect(changed.read(scope)).resolves.toMatchObject({
      availability: 'unavailable', reason: 'authorization_unavailable', items: [],
    });
  });

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
