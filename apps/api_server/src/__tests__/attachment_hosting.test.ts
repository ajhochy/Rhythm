import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Chat attachments are stored in the media artifact store and referenced from parts_json.

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20_000, 7)]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

let root: string | undefined;

async function setup(projectId: string | null, agentLocal = false) {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', agentLocal ? 'true' : 'false');
  root = mkdtempSync(path.join(tmpdir(), 'rhythm-attachments-'));
  vi.stubEnv('ARTIFACT_STORAGE_ROOT', root);
  vi.stubEnv('RHYTHM_RELAY_URLS', '');
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  const { UsersRepository } = await import('../repositories/users_repository');
  const { AgentSessionsRepository } = await import('../repositories/agent_sessions_repository');
  const user = new UsersRepository().create({ name: 'Owner', email: `owner-${randomUUID()}@example.com` });
  if (projectId) {
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'P', '/tmp/p', ?)`).run(projectId, new Date().toISOString());
  }
  const session = new AgentSessionsRepository().insert({
    agentKind: 'claude-code', cwd: '/tmp/a', name: 'chat', ownerUserId: user.id,
    projectId, taskId: null, taskTitle: null,
  });
  const { AgentSessionMessagesRepository } = await import('../repositories/agent_session_messages_repository');
  const { MediaArtifactStore } = await import('../services/media_artifact_store');
  return { db, sessionId: String(session.id), userId: user.id, messages: new AgentSessionMessagesRepository(), store: new MediaArtifactStore({ db, root }) };
}

function storedParts(db: Database.Database, sessionId: string, sdkMessageId: string) {
  const row = db.prepare(
    `SELECT parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`,
  ).get(sessionId, sdkMessageId) as { parts_json: string };
  return { raw: row.parts_json, parts: JSON.parse(row.parts_json) as Record<string, any>[] };
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('attachment hosting', () => {
  it('moves a read-tool image out of parts_json into a pinned artifact', async () => {
    const { db, sessionId, userId, messages, store } = await setup(null);
    messages.upsertPart(sessionId, 'msg_1', {
      id: 'prt_1', type: 'tool', tool: 'read',
      state: { status: 'completed', output: 'Image read successfully', attachments: [{ type: 'file', mime: 'image/jpeg', url: dataUrl('image/jpeg', jpeg) }] },
    });
    const { raw, parts } = storedParts(db, sessionId, 'msg_1');
    expect(raw).not.toContain(';base64,');
    const ref = parts[0]!.state.attachments[0];
    expect(ref).toMatchObject({ type: 'file', mime: 'image/jpeg', artifactProject: `session:${sessionId}`, size: jpeg.length });
    expect(ref.url).toBe(`/artifacts/${ref.artifactId}`);

    const artifact = await store.findProjectArtifact(ref.artifactId, ref.artifactProject);
    expect(artifact?.pinned).toBe(true);
    expect(await store.canUserAccessArtifact(artifact!, userId)).toBe(true);
    expect(await store.canUserAccessArtifact(artifact!, userId + 1)).toBe(false);
    expect(readFileSync(path.join(root!, artifact!.storageKey))).toEqual(jpeg);
  });

  it('hosts user file parts under the session project; leaves tiny and unsafe types inline', async () => {
    const { db, sessionId, messages } = await setup('proj-1');
    const tiny = dataUrl('image/png', Buffer.alloc(10, 1));
    const svg = dataUrl('image/svg+xml', Buffer.alloc(20_000, 60));
    messages.upsertPart(sessionId, 'msg_2', { id: 'prt_a', type: 'file', mime: 'image/jpeg', filename: 'Chapel.jpg', url: dataUrl('image/jpeg', jpeg) });
    messages.upsertPart(sessionId, 'msg_2', { id: 'prt_b', type: 'file', mime: 'image/png', url: tiny });
    messages.upsertPart(sessionId, 'msg_2', { id: 'prt_c', type: 'file', mime: 'image/svg+xml', url: svg });
    const { parts } = storedParts(db, sessionId, 'msg_2');
    expect(parts[0]).toMatchObject({ filename: 'Chapel.jpg', artifactProject: 'proj-1' });
    expect(parts[0]!.url).toMatch(/^\/artifacts\//);
    expect(parts[1]!.url).toBe(tiny);
    expect(parts[2]!.url).toBe(svg);
  });

  it('dedupes identical bytes to one artifact per session', async () => {
    const { db, sessionId, messages } = await setup(null);
    const part = (id: string) => ({ id, type: 'file', mime: 'image/jpeg', url: dataUrl('image/jpeg', jpeg) });
    messages.upsertPart(sessionId, 'msg_3', part('prt_1'));
    messages.upsertPart(sessionId, 'msg_4', part('prt_2'));
    expect((db.prepare(`SELECT COUNT(*) AS n FROM media_artifacts`).get() as { n: number }).n).toBe(1);
  });

  it('backfills embedded attachments once, then records completion', async () => {
    const { db, sessionId } = await setup(null);
    db.prepare(
      `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
       VALUES (?, 'output', '', '', 'msg_old', ?)`,
    ).run(sessionId, JSON.stringify([
      { id: 'prt_t', type: 'text', text: 'hi' },
      { id: 'prt_r', type: 'tool', tool: 'read', state: { status: 'completed', attachments: [{ type: 'file', mime: 'image/jpeg', url: dataUrl('image/jpeg', jpeg) }] } },
    ]));
    const { backfillHostedAttachments } = await import('../jobs/attachment_backfill_job');
    expect(await backfillHostedAttachments(db)).toEqual({ rewritten: 1 });
    const { raw, parts } = storedParts(db, sessionId, 'msg_old');
    expect(raw).not.toContain(';base64,');
    expect(parts[0]).toEqual({ id: 'prt_t', type: 'text', text: 'hi' });
    expect(parts[1]!.state.attachments[0].url).toMatch(/^\/artifacts\//);
    expect(await backfillHostedAttachments(db)).toBeNull();
  });

  it.each([
    [true, 200],
    [false, 401],
  ])('serves a hosted attachment to the tokenless desktop only under AGENT_LOCAL=%s', async (agentLocal, status) => {
    const { db, sessionId, messages } = await setup(null, agentLocal);
    messages.upsertPart(sessionId, 'msg_5', { id: 'prt_1', type: 'file', mime: 'image/jpeg', url: dataUrl('image/jpeg', jpeg) });
    const ref = storedParts(db, sessionId, 'msg_5').parts[0]!;
    const express = (await import('express')).default;
    const { mediaArtifactsRouter } = await import('../routes/media_artifacts_routes');
    const { errorHandler } = await import('../middleware/error_handler');
    const app = express();
    app.use('/artifacts', mediaArtifactsRouter);
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}${ref.url}`, { headers: { 'X-Rhythm-Project': ref.artifactProject } });
      expect(response.status).toBe(status);
      if (status === 200) expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
    } finally {
      server.close();
    }
  });
});
