/**
 * W4 — terminal hook behaviour: fire-and-forget, idempotent, root-resolving
 * (c8, c12) and the privacy gate over the whole write path (c10).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../../repositories/agent_org_experiment_enrollments_repository';
import { recordTerminalOutcome, recordFeedback } from '../run_outcome_service';

let db: Database.Database;

function session(id: string, parentId: string | null = null): void {
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_kind, cwd, name, parent_session_id)
     VALUES (?, 'build', '/tmp', ?, ?)`,
  ).run(id, id, parentId);
}

function outcomeCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM agent_run_outcomes`).get() as { n: number }).n;
}

function seedExperiment(params: {
  id: string;
  proposalId: string;
}): void {
  db.prepare(
    `
    INSERT INTO agent_org_experiments
      (id, proposal_id, adapter, evidence_bundle_json, baseline_spec_json,
       candidate_spec_json, assignment_key, stopping_rule_json, max_exposure,
       decision, declared_at)
    VALUES (?, ?, 'paired-cohort-outcome', '{}', '{}', '{}', 'paired-key',
            '{}', 10, ?, datetime('now'))`,
  ).run(params.id, params.proposalId, null);
}

function seedDispatchedEnrollment(params: { runEpisodeId: string; experimentId: string }): void {
  db.prepare(
    `INSERT INTO agent_org_experiment_enrollments
      (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
       assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
     VALUES (?, ?, ?, 'proposal-1', 'agent-1', 'baseline', 'assign', 'base', 'treat', 'dispatched', datetime('now'))`,
  ).run(`enroll-${params.runEpisodeId}`, params.runEpisodeId, params.experimentId);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

afterEach(() => {
  db.close();
});

/**
 * The row is written once and never updated, and `session.idle` is a TURN
 * boundary — so whatever the FIRST turn claims becomes the run's verdict
 * forever. That makes the honesty of the evidence passed at the call site a
 * correctness property, not a style preference: a hook that asserts artifact
 * production it did not observe permanently records `success` for every
 * interactive session, and W6 promotes on this ledger.
 *
 * The behavioural half is asserted first. The source half exists because the
 * defect lived entirely at the call site — the service was already correct, so
 * a service-level test alone passes identically with and without the bug and
 * guards nothing.
 */
describe('W4 — the interactive turn boundary cannot invent a verdict', () => {
  it('a completed turn with clean telemetry but no artifact evidence is inconclusive, not success', async () => {
    session('root-1');
    db.prepare(
      `INSERT INTO tool_events
         (session_id, sdk_session_id, call_id, tool, status,
          started_at, duration_ms, created_at)
       VALUES (?, ?, ?, 'read', 'completed', ?, 1, ?)`,
    ).run('root-1', 'sdk-root-1', 'call-1', new Date().toISOString(), new Date().toISOString());

    // Exactly what the interactive hook now sends: a terminal status and
    // nothing else. Zero tool errors must NOT be read as a success.
    await recordTerminalOutcome({ sessionId: 'root-1', terminalStatus: 'completed' });

    const view = await new AgentRunOutcomesRepository(db).findByRootSessionIdAsync('root-1');
    expect(view?.outcome.objectiveEvidence.producedArtifact).toBeNull();
    expect(view?.outcome.objectiveVerdict).toBe('inconclusive');
  });

  /**
   * The first version of this guard was broken three ways at once, and an
   * independent cross-package review caught all three: it read ONLY
   * opencode_stream_bridge.ts (missing both agent_runner.ts sites, one of
   * which carried the same defect); its regex matched the literal `true`, so
   * it could not have seen `resultText.length > 0` even pointed at the right
   * file; and `expect(claims).toEqual([])` over a regex-populated array never
   * asserted the regex matched anything, so a rename or reformat made it pass
   * while checking nothing.
   *
   * The rule being enforced: `producedArtifact` may be omitted (unknown) or
   * passed as literal `false`. Anything else is a claim about the run's output
   * that the hook is not in a position to observe — and the row is written
   * once and never updated, so a wrong claim is permanent.
   */
  it('no terminal hook call site claims artifact production it did not observe', () => {
    const servicesDir = join(__dirname, '..');
    const sources = readdirSync(servicesDir)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => [entry, readFileSync(join(servicesDir, entry), 'utf8')] as const);

    const claims: string[] = [];
    let callSites = 0;
    for (const [name, source] of sources) {
      for (const call of source.matchAll(/recordTerminalOutcome\(\{[\s\S]*?\n\s*\}\)/g)) {
        callSites += 1;
        const arg = /producedArtifact:\s*([^,\n]+)/.exec(call[0]);
        if (arg && arg[1].trim() !== 'false') claims.push(`${name}: ${arg[1].trim()}`);
      }
    }

    // Non-vacuity: if the scan finds no call sites the assertion below is
    // meaningless. Five is the shipped count (agent_runner x2, bridge x3);
    // adding one is fine, losing them all is the failure this catches.
    expect(callSites).toBeGreaterThanOrEqual(5);
    expect(claims).toEqual([]);
  });
});

describe('W4-c8 terminal hook', () => {
  it('duplicate terminal events for the same run produce exactly one row', async () => {
    session('root-1');
    const event = {
      sessionId: 'root-1',
      terminalStatus: 'completed' as const,
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    };
    await recordTerminalOutcome(event);
    await recordTerminalOutcome(event);
    await recordTerminalOutcome({ ...event, terminalStatus: 'error' as const });

    expect(outcomeCount()).toBe(1);
    const view = await new AgentRunOutcomesRepository(db).findByRootSessionIdAsync('root-1');
    expect(view?.outcome.objectiveVerdict).toBe('success');
  });

  it('never throws into the user turn, even when the ledger write fails', async () => {
    session('root-1');
    // Drop the table out from under the hook: the user's turn must not care.
    db.exec(`DROP TABLE agent_run_outcomes`);

    let synchronousThrow: unknown = null;
    let promise: Promise<void> | undefined;
    try {
      promise = recordTerminalOutcome({
        sessionId: 'root-1',
        terminalStatus: 'completed',
        evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
      });
    } catch (err) {
      synchronousThrow = err;
    }
    expect(synchronousThrow).toBeNull();
    await expect(promise).resolves.toBeUndefined();
  });

  it('leaves no unhandled rejection when the caller does not await it', async () => {
    session('root-1');
    db.exec(`DROP TABLE agent_run_outcomes`);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    void recordTerminalOutcome({
      sessionId: 'root-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

describe('W4-c12 a delegated child resolves to its root run', () => {
  it('a child terminal event writes to the root, not a second outcome', async () => {
    session('root-1');
    session('child-1', 'root-1');
    session('grandchild-1', 'child-1');

    await recordTerminalOutcome({
      sessionId: 'grandchild-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    await recordTerminalOutcome({
      sessionId: 'child-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    await recordTerminalOutcome({
      sessionId: 'root-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    expect(outcomeCount()).toBe(1);
    const row = db
      .prepare(`SELECT root_session_id AS r, session_id AS s FROM agent_run_outcomes`)
      .get();
    expect(row).toEqual({ r: 'root-1', s: 'grandchild-1' });
  });
});

describe('C1-B2 terminal hook enrollment transition', () => {
  it('terminalizes a dispatched enrollment by explicit runEpisode even when experiment is decided', async () => {
    session('root-1');
    seedExperiment({ id: 'experiment-1', proposalId: 'proposal-1' });
    db.prepare(`UPDATE agent_org_experiments SET decision = 'promote' WHERE id = 'experiment-1'`).run();
    seedDispatchedEnrollment({
      runEpisodeId: 'dispatched-episode-1',
      experimentId: 'experiment-1',
    });

    await recordTerminalOutcome({
      sessionId: 'root-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
      runEpisodeId: 'dispatched-episode-1',
      scheduledOccurrenceId: null,
    });

    const enrollment = new AgentOrgExperimentEnrollmentsRepository(db).findByRunEpisodeIdAsync('dispatched-episode-1');
    expect((await enrollment)?.state).toBe('terminalized');
  });

  it('deduplicates terminal events for explicitly routed dispatched enrollment terminalization', async () => {
    session('root-1');
    seedExperiment({ id: 'experiment-2', proposalId: 'proposal-2' });
    db.prepare(
      `UPDATE agent_org_experiments SET decision = 'promote' WHERE id = 'experiment-2'`,
    ).run();
    seedDispatchedEnrollment({
      runEpisodeId: 'dispatched-episode-2',
      experimentId: 'experiment-2',
    });
    const event = {
      sessionId: 'root-1',
      terminalStatus: 'completed' as const,
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
      runEpisodeId: 'dispatched-episode-2',
    };

    await recordTerminalOutcome(event);
    await recordTerminalOutcome(event);
    await recordTerminalOutcome({ ...event, terminalStatus: 'error' });

    expect(outcomeCount()).toBe(1);
    const enrollment = new AgentOrgExperimentEnrollmentsRepository(db).findByRunEpisodeIdAsync(
      'dispatched-episode-2',
    );
    expect((await enrollment)?.state).toBe('terminalized');
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`,
      )
      .get('dispatched-episode-2');
    expect(row).toEqual({ n: 1 });
  });

  it('terminalizes a dispatched enrollment even when outcome finalization fails', async () => {
    session('root-1');
    seedExperiment({ id: 'experiment-3', proposalId: 'proposal-3' });
    seedDispatchedEnrollment({
      runEpisodeId: 'dispatched-episode-3',
      experimentId: 'experiment-3',
    });
    const finalizeSpy = vi
      .spyOn(AgentRunOutcomesRepository.prototype, 'finalizeAsync')
      .mockRejectedValue(new Error('immutable outcome write failed'));

    const event = {
      sessionId: 'root-1',
      terminalStatus: 'completed' as const,
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
      runEpisodeId: 'dispatched-episode-3',
    };

    await expect(recordTerminalOutcome(event)).resolves.toBeUndefined();
    const enrollment = new AgentOrgExperimentEnrollmentsRepository(db).findByRunEpisodeIdAsync(
      'dispatched-episode-3',
    );
    expect((await enrollment)?.state).toBe('terminalized');
    expect(outcomeCount()).toBe(0);

    await recordTerminalOutcome(event);
    await recordTerminalOutcome({ ...event, terminalStatus: 'error' as const });

    expect(outcomeCount()).toBe(0);
    const duplicated = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`,
      )
      .get('dispatched-episode-3');
    expect(duplicated).toEqual({ n: 1 });

    const duplicatedEnrollment = await new AgentOrgExperimentEnrollmentsRepository(db).findByRunEpisodeIdAsync(
      'dispatched-episode-3',
    );
    expect(duplicatedEnrollment?.state).toBe('terminalized');
    finalizeSpy.mockRestore();
  });
});

describe('W4-c10 privacy gate', () => {
  const SECRETS = {
    prompt: 'Please draft the elder board letter about the roof budget',
    toolArgs: '{"path":"/Users/pastor/private/board-notes.md","mode":"rw"}',
    toolOutput: 'Attendance was 412 and the giving total was $18,204.55',
    apiKey: 'sk-ant-api03-QZ9fakefakefakefakefakefakefakefake',
    bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKEFAKE.FAKE',
  };

  function ledgerDump(): string {
    const outcomes = db.prepare(`SELECT * FROM agent_run_outcomes`).all();
    const feedback = db.prepare(`SELECT * FROM agent_run_feedback_events`).all();
    return JSON.stringify({ outcomes, feedback });
  }

  it('copies no prompt, tool payload or credential into the ledger tables', async () => {
    session('root-1');
    // A realistic turn: the session row and its messages are saturated with the
    // exact material the ledger must never absorb.
    db.prepare(`UPDATE agent_sessions SET last_preview = ? WHERE id = 'root-1'`).run(
      SECRETS.toolOutput,
    );
    for (const [role, text] of [
      ['input', SECRETS.prompt],
      ['output', SECRETS.toolOutput],
      ['output', SECRETS.toolArgs],
      ['output', `${SECRETS.apiKey} ${SECRETS.bearer}`],
    ] as const) {
      db.prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text)
         VALUES ('root-1', ?, ?, ?)`,
      ).run(role, text, text);
    }

    await recordTerminalOutcome({
      sessionId: 'root-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
      attribution: { tools: [{ name: 'read' }], skills: [{ name: 'smoke-test' }] },
    });
    await recordFeedback({
      sessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'partial',
      actor: 'user:3',
      reason: 'Letter was fine but slow',
    });

    const dump = ledgerDump();
    for (const [label, value] of Object.entries(SECRETS)) {
      expect(dump, `${label} leaked into the ledger`).not.toContain(value);
    }
    // The ledger did record the run — this is not a vacuous pass.
    expect(dump).toContain('root-1');
    expect(dump).toContain('smoke-test');
  });

  it('redacts secret-shaped values a human pastes into a feedback reason', async () => {
    session('root-1');
    await recordTerminalOutcome({
      sessionId: 'root-1',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    await recordFeedback({
      sessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'failure',
      reason: `it kept using ${SECRETS.apiKey} and also ${SECRETS.bearer}`,
    });

    const stored = db
      .prepare(`SELECT reason FROM agent_run_feedback_events`)
      .get() as { reason: string };
    expect(stored.reason).not.toContain(SECRETS.apiKey);
    expect(stored.reason).not.toContain(SECRETS.bearer);
    expect(stored.reason).toContain('[redacted]');
    expect(stored.reason).toContain('it kept using');
  });
});
