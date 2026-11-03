import {
  parseDayflowQualifiedReceipt,
  receiptMatchesCandidate,
  type DayflowQualificationAuthority,
  type DayflowQualificationCandidate,
  type DayflowQualificationScope,
  type DayflowQualifiedReceipt,
} from '../../contracts/dayflow_coordinator_reader_contract';
import { DayflowConfigStore } from './config_store';
import type { MemoryLedger } from './ledger';
import {
  activeDayflowSourceConsent,
  deriveDayflowQualificationBinding,
  type DayflowQualificationBinding,
} from './qualification_binding';

const RECEIPT_TTL_MS = 15 * 60_000;

export interface ActiveDayflowQualificationScope {
  binding: DayflowQualificationBinding;
  scope: DayflowQualificationScope;
}

/**
 * Real local authority backed by the durable private Dayflow config. A local
 * selection alone cannot manufacture a scope: only a previously authenticated
 * explicit source-consent record matching the current binding is accepted.
 */
export class DayflowPersistedQualificationAuthority implements DayflowQualificationAuthority {
  constructor(
    private readonly store: Pick<DayflowConfigStore, 'read'>,
    private readonly ledger: Pick<MemoryLedger, 'isSourceConsentGenerationRevoked'> | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  activeScope(): ActiveDayflowQualificationScope | null {
    try {
      const config = this.store.read();
      const binding = deriveDayflowQualificationBinding(config);
      if (!binding) return null;
      const consent = activeDayflowSourceConsent(config, binding);
      // A local config selection alone cannot be authority. The existing
      // ledger's persistent fence is required so a failed revoke write remains
      // closed across process restart.
      if (!consent || !this.ledger || this.ledger.isSourceConsentGenerationRevoked(consent.consentGeneration)) return null;
      return {
        binding,
        scope: {
          ownerUserId: consent.ownerUserId,
          projectId: consent.projectId,
          namespace: binding.namespace,
          sourceInstance: binding.sourceInstance,
          consentGeneration: consent.consentGeneration,
          configurationGeneration: binding.configurationGeneration,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Concrete synchronous proof for the final producer admission. It re-reads
   * the durable authenticated consent and ledger revocation fence; it never
   * reuses an earlier async response or accepts a caller-provided scope.
   */
  currentSnapshot(input: {
    namespace: string;
    sourceInstance: string;
    configurationGeneration: string;
  }): DayflowQualificationScope | null {
    const active = this.activeScope();
    if (!active || active.binding.namespace !== input.namespace ||
        active.binding.sourceInstance !== input.sourceInstance ||
        active.binding.configurationGeneration !== input.configurationGeneration) return null;
    return active.scope;
  }

  async current(input: {
    namespace: string;
    sourceInstance: string;
    configurationGeneration: string;
  }): Promise<DayflowQualificationScope | null> {
    return this.currentSnapshot(input);
  }

  async qualify(candidate: DayflowQualificationCandidate): Promise<DayflowQualifiedReceipt | null> {
    const scope = await this.current({
      namespace: candidate.namespace,
      sourceInstance: candidate.sourceInstance,
      configurationGeneration: candidate.configurationGeneration,
    });
    if (!scope) return null;
    const qualifiedAt = new Date(this.now()).toISOString();
    const raw = {
      schemaVersion: 1 as const,
      reference: {
        schemaVersion: 1 as const,
        namespace: candidate.namespace,
        sourceInstance: candidate.sourceInstance,
        sourceId: candidate.sourceId,
        exporterVersion: candidate.exporterVersion,
        normalizerVersion: candidate.normalizerVersion,
        sourceRevision: candidate.sourceRevision,
        sourceHash: candidate.sourceHash,
        canonicalId: candidate.canonicalId,
        canonicalVersion: candidate.canonicalVersion,
        ownerUserId: scope.ownerUserId,
        projectId: scope.projectId,
        consentGeneration: scope.consentGeneration,
        configurationGeneration: scope.configurationGeneration,
        observedStart: candidate.observedStart,
        observedEnd: candidate.observedEnd,
        expiresAt: new Date(this.now() + RECEIPT_TTL_MS).toISOString(),
        eligibility: 'active' as const,
      },
      canonicalContentHash: candidate.canonicalContentHash,
      canonicalSourceKey: candidate.canonicalSourceKey,
      qualifiedAt,
    };
    try {
      const receipt = parseDayflowQualifiedReceipt(raw);
      return receiptMatchesCandidate(receipt, candidate) ? receipt : null;
    } catch {
      return null;
    }
  }
}
