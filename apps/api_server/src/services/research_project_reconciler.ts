import { createHash } from 'node:crypto';
import type { AgentResearchRepository, HistoricalResearchJob } from '../repositories/agent_research_repository';

export type ResearchReconciliationMode = 'dry-run' | 'apply';
export interface ResearchReconciliationResult {
  scanned: number;
  verified: number;
  excluded: number;
  unresolved: number;
  plannedProjects: number;
  plannedRuns: number;
  plannedArtifacts: number;
  rerunCount: 0;
  changes: Array<{ jobId: string; outcome: 'verified' | 'excluded' | 'unresolved'; reason: string; projectId?: string; runId?: string }>;
}

function stableId(kind: string, ...values: string[]): string {
  return createHash('sha256').update([kind, ...values].join('\0')).digest('hex');
}

function confinedVaultPath(value: string | null): value is string {
  return Boolean(value && !value.startsWith('/') && !value.split(/[\\/]/).includes('..') && value.endsWith('.md'));
}

function outcome(job: HistoricalResearchJob): { outcome: 'verified' | 'excluded' | 'unresolved'; reason: string } {
  if (job.status === 'error') return { outcome: 'excluded', reason: 'historical-error-retained' };
  if (job.status !== 'done') return { outcome: 'unresolved', reason: 'non-terminal-historical-row' };
  if (job.ownerUserId === null) return { outcome: 'unresolved', reason: 'ownership-unverified' };
  if (job.hasArtifact || confinedVaultPath(job.vaultPath)) return { outcome: 'verified', reason: 'persisted-artifact-evidence' };
  return { outcome: 'unresolved', reason: 'artifact-evidence-missing' };
}

/** Database-only historical reconciliation. It never runs agents or touches vault files. */
export class ResearchProjectReconciler {
  constructor(private readonly repository: AgentResearchRepository) {}

  async reconcile(mode: ResearchReconciliationMode): Promise<ResearchReconciliationResult> {
    const jobs = await this.repository.listHistoricalResearchJobs();
    const changes: ResearchReconciliationResult['changes'] = [];
    const projectIds = new Set<string>();
    const runIds = new Set<string>();
    let plannedArtifacts = 0;
    for (const job of jobs) {
      const classification = outcome(job);
      const domain = job.researchType === 'theological' || job.researchType === 'ai-trends'
        ? job.researchType : 'general';
      const date = job.createdAt.slice(0, 10);
      const projectId = classification.outcome === 'verified'
        ? stableId('historical-project', String(job.ownerUserId), domain) : undefined;
      const runId = projectId ? stableId('historical-run', projectId, date) : undefined;
      if (projectId) projectIds.add(projectId);
      if (runId) runIds.add(runId);
      if (classification.outcome === 'verified' && confinedVaultPath(job.vaultPath) && !job.hasArtifact) plannedArtifacts += 1;
      const change = { jobId: job.id, ...classification, ...(projectId ? { projectId } : {}), ...(runId ? { runId } : {}) };
      changes.push(change);
      if (mode === 'apply') await this.repository.applyHistoricalReconciliation({
        job, ...classification, projectId, runId, domain, localDate: date,
      });
    }
    return {
      scanned: jobs.length,
      verified: changes.filter((change) => change.outcome === 'verified').length,
      excluded: changes.filter((change) => change.outcome === 'excluded').length,
      unresolved: changes.filter((change) => change.outcome === 'unresolved').length,
      plannedProjects: projectIds.size,
      plannedRuns: runIds.size,
      plannedArtifacts,
      rerunCount: 0,
      changes,
    };
  }
}
