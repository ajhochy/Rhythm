// Cold synthetic fixture only; never open an operational database.
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { seedC1Guards } from './sandbox_fixture_c1.mjs';
const file = fileURLToPath(import.meta.url);
const root = resolve(dirname(file), '../..');
const fixture = resolve(process.argv[2] || '/');
if (!fixture.startsWith('/private/tmp/') || realpathSync(dirname(fixture)) !== dirname(fixture)) throw new Error('New canonical /private/tmp fixture required');
if (process.argv[3] !== '--seed') {
  mkdirSync(fixture, { mode: 0o700 });
  const require = createRequire(`${root}/apps/api_server/package.json`);
  const child = spawnSync(process.execPath, ['--import', require.resolve('tsx'), file, fixture, '--seed'], {
    cwd: fixture, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: fixture, DB_CLIENT: 'sqlite', DB_PATH: `${fixture}/rhythm.db`, RHYTHM_OPTIMIZER_MODE: 'shadow', AUTO_PROMOTION_FEATURE_AVAILABLE: 'false' },
  });
  process.exit(child.status ?? 1);
}
const { initDb, getDb } = await import(`${root}/apps/api_server/src/database/db.ts`);
const { MobileDevicesRepository, initializeMobilePairingSchema } = await import(`${root}/apps/api_server/src/repositories/mobile_devices_repository.ts`);
const { MobilePairingService } = await import(`${root}/apps/api_server/src/services/mobile_pairing_service.ts`);
await initDb();
const db = getDb();
db.exec(`INSERT INTO users (id,name,email,role,email_notifications_enabled) VALUES
  (1,'Synthetic Admin','admin@example.invalid','admin',0),(2,'Synthetic Member','member@example.invalid','member',0);
  INSERT INTO workspaces (id,name,join_code,created_by) VALUES (1,'Synthetic Workspace','C1-FAKE',1);
  INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (1,1,'admin'),(1,2,'member');
  INSERT INTO sessions (token,user_id) VALUES ('e02-synthetic-session-not-a-secret',1),('c1-member-synthetic-session-not-a-secret',2);
  UPDATE agent_scheduled_tasks SET enabled=0; UPDATE automation_rules SET enabled=0;`);
seedC1Guards(db);
initializeMobilePairingSchema(db);
const service = new MobilePairingService({ repository: new MobileDevicesRepository(db), hostId: 'synthetic-c1-host' });
const devices = [1, 2].map(userId => {
  const code = service.createPairingCode(userId);
  return service.pair({ pairingCode: code.pairingCode, hostId: code.hostId, deviceName: `Synthetic C1 user ${userId}` });
});
writeFileSync(`${fixture}/devices.json`, JSON.stringify(devices, null, 2), { flag: 'wx', mode: 0o400 });
db.pragma('wal_checkpoint(TRUNCATE)'); db.pragma('journal_mode = DELETE'); db.close();
writeFileSync(`${fixture}/opencode.json`, JSON.stringify({ mcp: { rhythm: { type: 'local', command: ['node', `${root}/apps/mcp_server/dist/index.js`], environment: { RHYTHM_API_URL: 'http://127.0.0.1:4098', RHYTHM_API_TOKEN: 'e02-synthetic-session-not-a-secret' } } } }, null, 2), { flag: 'wx', mode: 0o400 });
chmodSync(`${fixture}/rhythm.db`, 0o400);
console.log(`Synthetic read-only sources and existing-service paired devices: ${fixture}`);
