/**
 * Regression guard: an expired approval card can never be approved.
 *
 * Live: a coordinator.workflow.start card was approved 51 minutes after its
 * expires_at and the decide path accepted it — nothing compared expiry.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';

let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); runMigrations(db); setDb(db); });
afterEach(() => db.close());

function card(expiresInMs: number) {
  const repo = new AgentApprovalsRepository();
  const a = repo.create({ action: 'Approve bounded coding execution', expiresAt: new Date(Date.now() + expiresInMs).toISOString() });
  db.prepare(`UPDATE agent_approvals SET decision_nonce='nonce' WHERE id=?`).run(a.id);
  return { repo, id: a.id };
}

describe('deciding an expired approval', () => {
  it('refuses to approve after expiry', () => {
    const { repo, id } = card(-60_000);
    expect(repo.decideWithNonce(id, 'approved', 'user:1', 'nonce')).toBeNull();
    expect(repo.getById(id)?.status).toBe('pending');
  });

  it('still lets an expired card be rejected', () => {
    const { repo, id } = card(-60_000);
    expect(repo.decideWithNonce(id, 'rejected', 'user:1', 'nonce')?.status).toBe('rejected');
  });

  it('approves a card inside its window', () => {
    const { repo, id } = card(60_000);
    expect(repo.decideWithNonce(id, 'approved', 'user:1', 'nonce')?.status).toBe('approved');
  });
});
