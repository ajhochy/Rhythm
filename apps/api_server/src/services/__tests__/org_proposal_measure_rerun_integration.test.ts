/**
 * W3 final review corrective (slice B) — INTEGRATION test for
 * `classifyRerunFailure` (org_proposal_measure.ts) against the REAL
 * `workflow_failure_signal_extractor` detectors and a real in-memory migrated
 * DB — no detector mock, unlike org_proposal_measure_rerun.test.ts's routing
 * unit tests.
 *
 * The bug this guards against: `classifyRerunFailure` used to synthesize a
 * fake two-message session (`partsJson: null`) instead of loading the rerun
 * session's ACTUAL persisted messages. Since `extractToolAttempts` (the
 * retry-loop detector's only evidence source) requires real `partsJson`, that
 * synthetic double could never carry structured tool-attempt evidence — a
 * reproduced retry-loop was invisible to this classifier, so every
 * retry-loop diagnosis proposal was silently kept regardless of whether the
 * patch actually fixed anything.
 *
 * Contract asserted here:
 *   - no readable structured tool-attempt evidence + 'retry-loop' among the
 *     original categories -> 'inconclusive' (never 'clean'/'completed').
 *   - real persisted tool parts that reproduce a retry loop -> 'reproduced'.
 *   - a valid, clean persisted tool trace (no retry loop) -> 'clean'.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../../repositories/agent_session_messages_repository';
import { classifyRerunFailure } from '../org_proposal_measure';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

/** Mirrors workflow_failure_signal_extractor.test.ts's seedToolAttempt — a producer-valid persisted tool part. */
function seedToolAttempt(
  messagesRepo: AgentSessionMessagesRepository,
  sessionId: string,
  sdkMessageId: string,
  opts: {
    callId: string;
    tool: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    startedAt: number;
    endedAt?: number;
    input: Record<string, unknown>;
  },
): void {
  const state: Record<string, unknown> = { status: opts.status, input: opts.input };
  if (opts.status === 'error') {
    state.error = 'boom';
    state.time = { start: opts.startedAt, end: opts.endedAt ?? opts.startedAt + 1000 };
  } else if (opts.status === 'completed') {
    state.output = 'ok';
    state.title = 'Tool result';
    state.metadata = {};
    state.time = { start: opts.startedAt, end: opts.endedAt ?? opts.startedAt + 1000 };
  } else if (opts.status === 'running') {
    state.time = { start: opts.startedAt };
  }
  messagesRepo.upsertPart(sessionId, sdkMessageId, {
    // `raw.sessionID` is a structurally valid producer SessionID — never the
    // Rhythm local session UUID (`sessionId` here only routes the upsert).
    id: `prt-${opts.callId}`,
    type: 'tool',
    sessionID: 'ses-test-session',
    messageID: sdkMessageId,
    callID: opts.callId,
    tool: opts.tool,
    state,
  });
}

describe('classifyRerunFailure — integration (real extractor + real DB)', () => {
  it('no readable structured tool-attempt evidence + retry-loop category -> inconclusive, never clean', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun', mcpRole: 'secretary' });
    // Only plain text messages — no persisted `type:'tool'` parts at all.
    messagesRepo.append(s.id, 'input', 'do the failing thing', 'do the failing thing');
    messagesRepo.append(s.id, 'output', 'A clean-looking response with no tool evidence at all.', 'A clean-looking response with no tool evidence at all.');

    const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);

    expect(result.status).toBe('inconclusive');
  });

  it('a real reproduced retry loop in persisted parts -> reproduced', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(messagesRepo, s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(messagesRepo, s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'error', startedAt: t0 + 5_000, input });

    const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);

    expect(result.status).toBe('reproduced');
    if (result.status === 'reproduced') {
      expect(result.categories).toContain('retry-loop');
    }
  });

  it('a valid, clean persisted tool trace (no retry loop) -> clean', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    seedToolAttempt(messagesRepo, s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'completed', startedAt: t0, input: { cmd: 'npm test' } });

    const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);

    expect(result.status).toBe('clean');
  });

  describe('W3 FINAL ARCHITECTURAL CORRECTIVE — RED probes: terminal producer-valid success required', () => {
    it('RED: a single pending-only attempt must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-pending', mcpRole: 'secretary' });
      messagesRepo.upsertPart(s.id, 'msg-1', {
        id: 'prt-call-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
        state: { status: 'pending', input: { cmd: 'npm test' }, raw: 'npm test' },
      });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });

    it('RED: a single fresh (non-stale) running-only attempt must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-running', mcpRole: 'secretary' });
      messagesRepo.upsertPart(s.id, 'msg-1', {
        id: 'prt-call-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
        state: { status: 'running', input: { cmd: 'npm test' }, time: { start: Date.now() } },
      });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });

    it('RED: a single stale/timed-out running-only attempt must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-timeout', mcpRole: 'secretary' });
      messagesRepo.upsertPart(s.id, 'msg-1', {
        id: 'prt-call-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
        state: { status: 'running', input: { cmd: 'npm test' }, time: { start: Date.now() - 20 * 60 * 1000 } },
      });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });

    it('RED: a single error-only attempt must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-error', mcpRole: 'secretary' });
      const t0 = Date.now() - 60_000;
      seedToolAttempt(messagesRepo, s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input: { cmd: 'npm test' } });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });

    it('RED: a single completed-but-MCP-error attempt must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-mcp-error', mcpRole: 'secretary' });
      messagesRepo.upsertPart(s.id, 'msg-1', {
        id: 'prt-call-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'mcp_tool',
        state: {
          status: 'completed', input: { cmd: 'call' }, output: 'boom', title: 't', metadata: {},
          time: { start: Date.now() - 60_000, end: Date.now() - 59_000 }, mcpResult: { isError: true },
        },
      });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });

    it('RED: malformed evidence (bad producer identity) must be inconclusive, never clean', async () => {
      const sessionsRepo = new AgentSessionsRepository();
      const messagesRepo = new AgentSessionMessagesRepository();
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'rerun-malformed', mcpRole: 'secretary' });
      // Missing sessionID/messageID entirely — producer-invalid identity.
      messagesRepo.upsertPart(s.id, 'msg-1', {
        id: 'prt-call-1', type: 'tool', callID: 'call-1', tool: 'bash',
        state: {
          status: 'completed', input: { cmd: 'npm test' }, output: 'ok', title: 't', metadata: {},
          time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
        },
      });

      const result = await classifyRerunFailure(s.id, 'secretary', ['retry-loop'], messagesRepo);
      expect(result.status).toBe('inconclusive');
    });
  });
});
