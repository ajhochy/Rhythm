import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const describeLive = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.RHYTHM_SANDBOX_DB ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

describeLive('issue #1309 live artifact serving', () => {
  const runId = randomUUID();
  const artifactId = randomUUID();
  const sessionId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const userToken = randomUUID();
  const otherUserToken = randomUUID();
  const deviceToken = randomUUID();
  const checksum = createHash('sha256').update('artifact-live-bytes').digest('hex');
  const storageKey = `${checksum.slice(0, 2)}/${checksum}`;
  const artifactBytes = Buffer.from('artifact-live-bytes');
  const projectRoot = join(sandboxDir, `issue-1309-${runId}`, 'project');
  const otherProjectRoot = join(sandboxDir, `issue-1309-${runId}`, 'other-project');
  const storageRoot = join(dirname(dbPath), 'media-artifacts');
  let db: Database.Database;
  let userId = 0;
  let otherUserId = 0;

  beforeAll(() => {
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !baseUrl ||
      /:4001(?:\/|$)/.test(baseUrl) ||
      !dbPath.startsWith('/') ||
      !sandboxDir.startsWith('/') ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error('UNVERIFIED: isolated sandbox URL, DB, and directory are required');
    }

    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(otherProjectRoot, { recursive: true });
    mkdirSync(join(storageRoot, checksum.slice(0, 2)), { recursive: true });
    writeFileSync(join(storageRoot, storageKey), artifactBytes);

    db = new Database(dbPath);
    const now = new Date().toISOString();
    userId = Number(db.prepare(
      `INSERT INTO users (name, email) VALUES (?, ?)`,
    ).run('Issue 1309 Owner', `issue-1309-owner-${runId}@example.test`).lastInsertRowid);
    otherUserId = Number(db.prepare(
      `INSERT INTO users (name, email) VALUES (?, ?)`,
    ).run('Issue 1309 Other', `issue-1309-other-${runId}@example.test`).lastInsertRowid);
    db.prepare(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    ).run(userToken, userId, new Date(Date.now() + 10 * 60_000).toISOString());
    db.prepare(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    ).run(otherUserToken, otherUserId, new Date(Date.now() + 10 * 60_000).toISOString());
    const insertProject = db.prepare(
      `INSERT INTO projects
         (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    );
    insertProject.run(projectId, 'Issue 1309 Project', projectRoot, now);
    insertProject.run(otherProjectId, 'Issue 1309 Other Project', otherProjectRoot, now);
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, project_id, owner_user_id, created_at, updated_at)
       VALUES (?, 'opencode', 'idle', ?, 'Issue 1309 Session', ?, ?, ?, ?)`,
    ).run(sessionId, projectRoot, projectId, userId, now, now);
    db.prepare(
      `INSERT INTO media_artifacts
         (id, project, session, mime, size, checksum, created_at, storage_key, pinned)
       VALUES (?, ?, ?, 'video/mp4', ?, ?, ?, ?, 0)`,
    ).run(artifactId, projectId, sessionId, artifactBytes.length, checksum, now, storageKey);
    db.prepare(
      `INSERT INTO mobile_devices
         (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      randomUUID(),
      `issue-1309-host-${runId}`,
      userId,
      'Issue 1309 iPhone',
      createHash('sha256').update(deviceToken).digest('hex'),
      now,
    );
  });

  afterAll(() => {
    if (db) {
      db.transaction(() => {
        db.prepare('DELETE FROM mobile_devices WHERE user_id IN (?, ?)').run(userId, otherUserId);
        db.prepare('DELETE FROM media_artifacts WHERE id = ?').run(artifactId);
        db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
        db.prepare('DELETE FROM projects WHERE id IN (?, ?)').run(projectId, otherProjectId);
        db.prepare('DELETE FROM sessions WHERE user_id IN (?, ?)').run(userId, otherUserId);
        db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userId, otherUserId);
      })();
      db.close();
    }
    rmSync(join(sandboxDir, `issue-1309-${runId}`), { recursive: true, force: true });
    rmSync(join(storageRoot, storageKey), { force: true });
  });

  it('issue-1309-c4: live authenticated route enforces owner/project scope and byte ranges', async () => {
    const unauthenticated = await fetch(`${baseUrl}/artifacts/${artifactId}`, {
      headers: { 'X-Rhythm-Project': projectId },
    });
    expect(unauthenticated.status).toBe(401);

    const wrongOwner = await fetch(`${baseUrl}/artifacts/${artifactId}`, {
      headers: { Authorization: `Bearer ${otherUserToken}`, 'X-Rhythm-Project': projectId },
    });
    expect(wrongOwner.status).toBe(404);

    const wrongProject = await fetch(`${baseUrl}/artifacts/${artifactId}`, {
      headers: { Authorization: `Bearer ${userToken}`, 'X-Rhythm-Project': otherProjectId },
    });
    expect(wrongProject.status).toBe(404);

    const response = await fetch(`${baseUrl}/artifacts/${artifactId}`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        'X-Rhythm-Project': projectId,
        Range: 'bytes=1-3',
      },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 1-3/${artifactBytes.length}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(artifactBytes.subarray(1, 4));
  });

  it('issue-1309-c8: paired mobile gateway serves the same project-scoped artifact', async () => {
    const response = await fetch(`${baseUrl}/mobile-gateway/artifacts/${artifactId}`, {
      headers: {
        Authorization: `Device ${deviceToken}`,
        'X-Rhythm-Project-ID': projectId,
        Range: 'bytes=0-0',
      },
    });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(artifactBytes.subarray(0, 1));
  });
});
