/**
 * Tests for skill_usage_tracker.countSkillToolUses — the #929 real-usage
 * signal for file-only harvested skills (no #792 sidecar row to increment).
 * Mirrors org_exercised_tools_resolver.test.ts's tool-part insertion pattern
 * (agent_session_messages.parts_json is the same telemetry source).
 *
 * W3 late-review corrective package — countSkillToolUses now joins
 * agent_session_messages to their owning agent_sessions row and only counts a
 * completed skill-tool call when evaluateLearningSessionEligibility (the SAME
 * shared predicate learning_session_eligibility.ts uses for harvest gating)
 * says the session is eligible. These tests seed REAL rows through the actual
 * migrated SQLite schema (runMigrations + real INSERT statements), not mocks,
 * so a schema/column-name drift between this tracker and the eligibility
 * predicate would fail here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { countSkillToolUses } from '../services/skill_usage_tracker';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function skillToolPart(name: string, status = 'completed') {
  return { type: 'tool', id: `part-${name}-${Math.random()}`, tool: 'skill', state: { status, input: { name } } };
}

beforeEach(() => {
  setDb(makeDb());
});

interface SessionOverrides {
  isSystem?: 0 | 1;
  category?: string | null;
  mcpRole?: string | null;
}

/** Insert a parent agent_sessions row so message FK (ON DELETE CASCADE) holds. */
function seedSession(id: string, overrides: SessionOverrides = {}): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, is_system, category, mcp_role)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'usage-test', ?, ?, ?)`,
    )
    .run(
      id,
      overrides.isSystem ?? 0,
      overrides.category === undefined ? 'chat' : overrides.category,
      overrides.mcpRole ?? null,
    );
}

describe('countSkillToolUses', () => {
  it('counts a completed skill-tool invocation, keyed by the invoked skill name', async () => {
    seedSession('sess-1');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-1',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi'), { type: 'text', text: 'done' }]),
      null,
      null,
    );

    const counts = (await countSkillToolUses());
    expect(counts.get('rebuild-abi')).toBe(1);
  });

  it('sums invocations of the same skill across multiple sessions/messages', async () => {
    seedSession('sess-1');
    seedSession('sess-2');
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-1', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-2', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-2', 'msg-2', 'output', JSON.stringify([skillToolPart('other-skill')]), null, null);

    const counts = (await countSkillToolUses());
    expect(counts.get('rebuild-abi')).toBe(2);
    expect(counts.get('other-skill')).toBe(1);
  });

  it('does not count a pending/error skill-tool call (only completed)', async () => {
    seedSession('sess-1');
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-1', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi', 'error')]), null, null);
    repo.upsertStructured('sess-1', 'msg-2', 'output', JSON.stringify([skillToolPart('rebuild-abi', 'pending')]), null, null);

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('ignores non-skill tool parts', async () => {
    seedSession('sess-1');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-1',
      'msg-1',
      'output',
      JSON.stringify([{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } }]),
      null,
      null,
    );

    expect((await countSkillToolUses()).size).toBe(0);
  });

  it('returns an empty map when there are no messages at all', async () => {
    expect((await countSkillToolUses()).size).toBe(0);
  });

  // ── W3 late-review corrective package: eligibility-gated counting ─────────
  // countSkillToolUses must not let internal optimizer/scheduled/system skill
  // invocations advance harvested-draft evaluation thresholds. Every case here
  // seeds a REAL agent_sessions row through the actual migrated schema.

  it('counts a completed skill call from an ordinary user chat session', async () => {
    seedSession('sess-chat', { isSystem: 0, category: 'chat', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-chat',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBe(1);
  });

  it('does NOT count a completed skill call from an is_system=1 session', async () => {
    seedSession('sess-system', { isSystem: 1, category: 'chat', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-system',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a category=self_improvement session', async () => {
    seedSession('sess-self-improve', { isSystem: 0, category: 'self_improvement', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-self-improve',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a category=scheduled session', async () => {
    seedSession('sess-scheduled', { isSystem: 0, category: 'scheduled', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-scheduled',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a curator mcp_role session', async () => {
    seedSession('sess-curator', { isSystem: 0, category: 'chat', mcpRole: 'skill-extract' });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-curator',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a session with corrupt/unknown category metadata', async () => {
    seedSession('sess-corrupt-category', { isSystem: 0, category: 'not_a_real_category', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-corrupt-category',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a session with a corrupt (non-0/1) is_system value', async () => {
    // Realistic corruption: a bad write/migration leaves is_system as neither
    // 0 nor 1. The shared predicate must fail closed rather than treat any
    // truthy/falsy-looking integer as a real boolean.
    seedSession('sess-corrupt-is-system', { isSystem: 0, category: 'chat', mcpRole: null });
    getDb().prepare(`UPDATE agent_sessions SET is_system = 2 WHERE id = ?`).run('sess-corrupt-is-system');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-corrupt-is-system',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('does not count a pending/error skill-tool call from an otherwise-eligible session', async () => {
    seedSession('sess-pending-error', { isSystem: 0, category: 'chat', mcpRole: null });
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured(
      'sess-pending-error',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi', 'error')]),
      null,
      null,
    );
    repo.upsertStructured(
      'sess-pending-error',
      'msg-2',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi', 'pending')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBeUndefined();
  });

  it('counts only the eligible session out of a mix of eligible/ineligible sessions', async () => {
    seedSession('sess-eligible', { isSystem: 0, category: 'chat', mcpRole: null });
    seedSession('sess-system-ineligible', { isSystem: 1, category: 'chat', mcpRole: null });
    seedSession('sess-scheduled-ineligible', { isSystem: 0, category: 'scheduled', mcpRole: null });

    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-eligible', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-eligible', 'msg-2', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured(
      'sess-system-ineligible',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );
    repo.upsertStructured(
      'sess-scheduled-ineligible',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect((await countSkillToolUses()).get('rebuild-abi')).toBe(2);
  });

  it('agent-server-memory-c1: preserves exact counts across malformed rows, same-timestamp edits, and deletes', async () => {
    seedSession('sess-live');
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO agent_session_messages
         (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, created_at)
       VALUES (?, 'output', '', '', ?, ?, '2026-09-15T00:00:00.000Z')`,
    );

    insert.run('sess-live', 'msg-a', JSON.stringify([
      skillToolPart('  rebuild-abi  '),
      skillToolPart('rebuild-abi'),
      skillToolPart('other-skill'),
      null,
      42,
      { type: 'tool', tool: 'skill', state: { status: 'completed', input: { name: '' } } },
    ]));
    insert.run('sess-live', 'msg-malformed', '{not-json');
    insert.run('sess-live', 'msg-object', JSON.stringify({ type: 'tool', tool: 'skill' }));

    expect(Object.fromEntries((await countSkillToolUses()))).toEqual({
      'rebuild-abi': 2,
      'other-skill': 1,
    });

    // Keep created_at unchanged: an implementation must observe data changes,
    // rather than return a timestamp-keyed cached aggregate.
    db.prepare(
      `UPDATE agent_session_messages SET parts_json = ?
       WHERE session_id = 'sess-live' AND sdk_message_id = 'msg-a'`,
    ).run(JSON.stringify([skillToolPart('replacement-skill')]));
    expect(Object.fromEntries((await countSkillToolUses()))).toEqual({ 'replacement-skill': 1 });

    db.prepare(
      `DELETE FROM agent_session_messages
       WHERE session_id = 'sess-live' AND sdk_message_id = 'msg-a'`,
    ).run();
    expect((await countSkillToolUses()).size).toBe(0);
  });

  it('matches JSON.parse last-key-wins semantics for duplicate metadata keys at every nested level', async () => {
    seedSession('sess-duplicates');
    const insert = getDb().prepare(
      `INSERT INTO agent_session_messages
         (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
       VALUES ('sess-duplicates', 'output', '', '', ?, ?)`,
    );

    // Each decisive property is duplicated. JSON.parse keeps its last value,
    // so this part is one completed use of final-name.
    insert.run(
      'duplicate-valid',
      '[{"type":"text","type":"tool","tool":"bash","tool":"skill",' +
        '"state":null,"state":{"status":"pending","status":"completed",' +
        '"input":42,"input":{"name":"old-name","name":"  final-name  "}}}]',
    );

    // The same duplicate shapes in the opposite order must not count: their
    // final values make the part, state, status, input, or name ineligible.
    insert.run(
      'duplicate-invalid',
      '[' +
        '{"type":"tool","type":"text","tool":"skill","state":{"status":"completed","input":{"name":"wrong-type"}}},' +
        '{"type":"tool","tool":"skill","tool":"bash","state":{"status":"completed","input":{"name":"wrong-tool"}}},' +
        '{"type":"tool","tool":"skill","state":{"status":"completed","input":{"name":"wrong-state"}},"state":null},' +
        '{"type":"tool","tool":"skill","state":{"status":"completed","status":"error","input":{"name":"wrong-status"}}},' +
        '{"type":"tool","tool":"skill","state":{"status":"completed","input":{"name":"wrong-input"},"input":42}},' +
        '{"type":"tool","tool":"skill","state":{"status":"completed","input":{"name":"wrong-name","name":42}}}' +
      ']',
    );

    expect(Object.fromEntries((await countSkillToolUses()))).toEqual({ 'final-name': 1 });
  });

  it('reflects owning-session eligibility changes on the next call', async () => {
    seedSession('sess-eligibility-change');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-eligibility-change',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('eligibility-sensitive')]),
      null,
      null,
    );
    const db = getDb();

    expect((await countSkillToolUses()).get('eligibility-sensitive')).toBe(1);

    db.prepare(
      `UPDATE agent_sessions
          SET category = 'scheduled', updated_at = '2026-09-15T00:00:00.000Z'
        WHERE id = 'sess-eligibility-change'`,
    ).run();
    expect((await countSkillToolUses()).get('eligibility-sensitive')).toBeUndefined();

    // Keep the same updated_at while changing eligibility again. This rejects
    // caches keyed only by the owning session's latest timestamp.
    db.prepare(
      `UPDATE agent_sessions
          SET category = 'chat', updated_at = '2026-09-15T00:00:00.000Z'
        WHERE id = 'sess-eligibility-change'`,
    ).run();
    expect((await countSkillToolUses()).get('eligibility-sensitive')).toBe(1);

    db.prepare(
      `UPDATE agent_sessions SET mcp_role = 'skill-extract'
        WHERE id = 'sess-eligibility-change'`,
    ).run();
    expect((await countSkillToolUses()).get('eligibility-sensitive')).toBeUndefined();
  });

  it('agent-server-memory-c2: counts a small live signal under a 128 MB heap beside more than 150 MB of irrelevant archived history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-skill-usage-heap-'));
    const dbPath = join(root, 'fixture.db');
    const fixtureDb = new Database(dbPath);
    try {
      fixtureDb.pragma('journal_mode = OFF');
      fixtureDb.pragma('synchronous = OFF');
      runMigrations(fixtureDb);
      fixtureDb.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, is_system, category, mcp_role)
         VALUES ('live', 'claude-code', 'idle', '/tmp', 'live', 0, 'chat', NULL),
                ('archive', 'claude-code', 'idle', '/tmp', 'archive', 0, 'chat', NULL)`,
      ).run();
      fixtureDb.prepare(
        `UPDATE agent_sessions SET archived_at = '2026-08-01T00:00:00.000Z'
         WHERE id = 'archive'`,
      ).run();
      fixtureDb.prepare(
        `INSERT INTO agent_session_messages
           (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
         VALUES ('live', 'output', '', '', 'live-skill', ?)`,
      ).run(JSON.stringify([skillToolPart('bounded-skill')]));

      // Generate 160 MiB inside SQLite, without first allocating a giant JS
      // string in the Vitest process. These are valid, archived text parts and
      // therefore representative of old transcript history that is irrelevant
      // to skill-use counts.
      fixtureDb.exec(`
        WITH RECURSIVE n(value) AS (
          VALUES(1)
          UNION ALL
          SELECT value + 1 FROM n WHERE value < 40
        )
        INSERT INTO agent_session_messages
          (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
        SELECT 'archive', 'output', '', '', 'archive-' || value,
               '[{"type":"text","text":"' || hex(zeroblob(2097152)) || '"}]'
          FROM n
      `);
    } finally {
      fixtureDb.close();
    }

    try {
      const apiRoot = resolve(__dirname, '../..');
      const tsx = join(apiRoot, 'node_modules', '.bin', 'tsx');
      const child = join(__dirname, 'fixtures', 'skill_usage_tracker_heap_child.ts');
      const result = spawnSync(tsx, [child, dbPath], {
        cwd: apiRoot,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128' },
        encoding: 'utf8',
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      });
      const diagnostics = [
        result.error ? String(result.error) : '',
        result.signal ? `signal=${result.signal}` : '',
        result.stderr,
      ].filter(Boolean).join('\n');

      expect(result.status, diagnostics).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ 'bounded-skill': 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
