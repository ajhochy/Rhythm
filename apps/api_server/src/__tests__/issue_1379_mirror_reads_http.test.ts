import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine's ABSENCE is this suite's premise, but a dev Mac running the
// desktop app has a real engine listening on the default 127.0.0.1:4096.
// Pin the proxy to port 1 — binding it needs root on macOS/Linux, so a
// connect always refuses — before any import resolves OPENCODE_ENGINE_PORT
// (a module-level const; vi.hoisted runs ahead of the import graph).
vi.hoisted(() => {
  process.env.RHYTHM_OPENCODE_ENGINE_PORT = '1';
});

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { installHumanApprovalTestCredentials } from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

/**
 * #1379 — behavioral verification over the real HTTP surface.
 *
 * This drives the actual `/mobile-gateway/opencode/*` route the phone calls,
 * through real `Device <token>` auth, real project-scope middleware, and real
 * repositories against a real SQLite database. Only the OpenCode engine is
 * absent — and that absence is the whole point:
 *
 *   The engine is NOT running. Any read that still proxies to :4096 must fail.
 *   Any read served from the mirror must succeed.
 *
 * A negative control (`file.list`, which must always stay live) proves the
 * engine really is unreachable, so a passing transcript read cannot be a
 * coincidence of a warm engine sitting on the port.
 *
 * This is what makes the mirror claim falsifiable: revert the mirror path and
 * the transcript/list/children assertions below fail with 502/504.
 */

const PROJECT_NAME = 'Issue 1379 mirror';

describe('#1379 mirror reads over the real mobile-gateway HTTP route', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let sandboxRoot: string;
  let humanCapabilityHeader: Record<string, string>;
  let projectId: string;
  let deviceToken: string;
  let userId: number;
  let sdkSessionId: string;

  beforeEach(async () => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'rhythm-1379-mirror-'));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));

    const user = new UsersRepository().create({
      name: 'Mirror Owner',
      email: `mirror-${randomUUID()}@example.com`,
    });
    userId = user.id;
    const session = new SessionsRepository().create(user.id);
    const codeResponse = await fetch(
      `${baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
          ...humanCapabilityHeader,
        },
        body: '{}',
      },
    );
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        hostId: code.hostId,
        deviceName: 'Mirror iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    deviceToken = ((await pairResponse.json()) as { deviceToken: string })
      .deviceToken;

    projectId = new ProjectsRepository().insert({
      cwd: sandboxRoot,
      icon: null,
      name: PROJECT_NAME,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;

    // Mirror state, written exactly as the /global/event ingest writes it.
    const sessions = new AgentSessionsRepository();
    const local = sessions.insert({
      agentKind: 'claude-code',
      cwd: sandboxRoot,
      name: 'Mirrored chat',
      ownerUserId: userId,
      projectId,
      taskId: null,
      taskTitle: null,
    });
    sdkSessionId = `ses_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    sessions.setSdkSessionId(local.id, sdkSessionId);

    const messages = new AgentSessionMessagesRepository();
    const sdkMessageId = 'msg_mirror_1';
    messages.upsertPart(local.id, sdkMessageId, {
      id: 'prt_mirror_1',
      type: 'text',
      text: 'served from the mirror with the engine down',
    });
    messages.upsertMessageInfo(
      local.id,
      sdkMessageId,
      'output',
      null,
      null,
      JSON.stringify({
        id: sdkMessageId,
        sessionID: sdkSessionId,
        role: 'assistant',
        modelID: 'claude-opus-5',
        providerID: 'anthropic',
        time: { created: 1_754_000_000_000, completed: 1_754_000_001_000 },
      }),
    );
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  function get(path: string) {
    return fetch(`${baseUrl}/mobile-gateway/opencode${path}`, {
      headers: {
        Authorization: `Device ${deviceToken}`,
        'X-Rhythm-Project-ID': projectId,
      },
    });
  }

  it('negative control: a live-only read fails because the engine is unreachable', async () => {
    const response = await get('/file?path=.');

    expect(
      response.ok,
      'the engine must be DOWN for this suite to prove anything',
    ).toBe(false);
    expect([502, 504]).toContain(response.status);
  });

  it('serves the transcript over HTTP with the engine down', async () => {
    const response = await get(
      `/session/${encodeURIComponent(sdkSessionId)}/message`,
    );

    expect(response.status).toBe(200);
    const records = (await response.json()) as Array<{
      info: Record<string, unknown>;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(records).toHaveLength(1);
    expect(records[0].info.id).toBe('msg_mirror_1');
    expect(records[0].info.modelID).toBe('claude-opus-5');
    expect(records[0].parts[0]).toMatchObject({
      type: 'text',
      text: 'served from the mirror with the engine down',
    });
  });

  it('serves the session list over HTTP with the engine down', async () => {
    const response = await get('/experimental/session');

    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<Record<string, unknown>>;
    expect(items.map((item) => item.id)).toEqual([sdkSessionId]);
    expect(items[0].title).toBe('Mirrored chat');
  });

  it('serves session children over HTTP with the engine down', async () => {
    const response = await get(
      `/session/${encodeURIComponent(sdkSessionId)}/children`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('never exposes the host project path to the phone', async () => {
    const [transcript, list] = await Promise.all([
      get(`/session/${encodeURIComponent(sdkSessionId)}/message`).then((r) =>
        r.text(),
      ),
      get('/experimental/session').then((r) => r.text()),
    ]);

    expect(transcript).not.toContain(sandboxRoot);
    expect(list).not.toContain(sandboxRoot);
  });

  it('rejects an unauthenticated mirror read', async () => {
    const response = await fetch(
      `${baseUrl}/mobile-gateway/opencode/experimental/session`,
      { headers: { 'X-Rhythm-Project-ID': projectId } },
    );

    expect(response.status).toBe(401);
  });

  it('does not serve another project\'s scope for the same device', async () => {
    const otherProjectId = new ProjectsRepository().insert({
      cwd: join(sandboxRoot, 'other'),
      icon: null,
      name: 'Other project',
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;

    const response = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sdkSessionId)}/message`,
      {
        headers: {
          Authorization: `Device ${deviceToken}`,
          'X-Rhythm-Project-ID': otherProjectId,
        },
      },
    );

    // Wrong project: the mirror declines (project_id mismatch) and the live
    // path cannot answer either, so the phone gets no transcript.
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain('served from the mirror');
  });
});
