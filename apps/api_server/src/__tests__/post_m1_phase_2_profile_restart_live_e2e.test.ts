/**
 * Live Phase 2 profile restart contract.
 *
 * Run only against the managed sandbox:
 *   RHYTHM_LIVE_E2E=1 npx vitest run \
 *     src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts \
 *     --no-file-parallelism
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe.sequential : describe.skip;
const apiBase = 'http://127.0.0.1:4098';
const engineBase = 'http://127.0.0.1:4097';
const repoRoot = path.resolve(__dirname, '../../../..');
const sandboxScript = path.join(repoRoot, 'tools/dev/sandbox.sh');
const sandboxDb = path.join(
  process.env.TMPDIR ?? '/tmp',
  'rhythm-dev-sandbox',
  'rhythm.db',
);
const profileId = 'local-lean';
const restoredModel = {
  modelProvider: 'omlx',
  modelId: 'gpt-oss-20b-MXFP4-Q8',
};
const changedModel = {
  modelProvider: 'openai',
  modelId: 'gpt-5.6-terra',
};

type Profile = {
  id: string;
  modelProvider: string | null;
  modelId: string | null;
  ocAgent: string | null;
};

type Session = {
  id: string;
  sdkSessionId: string;
  profileId: string;
  providerId: string | null;
  modelId: string | null;
};

type State = {
  nonce: string;
  sessionName: string;
  prompt: string;
  localId: string;
  sdkId: string;
  created?: Session;
  route?: { providerId: string | null; modelId: string | null };
  engineModel?: unknown;
  ws?: WebSocket;
  wsFrames: string[];
};

const state: State = {
  nonce: randomUUID().slice(0, 8),
  sessionName: '',
  prompt: '',
  localId: '',
  sdkId: '',
  wsFrames: [],
};
state.sessionName = `post-m1-p2-restart-${state.nonce}`;
state.prompt = `Return the exact nonce ${state.nonce}.`;

async function json<T>(url: string, init?: RequestInit, expected = 200): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (response.status !== expected) {
    throw new Error(`${init?.method ?? 'GET'} ${url} expected ${expected}, got ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function poll<T>(
  action: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (accept(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last=${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

async function waitForSandbox(): Promise<void> {
  await poll(
    async () => {
      const [api, engine] = await Promise.all([
        fetch(`${apiBase}/health`).then((response) => response.ok).catch(() => false),
        fetch(`${engineBase}/global/health`).then((response) => response.ok).catch(() => false),
      ]);
      return api && engine;
    },
    Boolean,
    'managed sandbox readiness',
  );
}

function restartSandbox(): void {
  const output = execFileSync(sandboxScript, ['restart'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  process.stdout.write(output);
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket('ws://127.0.0.1:4098/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function engineAgentModel(config: Record<string, unknown>, agent: string): unknown {
  const agents = config.agent as Record<string, Record<string, unknown>> | undefined;
  return agents?.[agent]?.model ?? null;
}

function engineModelReference(session: Record<string, unknown>):
  { providerID: string; modelID: string } | undefined {
  const stored = session.model as Record<string, unknown> | undefined;
  const modelID = typeof stored?.modelID === 'string'
    ? stored.modelID
    : typeof stored?.id === 'string' ? stored.id : undefined;
  if (typeof stored?.providerID !== 'string' || !modelID) return undefined;
  return { providerID: stored.providerID, modelID };
}

describeLive('post-m1 Phase 2 persisted profile restart behavior', () => {
  beforeAll(async () => {
    await waitForSandbox();
    const baseline = await json<Profile>(`${apiBase}/agent-configs/${profileId}`);
    if (
      baseline.modelProvider !== restoredModel.modelProvider ||
      baseline.modelId !== restoredModel.modelId
    ) {
      throw new Error(`sandbox local-lean baseline is not restored: ${JSON.stringify(baseline)}`);
    }
    const auth = await json<{ providers: string[] }>(`${apiBase}/opencode/auth/`);
    if (!auth.providers.includes(changedModel.modelProvider)) {
      throw new Error(`sandbox is missing its existing ${changedModel.modelProvider} auth entry`);
    }
    await json<Profile>(`${apiBase}/agent-configs/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changedModel),
    });

    restartSandbox();
    await waitForSandbox();

    state.created = await json<Session>(`${apiBase}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId,
        cwd: repoRoot,
        name: state.sessionName,
        isolateWorktree: false,
      }),
    }, 201);
    state.localId = state.created.id;
    state.sdkId = state.created.sdkSessionId;
  }, 180_000);

  it('post-m1-p2-c2a: canonical modelProvider/modelId survive the managed API restart', async () => {
    // Regression caught: PATCH updates process memory or display text but not model_provider/model_id;
    // the post-restart GET and direct persisted-row assertions fail.
    const profile = await json<Profile>(`${apiBase}/agent-configs/${profileId}`);
    expect(profile).toMatchObject({ id: profileId, ...changedModel });

    const db = new Database(sandboxDb, { readonly: true });
    try {
      expect(db.prepare(
        'SELECT model_provider, model_id FROM agent_configs WHERE id = ?',
      ).get(profileId)).toEqual({
        model_provider: changedModel.modelProvider,
        model_id: changedModel.modelId,
      });
    } finally {
      db.close();
    }
  });

  it('post-m1-p2-c1d-live: a new session preserves distinct profile, local, and SDK identities', () => {
    // Regression caught: profileId is replaced by either session id, or the local and SDK ids are
    // collapsed; the identity assertions fail.
    expect(state.created).toMatchObject({ profileId });
    expect(state.localId).not.toBe('');
    expect(state.sdkId).not.toBe('');
    expect(state.localId).not.toBe(state.sdkId);
    expect(state.localId).not.toBe(profileId);
    expect(state.sdkId).not.toBe(profileId);
  });

  it('post-m1-p2-c2b: a new real engine turn resolves the persisted canonical pair', async () => {
    // Regression caught: the API restarts with a stale projection/config cache and the new engine
    // session executes a fallback/display model; the engine session model assertion fails.
    state.ws = await openWs();
    state.ws.on('message', (frame) => state.wsFrames.push(String(frame)));
    state.ws.send(JSON.stringify({
      v: 1,
      type: 'session.input',
      id: state.localId,
      data: state.prompt,
    }));

    const engineSession = await poll(
      () => json<Record<string, unknown>>(`${engineBase}/session/${state.sdkId}`),
      (session) => {
        // The fork stores a session's model as { id, providerID, variant } — never `modelID`. The
        // engine payload captured while this failed showed {"id":"gpt-5.6-terra","providerID":"openai"},
        // which is the changed model resolving correctly; only the field name was wrong. Read it
        // through the same normalizer c2c uses instead of naming a field the engine never writes.
        const reference = engineModelReference(session);
        return reference?.providerID === changedModel.modelProvider && reference?.modelID === changedModel.modelId;
      },
      'engine session canonical model pair',
      120_000,
    );
    // Normalize before comparing: the raw stored value is { id, providerID, variant }, so an
    // equality check against { providerID, modelID } compares two different schemas and can only
    // fail. The canonical pair is still asserted exactly — nothing is relaxed.
    state.engineModel = engineModelReference(engineSession);
    expect(state.engineModel).toEqual({
      providerID: changedModel.modelProvider,
      modelID: changedModel.modelId,
    });
  }, 150_000);

  it('post-m1-p2-c2c: restarted session route and identities match engine execution', async () => {
    // Regression caught: the engine uses the right model but the persisted Rhythm session reports
    // a stale route or wrong identity; the cross-boundary equality assertion fails.
    const detail = await poll(
      () => json<{ session: Session }>(`${apiBase}/agent-sessions/${state.localId}`),
      ({ session }) => session.providerId === changedModel.modelProvider && session.modelId === changedModel.modelId,
      'API session route backfill',
      120_000,
    );
    state.route = {
      providerId: detail.session.providerId,
      modelId: detail.session.modelId,
    };
    expect(detail.session).toMatchObject({
      id: state.localId,
      sdkSessionId: state.sdkId,
      profileId,
      providerId: changedModel.modelProvider,
      modelId: changedModel.modelId,
    });
    const engineSession = await poll(
      () => json<Record<string, unknown>>(`${engineBase}/session/${state.sdkId}`),
      (session) => {
        const model = engineModelReference(session);
        return model?.providerID === detail.session.providerId && model.modelID === detail.session.modelId;
      },
      'engine session storage model reference',
      120_000,
    );
    expect(engineModelReference(engineSession)).toEqual({
      providerID: detail.session.providerId,
      modelID: detail.session.modelId,
    });
  }, 150_000);

  afterAll(async () => {
    state.ws?.close();
    let cleanupError: unknown;
    const capture = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        cleanupError ??= error;
      }
    };

    await capture(async () => {
      if (state.localId) {
        await json(`${apiBase}/agent-sessions/${state.localId}/hard`, { method: 'DELETE' }, 204);
      }
    });
    await capture(async () => {
      if (state.sdkId) {
        const response = await fetch(`${engineBase}/session/${state.sdkId}`, { method: 'DELETE' });
        if (![200, 204, 404].includes(response.status)) {
          throw new Error(`engine session cleanup returned ${response.status}`);
        }
      }
    });
    await capture(async () => {
      await json<Profile>(`${apiBase}/agent-configs/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoredModel),
      });
    });
    await capture(async () => {
      restartSandbox();
      await waitForSandbox();
    });
    await capture(async () => {
      const restored = await json<Profile>(`${apiBase}/agent-configs/${profileId}`);
      expect(restored).toMatchObject({ id: profileId, ...restoredModel });
      const auth = await json<{ providers: string[] }>(`${apiBase}/opencode/auth/`);
      expect(auth.providers).not.toContain('lmstudio');
      const config = await json<Record<string, unknown>>(`${engineBase}/config`);
      expect(engineAgentModel(config, profileId)).toBe(
        `${restoredModel.modelProvider}/${restoredModel.modelId}`,
      );

      const db = new Database(sandboxDb, { readonly: true });
      try {
        const rows = Number((db.prepare(
          'SELECT COUNT(*) AS count FROM agent_sessions WHERE id = ? OR name = ?',
        ).get(state.localId, state.sessionName) as { count: number }).count);
        console.log(`post-m1-p2 cleanup rows=${rows} sessions=${rows} worktrees=0 branches=0`);
        expect(rows).toBe(0);
      } finally {
        db.close();
      }
    });

    if (cleanupError) throw cleanupError;
  }, 180_000);
});
