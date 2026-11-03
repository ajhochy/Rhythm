import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

// Regression contract: production method and production reloadConfig; fake SDK
// transport/cache only. No native process, provider, credential or HTTP access.
vi.mock('../services/qualification_fixture_authority', () => ({ loadQualificationFixtureAuthority: () => null }));
let root: string, homePath: string, managedPath: string, explicitPath: string;
let svc: import('../services/opencode_client_service').OpencodeClientService;
let nativeMcp: Record<string, unknown>, connectedMcp: Record<string, unknown>;
let activePath: string, desired: Record<string, unknown>;
let addFault: 'throw' | 'envelope' | null, reloadFault: 'throw' | 'envelope' | null;
let addCount: number, reloadCount: number;
let addData: unknown;

beforeEach(async () => {
  root = realpathSync(mkdtempSync('/private/tmp/rhythm-managed-mcp-contract-'));
  chmodSync(root, 0o700);
  expect(root.startsWith('/private/tmp/rhythm-managed-mcp-contract-')).toBe(true);
  expect(lstatSync(root).uid).toBe(process.getuid!());
  expect(lstatSync(root).mode & 0o777).toBe(0o700);
  const home = join(root, 'unrelated-home');
  homePath = join(home, '.config', 'opencode', 'opencode.json');
  managedPath = join(root, 'managed', 'opencode.json');
  explicitPath = join(root, 'explicit', 'opencode.json');
  for (const path of [homePath, managedPath, explicitPath]) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ mcp: { other: { type: 'local', command: ['invented-offline-command'] } } }));
  }
  vi.stubEnv('HOME', home);
  // Worker process.env is a JS copy: native os.homedir() need not see HOME.
  // Stub the exact CommonJS os object used by production and prove isolation.
  vi.spyOn(require('os') as typeof import('os'), 'homedir').mockReturnValue(home);
  expect(require('os').homedir()).toBe(home);
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg-config'));
  for (const path of [join(root, 'xdg-config'), join(root, 'other-managed-directory'), join(home, '.config', 'rhythm')]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  // Establish private imported-service stores before the first dynamic import.
  vi.stubEnv('DB_CLIENT', 'sqlite');
  vi.stubEnv('DB_PATH', join(root, 'rhythm.db'));
  vi.stubEnv('MEMORY_VAULT_PATH', join(root, 'memory'));
  vi.stubEnv('RHYTHM_ACCOUNTS_FILE', join(root, 'anthropic-accounts.json'));
  vi.stubEnv('RHYTHM_OPENAI_ACCOUNTS_FILE', join(root, 'openai-accounts.json'));
  vi.stubEnv('RHYTHM_DECISION_ROUTER_FILE', join(root, 'decision-router.json'));
  vi.stubEnv('RHYTHM_OPENCODE_CONFIG_PATH', managedPath);
  vi.stubEnv('OPENCODE_CONFIG_DIR', join(root, 'other-managed-directory'));
  vi.stubEnv('RHYTHM_AGENT_URL', 'http://127.0.0.1:49999');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('contract forbids network')));
  const module = await import('../services/opencode_client_service');
  svc = new module.OpencodeClientService();
  const productionEnsure = svc.ensureRhythmMcp.bind(svc);
  // Fail CLOSED before every invocation, including cases that alter env/options.
  // The independently verified sandbox-exec profile is a required second layer.
  svc.ensureRhythmMcp = async (token, url, opts) => {
    expect(require('os').homedir()).toBe(home);
    const stat = lstatSync(root);
    expect(realpathSync(root)).toBe(root);
    expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true);
    expect(stat.uid).toBe(process.getuid!());
    expect(stat.mode & 0o777).toBe(0o700);
    expect(process.env.DB_PATH).toBe(join(root, 'rhythm.db'));
    expect(process.env.HOME).toBe(home);
    const managedDefault = process.env.RHYTHM_OPENCODE_CONFIG_PATH?.trim() ||
      join(process.env.OPENCODE_CONFIG_DIR!, 'opencode.json');
    for (const path of [homePath, managedPath, explicitPath, managedDefault,
      opts?.configPath ?? managedDefault,
      opts?.deletionPath ?? join(opts?.configPath ? dirname(opts.configPath) : join(home, '.config', 'rhythm'), 'mcp-deletions.json')]) {
      expect(isAbsolute(path)).toBe(true);
      const inside = relative(root, path);
      expect(inside !== '' && inside !== '..' && !inside.startsWith('../') && !isAbsolute(inside)).toBe(true);
      expect(realpathSync(dirname(path))).toBe(dirname(path));
      expect(lstatSync(dirname(path)).uid).toBe(process.getuid!());
      if (existsSync(path)) {
        const file = lstatSync(path);
        expect(file.isFile() && !file.isSymbolicLink()).toBe(true);
        expect(file.uid).toBe(process.getuid!());
        expect(file.nlink).toBe(1);
      }
    }
    return productionEnsure(token, url, opts);
  };
  desired = { type: 'local', timeout: 600_000, command: module.resolveRhythmMcpCommand(),
    environment: { RHYTHM_API_URL: 'https://fixture.invalid', RHYTHM_AGENT_URL: 'http://127.0.0.1:49999', RHYTHM_API_TOKEN: 'invented-contract-token' } };
  activePath = managedPath; nativeMcp = {}; connectedMcp = {};
  addFault = null; reloadFault = null; addCount = 0; reloadCount = 0;
  addData = { rhythm: { status: 'connected' } };
  // mcp.add can connect in memory while status still uses memoized persisted
  // config: the production #1134 cache boundary, not a call-count success stub.
  Object.assign(svc, { status: 'ready', client: { mcp: {
    add: async ({ body }: { body: { name: string; config: unknown } }) => {
      addCount++;
      if (addFault === 'throw') throw new Error('invented SDK registration failure');
      if (addFault === 'envelope') return { error: { message: 'invented SDK registration refusal' } };
      connectedMcp[body.name] = structuredClone(body.config);
      return { data: structuredClone(addData) };
    },
    status: async () => ({ data: structuredClone(nativeMcp) }),
  } } });
  // Exercise reloadConfig itself; replace only the v2 SDK transport it obtains.
  (svc as any).v2Client = async () => ({ app: { config: { reload: async () => {
    reloadCount++;
    if (reloadFault === 'throw') throw new Error('invented native cache failure');
    if (reloadFault === 'envelope') return { error: { message: 'invented native cache refusal' } };
    nativeMcp = JSON.parse(readFileSync(activePath, 'utf8')).mcp;
    return { data: true };
  } } } });
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (root?.startsWith('/private/tmp/rhythm-managed-mcp-contract-')) rmSync(root, { recursive: true, force: true });
});

it('managed-mcp-c1: explicit configPath and register:false remain test-controlled and offline', async () => {
  const managedBefore = readFileSync(managedPath, 'utf8'), homeBefore = readFileSync(homePath, 'utf8');
  const result = await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: explicitPath, register: false });
  expect(result).toEqual({ changed: true, registered: false });
  expect(JSON.parse(readFileSync(explicitPath, 'utf8')).mcp.rhythm).toEqual(desired);
  expect(readFileSync(managedPath, 'utf8')).toBe(managedBefore);
  expect(readFileSync(homePath, 'utf8')).toBe(homeBefore);
  expect({ addCount, reloadCount }).toEqual({ addCount: 0, reloadCount: 0 });
});

it('managed-mcp-c2: default ensure selects managed config despite an identical unrelated home entry', async () => {
  writeFileSync(homePath, JSON.stringify({ mcp: { rhythm: desired, foreign: { enabled: false } } }));
  const homeBefore = readFileSync(homePath, 'utf8');
  const result = await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { register: false });
  expect(JSON.parse(readFileSync(managedPath, 'utf8')).mcp.rhythm).toEqual(desired);
  expect(result.changed).toBe(true);
  expect(readFileSync(homePath, 'utf8')).toBe(homeBefore);
});

it('managed-mcp-c3: OPENCODE_CONFIG_DIR supplies the managed default when the explicit environment path is absent', async () => {
  vi.stubEnv('RHYTHM_OPENCODE_CONFIG_PATH', '');
  vi.stubEnv('OPENCODE_CONFIG_DIR', join(root, 'managed'));
  const homeBefore = readFileSync(homePath, 'utf8');
  await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { register: false });
  expect(JSON.parse(readFileSync(managedPath, 'utf8')).mcp.rhythm).toEqual(desired);
  expect(readFileSync(homePath, 'utf8')).toBe(homeBefore);
});

it('managed-mcp-c4: native config cache sees the trusted persisted integration after a changed ensure', async () => {
  const result = await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath });
  expect(result).toEqual({ changed: true, registered: true });
  expect(connectedMcp.rhythm).toEqual(desired);
  expect((await (svc as any).client.mcp.status()).data.rhythm).toEqual(desired);
  expect(JSON.parse(readFileSync(managedPath, 'utf8')).mcp.other).toEqual({ type: 'local', command: ['invented-offline-command'] });
});

it('managed-mcp-c5: identical persisted config still establishes native registration and cache visibility', async () => {
  writeFileSync(managedPath, JSON.stringify({ mcp: { rhythm: desired } }));
  const before = readFileSync(managedPath, 'utf8');
  const result = await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath });
  expect(result).toEqual({ changed: false, registered: true });
  expect(connectedMcp.rhythm).toEqual(desired);
  expect((await (svc as any).client.mcp.status()).data.rhythm).toEqual(desired);
  expect(readFileSync(managedPath, 'utf8')).toBe(before);
});

it('managed-mcp-c6: SDK registration error envelope cannot resolve as successful ensure', async () => {
  addFault = 'envelope';
  await expect(svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath })).rejects.toMatchObject({ code: 'SDK_ERROR' });
  expect(nativeMcp.rhythm).toBeUndefined();
});

it('managed-mcp-c7: thrown SDK registration failure cannot resolve as successful ensure', async () => {
  addFault = 'throw';
  await expect(svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath })).rejects.toMatchObject({ code: 'SDK_ERROR' });
  expect(nativeMcp.rhythm).toBeUndefined();
});

it('managed-mcp-c8: native cache error envelope cannot resolve as successful ensure', async () => {
  reloadFault = 'envelope';
  await expect(svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath })).rejects.toMatchObject({ code: 'SDK_ERROR' });
  expect(nativeMcp.rhythm).toBeUndefined();
});

it('managed-mcp-c9: thrown native cache failure cannot resolve as successful ensure', async () => {
  reloadFault = 'throw';
  await expect(svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath })).rejects.toMatchObject({ code: 'SDK_ERROR' });
  expect(nativeMcp.rhythm).toBeUndefined();
});

it('managed-mcp-c10: identical offline ensure remains byte-identical without native work', async () => {
  writeFileSync(explicitPath, JSON.stringify({ mcp: { rhythm: desired } }));
  const before = readFileSync(explicitPath, 'utf8');
  expect(await svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: explicitPath, register: false }))
    .toEqual({ changed: false, registered: false });
  expect(readFileSync(explicitPath, 'utf8')).toBe(before);
  expect({ addCount, reloadCount }).toEqual({ addCount: 0, reloadCount: 0 });
});

// Native HTTP 200 / no SDK error is insufficient: only the named Rhythm
// integration's connected status establishes a successful live registration.
// Invented detail canaries must never be reflected into an API-facing error.
it.each([
  { id: 'managed-mcp-c11', name: 'failed Rhythm status', data: { rhythm: { status: 'failed', error: 'invented-status-body-canary' } } },
  { id: 'managed-mcp-c12', name: 'disabled Rhythm status', data: { rhythm: { status: 'disabled', detail: 'invented-status-body-canary' } } },
  { id: 'managed-mcp-c13', name: 'configured Rhythm status', data: { rhythm: { status: 'configured', detail: 'invented-status-body-canary' } } },
  { id: 'managed-mcp-c14', name: 'missing Rhythm entry despite another connected server', data: { other: { status: 'connected', detail: 'invented-status-body-canary' } } },
  { id: 'managed-mcp-c15', name: 'null native status data', data: null },
  { id: 'managed-mcp-c16', name: 'array instead of native status map', data: [{ rhythm: { status: 'connected' }, detail: 'invented-status-body-canary' }] },
  { id: 'managed-mcp-c17', name: 'malformed Rhythm entry', data: { rhythm: 'invented-status-body-canary' } },
  { id: 'managed-mcp-c18', name: 'malformed Rhythm status', data: { rhythm: { status: { detail: 'invented-status-body-canary' } } } },
])('$id: $name rejects with body-free SDK_ERROR', async ({ data }) => {
  addData = data;
  const result = svc.ensureRhythmMcp('invented-contract-token', 'https://fixture.invalid', { configPath: managedPath });
  await expect(result).rejects.toMatchObject({ code: 'SDK_ERROR' });
  await result.catch((error: Error) => {
    expect(String(error.message) + JSON.stringify(error)).not.toContain('invented-status-body-canary');
  });
});
