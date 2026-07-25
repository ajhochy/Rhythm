import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const fixturePort = 56174;
const providerId = 'e2e-anthropic-1174';
const modelId = 'claude-parity-fixture';

type SessionMessage = {
  info: { id: string; role: string };
  parts: Array<{
    id: string;
    sessionID: string;
    messageID: string;
    type: string;
    text?: string;
    synthetic?: boolean;
  }>;
};

function anthropicSuccessStream(): string {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_issue_1174_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: modelId,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 5,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Parity fixture accepted.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
    { type: 'message_stop' },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

function createOpenCodeMessageId(): string {
  const encodedTimestamp = (
    BigInt(Date.now()) * BigInt(0x1000)
    + BigInt(1)
  ) & BigInt('0xffffffffffff');
  return `msg_${encodedTimestamp.toString(16).padStart(12, '0')}${randomUUID().replaceAll('-', '').slice(0, 14)}`;
}

async function poll<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
  contentType = false,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function gatewayRequest(
  deviceToken: string,
  projectId: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch(`${baseUrl}/mobile-gateway/opencode${path}`, {
    ...init,
    headers: {
      ...gatewayHeaders(
        deviceToken,
        projectId,
        init.body !== undefined,
      ),
      ...init.headers,
    },
  });
}

describeLive('live E2E — issue #1174 mobile OpenCode parity', () => {
  it('issue-1174-live: real gateway exposes approved parity surfaces and blocks alternate-only routes', async () => {
    if (
      baseUrl !== 'http://127.0.0.1:54174' ||
      engineUrl !== 'http://127.0.0.1:55174'
    ) {
      throw new Error(
        'Issue #1174 live test requires sandbox API 127.0.0.1:54174 and engine 127.0.0.1:55174',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/')
    ) {
      throw new Error(
        'Issue #1174 live test requires an attested absolute sandbox and DB path',
      );
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1174 live test refuses any non-sandbox or installed-app database',
      );
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const boundary = join(sandboxDir, `issue-1174-${runId}`);
    const projectRoot = join(boundary, 'project');
    const fileName = 'mobile-parity-proof.txt';
    const marker = `MOBILE-PARITY-${runId}`;
    const genuinePrompt = `Genuine user message ${marker}`;
    const configPath = join(
      sandboxDir,
      'home',
      '.config',
      'opencode',
      'opencode.json',
    );
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, fileName), `${marker}\n`);

    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken: string | null = null;
    let engineSessionId: string | null = null;
    let ptyId: string | null = null;
    let fixtureServer: Server | null = null;
    let originalConfig: string | null = null;
    let fixtureRequests = 0;
    try {
      fixtureServer = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          fixtureRequests += 1;
          JSON.parse(Buffer.concat(chunks).toString('utf8'));
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end(anthropicSuccessStream());
        });
      });
      await new Promise<void>((resolveListen, rejectListen) => {
        fixtureServer?.once('error', rejectListen);
        fixtureServer?.listen(fixturePort, '127.0.0.1', resolveListen);
      });

      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1174 User',
          `issue-1174-${runId}@example.com`,
          `issue-1174-${runId}`,
        ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        userToken,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(projectId, 'Issue 1174 Live', projectRoot, new Date().toISOString());

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as { pairingCode: string };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          deviceName: 'Issue 1174 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const search = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/find?pattern=${encodeURIComponent(marker)}`,
      );
      expect(search.status).toBe(200);
      expect(JSON.stringify(await search.json())).toContain(fileName);

      const currentProject = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/project/current',
      );
      expect(currentProject.status).toBe(200);
      const engineProject = (await currentProject.json()) as {
        id: string;
        name: string;
        worktree: string;
        vcs?: string;
      };
      expect(engineProject.id).toBeTruthy();

      const initializedGit = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/project/git/init',
        { method: 'POST', body: '{}' },
      );
      expect(initializedGit.status).toBe(200);
      const initializedProject = await initializedGit.json() as {
        id: string;
        worktree: string;
        vcs?: string;
      };
      expect(initializedProject).toMatchObject({
        worktree: realpathSync(projectRoot),
        vcs: 'git',
      });

      const renamedProject = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/project/${encodeURIComponent(initializedProject.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Issue 1174 renamed live' }),
        },
      );
      expect(renamedProject.status).toBe(200);
      expect(await renamedProject.json()).toMatchObject({
        id: initializedProject.id,
        name: 'Issue 1174 renamed live',
      });

      const vcsStatus = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/vcs/status',
      );
      expect(vcsStatus.status).toBe(200);
      expect(JSON.stringify(await vcsStatus.json())).toContain(fileName);

      const createdPty = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/pty',
        {
          method: 'POST',
          body: JSON.stringify({
            command: '/bin/sh',
            args: [
              '-c',
              'sleep 1; stty size > pty-size.txt; sleep 5',
            ],
            title: 'Issue 1174 resize',
          }),
        },
      );
      expect(
        createdPty.status,
        `PTY create response: ${await createdPty.clone().text()}`,
      ).toBe(200);
      const pty = (await createdPty.json()) as {
        id: string;
        title: string;
        cwd: string;
      };
      ptyId = pty.id;
      expect(pty).toMatchObject({
        title: 'Issue 1174 resize',
        cwd: realpathSync(projectRoot),
      });

      const resizedPty = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/pty/${encodeURIComponent(pty.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            title: 'Issue 1174 resized live',
            size: { rows: 32, cols: 120 },
          }),
        },
      );
      expect(resizedPty.status).toBe(200);
      expect(await resizedPty.json()).toMatchObject({
        id: pty.id,
        title: 'Issue 1174 resized live',
      });
      await poll(
        async () => {
          const contentResponse = await gatewayRequest(
            paired.deviceToken,
            projectId,
            `/file/content?path=${encodeURIComponent('pty-size.txt')}`,
          );
          if (!contentResponse.ok) {
            throw new Error(`PTY size proof returned ${contentResponse.status}`);
          }
          const content = (await contentResponse.json()) as {
            type: string;
            content: string;
          };
          expect(content.type).toBe('text');
          expect(content.content.trim()).toBe('32 120');
          return content;
        },
        10_000,
        'PTY resize proof',
      );

      const skills = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/skill',
      );
      expect(skills.status).toBe(200);
      expect(await skills.json()).toEqual(expect.any(Array));

      const skillReload = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/skill/reload',
        { method: 'POST', body: '{}' },
      );
      expect(skillReload.status).toBe(200);
      expect(await skillReload.json()).toEqual(expect.any(Array));

      originalConfig = readFileSync(configPath, 'utf8');
      const config = JSON.parse(originalConfig) as {
        provider?: Record<string, unknown>;
      };
      config.provider = config.provider ?? {};
      config.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: 'Issue 1174 Anthropic fixture',
        options: {
          apiKey: 'issue-1174-fixture-key',
          baseURL: `http://127.0.0.1:${fixturePort}/v1`,
        },
        models: {
          [modelId]: {
            name: 'Issue 1174 parity fixture',
            limit: { context: 200000, output: 4096 },
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

      const configReload = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/config/reload',
        { method: 'POST', body: '{}' },
      );
      expect(configReload.status).toBe(200);
      expect(await configReload.json()).toBe(true);

      for (const {
        path,
        validate,
      } of [
        {
          path: '/global/config',
          validate: (value: unknown) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        },
        {
          path: '/experimental/resource',
          validate: (value: unknown) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        },
        {
          path: '/experimental/tool/ids',
          validate: (value: unknown) => Array.isArray(value),
        },
      ]) {
        const inspection = await gatewayRequest(
          paired.deviceToken,
          projectId,
          path,
        );
        const inspectionBody = await inspection.json();
        expect(
          inspection.status,
          `${path} response: ${JSON.stringify(inspectionBody)}`,
        ).toBe(200);
        expect(
          validate(inspectionBody),
          `${path} returned an unexpected shape: ${JSON.stringify(inspectionBody)}`,
        ).toBe(true);
      }

      const created = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/session',
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Issue 1174 live parity' }),
        },
      );
      expect(created.status).toBe(200);
      const session = (await created.json()) as { id: string };
      expect(session.id).toBeTruthy();
      engineSessionId = session.id;

      const children = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/children`,
      );
      expect(children.status).toBe(200);
      expect(await children.json()).toEqual([]);

      const shell = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/shell`,
        {
          method: 'POST',
          body: JSON.stringify({
            agent: 'build',
            model: {
              providerID: 'openai',
              modelID: 'gpt-4.1-mini',
            },
            command: `printf '${marker}'`,
          }),
        },
      );
      expect(
        shell.status,
        `shell response: ${await shell.clone().text()}`,
      ).toBe(200);
      expect(JSON.stringify(await shell.json())).toContain(marker);

      const prompted = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/prompt_async`,
        {
          method: 'POST',
          body: JSON.stringify({
            agent: 'build',
            model: {
              providerID: providerId,
              modelID: modelId,
            },
            parts: [{ type: 'text', text: genuinePrompt }],
          }),
        },
      );
      expect(prompted.status).toBe(204);

      const genuine = await poll(
        async () => {
          const transcript = await gatewayRequest(
            paired.deviceToken,
            projectId,
            `/session/${encodeURIComponent(session.id)}/message`,
          );
          expect(transcript.status).toBe(200);
          const messages = (await transcript.json()) as SessionMessage[];
          const editable = messages.find(({ info, parts }) =>
            info.role === 'user' && parts.some((part) => (
              part.type === 'text'
              && part.synthetic !== true
              && part.text === genuinePrompt
            )),
          );
          const textPart = editable?.parts.find((part) => (
            part.type === 'text'
            && part.synthetic !== true
            && part.text === genuinePrompt
          ));
          const assistantAccepted = messages.some(({ info, parts }) =>
            info.role === 'assistant' && parts.some((part) => (
              part.type === 'text'
              && part.text?.includes('Parity fixture accepted.')
            )),
          );
          if (!editable || !textPart || !assistantAccepted) {
            throw new Error('genuine prompt turn has not completed');
          }
          return { editable, textPart };
        },
        30_000,
        'genuine user prompt',
      );
      await poll(
        async () => {
          const statusResponse = await gatewayRequest(
            paired.deviceToken,
            projectId,
            '/session/status',
          );
          expect(statusResponse.status).toBe(200);
          const statuses = await statusResponse.json() as Record<
            string,
            { type: string }
          >;
          expect(statuses[session.id]?.type ?? 'idle').toBe('idle');
          return statuses[session.id];
        },
        30_000,
        'genuine prompt idle state',
      );

      const initializedSession = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/init`,
        {
          method: 'POST',
          body: JSON.stringify({
            providerID: providerId,
            modelID: modelId,
            messageID: createOpenCodeMessageId(),
          }),
        },
      );
      expect(
        initializedSession.status,
        `session init response: ${await initializedSession.clone().text()}`,
      ).toBe(200);
      expect(await initializedSession.json()).toBe(true);
      await poll(
        async () => {
          const transcript = await gatewayRequest(
            paired.deviceToken,
            projectId,
            `/session/${encodeURIComponent(session.id)}/message`,
          );
          const messages = (await transcript.json()) as SessionMessage[];
          const acceptedResponses = messages.filter(({ info, parts }) =>
            info.role === 'assistant' && parts.some((part) => (
              part.type === 'text'
              && part.text?.includes('Parity fixture accepted.')
            )),
          );
          expect(acceptedResponses.length).toBeGreaterThanOrEqual(2);
          expect(fixtureRequests).toBeGreaterThanOrEqual(2);
          return acceptedResponses;
        },
        30_000,
        'session initialization response',
      );

      const editedText = `Edited from mobile parity ${runId}`;
      const updatedPart = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(genuine.editable.info.id)}/part/${encodeURIComponent(genuine.textPart.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...genuine.textPart, text: editedText }),
        },
      );
      expect(updatedPart.status).toBe(200);
      expect(await updatedPart.json()).toMatchObject({ text: editedText });

      const deletedPart = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(genuine.editable.info.id)}/part/${encodeURIComponent(genuine.textPart.id)}`,
        { method: 'DELETE' },
      );
      expect(deletedPart.status).toBe(200);
      expect(await deletedPart.json()).toBe(true);

      const deletedMessage = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(genuine.editable.info.id)}`,
        { method: 'DELETE' },
      );
      expect(deletedMessage.status).toBe(200);
      expect(await deletedMessage.json()).toBe(true);

      const deniedOperations = [
        { method: 'GET', path: '/config/providers' },
        { method: 'POST', path: '/mcp/fake/auth/authenticate' },
        {
          method: 'POST',
          path: `/session/${encodeURIComponent(session.id)}/permissions/fake`,
        },
        {
          method: 'GET',
          path: `/session/${encodeURIComponent(session.id)}`,
        },
        {
          method: 'GET',
          path: `/session/${encodeURIComponent(session.id)}/message/fake`,
        },
        {
          method: 'POST',
          path: `/session/${encodeURIComponent(session.id)}/message`,
        },
      ];
      for (const operation of deniedOperations) {
        const denied = await gatewayRequest(
          paired.deviceToken,
          projectId,
          operation.path,
          {
            method: operation.method,
            ...(operation.method === 'POST' ? { body: '{}' } : {}),
          },
        );
        expect(
          denied.status,
          `${operation.method} ${operation.path}`,
        ).toBe(403);
        expect(await denied.json()).toMatchObject({
          error: { code: 'OPERATION_NOT_ALLOWED' },
        });
      }
    } finally {
      if (ptyId && deviceToken) {
        await gatewayRequest(
          deviceToken,
          projectId,
          `/pty/${encodeURIComponent(ptyId)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (engineSessionId) {
        await gatewayRequest(
          deviceToken ?? '',
          projectId,
          `/session/${encodeURIComponent(engineSessionId)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (originalConfig !== null) {
        writeFileSync(configPath, originalConfig, 'utf8');
        if (deviceToken) {
          await gatewayRequest(
            deviceToken,
            projectId,
            '/config/reload',
            { method: 'POST', body: '{}' },
          ).catch(() => undefined);
        }
      }
      if (fixtureServer?.listening) {
        await new Promise<void>((resolveClose) => {
          fixtureServer?.close(() => resolveClose());
        });
      }
      if (deviceId !== null) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      db.prepare(
        `DELETE FROM mobile_pairing_codes
         WHERE user_id = ?`,
      ).run(userId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
      if (dirname(boundary) === resolve(sandboxDir)) {
        rmSync(boundary, { recursive: true, force: true });
      }
    }
  }, 90_000);
});
