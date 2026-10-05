import { sameDayflowQualifiedEvidenceCandidate } from '../contracts/dayflow_coordinator_reader_contract';
import { DayflowPersistedQualificationAuthority } from '../integrations/dayflow/persisted_qualification_authority';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import type { DayflowQualifiedReader } from './dayflow_qualified_evidence_service';

export interface DayflowSdkHistoryGuard {
  shouldBindPrompt(sdkSessionId: string): Promise<boolean>;
  revalidateBeforeSdk(sdkSessionId: string): Promise<boolean>;
}

function sameHistory(
  left: ReturnType<DayflowReceivingContextRepository['listSdkHistory']>,
  right: ReturnType<DayflowReceivingContextRepository['listSdkHistory']>,
): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return entry.binding.dispatchId === other.binding.dispatchId &&
      entry.binding.ownerUserId === other.binding.ownerUserId &&
      entry.binding.projectId === other.binding.projectId &&
      entry.binding.sdkSessionId === other.binding.sdkSessionId &&
      entry.binding.sdkTurnId === other.binding.sdkTurnId &&
      entry.candidates.length === other.candidates.length &&
      entry.candidates.every((candidate) => other.candidates.some((next) =>
        sameDayflowQualifiedEvidenceCandidate(candidate, next)));
  });
}

/**
 * Revalidates retained qualified evidence immediately before any later SDK
 * history operation. A missing guard is not permission to reuse Dayflow
 * history; opencode_client_service closes that case before native exposure.
 */
export class DayflowReceivingHistoryGuard implements DayflowSdkHistoryGuard {
  constructor(private readonly dependencies: {
    records: DayflowReceivingContextRepository;
    reader: DayflowQualifiedReader;
    authority: DayflowPersistedQualificationAuthority;
  }) {}

  async shouldBindPrompt(sdkSessionId: string): Promise<boolean> {
    const session = this.dependencies.records.activeSessionScope(sdkSessionId);
    const active = this.dependencies.authority.activeScope();
    return !!session && !!active && session.ownerUserId === active.scope.ownerUserId &&
      session.projectId === active.scope.projectId;
  }

  async revalidateBeforeSdk(sdkSessionId: string): Promise<boolean> {
    const before = this.dependencies.records.listSdkHistory(sdkSessionId);
    if (before === null) return this.fail(sdkSessionId);
    if (before.length === 0) return true;
    for (const dependency of before) {
      let page;
      try {
        page = await this.dependencies.reader.readQualifiedEvidence({
          ownerUserId: dependency.binding.ownerUserId,
          projectId: dependency.binding.projectId,
          limit: 3000,
        });
      } catch {
        return this.fail(sdkSessionId);
      }
      if (page.status !== 'available' || !dependency.candidates.every((candidate) =>
        page.candidates.some((current) => sameDayflowQualifiedEvidenceCandidate(candidate, current)))) {
        return this.fail(sdkSessionId);
      }
    }
    // The reader awaits are not leases. Re-read durable dependencies after all
    // of them before native SDK exposure so concurrent unsafe marking/binding
    // changes cannot become reusable history.
    if (!sameHistory(before, this.dependencies.records.listSdkHistory(sdkSessionId))) {
      return this.fail(sdkSessionId);
    }
    return true;
  }

  private fail(sdkSessionId: string): boolean {
    this.dependencies.records.markSdkUnsafe(sdkSessionId, 'dayflow_dependency_revalidation_failed');
    return false;
  }
}
