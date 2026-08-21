/**
 * D1.1 (#1426) — ToolSafetyReport: the durable record of one sandbox vetting
 * run for a `tool-install` org proposal (see tool_sandbox_vetter.ts, D1.2).
 *
 * Every observational field here is an AGGREGATE (a count, a hash, a closed
 * enum) — never raw prompt text, raw tool output, or raw credential bytes.
 * This is a hard invariant for the whole D1 track: a report is evidence a
 * human can safely read, not a second place secrets can leak into durable
 * storage. `forbiddenPathViolationsJson` / `networkCallsObservedJson` /
 * `fileSystemWritesObservedJson` / `evidenceJson` are redacted at the
 * repository write boundary (see {@link ToolSafetyReportsRepository}) the
 * same way `post_apply_events_repository.ts` redacts its snapshot columns —
 * the repository never trusts a caller to have redacted first.
 */

export const TOOL_SAFETY_VERDICTS = ['safe', 'conditional', 'unsafe', 'unknown'] as const;

export type ToolSafetyVerdict = (typeof TOOL_SAFETY_VERDICTS)[number];

export function isToolSafetyVerdict(v: unknown): v is ToolSafetyVerdict {
  return typeof v === 'string' && (TOOL_SAFETY_VERDICTS as readonly string[]).includes(v);
}

export interface ToolSafetyReport {
  id: string;
  /** The `agent_org_proposals` row (kind='tool-install') this report was generated for. */
  proposalId: string;
  toolName: string;
  toolVersion: string | null;
  packageSource: string;
  installMethod: string;
  /** Wall-clock duration of the sandbox run, milliseconds. */
  sandboxDurationMs: number;
  /** Count only — never the raw prompt text (see module doc comment). */
  testPromptsRunCount: number;
  /** JSON array of forbidden-path violation descriptors (paths/patterns matched, not file contents). */
  forbiddenPathViolationsJson: string;
  /** JSON array of aggregate network-call observations (e.g. {host, count}), never raw payloads. */
  networkCallsObservedJson: string;
  /** JSON array of aggregate filesystem-write observations (e.g. {path, count}), never file contents. */
  fileSystemWritesObservedJson: string;
  /** Count only — never the credential values themselves. */
  credentialAccessAttemptsCount: number;
  verdict: ToolSafetyVerdict;
  /** e.g. `sandbox_unavailable` when verdict is 'unknown'. Null otherwise. */
  reason: string | null;
  /** Sanitized aggregate evidence payload — hashes/counts only, no raw secrets. */
  evidenceJson: string;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for {@link ToolSafetyReportsRepository.createAsync}. */
export interface ToolSafetyReportInput {
  id?: string;
  proposalId: string;
  toolName: string;
  toolVersion?: string | null;
  packageSource: string;
  installMethod: string;
  sandboxDurationMs: number;
  testPromptsRunCount: number;
  forbiddenPathViolationsJson?: string;
  networkCallsObservedJson?: string;
  fileSystemWritesObservedJson?: string;
  credentialAccessAttemptsCount?: number;
  verdict: ToolSafetyVerdict;
  reason?: string | null;
  evidenceJson?: string;
}

/**
 * Build a {@link ToolSafetyReport} from a plain JSON object (camelCase keys).
 * Round-trips losslessly with {@link toolSafetyReportToJson}.
 */
export function toolSafetyReportFromJson(json: Record<string, unknown>): ToolSafetyReport {
  return {
    id: json.id as string,
    proposalId: json.proposalId as string,
    toolName: json.toolName as string,
    toolVersion: (json.toolVersion as string | null) ?? null,
    packageSource: json.packageSource as string,
    installMethod: json.installMethod as string,
    sandboxDurationMs: Number(json.sandboxDurationMs),
    testPromptsRunCount: Number(json.testPromptsRunCount),
    forbiddenPathViolationsJson: (json.forbiddenPathViolationsJson as string) ?? '[]',
    networkCallsObservedJson: (json.networkCallsObservedJson as string) ?? '[]',
    fileSystemWritesObservedJson: (json.fileSystemWritesObservedJson as string) ?? '[]',
    credentialAccessAttemptsCount: Number(json.credentialAccessAttemptsCount ?? 0),
    verdict: isToolSafetyVerdict(json.verdict) ? json.verdict : 'unknown',
    reason: (json.reason as string | null) ?? null,
    evidenceJson: (json.evidenceJson as string) ?? '{}',
    createdAt: json.createdAt as string,
    updatedAt: json.updatedAt as string,
  };
}

/** Serialize a {@link ToolSafetyReport} to a plain JSON object (camelCase keys). */
export function toolSafetyReportToJson(report: ToolSafetyReport): Record<string, unknown> {
  return {
    id: report.id,
    proposalId: report.proposalId,
    toolName: report.toolName,
    toolVersion: report.toolVersion,
    packageSource: report.packageSource,
    installMethod: report.installMethod,
    sandboxDurationMs: report.sandboxDurationMs,
    testPromptsRunCount: report.testPromptsRunCount,
    forbiddenPathViolationsJson: report.forbiddenPathViolationsJson,
    networkCallsObservedJson: report.networkCallsObservedJson,
    fileSystemWritesObservedJson: report.fileSystemWritesObservedJson,
    credentialAccessAttemptsCount: report.credentialAccessAttemptsCount,
    verdict: report.verdict,
    reason: report.reason,
    evidenceJson: report.evidenceJson,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}
