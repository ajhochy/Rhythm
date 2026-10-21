import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import { buildToolInstallProposalFingerprint, evaluateToolInstallSafetyAsync,
  readValidatedToolInstallInputs } from './tool_install_safety_policy';
import { validateToolInstallChange } from './tool_install_proposal_validator';
import { inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from './tool_install_artifact';
import { resolveManagedToolArtifactRoot } from '../config/env';
import { DockerSandboxRuntime, vetToolInSandboxAsync, type ToolVettingOutcome } from './tool_sandbox_vetter';

function privateScratchRoot(path: string): string {
  const root = realpathSync(path);
  const contained = ['/private/tmp', '/tmp', '/var/folders'].some((parent) => {
    const suffix = relative(parent, root);
    return suffix && suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  });
  if (!contained || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
    throw new Error('Tool evaluation requires a new private temporary scratch root');
  }
  return root;
}

export interface ToolInstallEvaluationVettingReceipt {
  status: 'observed' | 'inconclusive';
  changeHash: string;
  receiptHash: string;
  report: ToolVettingOutcome;
}

/** Existing Docker vetter is the only executable install path. This receipt
 * proves its closed scenarios ran, but cannot alone qualify an agent result. */
export async function vetToolInstallCandidateAsync(input: {
  changeJson: string; workerRoot: string; artifactRoot?: string;
}): Promise<ToolInstallEvaluationVettingReceipt> {
  const scratchRoot = privateScratchRoot(input.workerRoot);
  const proposal = { kind: 'tool-install', changeJson: input.changeJson } as AgentOrgProposal;
  const validation = validateToolInstallChange(proposal);
  if (!validation.valid) throw new Error(validation.reason ?? 'Tool candidate failed production validation');
  const change = JSON.parse(input.changeJson) as Record<string, unknown>;
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  if (change.installMethod !== 'local-tarball' || !digest || typeof change.toolName !== 'string' ||
      !inspectImmutableLocalTarball(input.artifactRoot ?? resolveManagedToolArtifactRoot(), digest, change.toolName)) {
    throw new Error('Evaluated tool has no available immutable local tarball');
  }
  const report = await vetToolInSandboxAsync({
    candidate: {
      toolName: change.toolName as string,
      packageSource: change.packageSource as string,
      installMethod: change.installMethod as string,
    },
    scenarioIds: change.testPrompts as string[],
  }, { runtime: new DockerSandboxRuntime({ scratchRoot,
    artifactRoot: input.artifactRoot ?? resolveManagedToolArtifactRoot() }) });
  const status = ['safe', 'conditional'].includes(report.verdict) &&
    report.testPromptsRunCount === (change.testPrompts as string[]).length
    ? 'observed' : 'inconclusive';
  const receiptHash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const changeHash = createHash('sha256').update(input.changeJson).digest('hex');
  return { status, changeHash, receiptHash, report };
}

/** Promotes only an immutable final validation receipt that already exists in
 * the qualified evaluation record. Missing Docker proof cannot create a
 * safety report or move a proposal into the vetted approval state. */
export async function promoteQualifiedToolVettingAsync(input: {
  proposalId: string; evaluationId: string;
}): Promise<void> {
  const proposals = new AgentOrgProposalsRepository();
  const evaluations = new OrgEvaluationRepository();
  const reports = new ToolSafetyReportsRepository();
  const proposal = await proposals.findByIdAsync(input.proposalId);
  const job = await evaluations.getJobAsync(input.evaluationId);
  if (!proposal || proposal.kind !== 'tool-install' || !['proposed', 'sandbox-running'].includes(proposal.status) ||
      !job || job.status !== 'qualified' || job.qualifiedProposalId !== proposal.id || !job.finalCandidateId) {
    throw new Error('Tool evaluation is not qualified for report promotion');
  }
  const root = job.budgetRootId ? await evaluations.getJobAsync(job.budgetRootId) : job;
  if (!root || root.status !== 'qualified') throw new Error('Shared evaluation budget is not closed');
  const final = (await evaluations.listCandidatesAsync(job.id)).find((item) => item.id === job.finalCandidateId && item.role === 'final');
  const expectedChangeHash = createHash('sha256').update(proposal.changeJson ?? '').digest('hex');
  if (!final || final.changeJson !== proposal.changeJson || !readValidatedToolInstallInputs(proposal)) {
    throw new Error('Tool proposal differs from its tested final candidate');
  }
  const fingerprint = buildToolInstallProposalFingerprint(proposal);
  const inputs = readValidatedToolInstallInputs(proposal);
  if (!fingerprint || !inputs) throw new Error('Tool proposal has no exact safety fingerprint');
  const running = proposal.status === 'proposed'
    ? await proposals.updateStatusAsync(proposal.id, 'sandbox-running', undefined, proposal.revision)
    : proposal;
  if (!running) throw new Error('Tool proposal changed before safety report promotion');
  try {
    const finalResults = (await evaluations.listResultsAsync(job.id)).filter((item) =>
      item.candidateId === final.id && item.phase === 'validation' && item.status === 'pass');
    let vetted: ToolInstallEvaluationVettingReceipt | null = null;
    for (const result of finalResults) {
      if (createHash('sha256').update(result.receiptJson).digest('hex') !== result.receiptHash) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(result.receiptJson) as Record<string, unknown>; } catch { continue; }
      const receipt = parsed.dockerVetting as ToolInstallEvaluationVettingReceipt | undefined;
      const proof = parsed.effectProof as { events?: Array<{ source?: string; evidenceHash?: string }> } | undefined;
      if (!receipt || receipt.status !== 'observed' || receipt.changeHash !== expectedChangeHash ||
          createHash('sha256').update(JSON.stringify(receipt.report)).digest('hex') !== receipt.receiptHash ||
          !proof?.events?.some((event) => event.source === 'docker-vetter' && event.evidenceHash === receipt.receiptHash)) continue;
      vetted = receipt;
      break;
    }
    if (!vetted || !['safe', 'conditional'].includes(vetted.report.verdict) ||
        vetted.report.testPromptsRunCount !== inputs.scenarioIds.length) {
      throw new Error('Final validation has no immutable Docker vetting receipt');
    }
    const existing = await reports.findByProposalIdAsync(proposal.id);
    if (existing) {
      if (existing.proposalFingerprint !== fingerprint || existing.verdict !== vetted.report.verdict ||
          existing.testPromptsRunCount !== vetted.report.testPromptsRunCount ||
          existing.evidenceJson !== vetted.report.evidenceJson ||
          existing.forbiddenPathViolationsJson !== vetted.report.forbiddenPathViolationsJson ||
          existing.networkCallsObservedJson !== vetted.report.networkCallsObservedJson ||
          existing.fileSystemWritesObservedJson !== vetted.report.fileSystemWritesObservedJson) {
        throw new Error('Existing tool safety report differs from immutable final evidence');
      }
    } else {
      await reports.createAsync({ proposalId: proposal.id, proposalFingerprint: fingerprint,
        toolName: inputs.toolName, packageSource: inputs.packageSource, installMethod: inputs.installMethod,
        ...vetted.report });
    }
    const safety = await evaluateToolInstallSafetyAsync(running, { deps: { reports } });
    if (!['safe', 'conditional'].includes(safety.verdict)) throw new Error('Persisted tool safety report failed revalidation');
    const transitioned = await proposals.updateStatusAsync(proposal.id, 'sandbox-vetted', undefined, running.revision);
    if (!transitioned) throw new Error('Tool proposal changed during safety report promotion');
  } catch (error) {
    await proposals.updateStatusAsync(proposal.id, 'pending', {
      measureReason: 'Qualified evaluation lacks promotable Docker safety evidence',
    }, running.revision).catch(() => null);
    throw error;
  }
}
