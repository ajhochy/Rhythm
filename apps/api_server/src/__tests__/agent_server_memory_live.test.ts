/**
 * Reproduces the production allocation path through the real API and engine.
 * Run only against tools/dev/sandbox.sh with NODE_OPTIONS=--max-old-space-size=256.
 * The old full-history .all() exceeds that heap on this synthetic archive.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const base = process.env.RHYTHM_LIVE_URL ?? '';
const sandbox = process.env.RHYTHM_MEMORY_TEST_SANDBOX ?? '';
const sessionId = `memory-contract-${randomUUID()}`;
const skillName = `memory-contract-${randomUUID()}`;
let db: Database.Database | undefined;
let createdSkill = false;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(60_000),
  });
}

async function uses(): Promise<number> {
  const response = await api('/opencode/skills?withMetadata=true');
  expect(response.status).toBe(200);
  const body = await response.json() as Array<{ name: string; metadata: { uses: number } }>;
  const skill = body.find((entry) => entry.name === skillName);
  expect(skill, 'the real engine must discover the HTTP-created skill').toBeDefined();
  return skill!.metadata.uses;
}

describe.skipIf(!live)('agent server memory: real sandbox API and engine', () => {
  beforeAll(async () => {
    if (process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1') throw new Error('Explicit live isolation is required');
    if (!sandbox.startsWith('/private/tmp/rhythm-') || realpathSync(sandbox) !== sandbox) {
      throw new Error('A canonical dedicated /private/tmp/rhythm-* sandbox is required');
    }
    const url = new URL(base);
    if (url.hostname !== '127.0.0.1' || !url.port || ['4000', '4001', '4096'].includes(url.port)) {
      throw new Error('Only an explicit isolated loopback API port is allowed');
    }
    const pid = readFileSync(join(sandbox, 'api_server.pid'), 'utf8').trim();
    if (!/^\d+$/.test(pid)) throw new Error('Invalid sandbox API PID');
    const command = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' });
    if (!command.includes(`--rhythm-sandbox=${sandbox}`)) throw new Error('API ownership marker mismatch');
    expect((await api('/health')).status).toBe(200);
    const engine = await api('/opencode/health');
    expect(engine.status).toBe(200);

    const created = await api('/opencode/skills', {
      method: 'POST',
      body: JSON.stringify({ name: skillName, description: 'Local memory regression fixture', content: 'Describe one observation from the provided local fixture.' }),
    });
    expect(created.ok).toBe(true);
    createdSkill = true;
    // Harvested drafts are file-only skills; this fixture marks the HTTP-created
    // skill as a draft so the real metadata route exposes its invocation count.
    const skillPath = join(sandbox, 'home', '.config', 'opencode', 'skills', skillName, 'SKILL.md');
    writeFileSync(skillPath, readFileSync(skillPath, 'utf8').replace(/^---\n/, '---\nstatus: draft\n'));
    db = new Database(join(sandbox, 'rhythm.db'), { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.prepare(`INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, is_system, category)
      VALUES (?, 'claude-code', 'idle', ?, 'Memory regression fixture', 0, 'chat')`).run(sessionId, sandbox);
    const positive = JSON.stringify([1, 2].map((id) => ({ type: 'tool', id: `positive-${id}`, tool: 'skill', state: { status: 'completed', input: { name: skillName } } })));
    db.prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, parts_json, sdk_message_id)
      VALUES (?, 'output', '', '', ?, 'memory-positive')`).run(sessionId, positive);
    // SQL constructs the payload so the test runner does not retain it in V8.
    // An individual 130 MiB row also catches merely moving JSON.parse to an iterator.
    const insert = db.prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, parts_json)
      VALUES (?, 'output', '', '', '[{"type":"tool","tool":"bash","state":{"status":"completed","output":"' || replace(hex(zeroblob(?)), '0', 'x') || '"}}]')`);
    db.transaction(() => {
      insert.run(sessionId, 65 * 1024 * 1024);
      for (let i = 0; i < 26; i++) insert.run(sessionId, 4 * 1024 * 1024);
    })();
  }, 90_000);

  afterAll(async () => {
    if (db) {
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
      db.close();
    }
    if (createdSkill) await api(`/opencode/skills/${skillName}`, { method: 'DELETE' }).catch(() => {});
  });

  it('returns exact current counts beside a 338 MiB archive and keeps the same API alive', async () => {
    const pidBefore = readFileSync(join(sandbox, 'api_server.pid'), 'utf8');
    const start = Date.now();
    expect(await uses()).toBe(2);
    expect((await api('/health')).status).toBe(200);
    // Same timestamp/same row changes must be visible on the next HTTP request.
    db!.prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE session_id = ? AND sdk_message_id = 'memory-positive'`)
      .run(JSON.stringify([{ type: 'tool', tool: 'skill', state: { status: 'completed', input: { name: skillName } } }]), sessionId);
    expect(await uses()).toBe(1);
    db!.prepare(`DELETE FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = 'memory-positive'`).run(sessionId);
    expect(await uses()).toBe(0);
    expect((await api('/opencode/health')).status).toBe(200);
    expect(readFileSync(join(sandbox, 'api_server.pid'), 'utf8')).toBe(pidBefore);
    console.log(JSON.stringify({ probe: 'agent-server-memory-live', archiveMiB: 338, requests: 3, elapsedMs: Date.now() - start, pid: pidBefore.trim() }));
  }, 180_000);
});
