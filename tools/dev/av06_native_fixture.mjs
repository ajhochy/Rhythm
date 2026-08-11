// Throwaway AV-06 PCO fixture. Start before sandbox.sh so the API receives its
// localhost base URL at boot. Secrets stay in the mode-0600 env file.
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import Database from 'better-sqlite3';

const [dbPath, envPath, evidencePath] = process.argv.slice(2);
if (!dbPath || !envPath || !evidencePath) throw new Error('usage: db env evidence');
for (let i = 0; i < 300 && !existsSync(dbPath); i++) await new Promise((resolve) => setTimeout(resolve, 100));
if (!existsSync(dbPath)) throw new Error(`sandbox database did not appear: ${dbPath}`);
const db = new Database(dbPath);
const suffix = randomUUID();
const token = randomUUID();
const pcoToken = `av06-${randomUUID()}`;
const userId = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run('AV06 native', `av06-${suffix}@example.test`).lastInsertRowid);
const workspaceId = Number(db.prepare('INSERT INTO workspaces (name,join_code,created_by) VALUES (?,?,?)').run('AV06 native', suffix, userId).lastInsertRowid);
db.prepare('INSERT INTO workspace_members (workspace_id,user_id) VALUES (?,?)').run(workspaceId, userId);
db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, userId);
const now = new Date().toISOString();
db.prepare('INSERT INTO integration_accounts (id,owner_id,provider,external_account_id,status,access_token,token_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), userId, 'planning_center', 'av06-pco', 'connected', pcoToken, 'Bearer', now, now);
let requests = 0;
let correctBearer = false;
let forbiddenPath = false;
const fixture = http.createServer((req, res) => {
  if (req.url === '/_av06/counters') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({requests}));
    return;
  }
  requests++;
  correctBearer ||= req.headers.authorization === `Bearer ${pcoToken}`;
  forbiddenPath ||= /token|state|bundle|worktree/i.test(req.url ?? '');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({data: [{id: 'st-av06', attributes: {name: 'Live Sunday', token: 'not-projected'}}]}));
});
fixture.listen(4199, '127.0.0.1', () => {
  writeFileSync(envPath, `AV06_TOKEN=${token}\nAV06_WORKSPACE_ID=${workspaceId}\n`, {mode: 0o600});
  chmodSync(envPath, 0o600);
});
let cleaning = false;
function cleanup(exitCode = 0) {
  if (cleaning) return;
  cleaning = true;
  let failure;
  try {
    writeFileSync(evidencePath, JSON.stringify({requests, correctBearer, forbiddenPath}) + '\n');
    db.transaction(() => {
      const artifactIds = db.prepare('SELECT id FROM live_artifacts WHERE owner_user_id=? AND workspace_id=?').all(userId, workspaceId).map(({id}) => id);
      if (artifactIds.length) {
        const ids = artifactIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM live_artifact_collaborators WHERE artifact_id IN (${ids})`).run(...artifactIds);
        db.prepare(`DELETE FROM live_artifact_bundle_revisions WHERE artifact_id IN (${ids})`).run(...artifactIds);
        db.prepare(`DELETE FROM live_artifact_state_revisions WHERE artifact_id IN (${ids})`).run(...artifactIds);
      }
      db.prepare('DELETE FROM live_artifacts WHERE owner_user_id=? AND workspace_id=?').run(userId, workspaceId);
      db.prepare('DELETE FROM integration_accounts WHERE owner_id=? AND access_token=?').run(userId, pcoToken);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token=?').run(userId, token);
      db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(workspaceId, userId);
      db.prepare('DELETE FROM workspaces WHERE id=? AND created_by=?').run(workspaceId, userId);
      db.prepare('DELETE FROM users WHERE id=? AND email=?').run(userId, `av06-${suffix}@example.test`);

      const count = (sql, ...params) => db.prepare(sql).get(...params).count;
      if (artifactIds.length && count(`SELECT COUNT(*) AS count FROM live_artifact_collaborators WHERE artifact_id IN (${artifactIds.map(() => '?').join(',')})`, ...artifactIds)) throw new Error('AV06 collaborator cleanup incomplete');
      if (artifactIds.length && count(`SELECT COUNT(*) AS count FROM live_artifact_bundle_revisions WHERE artifact_id IN (${artifactIds.map(() => '?').join(',')})`, ...artifactIds)) throw new Error('AV06 bundle revision cleanup incomplete');
      if (artifactIds.length && count(`SELECT COUNT(*) AS count FROM live_artifact_state_revisions WHERE artifact_id IN (${artifactIds.map(() => '?').join(',')})`, ...artifactIds)) throw new Error('AV06 state revision cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM live_artifacts WHERE owner_user_id=? AND workspace_id=?', userId, workspaceId)) throw new Error('AV06 artifact cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM integration_accounts WHERE owner_id=? OR access_token=?', userId, pcoToken)) throw new Error('AV06 integration cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? OR token=?', userId, token)) throw new Error('AV06 session cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id=? OR user_id=?', workspaceId, userId)) throw new Error('AV06 membership cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM workspaces WHERE id=?', workspaceId)) throw new Error('AV06 workspace cleanup incomplete');
      if (count('SELECT COUNT(*) AS count FROM users WHERE id=? OR email=?', userId, `av06-${suffix}@example.test`)) throw new Error('AV06 user cleanup incomplete');
    })();
  } catch (error) {
    failure = error;
    console.error(error);
  } finally {
    db.close();
    fixture.close(() => process.exit(failure ? 1 : exitCode));
  }
}
process.once('SIGINT', () => cleanup());
process.once('SIGTERM', () => cleanup());
process.once('uncaughtException', (error) => { console.error(error); cleanup(1); });
process.once('unhandledRejection', (error) => { console.error(error); cleanup(1); });
