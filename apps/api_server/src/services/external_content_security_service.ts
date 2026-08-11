/**
 * #1134 — server-owned authorization boundary for external-content read→write.
 *
 * The MCP process reports provenance using engine-authored per-call metadata.
 * This service resolves that SDK id to Rhythm's durable local session, rotates
 * a session taint epoch on every external read, and atomically consumes
 * approvals bound to the exact session, agent, action, canonical payload,
 * expiry, and tainted source turn.
 */

import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../errors/app_error';
import { getDb } from '../database/db';
import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { isAutoApproveProfile } from '../repositories/agent_approvals_repository';

export const SECURITY_ACTIONS = [
  'email.send',
  'message.send',
  'message-thread.create',
  'calendar.create',
  'calendar.update',
  'pco.plan-item.update',
  'pco.person.assign',
  'pco.scheduled-person.update',
  'trigger.clear',
  'task.create',
  'task.update',
  'task.complete',
  'task.delete',
  'rhythm.create',
  'rhythm.update',
  'project-instance.create',
  'facility-reservation.create',
  'memory.remember',
  'memory.forget',
  'research.start',
  'research.update',
  'research.complete-pass',
  'org-optimizer.run',
  'delegation.start',
  'delegation.start-async',
  'delegation.cancel',
  'notification.send',
  'scheduled-task.create',
  'scheduled-task.cancel',
  'scheduled-task.trigger',
  'memory.update',
  'memory.lifecycle',
  'rhythm.delete',
  'rhythm-step.create',
  'rhythm-step.delete',
  'project-template.create',
  'project-template-step.create',
  'project-step.update',
  'automation.create',
  'automation.update',
  'automation.delete',
  'automation.resync',
  'agent-profile.create',
  'agent-profile.permissions.update',
  'creative-capability.install',
  'creative-artifact.record',
  'org-optimizer.external-discovery',
  'live-artifact.create',
  'live-artifact.state.update',
  'live-artifact.bundle.update',
  'live-artifact.sharing.update',
] as const;
export type SecurityAction = (typeof SECURITY_ACTIONS)[number];

export interface TrustedSecurityContext {
  sdkSessionId: string;
  turnId: string;
  agentName: string;
  toolCallId: string;
}

export interface SecurityApprovalBinding {
  sessionId: string;
  agentConfigId: string;
  securityAction: SecurityAction;
  payloadDigest: string;
  taintId: string;
  taintedTurnId: string;
  boundAgent: string;
  expiresAt: string;
  preview: string;
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

export function parseTrustedSecurityContext(value: unknown): TrustedSecurityContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw AppError.badRequest('security context is required');
  }
  const record = value as Record<string, unknown>;
  if (
    !boundedIdentity(record.sdkSessionId) ||
    !boundedIdentity(record.turnId) ||
    !boundedIdentity(record.agentName) ||
    !boundedIdentity(record.toolCallId)
  ) {
    throw AppError.badRequest('security context identity is invalid');
  }
  return {
    sdkSessionId: record.sdkSessionId,
    turnId: record.turnId,
    agentName: record.agentName,
    toolCallId: record.toolCallId,
  };
}

export function parseSecurityAction(value: unknown): SecurityAction {
  if (typeof value !== 'string' || !SECURITY_ACTIONS.includes(value as SecurityAction)) {
    throw AppError.badRequest(`security action must be one of ${SECURITY_ACTIONS.join(', ')}`);
  }
  return value as SecurityAction;
}

export function parseSecurityPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw AppError.badRequest('security payload must be a JSON object');
  }
  return value as Record<string, unknown>;
}

const TRUSTED_ARGUMENT_ALIASES: Record<string, string> = {
  allowedMcpsJson: 'allowedMcps',
  allowedSkillsJson: 'allowedSkills',
};

const SECURITY_PAYLOAD_CONSTANTS: Partial<
  Record<SecurityAction, Record<string, unknown>>
> = {
  'calendar.create': { calendarId: 'primary' },
  'calendar.update': { calendarId: 'primary' },
  'scheduled-task.cancel': { enabled: false },
  'agent-profile.create': { isAgent: true, enabled: true },
  'live-artifact.create': { type: 'html' },
};

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function trustedArgumentMatchesPayload(
  trustedValue: unknown,
  payloadValue: unknown,
): boolean {
  const candidates = [trustedValue];
  if (typeof trustedValue === 'string') candidates.push(decodeHtml(trustedValue));
  if (Array.isArray(trustedValue) || (trustedValue && typeof trustedValue === 'object')) {
    candidates.push(JSON.stringify(trustedValue));
  }
  return candidates.some(
    (candidate) => canonicalJson(candidate) === canonicalJson(payloadValue),
  );
}

export function requireSecurityPayloadBoundToTrustedArguments(
  action: SecurityAction,
  trustedArguments: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  const constants = SECURITY_PAYLOAD_CONSTANTS[action] ?? {};
  const matchedArguments = new Set<string>();

  for (const [payloadKey, payloadValue] of Object.entries(payload)) {
    const argumentKeys = [
      payloadKey,
      snakeCase(payloadKey),
      TRUSTED_ARGUMENT_ALIASES[payloadKey],
    ].filter((value): value is string => Boolean(value));
    const matchingKey = argumentKeys.find(
      (key) =>
        Object.prototype.hasOwnProperty.call(trustedArguments, key) &&
        trustedArgumentMatchesPayload(trustedArguments[key], payloadValue),
    );
    if (matchingKey) {
      matchedArguments.add(matchingKey);
      continue;
    }
    if (
      Object.prototype.hasOwnProperty.call(constants, payloadKey) &&
      canonicalJson(constants[payloadKey]) === canonicalJson(payloadValue)
    ) {
      continue;
    }
    throw AppError.forbidden(
      'security payload does not match the signed MCP tool arguments',
    );
  }

  for (const [argumentKey, argumentValue] of Object.entries(trustedArguments)) {
    if (
      argumentKey === 'approval_id' ||
      argumentValue === undefined ||
      matchedArguments.has(argumentKey)
    ) {
      continue;
    }
    throw AppError.forbidden(
      'security payload omits a signed MCP tool argument',
    );
  }
}

interface TaintStateRow {
  session_id: string;
  sdk_session_id: string;
  taint_id: string;
  latest_event_id: string;
  tainted_turn_id: string;
  tainted_agent: string;
  source: string;
  updated_at: string;
}

interface ApprovalSecurityRow {
  id: string;
  session_id: string | null;
  agent_config_id: string | null;
  status: string;
  security_action: string | null;
  payload_digest: string | null;
  taint_id: string | null;
  tainted_turn_id: string | null;
  bound_agent: string | null;
  expires_at: string | null;
  consumed_at: string | null;
}

const sessions = new AgentSessionsRepository();
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const SAFE_DIAGNOSTIC_CLASSES = new Set([
  'override-instruction',
  'hidden-html-comment',
  'secrets-reference',
  'exfiltration',
  'invisible-unicode',
]);

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw AppError.badRequest('security payload must contain finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw AppError.badRequest('security payload must be JSON-serializable');
}

export function securityPayloadDigest(action: SecurityAction, payload: unknown): string {
  return createHash('sha256')
    .update(`${action}\n${canonicalJson(payload)}`)
    .digest('hex');
}

/**
 * The single definition of "no human can answer for this session, and its
 * profile has opted into acting anyway".
 *
 * Shared deliberately by BOTH approval paths — `consumeApproval` (enforcement,
 * when a mutation arrives with no token) and `POST /agent-approvals` with a
 * security binding (the request side, when an agent proactively asks first).
 * They were inconsistent at first: only enforcement honored the profile flag, so
 * an agent whose prompt told it to ask BEFORE acting still got a `pending` row
 * and stopped, on a profile explicitly configured to run unattended. Observed
 * live 2026-08-04 — Org External Discovery, twice, with the flag set.
 *
 * All three conditions are required. Interactive sessions can satisfy neither
 * `isSystem` nor `scheduledTaskId`, so a human at the keyboard keeps the full
 * #1134 gate.
 */
export function isUnattendedAutoApproveSession(session: {
  agentKind: string;
  isSystem?: boolean;
  scheduledTaskId?: string | null;
}): boolean {
  if (!session.isSystem) return false;
  if (!session.scheduledTaskId) return false;
  return isAutoApproveProfile(session.agentKind);
}

function requireKnownSession(context: TrustedSecurityContext) {
  const session = sessions.findBySdkSessionId(context.sdkSessionId);
  if (!session) throw AppError.forbidden('trusted SDK session is unknown');
  return session;
}

function safeDiagnostics(input: unknown): Array<{ patternId: string; class: string }> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.patternId !== 'string' ||
      !/^[a-z0-9-]{1,100}$/i.test(record.patternId) ||
      typeof record.class !== 'string' ||
      !SAFE_DIAGNOSTIC_CLASSES.has(record.class)
    ) {
      return [];
    }
    return [{ patternId: record.patternId, class: record.class }];
  });
}

export class ExternalContentSecurityService {
  markTainted(input: {
    context: TrustedSecurityContext;
    source: string;
    contentDigest: string;
    blocked: boolean;
    diagnostics: unknown;
  }): { taintId: string; eventId: string; sessionId: string } {
    const session = requireKnownSession(input.context);
    if (!/^[a-f0-9]{64}$/.test(input.contentDigest)) {
      throw AppError.badRequest('contentDigest must be a lowercase SHA-256 digest');
    }

    const eventId = randomUUID();
    const taintId = randomUUID();
    const now = new Date().toISOString();
    const diagnosticsJson = JSON.stringify(safeDiagnostics(input.diagnostics));

    getDb().transaction(() => {
      getDb()
        .prepare(
          `INSERT INTO agent_external_content_events
            (id, session_id, sdk_session_id, turn_id, agent_name, tool_call_id,
             source, content_digest, blocked, diagnostics_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          session.id,
          input.context.sdkSessionId,
          input.context.turnId,
          input.context.agentName,
          input.context.toolCallId,
          input.source,
          input.contentDigest,
          input.blocked ? 1 : 0,
          diagnosticsJson,
          now,
        );

      getDb()
        .prepare(
          `INSERT INTO agent_external_taint_state
            (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id,
             tainted_agent, source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             sdk_session_id = excluded.sdk_session_id,
             taint_id = excluded.taint_id,
             latest_event_id = excluded.latest_event_id,
             tainted_turn_id = excluded.tainted_turn_id,
             tainted_agent = excluded.tainted_agent,
             source = excluded.source,
             updated_at = excluded.updated_at`,
        )
        .run(
          session.id,
          input.context.sdkSessionId,
          taintId,
          eventId,
          input.context.turnId,
          input.context.agentName,
          input.source,
          now,
        );
    })();

    return { taintId, eventId, sessionId: session.id };
  }

  /**
   * Build the security binding for a protected outbound action.
   *
   * Returns `null` when the session carries NO taint — i.e. approval is not
   * required at all, because `consumeApproval` will allow the action outright.
   *
   * This used to throw `409 conflict`, which became a dead end once first-party
   * reads stopped arming the gate: an agent whose prompt tells it to request
   * approval before mutating would call this on a now-clean session, get a hard
   * 409, and abandon the work. Observed live 2026-08-04 — Memory Consolidation
   * took 8 consecutive 409s and reported "Captured: 0 … approval requests were
   * rejected by the server", which is the same zero-work outcome as the original
   * deadlock, just reached by a different route.
   *
   * "You do not need approval" is not an error condition. The caller turns this
   * null into an explicit instruction to proceed.
   */
  createApprovalBinding(
    context: TrustedSecurityContext,
    action: SecurityAction,
    payload: unknown,
  ): SecurityApprovalBinding | null {
    const session = requireKnownSession(context);
    const taint = getDb()
      .prepare('SELECT * FROM agent_external_taint_state WHERE session_id = ?')
      .get(session.id) as TaintStateRow | undefined;
    if (!taint) {
      return null;
    }

    const canonicalPayload = canonicalJson(payload);
    return {
      sessionId: session.id,
      agentConfigId: session.agentKind,
      securityAction: action,
      payloadDigest: securityPayloadDigest(action, payload),
      taintId: taint.taint_id,
      taintedTurnId: taint.tainted_turn_id,
      boundAgent: context.agentName,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      preview: `${action}: ${canonicalPayload}`,
    };
  }

  consumeApproval(input: {
    context: TrustedSecurityContext;
    approvalId?: string;
    action: SecurityAction;
    payload: unknown;
  }): { allowed: true; consumed: boolean } {
    const session = requireKnownSession(input.context);
    const taint = getDb()
      .prepare('SELECT * FROM agent_external_taint_state WHERE session_id = ?')
      .get(session.id) as TaintStateRow | undefined;
    if (!taint) {
      // A supplied token is never ignored: silently allowing a bearer ID
      // minted for another session would make cross-session replay appear to
      // succeed even though this clean session did not need approval.
      if (input.approvalId) {
        throw AppError.forbidden('approval token is not valid for this clean session');
      }
      return { allowed: true, consumed: false };
    }
    if (!input.approvalId) {
      // An unattended scheduled run has no human to produce an approval token.
      // If the bound profile is explicitly marked auto-approve, authorize here
      // and leave a full audit row behind. Returns null for every other shape,
      // which falls through to the original refusal.
      const auto = this.autoApproveUnattendedScheduledRun({
        session,
        taint,
        context: input.context,
        action: input.action,
        payload: input.payload,
      });
      if (auto) return auto;
      throw AppError.forbidden('human approval is required after external content was consumed');
    }

    return getDb().transaction(() => {
      const approval = getDb()
        .prepare('SELECT * FROM agent_approvals WHERE id = ?')
        .get(input.approvalId) as ApprovalSecurityRow | undefined;
      if (!approval) throw AppError.forbidden('approval token was not found');
      if (approval.session_id !== session.id) {
        throw AppError.forbidden('approval token belongs to another session');
      }
      if (approval.agent_config_id !== session.agentKind || approval.bound_agent !== input.context.agentName) {
        throw AppError.forbidden('approval token belongs to another agent');
      }
      if (approval.status !== 'approved') {
        throw AppError.forbidden('approval token has not been approved by a human');
      }
      if (approval.consumed_at) {
        throw AppError.conflict('approval token has already been consumed');
      }
      if (!approval.expires_at || Date.parse(approval.expires_at) <= Date.now()) {
        throw AppError.forbidden('approval token has expired');
      }
      if (
        approval.security_action !== input.action ||
        approval.payload_digest !== securityPayloadDigest(input.action, input.payload)
      ) {
        throw AppError.forbidden('approval token does not match the exact outbound action and payload');
      }
      if (
        approval.taint_id !== taint.taint_id ||
        approval.tainted_turn_id !== taint.tainted_turn_id
      ) {
        throw AppError.forbidden('approval token belongs to a stale external-content taint');
      }

      const consumedAt = new Date().toISOString();
      const updated = getDb()
        .prepare(
          `UPDATE agent_approvals
           SET consumed_at = ?
           WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
        )
        .run(consumedAt, approval.id);
      if (updated.changes !== 1) {
        throw AppError.conflict('approval token was consumed concurrently');
      }
      return { allowed: true as const, consumed: true };
    })();
  }

  /**
   * Authorize a protected mutation for an UNATTENDED SCHEDULED run whose bound
   * profile is explicitly marked `auto_approve_actions`.
   *
   * This is a deliberate, user-authorized narrowing of the #1134 rule that
   * security-bound approvals always require a human (decision 2026-08-04 —
   * see docs/ai/decisions/). The rule it relaxes had made autonomy structurally
   * impossible: a scheduled job reads data, that read arms the taint gate, and
   * the write that follows then demands a human who is by definition not there.
   * Memory Consolidation ran at 02:30 and reported success having captured 0.
   *
   * THREE conditions must ALL hold; any one missing returns null and the caller
   * refuses exactly as before:
   *
   *   1. `auto_approve_actions = 1` on the bound profile — opt-in, default 0,
   *      set per profile by the user.
   *   2. `is_system = 1` — a Rhythm-originated run, never an interactive one.
   *   3. `scheduled_task_id IS NOT NULL` — it came from the scheduler.
   *
   * Interactive sessions can satisfy none of 2 or 3, so a human at the keyboard
   * still gets the full gate. Delegated children inherit `is_system` and
   * `scheduled_task_id` from their parent (upsertResolvedChildSession), so a
   * subagent of a scheduled run is covered — which is required, since the
   * blocked writes were frequently in children.
   *
   * KNOWN AND ACCEPTED CONSEQUENCE: the taint may have come from genuinely
   * external content (an email body, a web page, PCO data). This therefore
   * allows attacker-influenced text to reach a protected mutation with no human
   * in the loop, for auto-approve profiles on scheduled runs only. That
   * trade-off was made explicitly to get unattended runs working. The audit row
   * written below is what keeps it reviewable: it records the exact action,
   * canonical payload digest, the taint id AND the taint source, so an
   * after-the-fact review can see which reads influenced which writes.
   */
  private autoApproveUnattendedScheduledRun(input: {
    session: { id: string; agentKind: string; isSystem?: boolean; scheduledTaskId?: string | null };
    taint: TaintStateRow;
    context: TrustedSecurityContext;
    action: SecurityAction;
    payload: unknown;
  }): { allowed: true; consumed: boolean } | null {
    const { session, taint } = input;
    if (!isUnattendedAutoApproveSession(session)) return null;

    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_approvals
           (id, session_id, agent_config_id, action, preview, consequence, status,
            actor, decided_at, security_action, payload_digest, taint_id,
            tainted_turn_id, bound_agent, expires_at, consumed_at, decision_nonce)
         VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        randomUUID(),
        session.id,
        session.agentKind,
        `Auto-approved ${input.action} (unattended scheduled run)`,
        `${input.action}: ${canonicalJson(input.payload)}`,
        `Profile "${session.agentKind}" has auto_approve_actions enabled and this run ` +
          `originated from scheduled task ${session.scheduledTaskId}. Session taint ` +
          `source at time of write: ${taint.source}.`,
        `auto-approved:scheduled-task:${session.scheduledTaskId}`,
        now,
        input.action,
        securityPayloadDigest(input.action, input.payload),
        taint.taint_id,
        taint.tainted_turn_id,
        input.context.agentName,
        now, // already-consumed: expires_at is in the past by construction
        now,
      );

    logger.warn(
      `[ExternalContentSecurity] auto-approved ${input.action} for unattended ` +
        `scheduled run (profile=${session.agentKind}, task=${session.scheduledTaskId}, ` +
        `taintSource=${taint.source}) — #1134 human gate bypassed by profile opt-in`,
    );

    return { allowed: true, consumed: true };
  }
}
