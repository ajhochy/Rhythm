// Synthetic sources only: no database/config is copied from the operator.
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const file = fileURLToPath(import.meta.url);
const root = resolve(dirname(file), '../..');
const fixture = resolve(process.argv[2] || '/');
if (!fixture.startsWith('/private/tmp/') || realpathSync(dirname(fixture)) !== dirname(fixture)) {
  throw new Error('Choose a new fixture directory directly under a canonical /private/tmp parent');
}
if (process.argv[3] !== '--seed') {
  mkdirSync(fixture, { mode: 0o700 }); // Refuse reuse, including symlinks.
  const require = createRequire(`${root}/apps/api_server/package.json`);
  const child = spawnSync(process.execPath, ['--import', require.resolve('tsx'), file, fixture, '--seed'], {
    cwd: fixture, stdio: 'inherit',
    env: { PATH: process.env.PATH, HOME: fixture, DB_CLIENT: 'sqlite', DB_PATH: `${fixture}/rhythm.db`,
      RHYTHM_OPTIMIZER_MODE: 'shadow', AUTO_PROMOTION_FEATURE_AVAILABLE: 'false' },
  });
  process.exit(child.status ?? 1);
}

const { initDb, getDb } = await import(`${root}/apps/api_server/src/database/db.ts`);
await initDb();
const db = getDb();
db.exec(`
  INSERT INTO users (id, name, email, role, email_notifications_enabled) VALUES
    (1, 'Synthetic Admin', 'admin@example.invalid', 'admin', 0),
    (2, 'Synthetic Member', 'member@example.invalid', 'member', 0);
  INSERT INTO workspaces (id, name, join_code, created_by) VALUES (1, 'Synthetic Workspace', 'E02-FAKE', 1);
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (1, 1, 'admin'), (1, 2, 'member');
  INSERT INTO sessions (token, user_id) VALUES ('e02-synthetic-session-not-a-secret', 1);
  UPDATE agent_scheduled_tasks SET enabled=0;
  UPDATE automation_rules SET enabled=0;
`);
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('journal_mode = DELETE');
db.close();
writeFileSync(`${fixture}/opencode.json`, JSON.stringify({
  mcp: { rhythm: { type: 'local', command: ['node', `${root}/apps/mcp_server/dist/index.js`],
    environment: { RHYTHM_API_URL: 'http://127.0.0.1:4098', RHYTHM_API_TOKEN: 'e02-synthetic-session-not-a-secret' } } },
}, null, 2), { flag: 'wx', mode: 0o400 });
chmodSync(`${fixture}/rhythm.db`, 0o400);
console.log(`Synthetic read-only sources: ${fixture}`);
