/** Only joined observed effects qualify a tool. */
import { createHash } from 'node:crypto';
import type { ToolInstallEvaluationVettingReceipt } from './org_evaluation_external_effects';
import type { EvaluationWorkerExecution } from './org_evaluation_worker';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
type Event = EvaluationWorkerExecution['observedEffects'][number];

export function verifyPrivateManagedEffects(input: {
  baseline: boolean; changeJson: string; manifestJson: string;
  vetting?: ToolInstallEvaluationVettingReceipt;
  execution: EvaluationWorkerExecution;
}): { events: Event[]; reason: string | null } {
  const observations = input.execution.managedReceiverObservations;
  if (!observations || observations.length > 64 || observations.some((value) =>
      !value || typeof value !== 'object' || Array.isArray(value))) {
    return { events: [], reason: 'Private signed managed receiver ledger is missing' };
  }
  const manifest = JSON.parse(input.manifestJson) as { managedTool?: {
    profileId?: unknown; toolName?: unknown; artifactDigest?: unknown;
    proposalFingerprint?: unknown; execution?: unknown } | null };
  if (input.baseline) {
    const emptyListHash = sha256(JSON.stringify({ tools: [] }));
    const list = observations.find((value) => value.toolName === 'rhythm_list_managed_tools' &&
      value.status === 200 && value.responseHash === emptyListHash &&
      typeof value.callId === 'string' && input.execution.toolEvents.some((part) =>
        part.name === 'mcp_dispatch' && part.status === 'completed' &&
        part.callId === value.callId && part.dispatch?.action === 'execute' &&
        part.dispatch.name === 'rhythm_list_managed_tools' &&
        part.resultContentHashes.includes(emptyListHash)));
    const denied = observations.find((value) => value.toolName === 'rhythm_run_managed_tool' &&
      value.status === 403 && value.denialReason === 'not-installed' &&
      typeof value.callId === 'string' && input.execution.toolEvents.some((part) =>
        part.name === 'mcp_dispatch' && part.status === 'error' &&
        part.callId === value.callId && part.dispatch?.action === 'execute' &&
        part.dispatch.name === 'rhythm_run_managed_tool'));
    const successfulRun = observations.some((value) =>
      value.toolName === 'rhythm_run_managed_tool' && value.status === 200);
    return manifest.managedTool === null && !!list && !!denied && !successfulRun
      ? { events: [{ kind: 'managed-original-absent', source: 'engine-tool',
          subject: 'rhythm', evidenceHash: sha256(JSON.stringify({
            list: list.responseHash, denied: denied.responseHash,
            callId: denied.callId })) }], reason: null }
      : { events: [], reason: 'Original signed list and denied run were not both proved' };
  }
  const descriptor = manifest.managedTool;
  if (!descriptor || typeof descriptor.profileId !== 'string' ||
      typeof descriptor.toolName !== 'string' ||
      typeof descriptor.artifactDigest !== 'string' ||
      typeof descriptor.proposalFingerprint !== 'string' ||
      descriptor.execution !== 'offline-container') {
    return { events: [], reason: 'Private production install receipt is missing' };
  }
  if (!input.vetting || input.vetting.status !== 'observed' ||
      input.vetting.changeHash !== sha256(input.changeJson) ||
      input.vetting.receiptHash !== sha256(JSON.stringify(input.vetting.report))) {
    return { events: [], reason: 'Exact Docker vetting receipt is missing' };
  }
  const run = observations.find((value) => value.toolName === 'rhythm_run_managed_tool' &&
    value.status === 200 && value.artifactDigest === descriptor.artifactDigest &&
    value.networkMode === 'none' && value.forbiddenArtifactWriteDenied === true &&
    typeof value.callId === 'string' && typeof value.responseHash === 'string' &&
    typeof value.outputHash === 'string');
  if (!run) return { events: [], reason: 'No signed private Docker invocation was observed' };
  const taint = observations.find((value) => value.toolName === 'external-content-taint' &&
    value.status === 201 && value.callId === run.callId &&
    value.responseHash === run.responseHash && value.taintBlocked === false);
  if (!taint) return { events: [], reason: 'Production external-content ingress was not recorded' };
  const toolPart = input.execution.toolEvents.find((part) =>
    part.name === 'mcp_dispatch' && part.status === 'completed' &&
    part.callId === run.callId && part.dispatch?.action === 'execute' &&
    part.dispatch.name === 'rhythm_run_managed_tool' &&
    part.resultContentHashes.includes(run.responseHash as string));
  if (!toolPart) return { events: [], reason: 'Engine tool result did not join signed Docker receipt' };
  const subject = descriptor.toolName;
  return { reason: null, events: [
    { kind: 'docker-safety-vetted', source: 'docker-vetter', subject,
      evidenceHash: input.vetting.receiptHash },
    { kind: 'tool-installed', source: 'worker-file', subject,
      evidenceHash: sha256(JSON.stringify(descriptor)) },
    { kind: 'tool-invoked', source: 'engine-tool', subject,
      evidenceHash: sha256(JSON.stringify({ toolPart: toolPart.evidenceHash,
        run: run.responseHash, taint: taint.responseHash })) },
    { kind: 'forbidden-tool-effect-denied', source: 'docker-vetter', subject,
      evidenceHash: sha256(JSON.stringify({ outputHash: run.outputHash,
        artifactDigest: run.artifactDigest, networkMode: run.networkMode,
        forbiddenArtifactWriteDenied: run.forbiddenArtifactWriteDenied })) },
  ] };
}
