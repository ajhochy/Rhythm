import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const serverLogPath = process.env.RHYTHM_LIVE_SERVER_LOG ?? '';
const cloudToken = process.env.RHYTHM_LIVE_CLOUD_TOKEN ?? '';
const projectCwd = process.env.RHYTHM_LIVE_PROJECT_CWD ?? '';

describeLive('local agent Cloud bearer live desktop sequence', () => {
  it('local-agent-cloud-token-auth-c11: Cloud-only bearer drives list, create, detail, todo, provenance, and VCS through the real API', async () => {
    const resolvedDbPath = resolve(dbPath);
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !/^http:\/\/127\.0\.0\.1:(?!4001$)\d{4,5}$/.test(baseUrl) ||
      (
        !resolvedDbPath.startsWith('/private/tmp/') &&
        !resolvedDbPath.startsWith('/tmp/')
      ) ||
      dbPath.includes('/Library/Application Support/Rhythm/') ||
      cloudToken.length < 16 ||
      !projectCwd.startsWith('/')
    ) {
      throw new Error(
        'Live Cloud auth test requires an attested isolated API/DB, a Cloud bearer, and an absolute throwaway project cwd',
      );
    }

    const db = new Database(dbPath, { readonly: true });
    const localPrecondition = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?')
      .get(cloudToken) as { count: number };
    db.close();
    expect(localPrecondition.count).toBe(0);

    const headers = {
      Authorization: `Bearer ${cloudToken}`,
      'Content-Type': 'application/json',
    };
    let createdId: string | null = null;
    try {
      const initialList = await fetch(`${baseUrl}/agent-sessions?scope=chats`, {
        headers,
      });
      expect(initialList.status).toBe(200);

      const created = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId: null,
          cwd: projectCwd,
          name: 'Cloud auth live contract',
        }),
      });
      expect(created.status).toBe(201);
      createdId = ((await created.json()) as { id: string }).id;

      const fanoutPaths = [
        `/agent-sessions/${createdId}`,
        `/agent-sessions/${createdId}/todo`,
        `/agent-sessions/${createdId}/memory-provenance`,
        `/agent-sessions/${createdId}/vcs`,
        `/agent-sessions/${createdId}/vcs/status`,
        '/agent-sessions/agents',
        '/agent-sessions?scope=chats',
      ];
      for (let index = 0; index < 21; index += 1) {
        const response = await fetch(
          `${baseUrl}${fanoutPaths[index % fanoutPaths.length]}`,
          { headers },
        );
        expect(response.status).toBe(200);
      }

      const ownerDb = new Database(dbPath, { readonly: true });
      const owner = ownerDb
        .prepare('SELECT owner_user_id FROM agent_sessions WHERE id = ?')
        .get(createdId) as { owner_user_id: number | null } | undefined;
      ownerDb.close();
      expect(owner?.owner_user_id).toEqual(expect.any(Number));

      if (serverLogPath) {
        const logs = readFileSync(serverLogPath, 'utf8');
        expect(logs).not.toContain(cloudToken);
      }
    } finally {
      if (createdId) {
        await fetch(`${baseUrl}/agent-sessions/${createdId}/hard`, {
          method: 'DELETE',
          headers,
        }).catch(() => undefined);
      }
    }
  });
});
