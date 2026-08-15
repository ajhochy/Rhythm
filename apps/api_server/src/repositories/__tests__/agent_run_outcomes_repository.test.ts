/**
 * W4 — outcome ledger repository. Covers the exact links (c3), the three
 * distinct verdict fields (c4), idempotent finalization and explicit-over-
 * inferred precedence (c5), append-only feedback (c2), post-finalization
 * immutability (c11) and root-run resolution across a session tree (c12).
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentRunOutcomesRepository } from '../agent_run_outcomes_repository';
import { buildAttribution } from '../../services/run_outcome_service';

let db: Database.Database;
let repo: AgentRunOutcomesRepository;

function session(id: string, parentId: string | null = null): void {
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_kind, cwd, name, parent_session_id)
     VALUES (?, 'build', '/tmp', ?, ?)`,
  ).run(id, id, parentId);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentRunOutcomesRepository(db);
});

afterEach(() => {
  db.close();
});

function finalizeInput(over: Record<string, unknown> = {}) {
  return {
    rootSessionId: 'root-1',
    sessionId: 'root-1',
    terminalStatus: 'completed' as const,
    objectiveVerdict: 'success' as const,
    objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    attribution: buildAttribution({ configRevision: 4 }),
    ...over,
  };
}

describe('W4-c3 exact links', () => {
  it('persists session, root session, scheduled occurrence, variant, revision and attribution', async () => {
    await repo.finalizeAsync(
      finalizeInput({
        sessionId: 'child-9',
        scheduledOccurrenceId: 'occ-42',
        experimentVariant: 'candidate-b',
        proposalId: 'prop-7',
        profileId: 'church-admin',
        configRevision: 4,
      }),
    );

    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.outcome).toMatchObject({
      rootSessionId: 'root-1',
      sessionId: 'child-9',
      scheduledOccurrenceId: 'occ-42',
      experimentVariant: 'candidate-b',
      proposalId: 'prop-7',
      profileId: 'church-admin',
      configRevision: 4,
    });
    expect(view?.outcome.attribution.configRevision).toBe(4);
  });
});

describe('W4-c5 idempotent finalization', () => {
  it('finalizing the same root run twice yields the same single row', async () => {
    const first = await repo.finalizeAsync(finalizeInput());
    const second = await repo.finalizeAsync(
      finalizeInput({ objectiveVerdict: 'failure', terminalStatus: 'error' }),
    );

    expect(second.id).toBe(first.id);
    expect(second.objectiveVerdict).toBe('success');
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM agent_run_outcomes`).get(),
    ).toEqual({ n: 1 });
  });
});

describe('W4-c4 / W4-c5 distinct verdict fields and explicit precedence', () => {
  it('keeps objective, explicit and inferred verdicts in separate fields', async () => {
    await repo.finalizeAsync(
      finalizeInput({
        objectiveVerdict: 'partial',
        objectiveEvidence: { producedArtifact: true, errorCount: 2, approvalDenied: false },
      }),
    );
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'failure',
      confidence: 1,
      actor: 'user:3',
    });
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'inferred',
      verdict: 'success',
      confidence: 0.6,
    });

    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.objectiveVerdict).toBe('partial');
    expect(view?.explicitUserVerdict).toBe('failure');
    expect(view?.inferredVerdict).toBe('success');
    // The human wins, whatever inference says and whenever it arrives.
    expect(view?.authoritativeVerdict).toBe('failure');
  });

  it('an inferred verdict arriving after an explicit one does not replace it', async () => {
    await repo.finalizeAsync(finalizeInput());
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'failure',
      confidence: 1,
      actor: 'user:3',
    });
    for (const verdict of ['success', 'partial', 'success'] as const) {
      await repo.appendFeedbackAsync({
        rootSessionId: 'root-1',
        source: 'inferred',
        verdict,
        confidence: 0.9,
      });
    }

    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.explicitUserVerdict).toBe('failure');
    expect(view?.authoritativeVerdict).toBe('failure');
  });
});

describe('W4-c2 append-only feedback', () => {
  it('retains a contradictory later verdict alongside the earlier one', async () => {
    await repo.finalizeAsync(finalizeInput());
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'success',
      confidence: 1,
      actor: 'user:3',
    });
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'explicit_user',
      verdict: 'failure',
      confidence: 1,
      actor: 'user:3',
    });

    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.feedback.map((f) => f.verdict)).toEqual(['success', 'failure']);
    // Latest explicit verdict is authoritative, but the earlier one is still on record.
    expect(view?.explicitUserVerdict).toBe('failure');
  });

  it('every stored row carries a source and a confidence', async () => {
    await repo.finalizeAsync(finalizeInput());
    await repo.appendFeedbackAsync({
      rootSessionId: 'root-1',
      source: 'inferred',
      verdict: 'partial',
      confidence: 0.25,
    });
    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.feedback[0]).toMatchObject({ source: 'inferred', confidence: 0.25 });
  });

  it('exposes no update or delete path', () => {
    const surface = new Set([
      ...Object.getOwnPropertyNames(AgentRunOutcomesRepository.prototype),
      ...Object.getOwnPropertyNames(repo),
    ]);
    for (const name of surface) {
      expect(name).not.toMatch(/update|delete|remove|clear|purge|set[A-Z]/i);
    }
  });
});

describe('W4-c11 post-finalization immutability', () => {
  it('a finalized row cannot be altered through the repository or the database', async () => {
    await repo.finalizeAsync(finalizeInput());
    // No repository path exists (asserted above); the database refuses too, so a
    // future writer that bypasses the repository still cannot rewrite history.
    expect(() =>
      db.prepare(`UPDATE agent_run_outcomes SET objective_verdict = 'failure'`).run(),
    ).toThrow(/immutable/i);

    const view = await repo.findByRootSessionIdAsync('root-1');
    expect(view?.outcome.objectiveVerdict).toBe('success');
  });
});

describe('W4-c12 root-run resolution', () => {
  it('resolves a delegated child to the root of its session tree', async () => {
    session('root-1');
    session('child-1', 'root-1');
    session('grandchild-1', 'child-1');

    expect(await repo.resolveRootSessionIdAsync('grandchild-1')).toBe('root-1');
    expect(await repo.resolveRootSessionIdAsync('child-1')).toBe('root-1');
    expect(await repo.resolveRootSessionIdAsync('root-1')).toBe('root-1');
  });

  it('falls back to the session id itself when no session row exists', async () => {
    expect(await repo.resolveRootSessionIdAsync('orphan')).toBe('orphan');
  });
});
