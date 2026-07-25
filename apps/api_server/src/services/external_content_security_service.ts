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
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

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
  'org-optimizer.run',
  'delegation.start',
  'delegation.start-async',
  'notification.send',
  'scheduled-task.create',
  'scheduled-task.cancel',
  'scheduled-task.trigger',
  'memory.update',
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

  createApprovalBinding(
    context: TrustedSecurityContext,
    action: SecurityAction,
    payload: unknown,
  ): SecurityApprovalBinding {
    const session = requireKnownSession(context);
    const taint = getDb()
      .prepare('SELECT * FROM agent_external_taint_state WHERE session_id = ?')
      .get(session.id) as TaintStateRow | undefined;
    if (!taint) {
      throw AppError.conflict('session has no external-content taint to approve');
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
}
