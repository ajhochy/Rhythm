/**
 * Dual-anthropic-accounts Task C — routing/failover tests for the vendored
 * `rhythm-anthropic-accounts` engine plugin, plus swap/idempotency tests for
 * `ensureRequiredPlugins`.
 *
 * These import the REAL vendored dist module (the exact code the engine
 * executes under Bun) — no SDK-shape mocks (the false-green lesson). Only
 * the network is stubbed, with local node:http servers:
 *   - stubA plays the Anthropic API (captures authorization/path/body;
 *     configurable to 429 with a huge retry-after for a specific bearer)
 *   - stubB plays api_server's POST /opencode/spillover intake
 *
 * Env knobs (RHYTHM_ACCOUNTS_FILE / RHYTHM_ANTHROPIC_BASE_URL /
 * RHYTHM_API_BASE / RHYTHM_FORCE_SPILLOVER) are read lazily by the plugin,
 * but each test still gets a fresh module registry (vi.resetModules) so the
 * plugin's session-override map and store mtime cache start clean.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  utimesSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureRequiredPlugins,
  rhythmAnthropicPluginPath,
} from '../services/opencode_plugin_config';

const PLUGIN_DIR = join(
  __dirname,
  '..',
  '..',
  'opencode_plugins',
  'rhythm-anthropic-accounts',
);
const PLUGIN_INDEX = join(PLUGIN_DIR, 'dist', 'index.js');

// ---------------------------------------------------------------------------
// Network stubs
// ---------------------------------------------------------------------------

interface CapturedRequest {
  auth: string | null;
  path: string;
  body: string;
}

let stubA: Server; // Anthropic API stand-in
let stubB: Server; // api_server spillover intake stand-in
let portA = 0;
let portB = 0;
let anthropicRequests: CapturedRequest[] = [];
let spilloverBodies: Record<string, unknown>[] = [];
/** When set, stubA answers this bearer with 429 + retry-after far over the cap. */
let rateLimitedBearer: string | null = null;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  stubA = createServer((req: IncomingMessage, res: ServerResponse) => {
    void readBody(req).then((body) => {
      const auth = (req.headers['authorization'] as string | undefined) ?? null;
      anthropicRequests.push({ auth, path: req.url ?? '', body });
      if (rateLimitedBearer && auth === `Bearer ${rateLimitedBearer}`) {
        res.writeHead(429, {
          'content-type': 'application/json',
          // Far over the plugin's 30s retry cap → fetchWithRetry returns the
          // 429 immediately (quota-exhaustion path), exactly one request sent.
          'retry-after': '99999',
        });
        res.end(
          JSON.stringify({
            error: { type: 'rate_limit_error', message: 'quota exhausted' },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_stub', content: [] }));
    });
  });
  stubB = createServer((req: IncomingMessage, res: ServerResponse) => {
    void readBody(req).then((body) => {
      if (req.method === 'POST' && req.url === '/opencode/spillover') {
        spilloverBodies.push(JSON.parse(body) as Record<string, unknown>);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  portA = await listen(stubA);
  portB = await listen(stubB);
});

afterAll(async () => {
  await new Promise((r) => stubA.close(r));
  await new Promise((r) => stubB.close(r));
});

// ---------------------------------------------------------------------------
// Store fixture + plugin loading
// ---------------------------------------------------------------------------

const TEAM_TOKEN = 'team-access-token';
const PERSONAL_TOKEN = 'personal-access-token';

let storeFile = '';

function writeStoreFixture(
  routing: Record<string, string> = { ses_b: 'personal' },
): void {
  writeFileSync(
    storeFile,
    JSON.stringify({
      version: 1,
      accounts: [
        {
          id: 'team',
          label: 'Team',
          access: TEAM_TOKEN,
          refresh: 'r1',
          expires: Date.now() + 3600_000,
          status: 'ok',
        },
        {
          id: 'personal',
          label: 'Personal',
          access: PERSONAL_TOKEN,
          refresh: 'r2',
          expires: Date.now() + 3600_000,
          status: 'ok',
        },
      ],
      defaultAccountId: 'team',
      routing,
    }),
  );
}

/** Import the REAL vendored plugin and pull the anthropic loader's fetch. */
async function loadPluginFetch(): Promise<{
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  baseURL: string;
}> {
  const mod = (await import(PLUGIN_INDEX)) as {
    default: (app: Record<string, unknown>) => Promise<{
      auth: {
        provider: string;
        loader: (
          getAuth: () => Promise<{ type: string }>,
          provider: { models: Record<string, unknown> },
        ) => Promise<{
          fetch: (input: string, init?: RequestInit) => Promise<Response>;
          baseURL: string;
        }>;
      };
    }>;
  };
  const hooks = await mod.default({ client: {}, directory: process.cwd() });
  expect(hooks.auth?.provider).toBe('anthropic');
  return hooks.auth.loader(async () => ({ type: 'oauth' }), { models: {} });
}

function messagesUrl(): string {
  return `http://127.0.0.1:${portA}/v1/messages`;
}

function requestInit(sessionId?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId ? { 'x-session-affinity': sessionId } : {}),
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  };
}

beforeEach(() => {
  anthropicRequests = [];
  spilloverBodies = [];
  rateLimitedBearer = null;
  storeFile = join(mkdtempSync(join(tmpdir(), 'plugin-routing-')), 'accounts.json');
  writeStoreFixture();
  process.env.RHYTHM_ACCOUNTS_FILE = storeFile;
  process.env.RHYTHM_ANTHROPIC_BASE_URL = `http://127.0.0.1:${portA}/v1`;
  process.env.RHYTHM_API_BASE = `http://127.0.0.1:${portB}`;
  delete process.env.RHYTHM_FORCE_SPILLOVER;
  delete process.env.CLAUDE_AUTH_DEBUG;
  // Fresh module state per test (session-override map, store mtime cache).
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Routing + failover through the REAL vendored module
// ---------------------------------------------------------------------------

describe('rhythm-anthropic-accounts plugin routing', () => {
  it('routes an unrouted session to the default account (team)', async () => {
    const opts = await loadPluginFetch();
    const res = await opts.fetch(messagesUrl(), requestInit('ses_a'));
    expect(res.status).toBe(200);
    expect(anthropicRequests).toHaveLength(1);
    expect(anthropicRequests[0].auth).toBe(`Bearer ${TEAM_TOKEN}`);
    expect(anthropicRequests[0].path).toContain('/v1/messages');
  });

  it('routes a session with a file routing entry to that account (personal)', async () => {
    const opts = await loadPluginFetch();
    const res = await opts.fetch(messagesUrl(), requestInit('ses_b'));
    expect(res.status).toBe(200);
    expect(anthropicRequests).toHaveLength(1);
    expect(anthropicRequests[0].auth).toBe(`Bearer ${PERSONAL_TOKEN}`);
  });

  it('fails over to the fallback account on quota-exhaustion 429 and reports spillover', async () => {
    rateLimitedBearer = TEAM_TOKEN;
    const opts = await loadPluginFetch();
    const res = await opts.fetch(messagesUrl(), requestInit('ses_a'));

    // Original send with team (429 immediately — retry-after over cap), then
    // exactly one retry with personal.
    expect(res.status).toBe(200);
    expect(anthropicRequests).toHaveLength(2);
    expect(anthropicRequests[0].auth).toBe(`Bearer ${TEAM_TOKEN}`);
    expect(anthropicRequests[1].auth).toBe(`Bearer ${PERSONAL_TOKEN}`);

    // markSpillover is fire-and-forget → poll the api_server stub.
    await waitFor(() => spilloverBodies.length >= 1);
    expect(spilloverBodies[0]).toMatchObject({
      sdkSessionId: 'ses_a',
      fromAccountId: 'team',
      toAccountId: 'personal',
      reason: 'rate_limited',
    });

    // Session affinity: the next request for ses_a goes straight to personal
    // via the in-memory override (no second 429 round-trip).
    const res2 = await opts.fetch(messagesUrl(), requestInit('ses_a'));
    expect(res2.status).toBe(200);
    expect(anthropicRequests).toHaveLength(3);
    expect(anthropicRequests[2].auth).toBe(`Bearer ${PERSONAL_TOKEN}`);
  });

  it('RHYTHM_FORCE_SPILLOVER deterministically routes to the fallback before sending', async () => {
    process.env.RHYTHM_FORCE_SPILLOVER = 'team';
    const opts = await loadPluginFetch();
    const res = await opts.fetch(messagesUrl(), requestInit('ses_a'));

    // Switched BEFORE sending: only one request, already on personal.
    expect(res.status).toBe(200);
    expect(anthropicRequests).toHaveLength(1);
    expect(anthropicRequests[0].auth).toBe(`Bearer ${PERSONAL_TOKEN}`);

    await waitFor(() => spilloverBodies.length >= 1);
    expect(spilloverBodies[0]).toMatchObject({
      sdkSessionId: 'ses_a',
      fromAccountId: 'team',
      toAccountId: 'personal',
      reason: 'rate_limited',
    });
  });

  it('a fresh store write beats a stale spillover override', async () => {
    // Spill ses_a from team → personal (records the in-memory override).
    rateLimitedBearer = TEAM_TOKEN;
    const opts = await loadPluginFetch();
    const res = await opts.fetch(messagesUrl(), requestInit('ses_a'));
    expect(res.status).toBe(200);
    expect(anthropicRequests[anthropicRequests.length - 1].auth).toBe(
      `Bearer ${PERSONAL_TOKEN}`,
    );

    // api_server rewrites the store routing ses_a back to team. Force the
    // mtime strictly forward — same-ms rewrites must still win.
    rateLimitedBearer = null;
    writeStoreFixture({ ses_a: 'team' });
    const bumped = new Date(statSync(storeFile).mtimeMs + 2000);
    utimesSync(storeFile, bumped, bumped);

    // The newer file routing wins; the stale override is discarded.
    anthropicRequests = [];
    const res2 = await opts.fetch(messagesUrl(), requestInit('ses_a'));
    expect(res2.status).toBe(200);
    expect(anthropicRequests).toHaveLength(1);
    expect(anthropicRequests[0].auth).toBe(`Bearer ${TEAM_TOKEN}`);
  });

  it('falls back to the legacy Claude Code path when the store file disappears', async () => {
    // Plugin initialised while the store was live → keychain never read.
    const opts = await loadPluginFetch();
    rmSync(storeFile);
    // hasAccounts() is now false → legacy getCachedCredentials() path, which
    // has no accounts loaded in this process → the classic Claude Code error.
    await expect(opts.fetch(messagesUrl(), requestInit('ses_a'))).rejects.toThrow(
      /Claude Code credentials are unavailable or expired/,
    );
    expect(anthropicRequests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureRequiredPlugins — legacy swap + idempotency (tmp config file only;
// never touches ~/.config/opencode/opencode.json)
// ---------------------------------------------------------------------------

describe('ensureRequiredPlugins', () => {
  let configPath = '';

  beforeEach(() => {
    configPath = join(
      mkdtempSync(join(tmpdir(), 'oc-config-')),
      'opencode.json',
    );
  });

  it('resolves the vendored plugin dir', () => {
    expect(rhythmAnthropicPluginPath()).toBe(PLUGIN_DIR);
    expect(existsSync(join(PLUGIN_DIR, 'dist', 'index.js'))).toBe(true);
  });

  it('swaps opencode-claude-auth for the vendored path and preserves user entries', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ['opencode-claude-auth', 'custom-user-plugin'],
      }),
    );
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      plugin: string[];
    };
    expect(parsed.plugin).not.toContain('opencode-claude-auth');
    expect(parsed.plugin).toContain('custom-user-plugin');
    expect(parsed.plugin).toContain('opencode-openai-codex-auth');
    expect(parsed.plugin).toContain('opencode-gemini-auth');
    expect(parsed.plugin).toContain(PLUGIN_DIR);
  });

  it('is idempotent — second run makes no changes', () => {
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const after = readFileSync(configPath, 'utf8');
    expect(ensureRequiredPlugins(configPath)).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(after);
  });

  it('creates the config with $schema when missing', () => {
    expect(existsSync(configPath)).toBe(false);
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      $schema: string;
      plugin: string[];
    };
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.plugin).toContain(PLUGIN_DIR);
  });
});
