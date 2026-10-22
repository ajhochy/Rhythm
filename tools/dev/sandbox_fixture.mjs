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
  const child = spawnSync(process.execPath, ['--import', require.resolve('tsx'), file, fixture, '--seed', ...process.argv.slice(3)], {
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
if (process.argv.includes('--c1')) {
  const { seedC1Guards } = await import('./sandbox_fixture_c1.mjs');
  seedC1Guards(db);
}
if (process.argv.includes('--web-host')) {
  db.exec(`INSERT INTO agent_configs
    (id,label,icon,command,enabled,is_agent,session_selectable,oc_agent,
     model_provider,model_id,allowed_mcps_json,allowed_skills_json,allowed_delegates_json,core_permissions_json)
    VALUES ('local-lean','Synthetic local lean','flask','',1,1,1,'build',
      'web-scripted','s0-local','[]','[]','[]','{"*":"deny"}')`);
}
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('journal_mode = DELETE');
db.close();
writeFileSync(`${fixture}/opencode.json`, JSON.stringify({
  ...(process.argv.includes('--web-host') ? {
    provider: { 'web-scripted': { npm: '@ai-sdk/openai-compatible', name: 'Scripted loopback only',
      options: { baseURL: 'http://127.0.0.1:6996/v1', apiKey: 's0-local-synthetic-key' },
      models: { 's0-local': { name: 'Synthetic local' } } } },
  } : {}),
  mcp: { rhythm: { type: 'local', command: ['node', `${root}/apps/mcp_server/dist/index.js`],
    environment: { RHYTHM_API_URL: 'http://127.0.0.1:4098', RHYTHM_API_TOKEN: 'e02-synthetic-session-not-a-secret' } } },
}, null, 2), { flag: 'wx', mode: 0o400 });
chmodSync(`${fixture}/rhythm.db`, 0o400);
if (process.argv.includes('--web-host')) {
  // Model resolution reads the auth store, not provider.options.apiKey. Synthetic only.
  writeFileSync(`${fixture}/auth.json`, JSON.stringify({ 'web-scripted': { type: 'api', key: 's0-local-synthetic-key' } }), { flag: 'wx', mode: 0o400 });
}
console.log(`Synthetic read-only sources: ${fixture}`);
