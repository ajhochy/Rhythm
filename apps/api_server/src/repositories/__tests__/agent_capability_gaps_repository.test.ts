/**
 * Unit tests for AgentCapabilityGapsRepository (SQLite).
 *
 * Local-SQLite-only, Stage A / Plan A↔Plan B shared contract (#983). Each test
 * uses an in-memory SQLite database so tests are fully isolated.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentCapabilityGapsRepository } from '../agent_capability_gaps_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('AgentCapabilityGapsRepository', () => {
  let repo: AgentCapabilityGapsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentCapabilityGapsRepository();
  });

  describe('dedupKeyFor', () => {
    it('is stable for the same title and tags', () => {
      const a = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', [
        'email',
        'weekly',
      ]);
      const b = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', [
        'email',
        'weekly',
      ]);
      expect(a).toBe(b);
    });

    it('ignores tag order', () => {
      const a = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', [
        'email',
        'weekly',
      ]);
      const b = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', [
        'weekly',
        'email',
      ]);
      expect(a).toBe(b);
    });

    it('is stable regardless of casing/whitespace in title and tags', () => {
      const a = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', [
        'Email',
        'Weekly',
      ]);
      const b = AgentCapabilityGapsRepository.dedupKeyFor('  draft a weekly email  ', [
        'email',
        'weekly',
      ]);
      expect(a).toBe(b);
    });

    it('differs for a different title', () => {
      const a = AgentCapabilityGapsRepository.dedupKeyFor('Draft a weekly email', ['email']);
      const b = AgentCapabilityGapsRepository.dedupKeyFor('Send a monthly report', ['email']);
      expect(a).not.toBe(b);
    });

    it('differs for different tags', () => {
      const a = AgentCapabilityGapsRepository.dedupKeyFor('Same title', ['a']);
      const b = AgentCapabilityGapsRepository.dedupKeyFor('Same title', ['b']);
      expect(a).not.toBe(b);
    });

    it('is a stable sha256 hex digest, never a uuid or timestamp', () => {
      const key = AgentCapabilityGapsRepository.dedupKeyFor('Some intent', null);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('insertIfAbsentAsync', () => {
    it('inserts a new open gap on first call', async () => {
      const { inserted, gap } = await repo.insertIfAbsentAsync({
        intentTitle: 'Draft a weekly email',
        intentProblem: 'No skill drafts recurring emails',
        intentTags: ['email', 'weekly'],
        sampleSessionId: 'session-1',
        agentConfigId: 'agent-1',
      });

      expect(inserted).toBe(true);
      expect(gap.id).toBeTruthy();
      expect(gap.intentTitle).toBe('Draft a weekly email');
      expect(gap.intentProblem).toBe('No skill drafts recurring emails');
      expect(gap.intentTags).toEqual(['email', 'weekly']);
      expect(gap.sampleSessionId).toBe('session-1');
      expect(gap.agentConfigId).toBe('agent-1');
      expect(gap.status).toBe('open');
    });

    it('collapses a second insert with the same title+tags onto the same row (idempotent)', async () => {
      const first = await repo.insertIfAbsentAsync({
        intentTitle: 'Draft a weekly email',
        intentTags: ['email', 'weekly'],
        sampleSessionId: 'session-1',
      });

      const second = await repo.insertIfAbsentAsync({
        intentTitle: 'Draft a weekly email',
        intentTags: ['weekly', 'email'], // reordered — same dedup key
        sampleSessionId: 'a-different-session',
      });

      expect(second.inserted).toBe(false);
      expect(second.gap.id).toBe(first.gap.id);
      // The original row's content is not overwritten by the second call.
      expect(second.gap.sampleSessionId).toBe('session-1');

      const all = await repo.listOpenAsync();
      expect(all).toHaveLength(1);
    });
  });

  describe('listOpenAsync', () => {
    it('returns [] on an empty DB', async () => {
      expect(await repo.listOpenAsync()).toEqual([]);
    });

    it('returns only open rows, excluding resolved ones', async () => {
      const { gap: openGap } = await repo.insertIfAbsentAsync({ intentTitle: 'Open gap' });
      const { gap: resolvedGap } = await repo.insertIfAbsentAsync({
        intentTitle: 'Resolved gap',
      });
      await repo.resolveByDedupKeyAsync(resolvedGap.dedupKey);

      const open = await repo.listOpenAsync();
      expect(open.map((g) => g.id)).toEqual([openGap.id]);
    });
  });

  describe('findByDedupKeyAsync', () => {
    it('finds an existing gap by its dedup key', async () => {
      const { gap } = await repo.insertIfAbsentAsync({ intentTitle: 'Findable gap' });
      const found = await repo.findByDedupKeyAsync(gap.dedupKey);
      expect(found?.id).toBe(gap.id);
    });

    it('returns null for an unknown dedup key', async () => {
      expect(await repo.findByDedupKeyAsync('does-not-exist')).toBeNull();
    });
  });

  describe('resolveByDedupKeyAsync', () => {
    it('flips status to resolved and bumps updated_at', async () => {
      const { gap } = await repo.insertIfAbsentAsync({ intentTitle: 'Gap to resolve' });
      expect(gap.status).toBe('open');

      await repo.resolveByDedupKeyAsync(gap.dedupKey);

      const resolved = await repo.findByDedupKeyAsync(gap.dedupKey);
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.updatedAt).toBeTypeOf('string');
    });

    it('is a no-op for an unknown dedup key (never throws)', async () => {
      await expect(repo.resolveByDedupKeyAsync('unknown-key')).resolves.toBeUndefined();
    });
  });
});
