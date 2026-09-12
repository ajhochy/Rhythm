import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
const Database = createRequire(import.meta.url)('better-sqlite3');

test('E43: SQLite backup preserves rows, disables copied schedules, and never overwrites', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rhythm-e43-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'source.db'), targetPath = join(dir, 'target', 'rhythm.db'), receiptPath = join(dir, 'target', 'migration-receipt.json');
  const source = new Database(sourcePath); source.exec("CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE scheduled_agent_tasks (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL); INSERT INTO agent_sessions VALUES ('session-1', 'Preserved'); INSERT INTO scheduled_agent_tasks VALUES ('schedule-1', 1);"); source.close();
  const script = new URL('../../api_server/scripts/migrate_desktop_db.mjs', import.meta.url);
  const first = spawnSync(process.execPath, [script.pathname, sourcePath, targetPath, receiptPath], { encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr);
  const target = new Database(targetPath, { readonly: true }); assert.deepEqual(target.prepare('SELECT * FROM agent_sessions').get(), { id: 'session-1', name: 'Preserved' }); assert.equal(target.prepare('SELECT enabled FROM scheduled_agent_tasks').get().enabled, 0); target.close();
  const sourceAgain = new Database(sourcePath, { readonly: true }); assert.equal(sourceAgain.prepare('SELECT enabled FROM scheduled_agent_tasks').get().enabled, 1); sourceAgain.close();
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); assert.equal(receipt.counts.agent_sessions, 1); assert.equal(receipt.schedulesRequireReview, true);
  const second = spawnSync(process.execPath, [script.pathname, sourcePath, targetPath, receiptPath], { encoding: 'utf8' }); assert.notEqual(second.status, 0); assert.match(second.stderr, /destination already exists/i);
});
