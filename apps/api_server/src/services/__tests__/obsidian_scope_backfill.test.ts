/**
 * obsidian_scope_backfill — one-time, idempotent grant of obsidian READ/SEARCH
 * advertise-scope to existing SELECTABLE agent profiles.
 *
 * Exercises the REAL backfill against a real in-memory DB (so the schema_meta
 * run-once marker + the AgentConfigsRepository are real). Asserts:
 *   • an array scope gains "obsidian"; existing members are preserved + ordered;
 *   • an object-map scope gains an "obsidian": [read/search tools] key; existing
 *     keys preserved; granted tools are read/search only (no write/delete);
 *   • a null scope is left null (unrestricted — already has everything);
 *   • a profile already carrying obsidian (array or object) is left untouched;
 *   • a NON-selectable profile is never touched;
 *   • the pass is idempotent (re-run via injected alreadyDone=false adds nothing);
 *   • Postgres is a no-op.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import {
  backfillObsidianReadScope,
  grantObsidianScope,
  OBSIDIAN_READ_TOOLS,
} from '../obsidian_scope_backfill';

let db: Database.Database;
let repo: AgentConfigsRepository;

function seed(
  id: string,
  allowedMcpsJson: string | null,
  sessionSelectable = true,
): void {
  repo.insert({
    id,
    label: id,
    icon: 'robot',
    isAgent: true,
    enabled: true,
    ocAgent: id,
    sessionSelectable,
    allowedMcpsJson,
    sortOrder: 100,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentConfigsRepository();
});

afterEach(() => {
  db.close();
  vi.clearAllMocks();
});

describe('grantObsidianScope (pure)', () => {
  it('appends "obsidian" to an array scope, preserving order + members', () => {
    expect(grantObsidianScope('["rhythm"]')).toBe('["rhythm","obsidian"]');
    expect(grantObsidianScope('["rhythm","gmail-work"]')).toBe(
      '["rhythm","gmail-work","obsidian"]',
    );
  });

  it('is idempotent on an array already containing obsidian (returns null = no change)', () => {
    expect(grantObsidianScope('["rhythm","obsidian"]')).toBeNull();
  });

  it('adds an obsidian read/search key to an object-map scope, preserving keys', () => {
    const out = grantObsidianScope('{"rhythm":["rhythm_list_tasks"]}');
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!) as Record<string, string[]>;
    expect(parsed.rhythm).toEqual(['rhythm_list_tasks']); // preserved
    expect(parsed.obsidian).toEqual([...OBSIDIAN_READ_TOOLS]);
    // SAFETY: granted obsidian tools are read/search only — no write/delete.
    for (const t of parsed.obsidian) {
      expect(t).not.toMatch(/put|patch|post|delete|execute/);
    }
  });

  it('is idempotent on an object-map already containing an obsidian key', () => {
    // Preserves the existing (possibly write-bearing) obsidian tool list.
    expect(
      grantObsidianScope('{"obsidian":["obsidian_put_file"]}'),
    ).toBeNull();
  });

  it('leaves a null scope null (unrestricted — already has all servers)', () => {
    expect(grantObsidianScope(null)).toBeNull();
  });

  it('never rewrites a malformed / non-array-non-object value', () => {
    expect(grantObsidianScope('not json')).toBeNull();
    expect(grantObsidianScope('"a string"')).toBeNull();
    expect(grantObsidianScope('42')).toBeNull();
  });
});

describe('backfillObsidianReadScope (real DB)', () => {
  it('grants obsidian to selectable array + object-map scopes; preserves entries; idempotent', () => {
    // NOTE: migrations seed preset rows (claude-code/codex/gemini-cli/opencode),
    // all selectable with NULL scope, plus the Config Doctor profile which is
    // selectable with an explicit empty-array scope ('[]') — array-scoped and
    // selectable, so it IS eligible for this backfill same as any other
    // array-scoped row (see the seed comment in migrations.ts). Use unique
    // ids and assert on our own rows for everything else.
    seed('test-array-agent', '["rhythm"]'); // array, selectable
    seed('test-object-agent', '{"rhythm":["rhythm_list_tasks"],"gmail-work":["search_emails"]}'); // object-map
    seed('test-has-obsidian-array', '["obsidian","rhythm"]'); // already has obsidian (array)
    seed('test-has-obsidian-object', '{"obsidian":["obsidian_put_file"],"rhythm":[]}'); // already has obsidian (object)
    seed('test-null-scope', null); // null scope (unrestricted)
    seed('test-nonselectable', '["rhythm"]', false); // NON-selectable → never touched

    const r = backfillObsidianReadScope();

    expect(r.alreadyDone).toBe(false);
    // test-array-agent + the seeded Config Doctor profile (empty array) are
    // both granted (preset rows have null scope → skipped, never granted).
    expect(r.arrayGranted).toBe(2); // test-array-agent, config-doctor
    expect(r.objectGranted).toBe(1); // test-object-agent

    // test-array-agent: array gained obsidian, rhythm preserved + ordered.
    expect(JSON.parse(repo.getById('test-array-agent')!.allowedMcpsJson!)).toEqual([
      'rhythm',
      'obsidian',
    ]);

    // test-object-agent: object-map gained obsidian read/search; keys preserved.
    const obj = JSON.parse(repo.getById('test-object-agent')!.allowedMcpsJson!) as Record<
      string,
      string[]
    >;
    expect(obj.rhythm).toEqual(['rhythm_list_tasks']);
    expect(obj['gmail-work']).toEqual(['search_emails']);
    expect(obj.obsidian).toEqual([...OBSIDIAN_READ_TOOLS]);

    // already-obsidian rows: existing grants (incl. write tool) untouched.
    expect(repo.getById('test-has-obsidian-array')!.allowedMcpsJson).toBe(
      '["obsidian","rhythm"]',
    );
    expect(repo.getById('test-has-obsidian-object')!.allowedMcpsJson).toBe(
      '{"obsidian":["obsidian_put_file"],"rhythm":[]}',
    );

    // null scope left null; non-selectable never touched.
    expect(repo.getById('test-null-scope')!.allowedMcpsJson).toBeNull();
    expect(repo.getById('test-nonselectable')!.allowedMcpsJson).toBe('["rhythm"]');

    // Preset (migration-seeded) selectable rows have NULL scope → left null.
    expect(repo.getById('claude-code')!.allowedMcpsJson).toBeNull();

    // Idempotent: a real second run short-circuits on the schema_meta marker.
    const r2 = backfillObsidianReadScope();
    expect(r2.alreadyDone).toBe(true);
    expect(r2.examined).toBe(0);

    // …and even forcing the run-once gate open adds nothing (no row gains
    // obsidian a second time).
    const r3 = backfillObsidianReadScope({ alreadyDone: () => false, markDone: () => {} });
    expect(r3.arrayGranted).toBe(0);
    expect(r3.objectGranted).toBe(0);
  });

  it('no-ops under Postgres (agent_configs MCP scopes are local-SQLite-only)', async () => {
    seed('test-array-agent', '["rhythm"]');
    const { env } = await import('../../config/env');
    const orig = env.dbClient;
    (env as { dbClient: string }).dbClient = 'postgres';
    try {
      const r = backfillObsidianReadScope();
      expect(r.alreadyDone).toBe(true);
      expect(r.examined).toBe(0);
      // Untouched.
      expect(repo.getById('test-array-agent')!.allowedMcpsJson).toBe('["rhythm"]');
    } finally {
      (env as { dbClient: string }).dbClient = orig;
    }
  });
});
