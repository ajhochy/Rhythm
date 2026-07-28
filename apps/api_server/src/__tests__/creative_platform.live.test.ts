import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const baseUrl = process.env.RHYTHM_LIVE_BASE_URL ?? 'http://127.0.0.1:4098';
const sandboxDir =
  process.env.RHYTHM_SANDBOX_DIR ?? join(tmpdir(), 'rhythm-dev-sandbox');

async function initializeMcp(command: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    const child = spawn(command, [], {
      env: {
        ...process.env,
        OBSIDIAN_API_KEY: 'rhythm-live-test-placeholder',
        OBSIDIAN_HOST: '127.0.0.1',
        OBSIDIAN_PORT: '27123',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      reject(
        new Error(
          `Timed out waiting for Obsidian MCP initialize response: ${stderr}`,
        ),
      );
    }, 15_000);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const line = output.split('\n').find((candidate) => candidate.trim());
      if (!line || settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Obsidian MCP exited before initialize (${signal ?? code}): ${stderr}`,
        ),
      );
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'rhythm-live-test', version: '1' },
        },
      })}\n`,
    );
  });
}

describe.skipIf(!live)('creative platform live installer', () => {
  it(
    'installs and executes the managed ffmpeg binary through the real approval + API flow',
    async () => {
      const sessionId = `creative-installer-live-${Date.now()}`;
      const first = await fetch(
        `${baseUrl}/creative-platform/media-tools/request-or-start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
      );
      expect(first.status).toBe(202);
      const pending = (await first.json()) as {
        status: string;
        approval: { id: string };
      };
      expect(pending.status).toBe('pending');

      const approval = await fetch(
        `${baseUrl}/agent-approvals/${pending.approval.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: 'approved',
            actor: 'creative-platform-live-test',
          }),
        },
      );
      expect(approval.status).toBe(200);

      const install = await fetch(
        `${baseUrl}/creative-platform/media-tools/request-or-start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
      );
      expect(install.status).toBe(200);
      const result = (await install.json()) as {
        status: string;
        detail: string;
      };
      expect(result, result.detail).toMatchObject({ status: 'installed' });

      const verify = await fetch(
        `${baseUrl}/creative-platform/media-tools/verify`,
        { method: 'POST' },
      );
      expect(verify.status).toBe(200);
      expect((await verify.json()) as { status: string }).toMatchObject({
        status: 'installed',
      });

      const ffmpeg = join(
        sandboxDir,
        'home',
        'Library',
        'Application Support',
        'Rhythm',
        'creative-tools',
        'media-tools',
        'bin',
        'ffmpeg',
      );
      expect(existsSync(ffmpeg)).toBe(true);
      expect(execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' })).toMatch(
        /^ffmpeg version/m,
      );
    },
    180_000,
  );

  it(
    'installs the REST-compatible Obsidian package and completes an MCP initialize handshake',
    async () => {
      const sessionId = `creative-obsidian-live-${Date.now()}`;
      const first = await fetch(
        `${baseUrl}/creative-platform/obsidian/request-or-start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
      );
      expect(first.status).toBe(202);
      const pending = (await first.json()) as {
        status: string;
        approval: { id: string };
      };
      expect(pending.status).toBe('pending');

      const approval = await fetch(
        `${baseUrl}/agent-approvals/${pending.approval.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: 'approved',
            actor: 'creative-platform-live-test',
          }),
        },
      );
      expect(approval.status).toBe(200);

      const install = await fetch(
        `${baseUrl}/creative-platform/obsidian/request-or-start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
      );
      expect(install.status).toBe(200);
      const result = (await install.json()) as {
        status: string;
        detail: string;
      };
      expect(result, result.detail).toMatchObject({ status: 'awaiting-user' });

      const verify = await fetch(
        `${baseUrl}/creative-platform/obsidian/verify`,
        { method: 'POST' },
      );
      expect(verify.status).toBe(200);
      expect((await verify.json()) as { status: string }).not.toMatchObject({
        status: 'missing',
      });

      const command = join(
        sandboxDir,
        'home',
        'Library',
        'Application Support',
        'Rhythm',
        'creative-tools',
        'obsidian',
        '.venv',
        'bin',
        'mcp-obsidian',
      );
      expect(existsSync(command)).toBe(true);
      const initialized = await initializeMcp(command);
      expect(initialized).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          serverInfo: expect.objectContaining({ name: expect.any(String) }),
        },
      });
    },
    180_000,
  );
});

describe.skipIf(!live)('creative platform sandbox fixture', () => {
  it('lists capabilities and rejects a direct unsigned approval request', async () => {
    const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
    if (!dbPath.startsWith('/')) {
      throw new Error('Creative platform live test requires RHYTHM_LIVE_DB_PATH');
    }
    const db = new Database(dbPath);
    const sessionId = randomUUID();
    const sdkSessionId = `sdk-creative-platform-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, created_at, updated_at,
          permission_mode, fast_mode, is_system, delegation_depth,
          category, sdk_session_id)
       VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
    ).run(
      sessionId,
      'creative-media',
      process.cwd(),
      'Creative platform live fixture',
      now,
      now,
      sdkSessionId,
    );
    try {
      const list = await fetch(`${baseUrl}/creative-platform`);
      expect(list.status).toBe(200);
      expect((await list.json()) as unknown[]).toHaveLength(7);
      const forged = await fetch(
        `${baseUrl}/creative-platform/media-tools/request-or-start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runtimeContext: {
              sdkSessionId,
              turnId: 'turn-creative-platform-forged',
              agentName: 'creative-media',
              toolCallId: 'call-creative-platform-forged',
            },
          }),
        },
      );
      expect(forged.status).toBe(403);
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM agent_approvals WHERE session_id = ?',
          )
          .get(sessionId),
      ).toEqual({ count: 0 });
    } finally {
      db.prepare('DELETE FROM agent_approvals WHERE session_id = ?').run(
        sessionId,
      );
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
      db.close();
    }
  });
});
