/**
 * persisted_tool_evidence.ts — W3 final architectural corrective.
 *
 * ONE shared, strict producer-compatibility parser for persisted `type:'tool'`
 * message parts. Both `workflow_failure_signal_extractor.ts` (retry-loop
 * detection) and `org_proposal_measure.ts` (rerun/keep-revert measurement)
 * must consume THIS module's result rather than each hand-rolling their own
 * subset of the producer schema — that drift (two callers, two incomplete
 * validators) is exactly what the prior two correction cycles failed to close.
 *
 * Producer truth (read in full, not excerpted):
 *   - apps/opencode_fork/packages/opencode/src/session/message-v2.ts
 *     `partBase`, `FilePart` + every `FilePartSource` variant,
 *     `ToolStatePending/Running/Completed/Error`, `ToolPart`.
 *   - apps/opencode_fork/packages/opencode/src/session/schema.ts
 *     SessionID starts "ses", MessageID starts "msg", PartID starts "prt".
 *
 * Identity rule: `AgentSessionMessage.sessionId` is Rhythm's own local UUID —
 * it is NEVER compared to the raw OpenCode `sessionID` on a part (that field
 * only needs to be a structurally valid producer SessionID). The producer
 * identity that IS load-bearing is the message: a trusted part's
 * `raw.messageID` must equal the persisted row's `sdkMessageId` exactly.
 *
 * `integrity: 'invalid'` means at least one raw `type:'tool'` part in the
 * evidence set failed producer-shape validation, or two raw parts disagree
 * about the same identity (duplicate part id, or conflicting records sharing
 * one callID). In either case the WHOLE evidence set for that session/rerun
 * is untrustworthy — callers must never quietly keep the well-formed subset
 * and certify it clean; malformed evidence is ambiguous, not absent.
 */

import { createHash } from 'crypto';

export type ToolAttemptStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ToolAttempt {
  partId: string;
  tool: string;
  callId: string;
  status: ToolAttemptStatus;
  /** `state.time.start`, ms epoch. null for 'pending' (the producer schema carries no `time` on it at all). */
  startedAt: number | null;
  /** `state.time.end`, ms epoch. Only present for terminal ('completed'/'error') states. */
  endedAt: number | null;
  /** true iff status='completed' AND `state.mcpResult.isError===true` — a completed MCP call that itself failed. */
  mcpIsError: boolean;
  /**
   * SHA-256 identity of `state.input`, canonicalized (recursively key-sorted
   * JSON) so key-order differences never split one retry pattern into two.
   * The raw input is never logged, returned, or persisted — only this hash.
   */
  inputHash: string;
}

export type PersistedToolEvidenceIntegrity = 'valid' | 'invalid';

export interface PersistedToolEvidence {
  integrity: PersistedToolEvidenceIntegrity;
  /** Empty whenever integrity is 'invalid' — malformed/ambiguous evidence is never mixed with trustworthy attempts. */
  attempts: ToolAttempt[];
}

/** Minimal shape this parser needs from a persisted message row. */
export interface PersistedMessageLike {
  sdkMessageId: string | null;
  partsJson: string | null;
}

/** A producer-valid completed, non-MCP-error attempt — the only kind of attempt that is genuine terminal success evidence. */
export function isTerminalSuccess(attempt: ToolAttempt): boolean {
  return attempt.status === 'completed' && !attempt.mcpIsError;
}

// ── Generic shape guards ─────────────────────────────────────────────────

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Integer, finite, >= 0 — matches the producer schema's `NonNegativeInt`. */
function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** A producer-shaped identifier: a non-empty string strictly longer than the required prefix. */
function isValidProducerId(v: unknown, prefix: string): v is string {
  return typeof v === 'string' && v.length > prefix.length && v.startsWith(prefix);
}

/** Recursively key-sorted JSON serialization — a stable basis for content-equality/hashing. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Stable in-memory identity for a tool call's input. Never exposes the input itself. */
function hashInput(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

// ── FilePart / FilePartSource validation (producer-valid attachments) ────

function validateRange(range: unknown): boolean {
  if (!isPlainRecord(range)) return false;
  const { start, end } = range;
  if (!isPlainRecord(start) || !isPlainRecord(end)) return false;
  return (
    isNonNegativeInt(start.line) &&
    isNonNegativeInt(start.character) &&
    isNonNegativeInt(end.line) &&
    isNonNegativeInt(end.character)
  );
}

function validateFilePartSourceText(text: unknown): boolean {
  if (!isPlainRecord(text)) return false;
  return typeof text.value === 'string' && isFiniteNumber(text.start) && isFiniteNumber(text.end);
}

function validateFilePartSource(source: unknown): boolean {
  if (!isPlainRecord(source)) return false;
  if (!validateFilePartSourceText(source.text)) return false;
  switch (source.type) {
    case 'file':
      return typeof source.path === 'string';
    case 'symbol':
      return typeof source.path === 'string' && validateRange(source.range) && typeof source.name === 'string' && isNonNegativeInt(source.kind);
    case 'resource':
      return typeof source.clientName === 'string' && typeof source.uri === 'string';
    default:
      return false;
  }
}

function validateFilePart(raw: unknown): boolean {
  if (!isPlainRecord(raw)) return false;
  if (!isValidProducerId(raw.id, 'prt')) return false;
  if (!isValidProducerId(raw.sessionID, 'ses')) return false;
  if (!isValidProducerId(raw.messageID, 'msg')) return false;
  if (raw.type !== 'file') return false;
  if (typeof raw.mime !== 'string') return false;
  if (raw.filename !== undefined && typeof raw.filename !== 'string') return false;
  if (typeof raw.url !== 'string') return false;
  if (raw.source !== undefined && !validateFilePartSource(raw.source)) return false;
  return true;
}

function validateAttachments(attachments: unknown): boolean {
  if (attachments === undefined) return true;
  if (!Array.isArray(attachments)) return false;
  return attachments.every((a) => validateFilePart(a));
}

// ── mcpResult / mcpAppResource validation ────────────────────────────────

function validateMcpResult(mcpResult: unknown): boolean {
  if (mcpResult === undefined) return true;
  if (!isPlainRecord(mcpResult)) return false;
  if (mcpResult._meta !== undefined && !isPlainRecord(mcpResult._meta)) return false;
  if (mcpResult.isError !== undefined && typeof mcpResult.isError !== 'boolean') return false;
  // structuredContent may be any value, including absent.
  return true;
}

function validateMcpAppResource(resource: unknown): boolean {
  if (resource === undefined) return true;
  if (!isPlainRecord(resource)) return false;
  const requiredStringFields = ['sessionID', 'callID', 'serverName', 'cwd', 'resourceUri', 'advertisedAt', 'expiresAt'];
  return requiredStringFields.every((f) => typeof resource[f] === 'string');
}

// ── ToolState validation (producer's ToolStatePending/Running/Completed/Error) ──

interface ValidatedToolState {
  status: ToolAttemptStatus;
  startedAt: number | null;
  endedAt: number | null;
  mcpIsError: boolean;
}

function validateToolState(state: unknown): ValidatedToolState | null {
  if (!isPlainRecord(state)) return null;
  if (!isPlainRecord(state.input)) return null; // every status requires `input: Record<string, Any>`

  const status = state.status;

  if (status === 'pending') {
    if (typeof state.raw !== 'string') return null;
    return { status: 'pending', startedAt: null, endedAt: null, mcpIsError: false };
  }

  if (status === 'running') {
    if (state.title !== undefined && typeof state.title !== 'string') return null;
    if (state.metadata !== undefined && !isPlainRecord(state.metadata)) return null;
    if (!isPlainRecord(state.time) || !isNonNegativeInt(state.time.start)) return null;
    return { status: 'running', startedAt: state.time.start, endedAt: null, mcpIsError: false };
  }

  if (status === 'completed') {
    if (typeof state.output !== 'string') return null;
    if (typeof state.title !== 'string') return null;
    if (!isPlainRecord(state.metadata)) return null;
    if (!isPlainRecord(state.time)) return null;
    const { start, end, compacted } = state.time;
    if (!isNonNegativeInt(start) || !isNonNegativeInt(end) || end < start) return null;
    if (compacted !== undefined && !isNonNegativeInt(compacted)) return null;
    if (!validateMcpResult(state.mcpResult)) return null;
    if (!validateMcpAppResource(state.mcpAppResource)) return null;
    if (!validateAttachments(state.attachments)) return null;

    const mcpIsError = isPlainRecord(state.mcpResult) && state.mcpResult.isError === true;
    return { status: 'completed', startedAt: start, endedAt: end, mcpIsError };
  }

  if (status === 'error') {
    if (typeof state.error !== 'string') return null;
    if (state.metadata !== undefined && !isPlainRecord(state.metadata)) return null;
    if (!isPlainRecord(state.time)) return null;
    const { start, end } = state.time;
    if (!isNonNegativeInt(start) || !isNonNegativeInt(end) || end < start) return null;
    return { status: 'error', startedAt: start, endedAt: end, mcpIsError: false };
  }

  return null; // unrecognized status — impossible state, reject rather than guess
}

// ── Trusted tool-part identity ───────────────────────────────────────────

function isTrustedToolPartIdentity(raw: Record<string, unknown>, rowSdkMessageId: string | null): boolean {
  if (!isValidProducerId(raw.id, 'prt')) return false;
  if (!isValidProducerId(raw.sessionID, 'ses')) return false;
  if (!isValidProducerId(raw.messageID, 'msg')) return false;
  if (rowSdkMessageId == null) return false;
  if (raw.messageID !== rowSdkMessageId) return false;
  if (raw.type !== 'tool') return false;
  if (!isNonEmptyString(raw.callID)) return false;
  if (!isNonEmptyString(raw.tool)) return false;
  if (raw.metadata !== undefined && !isPlainRecord(raw.metadata)) return false;
  return true;
}

// ── Main parser ───────────────────────────────────────────────────────────

/**
 * Parse every persisted `type:'tool'` part out of a session's messages
 * against the FULL producer schema. Non-tool parts are ignored. Any tool
 * part that fails identity or state validation flips the whole result to
 * `integrity: 'invalid'` and attempts is returned empty — a malformed part
 * is never silently dropped while the rest is certified clean. A duplicate
 * part id (even across distinct callIDs/messages) is ambiguous and also
 * invalidates the whole result. A duplicate CALL id is tolerated only when
 * every persisted record of it is an exact (canonical) duplicate; conflicting
 * records sharing one callID are invalid, never resolved by persistence order.
 */
export function parsePersistedToolEvidence(messages: PersistedMessageLike[]): PersistedToolEvidence {
  let integrity: PersistedToolEvidenceIntegrity = 'valid';
  const validParts: Array<{ partId: string; callId: string; canonical: string; attempt: ToolAttempt }> = [];

  for (const m of messages) {
    if (!m.partsJson) continue;
    let parts: unknown;
    try {
      parts = JSON.parse(m.partsJson);
    } catch {
      continue;
    }
    if (!Array.isArray(parts)) continue;

    for (const raw of parts) {
      if (!isPlainRecord(raw)) continue;
      if (raw.type !== 'tool') continue; // non-tool parts are ignored, never evidence

      if (!isTrustedToolPartIdentity(raw, m.sdkMessageId)) {
        integrity = 'invalid';
        continue;
      }

      const validatedState = validateToolState(raw.state);
      if (!validatedState) {
        integrity = 'invalid';
        continue;
      }

      const input = (raw.state as Record<string, unknown>).input;
      const attempt: ToolAttempt = {
        partId: raw.id as string,
        tool: raw.tool as string,
        callId: raw.callID as string,
        status: validatedState.status,
        startedAt: validatedState.startedAt,
        endedAt: validatedState.endedAt,
        mcpIsError: validatedState.mcpIsError,
        inputHash: hashInput(input),
      };
      // Duplicate/conflict comparisons are based on the SUBSTANTIVE attempt
      // content (never partId/sessionID/messageID — those legitimately differ
      // across persisted records of the very same call, e.g. a reconnect
      // writing it into a different message row).
      const canonical = canonicalJson({
        tool: attempt.tool,
        callId: attempt.callId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
        mcpIsError: attempt.mcpIsError,
        inputHash: attempt.inputHash,
      });
      validParts.push({ partId: attempt.partId, callId: attempt.callId, canonical, attempt });
    }
  }

  // A duplicate PART id — even across distinct calls/messages — has no way
  // to be resolved: it is ambiguous evidence, not two candidate readings of
  // the same fact.
  const byPartId = new Map<string, string[]>();
  for (const vp of validParts) {
    const list = byPartId.get(vp.partId) ?? [];
    list.push(vp.canonical);
    byPartId.set(vp.partId, list);
  }
  for (const canonicals of byPartId.values()) {
    if (new Set(canonicals).size > 1) integrity = 'invalid';
  }

  // A duplicate CALL id collapses to one attempt only when every persisted
  // record of it agrees exactly; conflicting records make that call's
  // evidence invalid, never resolved by persistence order.
  const byCallId = new Map<string, { canonical: string; attempt: ToolAttempt }[]>();
  for (const vp of validParts) {
    const list = byCallId.get(vp.callId) ?? [];
    list.push({ canonical: vp.canonical, attempt: vp.attempt });
    byCallId.set(vp.callId, list);
  }

  const attempts: ToolAttempt[] = [];
  for (const records of byCallId.values()) {
    const distinct = new Set(records.map((r) => r.canonical));
    if (distinct.size > 1) {
      integrity = 'invalid';
      continue;
    }
    attempts.push(records[0].attempt);
  }

  if (integrity === 'invalid') {
    return { integrity: 'invalid', attempts: [] };
  }
  return { integrity: 'valid', attempts };
}
