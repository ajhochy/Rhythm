/**
 * async_delegation_status_service.ts — a lightweight, pollable view of a parent's
 * in-flight delegations, plus cancel control.
 *
 * Purpose: let a manager answer "is my delegate still working, and how long has it
 * been?" without waiting for the wake and without reading the child's transcript.
 *
 * ## Metadata only — deliberately
 *
 * This returns NO child text: no assistant output, no tool arguments, no tool
 * results, no completion text. Only state, timings, a step count, and the NAME of
 * the tool the child is currently running.
 *
 * That is a security boundary, not a UI preference. A delegated child routinely
 * reads untrusted external content (email, calendar, PCO, web). Surfacing its text
 * to the parent on demand would be a laundering path straight around the
 * external-content approval gate: the child reads tainted content, the parent
 * polls it as "progress", and the parent then acts on it having never crossed the
 * boundary itself. Completion text already flows through the wake, which IS
 * gated. Progress must therefore carry no content at all.
 *
 * A tool NAME is safe: it is drawn from Rhythm's own tool registry, not from
 * external data. Tool arguments are not — a `webfetch` argument can contain an
 * attacker-chosen URL — so they are never included.
 */
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { opencodeClient } from './opencode_engine';
import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';

/** What a polling parent is allowed to see. No child content, ever. */
export interface DelegationStatusView {
  delegationId: string;
  target: string;
  /** dispatched | waking | completed | notified | failed | cancelled */
  state: string;
  elapsedMs: number;
  /** Present once the child finished; the wall time it actually took. */
  durationMs: number | null;
  /** Child session lifecycle, e.g. working / idle / error. */
  childState: string | null;
  /** How many assistant turns the child has produced — a coarse progress signal. */
  childSteps: number;
  /**
   * The name of the most recent tool the child ran, and its status. NAME ONLY —
   * never arguments or results (see the module doc).
   */
  latestEvent: { tool: string; status: string | null } | null;
  /** Whether a cancel would do anything. */
  cancellable: boolean;
  /** Set only when the delegation itself failed to dispatch or run. */
  error: string | null;
}

const TERMINAL = new Set(['completed', 'notified', 'failed', 'cancelled']);

function elapsed(from: string, to?: string | null): number {
  const start = Date.parse(from);
  const end = to ? Date.parse(to) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/**
 * Status of every delegation dispatched by `parentSessionId`, newest first.
 * Never throws for a parent with no delegations — returns [].
 */
export function getDelegationStatus(parentSessionId: string): DelegationStatusView[] {
  const rows = new AgentAsyncDelegationsRepository().listForParent(parentSessionId);
  const sessions = new AgentSessionsRepository();
  const messages = new AgentSessionMessagesRepository();

  return rows.map((row) => {
    const child = row.childSessionId ? sessions.findById(row.childSessionId) : null;

    let childSteps = 0;
    let latestEvent: DelegationStatusView['latestEvent'] = null;
    if (row.childSessionId) {
      try {
        const msgs = messages.listBySessionStructured(row.childSessionId, 200);
        childSteps = msgs.filter((m) => m.role === 'output').length;
        // Walk backwards for the most recent tool part. Name + status only.
        for (let i = msgs.length - 1; i >= 0 && !latestEvent; i -= 1) {
          const parts = (msgs[i] as unknown as { parts?: Array<Record<string, unknown>> }).parts ?? [];
          for (let j = parts.length - 1; j >= 0; j -= 1) {
            const part = parts[j];
            if (part?.type === 'tool' && typeof part.tool === 'string') {
              const state = part.state as { status?: string } | undefined;
              latestEvent = { tool: part.tool, status: state?.status ?? null };
              break;
            }
          }
        }
      } catch (err) {
        // A read failure must not break the whole status poll.
        logger.warn(`[AsyncDelegationStatus] child read failed for ${row.id}: ${String(err)}`);
      }
    }

    return {
      delegationId: row.id,
      target: row.targetAgentConfigId,
      state: row.status,
      elapsedMs: elapsed(row.createdAt, TERMINAL.has(row.status) ? row.completedAt : null),
      durationMs: row.completedAt ? elapsed(row.createdAt, row.completedAt) : null,
      childState: child?.status ?? null,
      childSteps,
      latestEvent,
      cancellable: row.status === 'dispatched' || row.status === 'waking',
      error: row.errorText ?? null,
    };
  });
}

/**
 * Cancel one in-flight delegation: abort the child's engine session, then mark the
 * row cancelled.
 *
 * Ownership is enforced by `parentSessionId` — a session may only cancel a
 * delegation it dispatched. Terminal delegations are refused rather than silently
 * ignored, so a caller learns the result already landed instead of assuming it
 * stopped something.
 */
export async function cancelDelegation(
  parentSessionId: string,
  delegationId: string,
): Promise<DelegationStatusView> {
  const repo = new AgentAsyncDelegationsRepository();
  const row = repo.findById(delegationId);
  if (!row) throw AppError.notFound('AsyncDelegation');
  if (row.parentSessionId !== parentSessionId) {
    throw AppError.forbidden('that delegation was dispatched by another session');
  }
  if (TERMINAL.has(row.status)) {
    throw AppError.badRequest(
      `delegation is already ${row.status} — nothing to cancel`,
    );
  }

  // CLAIM THE ROW FIRST, then abort. Aborting first looked natural and was wrong:
  // killing the child immediately drives the completion pipeline, which marks the
  // row terminal and WAKES the parent — after which markCancelled finds nothing to
  // transition and reports "completed before it could be cancelled". Observed live
  // 2026-08-05: the child was killed, the API returned 400, and the parent was
  // still woken with a result its owner had just cancelled. Claiming first makes
  // the cancel authoritative; the completion writes now skip cancelled rows.
  const cancelled = repo.markCancelled(delegationId);
  if (!cancelled) {
    // Genuinely terminal between our read and the write.
    throw AppError.badRequest('delegation completed before it could be cancelled');
  }

  // Best-effort abort. If the engine is down the row is already cancelled, so the
  // parent is not left polling forever.
  const child = new AgentSessionsRepository().findById(row.childSessionId);
  if (child?.sdkSessionId) {
    try {
      await opencodeClient.abortSession(child.sdkSessionId, child.cwd);
    } catch (err) {
      logger.warn(
        `[AsyncDelegationStatus] engine abort failed for child ${row.childSessionId}: ${String(err)}`,
      );
    }
  }
  const view = getDelegationStatus(parentSessionId).find(
    (v) => v.delegationId === delegationId,
  );
  if (!view) throw AppError.internal('cancelled delegation vanished from status');
  return view;
}
