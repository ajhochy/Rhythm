import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { liveEnvironment } from '../live-environment';

const { apiBase, engineBase, wsBase } = liveEnvironment();
const providerPort = 1234;
const vitePort = 4175;
const dbPath = process.env.RHYTHM_LIVE_DB_PATH;
const live = process.env.RHYTHM_LIVE_E2E === '1';
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));

test.skip(!live, 'requires RHYTHM_LIVE_E2E=1');
test.use({ bypassCSP: true });
test.setTimeout(600_000);

type Db = {
  prepare(sql: string): {
    get(...values: unknown[]): Record<string, unknown> | undefined;
    run(...values: unknown[]): { lastInsertRowid: number };
  };
  close(): void;
};

type Profile = {
  id: string;
  label: string;
  enabled: boolean;
  locked?: boolean;
  sessionSelectable?: boolean;
  modelProvider: string | null;
  modelId: string | null;
  ocAgent: string | null;
};

type SessionResponse = {
  id?: string;
  sdkSessionId?: string;
  sessionToken?: string;
  profileId?: string;
  agentKind?: string;
  opencodeAgentId?: string;
  providerId?: string | null;
  modelId?: string | null;
  cwd?: string;
  worktreePath?: string;
};

function openDb(): Db {
  const Database = requireApi('better-sqlite3') as new (file: string) => Db;
  return new Database(dbPath!);
}

function count(db: Db, sql: string, ...values: unknown[]) {
  return Number(db.prepare(sql).get(...values)?.count ?? 0);
}

function seedIdentity(db: Db, nonce: string) {
  const now = new Date().toISOString();
  const email = `smoke-session-${nonce}@example.invalid`;
  const inserted = db.prepare('INSERT INTO users (name, email, role, is_facilities_manager, email_notifications_enabled, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`Session smoke ${nonce}`, email, 'member', 0, 1, 'America/Los_Angeles', now, now);
  const userId = Number(inserted.lastInsertRowid);
  const token = randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now, '2099-01-01T00:00:00.000Z');
  return { email, token, userId };
}

async function startLiveWeb(token: string) {
  const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort)], {
    cwd: new URL('../..', import.meta.url),
    env: {
      ...process.env,
      VITE_RHYTHM_GATEWAY_MODE: 'live',
      VITE_RHYTHM_API_BASE: apiBase,
      VITE_RHYTHM_EXPECTED_API_BASE: apiBase,
      VITE_RHYTHM_PRODUCTION_API_BASE: apiBase,
      VITE_RHYTHM_ENGINE_BASE: engineBase,
      VITE_RHYTHM_EXPECTED_ENGINE_BASE: engineBase,
      VITE_RHYTHM_LIVE_TOKEN: token,
    },
    stdio: 'ignore',
  });
  await expect.poll(() => fetch(`http://127.0.0.1:${vitePort}/`).then((response) => response.status).catch(() => 0), {
    message: 'live Vite server must become reachable', timeout: 8_000,
  }).toBe(200);
  return vite;
}

async function stop(process: ChildProcess | undefined) {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    process.once('exit', () => resolve());
    setTimeout(resolve, 3_000);
  });
}

async function closeServer(server: Server | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function startDelayedProvider(nonce: string) {
  const requests: string[] = [];
  const first = `FIRST-${nonce}`;
  const rest = `-SECOND-${nonce}-COMPLETE`;
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const chunk = (content: string, finishReason: string | null = null) =>
        `data: ${JSON.stringify({ id: `chatcmpl-${nonce}`, object: 'chat.completion.chunk', created: 1, model: 'qwen/qwen3-coder-30b', choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }] })}\n\n`;
      setTimeout(() => response.write(chunk(first)), 350);
      setTimeout(() => response.write(chunk(rest)), 1_200);
      setTimeout(() => { response.write(chunk('', 'stop')); response.end('data: [DONE]\n\n'); }, 1_650);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(providerPort, '127.0.0.1', resolve);
  });
  return { server, requests, first, full: `${first}${rest}` };
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, expected: number): Promise<T> {
  expect(response.status()).toBe(expected);
  return await response.json() as T;
}

async function engineConfig(request: APIRequestContext) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request.get(`${engineBase}/config`, { timeout: 5_000 });
      if (response.status() === 200) return json<Record<string, unknown>>(response, 200);
      lastError = new Error(`Engine config returned ${response.status()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error('Engine config did not recover after the supervised respawn');
}

function engineAgentModel(config: Record<string, unknown>, agent: string) {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined;
  return agents?.[agent]?.model ?? null;
}

function listenerCount(port: number) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split('\n').slice(1).filter(Boolean).length : 0;
}

function listenerOwners(port: number) {
  const result = spawnSync('lsof', ['-nP', '-Fp', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return result.status === 0 ? [...new Set(result.stdout.split('\n').filter((line) => line.startsWith('p')).map((line) => line.slice(1)))].sort() : [];
}

function removeStaleSmokeWorktrees() {
  const cwd = process.cwd().replace(/\/apps\/web$/, '');
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error('Unable to inspect disposable smoke worktrees before the live lifecycle');

  for (const entry of listed.stdout.split('\n\n')) {
    const path = entry.split('\n').find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch = entry.split('\n').find((line) => line.startsWith('branch refs/heads/opencode/smoke-'))?.slice('branch refs/heads/'.length);
    if (!path || !branch) continue;
    const removed = spawnSync('git', ['worktree', 'remove', '--force', path], { cwd, encoding: 'utf8' });
    if (removed.status !== 0) throw new Error(`Unable to remove disposable smoke worktree ${branch}`);
  }

  spawnSync('git', ['worktree', 'prune'], { cwd, encoding: 'utf8' });
  const branches = spawnSync('git', ['branch', '--format=%(refname:short)', '--list', 'opencode/smoke-*'], { cwd, encoding: 'utf8' });
  if (branches.status !== 0) throw new Error('Unable to inspect disposable smoke branches before the live lifecycle');
  for (const branch of branches.stdout.split('\n').filter(Boolean)) {
    const removed = spawnSync('git', ['branch', '-D', branch], { cwd, encoding: 'utf8' });
    if (removed.status !== 0) throw new Error(`Unable to remove disposable smoke branch ${branch}`);
  }
}

function smokeGitState() {
  const cwd = process.cwd().replace(/\/apps\/web$/, '');
  const worktrees = spawnSync('git', ['worktree', 'list'], { cwd, encoding: 'utf8' });
  const branches = spawnSync('git', ['branch', '--format=%(refname:short)', '--list', 'opencode/smoke-*'], { cwd, encoding: 'utf8' });
  return {
    worktrees: worktrees.stdout.split('\n').filter((line) => line.includes('smoke-')).length,
    branches: branches.stdout.split('\n').filter(Boolean).length,
  };
}

function removeDisposableWorktree(worktreePath: string, worktreeName: string) {
  if (!worktreePath) return;
  const cwd = process.cwd().replace(/\/apps\/web$/, '');
  const removed = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd, encoding: 'utf8' });
  if (removed.status !== 0 && spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).stdout.includes(`worktree ${worktreePath}`)) {
    throw new Error(`Unable to remove disposable smoke worktree ${worktreePath}`);
  }
  spawnSync('git', ['worktree', 'prune'], { cwd, encoding: 'utf8' });
  const branch = `opencode/${worktreeName}`;
  const deleted = spawnSync('git', ['branch', '-D', branch], { cwd, encoding: 'utf8' });
  if (deleted.status !== 0 && spawnSync('git', ['branch', '--list', branch], { cwd, encoding: 'utf8' }).stdout.trim()) {
    throw new Error(`Unable to remove disposable smoke branch ${branch}`);
  }
}

async function freshDetail(page: Page, localId: string) {
  const response = await page.waitForResponse((candidate) =>
    candidate.request().method() === 'GET' &&
    candidate.url().startsWith(`${apiBase}/agent-sessions/${localId}?`) &&
    candidate.status() === 200,
  );
  return response.json() as Promise<{ session: SessionResponse; messages: Array<{ role?: string; rawText?: string; parts?: Array<{ text?: string }> }> }>;
}

test('engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session', async ({ page, request }) => {
  // Regression caught: live mode uses the fixture store, only enqueues/final-reloads output, retains WS-only text, or leaks a real engine session.
  removeStaleSmokeWorktrees();
  expect(process.env.RHYTHM_LIVE_API_URL).toBe(apiBase);
  expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engineBase);
  expect(dbPath).toMatch(/\/rhythm\.db$/);
  const protectedListeners = { api: listenerOwners(4001), engine: listenerOwners(4096) };
  expect(listenerCount(providerPort), 'Slice 0 deterministic provider port must be free before setup').toBe(0);

  const nonce = randomUUID();
  const sessionName = `smoke-session-${nonce}`;
  const prompt = `nonce prompt ${nonce}`;
  const worktreeName = `smoke-${nonce.slice(0, 8)}`;
  const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = openDb();
  const identity = seedIdentity(db, nonce);
  db.close();

  let vite: ChildProcess | undefined;
  let provider: Awaited<ReturnType<typeof startDelayedProvider>> | undefined;
  let profile: Profile | undefined;
  let initialEngineModel: unknown = null;
  let initialEngineModelSnapshotted = false;
  let projectedProfilePath = '';
  let projectedProfileInitiallyExisted = false;
  let projectedProfileSnapshotTaken = false;
  let originalProjectedProfileBytes: Buffer | undefined;
  let lmStudioCredentialAdded = false;
  let localId = '';
  let sdkId = '';
  let worktreePath = '';
  let initiallyAuthed = false;
  let primaryError: unknown;
  const apiEvents: string[] = [];
  const protectedRequests: string[] = [];
  const wsFramesSent: string[] = [];
  const wsFramesReceived: string[] = [];

  page.on('request', (requestEvent) => {
    if (['4001', '4096'].includes(new URL(requestEvent.url()).port)) protectedRequests.push(requestEvent.url());
  });

  page.on('response', (response) => {
    if (response.url().startsWith(`${apiBase}/agent-sessions`)) {
      apiEvents.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
    }
  });

  page.on('websocket', (socket) => {
    if (socket.url() !== `${wsBase}/ws/agents`) return;
    socket.on('framesent', (event) => wsFramesSent.push(event.payload));
    socket.on('framereceived', (event) => wsFramesReceived.push(event.payload));
  });

  try {
    const profiles = await json<Profile[]>(await request.get(`${apiBase}/agent-configs`, { headers: authHeaders(identity.token) }), 200);
    profile = profiles.find((item) => item.id === 'local-lean') ?? profiles.find((item) => item.enabled && !item.locked && item.sessionSelectable !== false);
    expect(profile, 'c4 requires a selectable real profile from GET /agent-configs').toBeTruthy();
    projectedProfilePath = join(dirname(dbPath!), 'home', '.config', 'opencode', 'agents', `${profile!.id}.md`);
    try {
      originalProjectedProfileBytes = await readFile(projectedProfilePath);
      projectedProfileInitiallyExisted = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    projectedProfileSnapshotTaken = true;
    const agentName = profile!.ocAgent || profile!.id;
    initialEngineModel = engineAgentModel(await engineConfig(request), agentName);
    initialEngineModelSnapshotted = true;
    const engineBeforeCredentialWrite = await json<{ healthy: boolean; bootId: string }>(
      await request.get(`${engineBase}/global/health`), 200,
    );
    const auth = await json<{ providers: string[] }>(await request.get(`${apiBase}/opencode/auth/`), 200);
    initiallyAuthed = auth.providers.includes('lmstudio');
    expect(initiallyAuthed, 'the disposable Slice 0 lmstudio credential must not replace an existing credential').toBe(false);

    provider = await startDelayedProvider(nonce);
    await json(await request.post(`${apiBase}/opencode/auth/lmstudio`, { data: { apiKey: `throwaway-${nonce}` } }), 200);
    lmStudioCredentialAdded = true;
    const patchedProfile = await json<Profile>(await request.patch(`${apiBase}/agent-configs/${profile!.id}`, {
      headers: authHeaders(identity.token), data: { modelProvider: 'lmstudio', modelId: 'qwen/qwen3-coder-30b' },
    }), 200);
    expect(patchedProfile).toMatchObject({ modelProvider: 'lmstudio', modelId: 'qwen/qwen3-coder-30b' });
    await expect.poll(async () => {
      try {
        const health = await json<{ healthy: boolean; bootId: string }>(await request.get(`${engineBase}/global/health`), 200);
        return health.healthy && health.bootId !== engineBeforeCredentialWrite.bootId;
      } catch {
        return false;
      }
    }, {
      message: 'engine must return healthy with a new bootId after the auth/profile bounce',
      timeout: 20_000,
    }).toBe(true);

    vite = await startLiveWeb(identity.token);
    await page.goto(`http://127.0.0.1:${vitePort}/#/agents`);
    await expect(page.getByTestId('environment-receipt')).toContainText('Live');

    await test.step('engine-session-live-lifecycle-c4: advanced form creates distinct local/SDK identities with a real profile and worktree cwd', async () => {
      await page.getByTestId('new-session-advanced').click();
      await page.getByTestId('advanced-name').fill(sessionName);
      await page.getByTestId('advanced-cwd').fill(process.cwd().replace(/\/apps\/web$/, ''));
      await page.getByTestId('advanced-isolate-worktree').check();
      await page.getByTestId('advanced-worktree-name').fill(worktreeName);
      const profilePicker = page.getByTestId('advanced-profile');
      if (await profilePicker.count()) await profilePicker.selectOption(profile!.id);

      const createResponsePromise = page.waitForResponse((response) =>
        response.url() === `${apiBase}/agent-sessions` && response.request().method() === 'POST',
        { timeout: 180_000 },
      );
      await page.getByTestId('advanced-create').click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status(), 'c4 advanced UI must POST a real session and receive 201').toBe(201);
      const created = await createResponse.json() as SessionResponse;
      localId = created.id ?? '';
      sdkId = created.sdkSessionId ?? created.sessionToken ?? '';
      worktreePath = created.worktreePath ?? created.cwd ?? '';
      expect(localId, 'c4 POST 201 must include the local Rhythm session id').not.toBe('');
      expect(sdkId, 'c4 POST 201 must include the SDK/engine session id').not.toBe('');
      expect(sdkId, 'c4 local and SDK session ids must remain distinct').not.toBe(localId);
      expect(created.profileId, 'c4 POST must retain the real selected profile').toBe(profile!.id);
      expect(worktreePath, 'c4 response must expose the isolated worktree cwd').toContain(worktreeName);
      await expect(page.getByTestId(`session-${localId}`), 'c4 visible rail id must equal the POST local id').toContainText(sessionName);

      const apiDetail = await json<{ session: SessionResponse }>(await request.get(`${apiBase}/agent-sessions/${localId}`, {
        headers: authHeaders(identity.token),
      }), 200);
      const engineAgent = profile!.ocAgent || profile!.id;
      const currentEngineConfig = await engineConfig(request);
      const engineSession = await json<Record<string, unknown>>(await request.get(`${engineBase}/session/${sdkId}`), 200);
      console.log(`engine-session-live-lifecycle-c5 routing after create=${JSON.stringify({
        apiSession: {
          profileId: apiDetail.session.profileId,
          agentKind: apiDetail.session.agentKind,
          opencodeAgentId: apiDetail.session.opencodeAgentId,
          providerId: apiDetail.session.providerId,
          modelId: apiDetail.session.modelId,
        },
        engineAgent,
        engineAgentModel: engineAgentModel(currentEngineConfig, engineAgent),
        engineSession,
      })}`);
    });

    await test.step('engine-session-live-lifecycle-c5: nonce prompt reaches delayed deterministic provider through real API and engine', async () => {
      await page.getByTestId('composer-input').fill(prompt);
      await page.getByTestId('composer-send').click();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const engineMessagesResponse = await request.get(`${engineBase}/session/${sdkId}/message`);
      console.log(`engine-session-live-lifecycle-c5 transport=${JSON.stringify({
        sent: wsFramesSent.filter((frame) => frame.includes(prompt)),
        accepted: wsFramesReceived.filter((frame) => frame.includes(localId) && frame.includes('session.updated')),
        receivedFrameCount: wsFramesReceived.length,
        apiEvents,
        engineMessagesStatus: engineMessagesResponse.status(),
        engineMessageCount: engineMessagesResponse.status() === 200 ? (await engineMessagesResponse.json() as unknown[]).length : null,
      })}`);
      await expect.poll(() => provider!.requests.length, {
        message: 'c5 provider must receive one real engine request',
        timeout: 120_000,
      }).toBe(1);
      expect(provider!.requests[0], 'c5 provider request body must contain the nonce prompt').toContain(prompt);
      expect(protectedRequests, 'c5 browser journey must make no request to protected ports 4001/4096').toEqual([]);
      expect({ api: listenerOwners(4001), engine: listenerOwners(4096) }, 'c5 must not replace or stop AJ desktop listeners').toEqual(protectedListeners);
    });

    await test.step('engine-session-live-lifecycle-c6: first delayed fragment renders while working, full text only after working:false', async () => {
      await expect(page.getByTestId('composer-cancel'), 'c6 cancel affordance proves the session is still working').toBeVisible();
      await expect(page.getByTestId('transcript'), 'c6 first delayed assistant fragment must render before completion').toContainText(provider!.first);
      await expect(page.getByTestId('transcript'), 'c6 full output must not appear during the intermediate working state').not.toContainText(provider!.full);
      const idleResponse = page.waitForResponse(async (response) => {
        if (!response.url().startsWith(`${apiBase}/agent-sessions/${localId}`) || response.request().method() !== 'GET' || response.status() !== 200) return false;
        const body = await response.json() as { session?: { working?: boolean; status?: string } };
        return body.session?.working === false || ['idle', 'resumable', 'closed'].includes(body.session?.status ?? '');
      });
      await page.getByTestId('sessions-refresh').click();
      await idleResponse;
      await expect(page.getByTestId('composer-cancel'), 'c6 cancel must disappear after working:false').toHaveCount(0);
      await expect(page.getByTestId('transcript'), 'c6 full delayed output renders only after idle').toContainText(provider!.full);
    });

    await test.step('engine-session-live-lifecycle-c7: reload performs fresh detail GET and hydrates persisted assistant text', async () => {
      const detailPromise = freshDetail(page, localId);
      await page.reload();
      const detail = await detailPromise;
      expect(detail.session.id, 'c7 fresh detail read must return the same local id').toBe(localId);
      expect(JSON.stringify(detail.messages), 'c7 fresh API detail must contain persisted assistant output').toContain(provider!.full);
      await expect(page.getByTestId(`session-${localId}`), 'c7 same local session must reappear after reload').toBeVisible();
      await expect(page.getByTestId('transcript'), 'c7 full assistant text must rehydrate after reload').toContainText(provider!.full);
      const persisted = openDb();
      expect(count(persisted, 'SELECT COUNT(*) AS count FROM agent_session_messages WHERE session_id = ? AND role = ?', localId, 'output'), 'c7 assistant text must exist in agent_session_messages').toBeGreaterThan(0);
      persisted.close();
    });

    await test.step('engine-session-live-lifecycle-c8: permanent delete removes local and SDK sessions and remains absent after reload', async () => {
      await page.getByTestId(`session-menu-${localId}`).click();
      await page.getByTestId(`delete-${localId}`).click();
      const deleteResponsePromise = page.waitForResponse((response) =>
        response.url() === `${apiBase}/agent-sessions/${localId}/hard` && response.request().method() === 'DELETE',
      );
      await page.getByTestId('confirm-session-delete').click();
      expect((await deleteResponsePromise).status(), 'c8 hard-delete endpoint must return 204').toBe(204);
      await expect(page.getByTestId(`session-${localId}`)).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId(`session-${localId}`), 'c8 rail absence must persist after reload').toHaveCount(0);
      expect((await request.get(`${apiBase}/agent-sessions/${localId}`, { headers: authHeaders(identity.token) })).status(), 'c8 local lookup after hard delete').toBe(404);
      expect((await request.get(`${engineBase}/session/${sdkId}`)).status(), 'c8 SDK/engine lookup after hard delete').toBe(404);
      localId = '';
      sdkId = '';
    });
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupRequest = await playwrightRequest.newContext({ timeout: 60_000 });
    const cleanupErrors: unknown[] = [];
    const recordCleanupError = (error: unknown) => cleanupErrors.push(error);
    try {
      try {
        if (localId) await cleanupRequest.delete(`${apiBase}/agent-sessions/${localId}/hard`, {
          headers: authHeaders(identity.token), timeout: 60_000,
        }).catch(() => undefined);
      } finally {
        try {
          if (sdkId) await cleanupRequest.delete(`${engineBase}/session/${sdkId}`, { timeout: 60_000 }).catch(() => undefined);
        } finally {
          try {
            if (profile) {
              await json<Profile>(await cleanupRequest.patch(`${apiBase}/agent-configs/${profile.id}`, {
                headers: authHeaders(identity.token), data: { modelProvider: profile.modelProvider, modelId: profile.modelId },
                timeout: 60_000,
              }), 200);
            }
          } catch (error) {
            recordCleanupError(error);
          } finally {
            try {
              if (lmStudioCredentialAdded) {
                const credentialResponse = await cleanupRequest.delete(`${engineBase}/auth/lmstudio`, { timeout: 60_000 });
                expect(credentialResponse.ok(), 'c9 must remove the temporary lmstudio credential').toBe(true);
              }
            } catch (error) {
              recordCleanupError(error);
            } finally {
              try {
                if (projectedProfileSnapshotTaken) {
                  if (projectedProfileInitiallyExisted) await writeFile(projectedProfilePath, originalProjectedProfileBytes!);
                  else await rm(projectedProfilePath, { force: true });
                }
              } catch (error) {
                recordCleanupError(error);
              } finally {
                try {
                  if (projectedProfileSnapshotTaken) {
                    const reloadResponse = await cleanupRequest.post(`${engineBase}/config/reload`, { timeout: 60_000 });
                    expect(reloadResponse.ok(), 'c9 engine config reload after exact projected-file restoration must succeed').toBe(true);
                  }
                } catch (error) {
                  recordCleanupError(error);
                } finally {
                  try {
                    if (profile) {
                      const restored = await json<Profile>(await cleanupRequest.get(`${apiBase}/agent-configs/${profile.id}`, { headers: authHeaders(identity.token) }), 200);
                      expect({ modelProvider: restored.modelProvider, modelId: restored.modelId }, 'c9 must restore exact profile model fields').toEqual({ modelProvider: profile.modelProvider, modelId: profile.modelId });
                    }
                  } catch (error) {
                    recordCleanupError(error);
                  }
                  try {
                    if (projectedProfileSnapshotTaken) {
                      let restoredProjectedProfileBytes: Buffer | undefined;
                      try {
                        restoredProjectedProfileBytes = await readFile(projectedProfilePath);
                      } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                      }
                      expect(restoredProjectedProfileBytes !== undefined, 'c9 must restore exact projected profile file existence').toBe(projectedProfileInitiallyExisted);
                      if (projectedProfileInitiallyExisted) {
                        expect(restoredProjectedProfileBytes, 'c9 must restore exact projected profile file bytes').toEqual(originalProjectedProfileBytes);
                      }
                    }
                  } catch (error) {
                    recordCleanupError(error);
                  }
                  try {
                    if (profile && initialEngineModelSnapshotted) {
                      expect(engineAgentModel(await engineConfig(cleanupRequest), profile.ocAgent || profile.id), 'c9 must restore the exact engine agent model field').toEqual(initialEngineModel);
                    }
                  } catch (error) {
                    recordCleanupError(error);
                  }
                }
              }
            }
          }

          await page.close().catch(() => undefined);
          await stop(vite);
          await closeServer(provider?.server);
          removeDisposableWorktree(worktreePath, worktreeName);

          const cleanup = openDb();
          if (localId) cleanup.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(localId);
          cleanup.prepare('DELETE FROM agent_sessions WHERE owner_user_id = ? OR name = ?').run(identity.userId, sessionName);
          cleanup.prepare('DELETE FROM tasks WHERE owner_id = ?').run(identity.userId);
          cleanup.prepare('DELETE FROM sessions WHERE user_id = ?').run(identity.userId);
          cleanup.prepare('DELETE FROM users WHERE id = ?').run(identity.userId);
          const counts = {
            users: count(cleanup, 'SELECT COUNT(*) AS count FROM users WHERE email = ?', identity.email),
            authSessions: count(cleanup, 'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', identity.userId),
            agentSessions: count(cleanup, 'SELECT COUNT(*) AS count FROM agent_sessions WHERE owner_user_id = ? OR name = ?', identity.userId, sessionName),
            messages: count(cleanup, 'SELECT COUNT(*) AS count FROM agent_session_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE owner_user_id = ? OR name = ?)', identity.userId, sessionName),
            tasks: count(cleanup, 'SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ?', identity.userId),
            artifacts: count(cleanup, 'SELECT COUNT(*) AS count FROM live_artifacts WHERE owner_user_id = ?', identity.userId),
            files: worktreePath ? await access(worktreePath).then(() => 1).catch(() => 0) : 0,
            listeners: listenerCount(providerPort) + listenerCount(vitePort),
          };
          cleanup.close();
          console.log(`engine-session-live-lifecycle-c9 cleanup counts=${JSON.stringify(counts)}`);
          expect(counts, 'c9 must leave zero nonce-owned disposable rows, files, or listeners').toEqual({ users: 0, authSessions: 0, agentSessions: 0, messages: 0, tasks: 0, artifacts: 0, files: 0, listeners: 0 });
          // A create that outlives the test's patience still completes server-side, so a worktree
          // and branch can appear AFTER the failure path began — localId is unset in that case, so
          // the targeted removal above cannot reach them. Sweep, then assert, using the same helper
          // the test uses at startup.
          removeStaleSmokeWorktrees();
          expect(smokeGitState(), 'c9 must leave zero nonce-owned git worktrees or branches').toEqual({ worktrees: 0, branches: 0 });
        }
      }
    } catch (error) {
      recordCleanupError(error);
    } finally {
      await cleanupRequest.dispose().catch(() => undefined);
    }
    const cleanupError = cleanupErrors.length > 0
      ? new AggregateError(cleanupErrors, 'engine-session-live-lifecycle-c9 cleanup failed')
      : undefined;
    if (primaryError) {
      if (cleanupError) console.error('engine-session-live-lifecycle-c9 secondary cleanup error:', cleanupError);
      throw primaryError;
    }
    if (cleanupError) throw cleanupError;
  }
});
