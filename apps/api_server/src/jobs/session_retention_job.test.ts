import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanOutputRow } from '../services/org_exercised_tools_resolver';
import {
  distillPart, getRetentionState, isRetentionMode, readRetentionSetting, resolveRetentionMode, runSessionRetention,
  sweepSessionRetention, writeRetentionSetting,
} from './session_retention_job';

// Schemas copied read-only from the live ~/.local/share/opencode/opencode.db and
// Rhythm Electron/rhythm.db on 2026-09-29.
const ENGINE_SCHEMA = `
CREATE TABLE \`session\` (
	\`id\` text PRIMARY KEY, \`project_id\` text NOT NULL, \`parent_id\` text, \`slug\` text NOT NULL,
	\`directory\` text NOT NULL, \`title\` text NOT NULL, \`version\` text NOT NULL, \`share_url\` text,
	\`summary_additions\` integer, \`summary_deletions\` integer, \`summary_files\` integer, \`summary_diffs\` text,
	\`revert\` text, \`permission\` text, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL,
	\`time_compacting\` integer, \`time_archived\` integer, \`workspace_id\` text, \`path\` text, \`agent\` text,
	\`model\` text, \`cost\` real DEFAULT 0 NOT NULL, \`tokens_input\` integer DEFAULT 0 NOT NULL,
	\`tokens_output\` integer DEFAULT 0 NOT NULL, \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
	\`tokens_cache_read\` integer DEFAULT 0 NOT NULL, \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
	\`mcp_allowlist\` text, \`skill_allowlist\` text,
	CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
);
CREATE TABLE \`message\` (
	\`id\` text PRIMARY KEY, \`session_id\` text NOT NULL, \`time_created\` integer NOT NULL,
	\`time_updated\` integer NOT NULL, \`data\` text NOT NULL,
	CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
);
CREATE TABLE \`part\` (
	\`id\` text PRIMARY KEY, \`message_id\` text NOT NULL, \`session_id\` text NOT NULL,
	\`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL,
	CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
);
CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);
CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`;

const RHYTHM_SCHEMA = `
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, agent_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting', session_token TEXT, cwd TEXT NOT NULL, name TEXT NOT NULL,
  last_preview TEXT, last_activity_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), task_title TEXT, provider_id TEXT, model_id TEXT,
  agent_mode TEXT, project_id TEXT REFERENCES projects(id), archived_at TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'default', thinking_budget INTEGER, fast_mode INTEGER NOT NULL DEFAULT 0,
  status_message TEXT, sdk_session_id TEXT, mcp_role TEXT, mcp_allowed_tools_json TEXT,
  scheduled_task_id TEXT REFERENCES agent_scheduled_tasks(id) ON DELETE SET NULL,
  parent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL, is_system INTEGER NOT NULL DEFAULT 0,
  anthropic_account_id TEXT, owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delegation_depth INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'chat', worktree_name TEXT,
  worktree_path TEXT, worktree_branch TEXT, profile_id TEXT, approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
  workflow_run_id TEXT, workflow_stage_execution_id TEXT, openai_account_id TEXT);
CREATE TABLE agent_session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, raw_text TEXT NOT NULL, stripped_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sdk_message_id TEXT, parts_json TEXT, tokens_json TEXT, cost REAL, info_json TEXT);
CREATE TABLE agent_async_delegations (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  child_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
  target_agent_config_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'dispatched'
    CHECK (status IN ('dispatched', 'completed', 'waking', 'notified', 'failed', 'cancelled')),
  completion_text TEXT, error_text TEXT, completed_at TEXT, notified_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`;

// Same shape as migrations.ts's org_settings (the retention mode is one row in it).
const ORG_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS org_settings (
  id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;

const NOW = new Date('2026-09-29T12:00:00.000Z');
const DAY = 86_400_000;
const OLD = NOW.getTime() - 40 * DAY;
const RECENT = NOW.getTime() - 5 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();
const sqliteTs = (ms: number) => iso(ms).slice(0, 19).replace('T', ' ');

const BIG = 'x'.repeat(10_000);
const PNG = `data:image/png;base64,${Buffer.alloc(6000, 7).toString('base64')}`;

function toolPart(tool: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id: `prt_${id}`, sessionID: 'ses_a', messageID: 'msg_a', type: 'tool', callID: `call_${id}`, tool,
    state: {
      status: 'completed', input: { command: 'ls', name: tool === 'skill' ? 'tdd' : undefined },
      output: BIG, title: `${tool} title`,
      metadata: { exit: 0, truncated: false, output: BIG, diff: BIG, nested: { a: 1 } },
      time: { start: OLD, end: OLD + 10 },
      attachments: [{ id: 'prt_att', sessionID: 'ses_a', messageID: 'msg_a', type: 'file', mime: 'image/png', url: PNG }],
      ...extra,
    },
  };
}
const textPart = { id: 'prt_t', sessionID: 'ses_a', messageID: 'msg_a', type: 'text', text: BIG };
const stepPart = { id: 'prt_s', sessionID: 'ses_a', messageID: 'msg_a', type: 'step-finish', tokens: { input: 1 }, cost: 0.1 };
const filePart = { id: 'prt_f', sessionID: 'ses_a', messageID: 'msg_a', type: 'file', mime: 'image/png', filename: 'a.png', url: PNG };

let dir: string;
const enginePath = () => path.join(dir, 'opencode.db');
const rhythmPath = () => path.join(dir, 'rhythm.db');
const sha = (p: string) => (fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');

function makeEngine(parts: Array<{ id: string; session: string; created: number; data: unknown }>, sessions: Record<string, number>) {
  const db = new Database(enginePath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // fixtures omit the referenced project/tasks tables
  db.exec(ENGINE_SCHEMA);
  for (const [id, updated] of Object.entries(sessions)) {
    db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
                VALUES (?, 'p', 's', '/', 't', '1', ?, ?)`).run(id, OLD, updated);
    db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, '{}')`).run(`msg_${id}`, id, OLD, OLD);
  }
  for (const p of parts) {
    db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`)
      .run(p.id, `msg_${p.session}`, p.session, p.created, p.created, JSON.stringify(p.data));
  }
  return db;
}

function makeRhythm(
  msgs: Array<{ session: string; created: number; parts: unknown[] }>,
  sessions: Record<string, number>,
) {
  const db = new Database(rhythmPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // fixtures omit the referenced project/tasks tables
  db.exec(RHYTHM_SCHEMA);
  for (const [id, updated] of Object.entries(sessions)) {
    db.prepare(`INSERT INTO agent_sessions (id, agent_kind, cwd, name, last_activity_at, created_at, updated_at, sdk_session_id)
                VALUES (?, 'claude', '/', 'n', ?, ?, ?, ?)`).run(id, iso(updated), iso(OLD), iso(updated), `ses_${id}`);
  }
  for (const m of msgs) {
    db.prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, created_at, sdk_message_id, parts_json)
                VALUES (?, 'output', '', '', ?, 'msg_a', ?)`).run(m.session, sqliteTs(m.created), JSON.stringify(m.parts));
  }
  return db;
}

const partData = (db: Database.Database, id: string) =>
  JSON.parse((db.prepare(`SELECT data FROM part WHERE id = ?`).get(id) as { data: string }).data);
const msgParts = (db: Database.Database, id: number) =>
  JSON.parse((db.prepare(`SELECT parts_json FROM agent_session_messages WHERE id = ?`).get(id) as { parts_json: string }).parts_json);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-retention-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('session retention', () => {
  it('defaults to dry-run and only an exact "on" trims; anything else is dry-run', () => {
    const m = (env: Record<string, string | undefined>, stored: string | null = null) => resolveRetentionMode(env, stored).mode;
    expect(m({})).toBe('dry-run');
    for (const bad of ['yes', 'ON', 'On', ' on', 'on ', 'true', '1', 'enabled', 'dry-run']) {
      expect(m({ RHYTHM_SESSION_RETENTION: bad })).toBe('dry-run');
      expect(m({}, bad)).toBe('dry-run');
    }
    expect(m({ RHYTHM_SESSION_RETENTION: 'on' })).toBe('on');
    expect(m({ RHYTHM_SESSION_RETENTION: 'off' })).toBe('off');
    expect(m({}, 'on')).toBe('on');
    expect(m({}, 'off')).toBe('off');
  });

  it('precedence: explicit env > persisted setting > dry-run default', () => {
    expect(resolveRetentionMode({}, null)).toEqual({ mode: 'dry-run', source: 'default' });
    expect(resolveRetentionMode({ RHYTHM_SESSION_RETENTION: '' }, null)).toEqual({ mode: 'dry-run', source: 'default' });
    expect(resolveRetentionMode({}, 'on')).toEqual({ mode: 'on', source: 'setting' });
    expect(resolveRetentionMode({}, 'off')).toEqual({ mode: 'off', source: 'setting' });
    expect(resolveRetentionMode({ RHYTHM_SESSION_RETENTION: 'off' }, 'on')).toEqual({ mode: 'off', source: 'env' });
    expect(resolveRetentionMode({ RHYTHM_SESSION_RETENTION: 'dry-run' }, 'on')).toEqual({ mode: 'dry-run', source: 'env' });
    expect(resolveRetentionMode({ RHYTHM_SESSION_RETENTION: 'on' }, 'off')).toEqual({ mode: 'on', source: 'env' });
    expect(resolveRetentionMode({ RHYTHM_SESSION_RETENTION: 'bogus' }, 'on')).toEqual({ mode: 'dry-run', source: 'env' });
  });

  it('validates PUT modes to exactly off | dry-run | on', () => {
    for (const ok of ['off', 'dry-run', 'on']) expect(isRetentionMode(ok)).toBe(true);
    for (const bad of ['ON', 'dryrun', 'report', '', null, undefined, 1, true, {}]) expect(isRetentionMode(bad)).toBe(false);
  });

  it('reads the setting at run time: a change applies on the next sweep without a restart', async () => {
    const rhythm = makeRhythm([{ session: 'idle', created: OLD, parts: [toolPart('bash', 'rt1')] }], { idle: OLD });
    rhythm.exec(ORG_SETTINGS_SCHEMA);
    const env = { RHYTHM_SESSION_RETENTION_ENGINE_DB: path.join(dir, 'absent.db') };
    const report = path.join(dir, 'session-retention-report.json');

    // No setting: dry-run report, nothing written.
    expect((await sweepSessionRetention(env, rhythm, rhythmPath(), NOW))?.mode).toBe('dry-run');
    expect(msgParts(rhythm, 1)[0].state.output).toBe(BIG);

    writeRetentionSetting(rhythm, 'off');
    fs.rmSync(report);
    expect(await sweepSessionRetention(env, rhythm, rhythmPath(), NOW)).toBeNull();
    expect(fs.existsSync(report)).toBe(false);

    writeRetentionSetting(rhythm, 'on');
    const on = await sweepSessionRetention(env, rhythm, rhythmPath(), NOW);
    expect(on?.mode).toBe('on');
    expect(on?.rhythm?.written).toBe(1);
    expect(msgParts(rhythm, 1)[0].state.output.length).toBeLessThan(BIG.length);

    // The env var still overrides the stored 'on'.
    writeRetentionSetting(rhythm, 'on');
    expect(await sweepSessionRetention({ ...env, RHYTHM_SESSION_RETENTION: 'off' }, rhythm, rhythmPath(), NOW)).toBeNull();
    rhythm.close();
  });

  it('GET state reports source, the stored value under an env override, and the last report', async () => {
    const rhythm = makeRhythm([{ session: 'idle', created: OLD, parts: [toolPart('bash', 'gs1')] }], { idle: OLD });
    rhythm.exec(ORG_SETTINGS_SCHEMA);
    expect(getRetentionState({}, rhythm, rhythmPath())).toEqual({ mode: 'dry-run', source: 'default', setting: null });
    writeRetentionSetting(rhythm, 'on');
    expect(readRetentionSetting(rhythm)).toBe('on');
    expect(getRetentionState({ RHYTHM_SESSION_RETENTION: 'dry-run' }, rhythm, rhythmPath()))
      .toEqual({ mode: 'dry-run', source: 'env', setting: 'on' });
    writeRetentionSetting(rhythm, 'dry-run');
    await sweepSessionRetention({ RHYTHM_SESSION_RETENTION_ENGINE_DB: path.join(dir, 'absent.db') }, rhythm, rhythmPath(), NOW);
    const state = getRetentionState({}, rhythm, rhythmPath());
    expect(state).toMatchObject({ mode: 'dry-run', source: 'setting', setting: 'dry-run', lastReport: { mode: 'dry-run', rowsWritten: { engine: null, rhythm: 0 } } });
    expect(state.lastReport?.reclaimableBytes.rhythm).toBeGreaterThan(5_000);
    expect(state.lastReport?.reclaimableBytes.engine).toBeNull();
    rhythm.close();
  });

  it('only distills parts that are old AND in a session idle past the cutoff (both stores)', async () => {
    const engine = makeEngine([
      { id: 'prt_old_idle', session: 'ses_idle', created: OLD, data: toolPart('bash', 'e1') },
      { id: 'prt_old_active', session: 'ses_active', created: OLD, data: toolPart('bash', 'e2') },
      { id: 'prt_recent_idle', session: 'ses_idle', created: RECENT, data: toolPart('bash', 'e3') },
    ], { ses_idle: OLD, ses_active: RECENT });
    const rhythm = makeRhythm([
      { session: 'idle', created: OLD, parts: [toolPart('bash', 'r1')] },
      { session: 'active', created: OLD, parts: [toolPart('bash', 'r2')] },
      { session: 'idle', created: RECENT, parts: [toolPart('bash', 'r3')] },
    ], { idle: OLD, active: RECENT });
    const report = await runSessionRetention({ mode: 'on', enginePath: enginePath(), rhythmPath: rhythmPath(), now: NOW });

    expect(report.engine?.written).toBe(1);
    expect(partData(engine, 'prt_old_idle').state.metadata.retentionPruned).toBe('2026-09-29');
    expect(partData(engine, 'prt_old_active').state.output).toBe(BIG);
    expect(partData(engine, 'prt_recent_idle').state.output).toBe(BIG);
    expect(report.rhythm?.written).toBe(1);
    expect(msgParts(rhythm, 1)[0].state.metadata.retentionPruned).toBe('2026-09-29');
    expect(msgParts(rhythm, 2)[0].state.output).toBe(BIG);
    expect(msgParts(rhythm, 3)[0].state.output).toBe(BIG);
    engine.close();
    rhythm.close();
  });

  it('never touches skill calls, text, step parts, pending calls, or session/message metadata', async () => {
    const pending = { ...toolPart('bash', 'p'), state: { status: 'pending', input: {}, raw: BIG } };
    const keep = [toolPart('skill', 'k'), textPart, stepPart, pending];
    const engine = makeEngine(keep.map((d, i) => ({ id: `prt_k${i}`, session: 'ses_idle', created: OLD, data: d })), { ses_idle: OLD });
    const rhythm = makeRhythm([{ session: 'idle', created: OLD, parts: keep }], { idle: OLD });
    const sessionBefore = engine.prepare(`SELECT * FROM session`).all();
    const messageBefore = engine.prepare(`SELECT * FROM message`).all();

    const report = await runSessionRetention({ mode: 'on', enginePath: enginePath(), rhythmPath: rhythmPath(), now: NOW });

    expect(report.engine?.eligibleParts).toBe(0);
    expect(report.rhythm?.eligibleParts).toBe(0);
    keep.forEach((d, i) => expect(partData(engine, `prt_k${i}`)).toEqual(d));
    expect(msgParts(rhythm, 1)).toEqual(keep);
    expect(engine.prepare(`SELECT * FROM session`).all()).toEqual(sessionBefore);
    expect(engine.prepare(`SELECT * FROM message`).all()).toEqual(messageBefore);
    engine.close();
    rhythm.close();
  });

  it('trims to the documented shape and produces zero org-scanner defects', () => {
    const before = toolPart('bash', 'shape', { mcpResult: { isError: false, structuredContent: BIG, _meta: {} } });
    const after = distillPart(before, NOW)!;
    const s = after.state as Record<string, any>;
    expect(s.output.startsWith('x'.repeat(2048))).toBe(true);
    expect(s.output).toBe(`${'x'.repeat(2048)}\n[pruned by retention 2026-09-29; 10000 bytes]`);
    expect(s.metadata).toEqual({ exit: 0, truncated: false, retentionPruned: '2026-09-29' });
    expect(s.attachments).toBeUndefined();
    expect(s.mcpResult).toEqual({ isError: false });
    expect(s.time).toEqual({ start: OLD, end: OLD + 10, compacted: NOW.getTime() });
    for (const k of ['status', 'input', 'title']) expect(s[k]).toEqual((before.state as Record<string, unknown>)[k]);
    for (const k of ['id', 'callID', 'tool', 'sessionID', 'messageID']) expect(after[k]).toBe((before as Record<string, unknown>)[k]);
    expect(distillPart(after, NOW)).toBeNull(); // idempotent

    const errored = { ...toolPart('grep', 'err'), state: { status: 'error', input: {}, error: 'boom', metadata: { big: BIG }, time: { start: OLD, end: OLD } } };
    const erroredAfter = distillPart(errored, NOW)!;
    expect((erroredAfter.state as Record<string, unknown>).error).toBe('boom');

    const rowBefore = [textPart, before, errored, toolPart('skill', 'sk'), stepPart];
    const rowAfter = rowBefore.map((p) => distillPart(p, NOW) ?? p);
    const scanBefore = scanOutputRow(JSON.stringify(rowBefore), 'msg_a');
    const scanAfter = scanOutputRow(JSON.stringify(rowAfter), 'msg_a');
    expect(scanBefore.defectCount).toBe(0);
    expect(scanAfter.defectCount).toBe(0);
    expect(scanAfter.names).toEqual(scanBefore.names);

    const fileAfter = distillPart(filePart, NOW)!;
    const stub = JSON.parse(Buffer.from(String(fileAfter.url).split(',')[1], 'base64').toString());
    const raw = Buffer.from(PNG.split(',')[1], 'base64');
    expect(stub).toMatchObject({ type: 'image/png', size: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
    expect(fileAfter).toMatchObject({ type: 'file', mime: 'text/plain', filename: 'a.png', id: 'prt_f' });
  });

  it('skips a row the engine changed after it was read (both stores)', async () => {
    const engine = makeEngine([
      { id: 'prt_race', session: 'ses_idle', created: OLD, data: toolPart('bash', 'race') },
      { id: 'prt_calm', session: 'ses_idle', created: OLD, data: toolPart('read', 'calm') },
    ], { ses_idle: OLD });
    const rhythm = makeRhythm([
      { session: 'idle', created: OLD, parts: [toolPart('bash', 'race')] },
      { session: 'idle', created: OLD, parts: [toolPart('read', 'calm')] },
    ], { idle: OLD });
    const engineWrite = JSON.stringify({ ...toolPart('bash', 'race'), live: true });
    const rhythmWrite = JSON.stringify([{ ...toolPart('bash', 'race'), live: true }]);

    const report = await runSessionRetention({
      mode: 'on', enginePath: enginePath(), rhythmPath: rhythmPath(), now: NOW,
      afterBatchRead: (store) => {
        if (store === 'engine') engine.prepare(`UPDATE part SET data = ?, time_updated = ? WHERE id = 'prt_race'`).run(engineWrite, OLD + 1);
        else rhythm.prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE id = 1`).run(rhythmWrite);
      },
    });

    expect(report.engine?.skippedConcurrent).toBe(1);
    expect(report.engine?.written).toBe(1);
    expect(partData(engine, 'prt_race')).toEqual(JSON.parse(engineWrite));
    expect(partData(engine, 'prt_calm').state.metadata.retentionPruned).toBe('2026-09-29');
    expect(report.rhythm?.skippedConcurrent).toBe(1);
    expect(report.rhythm?.written).toBe(1);
    expect(msgParts(rhythm, 1)).toEqual(JSON.parse(rhythmWrite));
    engine.close();
    rhythm.close();
  });

  it('dry-run writes nothing: both DB files and WALs are byte-identical, and a report is produced', async () => {
    const engine = makeEngine([
      { id: 'prt_1', session: 'ses_idle', created: OLD, data: toolPart('read', 'd1') },
      { id: 'prt_2', session: 'ses_idle', created: OLD, data: filePart },
    ], { ses_idle: OLD });
    const rhythm = makeRhythm([{ session: 'idle', created: OLD, parts: [toolPart('bash', 'd2'), toolPart('skill', 'd3')] }], { idle: OLD });
    engine.pragma('wal_checkpoint(TRUNCATE)');
    rhythm.pragma('wal_checkpoint(TRUNCATE)');
    const files = ['opencode.db', 'opencode.db-wal', 'rhythm.db', 'rhythm.db-wal'].map((f) => path.join(dir, f));
    const before = files.map(sha);

    const report = await runSessionRetention({ mode: 'dry-run', enginePath: enginePath(), rhythmPath: rhythmPath(), now: NOW });

    expect(files.map(sha)).toEqual(before);
    expect(report.engine?.eligibleRows).toBe(2);
    expect(report.engine?.byTool.read.parts).toBe(1);
    expect(report.engine?.byTool.file.parts).toBe(1);
    expect(report.engine?.bytesReclaimable).toBeGreaterThan(10_000);
    expect(report.engine?.written).toBe(0);
    expect(report.rhythm?.eligibleParts).toBe(1);
    expect(report.rhythm?.newScannerDefects).toBe(0);
    expect(report.rhythm?.written).toBe(0);
    expect(report.rhythm?.oldestEligible).toBe(iso(OLD).slice(0, 19) + '.000Z');
    expect(report.engine?.samples[0].after).toMatchObject({ type: 'tool', tool: 'read', attachments: undefined });
    expect(partData(engine, 'prt_1').state.output).toBe(BIG);
    engine.close();
    rhythm.close();
  });

  it('works in ~batchSize windows with a yield between them, and a second run is a no-op', async () => {
    const parts = Array.from({ length: 7 }, (_, i) => ({ id: `prt_b${i}`, session: 'ses_idle', created: OLD, data: toolPart('bash', `b${i}`) }));
    const engine = makeEngine(parts, { ses_idle: OLD });
    const batches: number[] = [];
    let yielded = 0;
    const counter = setInterval(() => { yielded += 1; }, 0);
    const report = await runSessionRetention({
      mode: 'on', enginePath: enginePath(), now: NOW, batchSize: 3,
      afterBatchRead: (_store, ids) => batches.push(ids.length),
    });
    clearInterval(counter);
    expect(batches).toEqual([3, 3, 1]);
    expect(report.engine?.batches).toBe(3);
    expect(report.engine?.written).toBe(7);
    expect(yielded).toBeGreaterThan(0);
    const again = await runSessionRetention({ mode: 'on', enginePath: enginePath(), now: NOW, batchSize: 3 });
    expect(again.engine?.eligibleRows).toBe(0);
    engine.close();
  });

  it('skips sessions with a live async delegation', async () => {
    const engine = makeEngine([{ id: 'prt_d', session: 'ses_child', created: OLD, data: toolPart('bash', 'd') }], { ses_child: OLD });
    const rhythm = makeRhythm([{ session: 'child', created: OLD, parts: [toolPart('bash', 'd')] }], { parent: OLD, child: OLD });
    rhythm.prepare(`INSERT INTO agent_async_delegations VALUES ('d1', 'parent', 'child', 'cfg', 'dispatched', NULL, NULL, NULL, NULL, ?, ?)`).run(iso(OLD), iso(OLD));
    const report = await runSessionRetention({ mode: 'on', enginePath: enginePath(), rhythmPath: rhythmPath(), now: NOW });
    expect(report.engine?.written).toBe(0);
    expect(report.rhythm?.written).toBe(0);
    engine.close();
    rhythm.close();
  });
});
