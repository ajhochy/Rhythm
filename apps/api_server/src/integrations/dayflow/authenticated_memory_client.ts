import { createHash, randomUUID } from 'node:crypto';

import { AgentMemoryRepository } from '../../repositories/agent_memory_repository';
import {
  createObservationIfAbsentInVault,
  forgetCanonicalMemoryById,
  type CreateOnlyObservationResult,
} from '../../services/memoryVaultWriteService';
import { MemoryIndexService } from '../../services/memory_index_service';
import type { DayflowObservation } from './types';
import type { DayflowMemoryClient } from './memory_client';
import { DayflowPersistedQualificationAuthority } from './persisted_qualification_authority';

type CreateOnlyInput = {
  operationId: string;
  id: string;
  content: string;
  sourceId: string;
  observation: DayflowObservation;
};

function sameScope(
  left: ReturnType<DayflowPersistedQualificationAuthority['activeScope']>,
  right: ReturnType<DayflowPersistedQualificationAuthority['activeScope']>,
): boolean {
  return !!left && !!right && left.scope.ownerUserId === right.scope.ownerUserId &&
    left.scope.projectId === right.scope.projectId &&
    left.scope.namespace === right.scope.namespace &&
    left.scope.sourceInstance === right.scope.sourceInstance &&
    left.scope.consentGeneration === right.scope.consentGeneration &&
    left.scope.configurationGeneration === right.scope.configurationGeneration;
}

/**
 * Canonical import is in-process, scoped to the authority's authenticated
 * owner, and rechecked after the canonical writer await. It deliberately does
 * not send an owner/project body to the old loopback import route.
 */
export class AuthenticatedDayflowMemoryClient implements DayflowMemoryClient {
  constructor(
    private readonly authority: DayflowPersistedQualificationAuthority,
    private readonly dependencies: {
      createOnly?: (input: Parameters<typeof createObservationIfAbsentInVault>[0], options: Parameters<typeof createObservationIfAbsentInVault>[1]) => Promise<CreateOnlyObservationResult>;
      forget?: typeof forgetCanonicalMemoryById;
      indexForOwner?: (ownerUserId: number) => MemoryIndexService;
      claimOwner?: (source: string, sourceId: string, ownerUserId: number) => Promise<boolean>;
    } = {},
  ) {}

  async create(input: { id: string; content: string; sourceId: string; observation: DayflowObservation }): Promise<{ id: string }> {
    const receipt = await this.createOnly({
      ...input,
      operationId: `dayflow_${randomUUID().replace(/-/gu, '')}`,
    });
    return { id: receipt.id };
  }

  async createOnly(input: CreateOnlyInput): Promise<{
    id: string;
    disposition: 'created' | 'already_present';
    canonicalContentHash: string;
    canonicalSourceKey?: string;
  }> {
    const before = this.authority.activeScope();
    if (!before) throw new Error('Dayflow canonical import has no authenticated source consent.');
    const footnoteId = `dayflow_${createHash('sha256').update(input.sourceId).digest('hex').slice(0, 32)}`;
    const importer = this.dependencies.createOnly ?? createObservationIfAbsentInVault;
    const index = this.dependencies.indexForOwner?.(before.scope.ownerUserId) ??
      new MemoryIndexService(new AgentMemoryRepository(), before.scope.ownerUserId);
    const result = await importer({
      id: input.id,
      kind: 'context',
      content: input.content,
      source: 'dayflow',
      tags: ['dayflow', 'activity-observation'],
      sourceRevision: input.observation.revisionHash,
      normalizerVersion: input.observation.exportVersion,
      sources: [{
        id: footnoteId,
        resource: `dayflow://card/${encodeURIComponent(input.sourceId)}`,
        revision: input.observation.revisionHash,
        origin: 'dayflow',
        observationId: footnoteId,
        observedAt: input.observation.observedStart,
        observed_at: input.observation.observedStart,
        normalizer_version: input.observation.exportVersion,
        ...(input.observation.observedEnd ? { observed_end: input.observation.observedEnd } : {}),
      }],
      usageWindow: { from: input.observation.dayKey, to: input.observation.dayKey },
    }, { index });
    const after = this.authority.activeScope();
    if (!after || !sameScope(before, after)) {
      throw new Error('Dayflow source consent changed during canonical import.');
    }
    // The vault/index projection may have been rebuilt by a generic startup
    // scan while this create awaited. Claim only a null-owner projection using
    // the already-verified immutable canonical key, never a reader-supplied
    // owner or a broad memory search.
    const claim = this.dependencies.claimOwner ?? ((source: string, sourceId: string, ownerUserId: number) =>
      new AgentMemoryRepository().claimOwnerForSourceIfNull(source, sourceId, ownerUserId));
    if (!(await claim('obsidian-memory', result.path, after.scope.ownerUserId))) {
      throw new Error('Dayflow canonical owner binding is unavailable.');
    }
    if (!sameScope(before, this.authority.activeScope())) {
      throw new Error('Dayflow source consent changed during canonical owner binding.');
    }
    return {
      id: result.id,
      disposition: result.disposition,
      canonicalContentHash: result.canonicalContentHash,
      canonicalSourceKey: result.path,
    };
  }

  async remove(id: string): Promise<void> {
    // Forget is a cleanup operation for a ledger-owned canonical ULID. It does
    // not grant or restore read qualification; source service eligibility
    // remains fail-closed if the consent has been revoked.
    const forget = this.dependencies.forget ?? forgetCanonicalMemoryById;
    await forget(id);
  }
}
