import type {
  SessionMessageRecord,
  TranscriptDetail,
  TranscriptEntry,
} from '@/lib/opencode/format';

type EditableTextPart = Extract<
  SessionMessageRecord['parts'][number],
  { type: 'text' }
>;

export function findEditableUserTextPart(
  message: SessionMessageRecord | undefined,
  partId?: string,
): EditableTextPart | undefined {
  if (message?.info.role !== 'user') {
    return undefined;
  }

  return message.parts.find((part): part is EditableTextPart => (
    part.type === 'text'
    && part.synthetic !== true
    && (partId === undefined || part.id === partId)
  ));
}

export function getTranscriptActivityLabel(entry: TranscriptEntry) {
  const runningTool = entry.details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  if (runningTool) {
    return runningTool.label;
  }

  const latestTool = [...entry.details].reverse().find((detail) => detail.kind === 'tool');
  if (latestTool) {
    return latestTool.label;
  }

  const latestPatch = [...entry.details].reverse().find((detail) => detail.kind === 'patch');
  if (latestPatch) {
    return latestPatch.label;
  }

  const latestReasoning = [...entry.details].reverse().find((detail) => detail.kind === 'reasoning');
  if (latestReasoning) {
    return latestReasoning.label;
  }

  const latestStep = [...entry.details].reverse().find((detail) => detail.kind === 'step' || detail.kind === 'subtask');
  if (latestStep) {
    return latestStep.label;
  }

  return undefined;
}

export function isTranscriptDisplayMessage(entry: TranscriptEntry) {
  if (entry.internal) {
    return false;
  }

  if (entry.role === 'user') {
    return Boolean(
      entry.text.trim() ||
      entry.error ||
      entry.details.some((detail) => detail.kind !== 'compaction'),
    );
  }

  const hasVisibleTool = entry.details.some(
    (detail) =>
      detail.kind === 'tool' &&
      ['running', 'completed', 'error'].includes(detail.status),
  );
  return Boolean(entry.text.trim() || entry.error || hasVisibleTool);
}

export function summarizeTranscriptDetails(details: TranscriptDetail[]) {
  const patches = details.filter((detail) => detail.kind === 'patch').length;
  const files = details.filter((detail) => detail.kind === 'file').length;
  const failedRetry = details.find((detail) => detail.kind === 'retry');
  const summaries: string[] = [];

  for (const detail of details) {
    if (detail.kind !== 'tool') continue;
    const status =
      detail.status === 'error'
        ? 'failed'
        : ['running', 'completed'].includes(detail.status)
          ? detail.status
          : null;
    if (status) {
      // Labels are the presentation-safe tool identity/action. Never include
      // detail.body here: it may contain command output, paths, or metadata.
      summaries.push(`${detail.label} · ${status}`);
    }
  }

  if (patches > 0) {
    summaries.push(`Updated ${patches} patch${patches === 1 ? '' : 'es'}`);
  }

  if (files > 0) {
    summaries.push(`${files} file${files === 1 ? '' : 's'}`);
  }

  if (failedRetry) {
    summaries.push(failedRetry.label);
  }

  return summaries;
}
