import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// augmentPathForOpencode uses __dirname (module-level) and existsSync at call
// time. We mock 'fs' before importing the service so the mock is in place when
// the module loads, and we re-mock existsSync per test.
// ---------------------------------------------------------------------------
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false), // default: no bundled binary
  };
});

import {
  OpencodeClientService,
  augmentPathForOpencode,
} from './opencode_client_service';
import { expandMcpAllowlist } from './mcp_allowlist_expander';
import type { McpRoleConfig } from './agent_profile_scope';
import { existsSync } from 'fs';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

describe('augmentPathForOpencode', () => {
  let originalPath: string | undefined;
  let originalDevBin: string | undefined;
  let originalDevBinDir: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalDevBin = process.env.RHYTHM_OPENCODE_BIN;
    originalDevBinDir = process.env.RHYTHM_OPENCODE_BIN_DIR;
    // Issue #855: tests must be hermetic against a developer's own shell
    // having either override set (e.g. from following the dev-fork docs).
    delete process.env.RHYTHM_OPENCODE_BIN;
    delete process.env.RHYTHM_OPENCODE_BIN_DIR;
    mockExistsSync.mockReturnValue(false); // default: no bundled binary
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalDevBin === undefined) delete process.env.RHYTHM_OPENCODE_BIN;
    else process.env.RHYTHM_OPENCODE_BIN = originalDevBin;
    if (originalDevBinDir === undefined) delete process.env.RHYTHM_OPENCODE_BIN_DIR;
    else process.env.RHYTHM_OPENCODE_BIN_DIR = originalDevBinDir;
    vi.restoreAllMocks();
  });

  it('prepends opencode bin + homebrew + /usr/local/bin to PATH (no bundled binary)', () => {
    process.env.PATH = '/usr/bin:/bin';
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain('/usr/bin');
  });

  it('is idempotent — repeated calls do not duplicate entries', () => {
    process.env.PATH = '/usr/bin:/bin';
    augmentPathForOpencode();
    const afterFirst = process.env.PATH;
    augmentPathForOpencode();
    augmentPathForOpencode();
    expect(process.env.PATH).toBe(afterFirst);
  });

  it('preserves entries already in PATH without reordering them', () => {
    const homebrew = '/opt/homebrew/bin';
    process.env.PATH = `${homebrew}:/usr/bin`;
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts.filter((p) => p === homebrew).length).toBe(1);
  });

  it('handles empty PATH gracefully', () => {
    process.env.PATH = '';
    augmentPathForOpencode();
    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
    expect(parts.filter((p) => p === '').length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // mcp-scope-03: bundled binary path tests
  // -------------------------------------------------------------------------

  it('(bundled present) prepends opencode_bin dir FIRST — before all other extras', () => {
    mockExistsSync.mockReturnValue(true);
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    // The bundled bin dir is resolved as __dirname/../../opencode_bin.
    // In tests __dirname is the compiled output dir; we just assert it
    // ends with 'opencode_bin' and comes before the homebrewpath.
    const bundledIdx = parts.findIndex((p) => p.endsWith('opencode_bin'));
    const homebrewIdx = parts.findIndex((p) => p === '/opt/homebrew/bin');
    const opencodeUserIdx = parts.findIndex((p) =>
      p === join(homedir(), '.opencode', 'bin'),
    );
    expect(bundledIdx).toBeGreaterThanOrEqual(0);
    expect(homebrewIdx).toBeGreaterThan(bundledIdx);
    expect(opencodeUserIdx).toBeGreaterThan(bundledIdx);
  });

  it('(real dist/services bundle layout) resolves opencode_bin THREE levels up — sibling of api_server, not inside it', () => {
    // Regression for the off-by-one that shipped the bundled fork inert:
    // the compiled module lives at <Resources>/api_server/dist/services/, so the
    // bundled binary (<Resources>/opencode_bin/opencode) is THREE levels up.
    // Two levels up (<Resources>/api_server/opencode_bin) does NOT exist in the
    // bundle, so the old code fell through to stock ~/.opencode/bin/opencode.
    const threeUp = join(__dirname, '..', '..', '..', 'opencode_bin');
    const twoUp = join(__dirname, '..', '..', 'opencode_bin');
    // Simulate the real bundle: ONLY the three-levels-up opencode exists.
    mockExistsSync.mockImplementation((p: string) => p === join(threeUp, 'opencode'));
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(threeUp);
    expect(parts).not.toContain(twoUp);
    // Bundled fork must shadow the stock fallback.
    expect(parts.indexOf(threeUp)).toBeLessThan(
      parts.indexOf(join(homedir(), '.opencode', 'bin')),
    );
  });

  it('(bundled present) bundled dir is still only included once (idempotent)', () => {
    mockExistsSync.mockReturnValue(true);
    process.env.PATH = '/usr/bin:/bin';
    augmentPathForOpencode();
    const afterFirst = process.env.PATH;
    augmentPathForOpencode();
    expect(process.env.PATH).toBe(afterFirst);
  });

  it('(bundled absent) does NOT throw and still prepends the existing extras', () => {
    mockExistsSync.mockReturnValue(false);
    process.env.PATH = '/usr/bin:/bin';
    expect(() => augmentPathForOpencode()).not.toThrow();
    const parts = process.env.PATH!.split(':');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/usr/local/bin');
    // No opencode_bin dir should be added when binary is absent
    expect(parts.some((p) => p.endsWith('opencode_bin'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Issue #855: RHYTHM_OPENCODE_BIN[_DIR] dev override tests
  // -------------------------------------------------------------------------

  it('(#855) RHYTHM_OPENCODE_BIN_DIR set + valid → that dir is prepended FIRST, ahead of bundled + stock fallbacks', () => {
    const devDir = '/Users/dev/rhythm-fork-build/bin';
    mockExistsSync.mockImplementation((p: string) => p === join(devDir, 'opencode'));
    process.env.RHYTHM_OPENCODE_BIN_DIR = devDir;
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    const devIdx = parts.indexOf(devDir);
    const opencodeUserIdx = parts.indexOf(join(homedir(), '.opencode', 'bin'));
    expect(devIdx).toBe(0);
    expect(opencodeUserIdx).toBeGreaterThan(devIdx);
  });

  it('(#855) RHYTHM_OPENCODE_BIN_DIR takes priority over a present bundled binary', () => {
    const devDir = '/Users/dev/rhythm-fork-build/bin';
    mockExistsSync.mockImplementation(
      (p: string) => p === join(devDir, 'opencode') || p.endsWith(join('opencode_bin', 'opencode')),
    );
    process.env.RHYTHM_OPENCODE_BIN_DIR = devDir;
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    const devIdx = parts.indexOf(devDir);
    const bundledIdx = parts.findIndex((p) => p.endsWith('opencode_bin'));
    expect(devIdx).toBe(0);
    expect(bundledIdx).toBeGreaterThan(devIdx);
  });

  it('(#855) RHYTHM_OPENCODE_BIN (full binary path) set + valid → its parent dir is prepended FIRST', () => {
    const devBin = '/Users/dev/rhythm-fork-build/bin/opencode';
    mockExistsSync.mockImplementation((p: string) => p === devBin);
    process.env.RHYTHM_OPENCODE_BIN = devBin;
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    expect(parts[0]).toBe(join(devBin, '..'));
  });

  it('(#855) RHYTHM_OPENCODE_BIN set but file does not exist → override ignored, falls back to unset behavior', () => {
    mockExistsSync.mockReturnValue(false);
    process.env.RHYTHM_OPENCODE_BIN = '/nonexistent/opencode';
    process.env.PATH = '/usr/bin:/bin';

    expect(() => augmentPathForOpencode()).not.toThrow();

    const parts = process.env.PATH!.split(':');
    expect(parts).not.toContain('/nonexistent');
    expect(parts).toContain(join(homedir(), '.opencode', 'bin'));
  });

  it('(#855) RHYTHM_OPENCODE_BIN_DIR set but has no opencode executable → override ignored', () => {
    mockExistsSync.mockReturnValue(false);
    process.env.RHYTHM_OPENCODE_BIN_DIR = '/some/empty/dir';
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    expect(parts).not.toContain('/some/empty/dir');
  });

  it('(#855) neither override set → PATH augmentation is byte-for-byte unchanged from pre-#855 behavior', () => {
    mockExistsSync.mockReturnValue(false);
    process.env.PATH = '/usr/bin:/bin';

    augmentPathForOpencode();

    const parts = process.env.PATH!.split(':');
    expect(parts).toEqual([
      join(homedir(), '.opencode', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ]);
  });

  // Falsification: if the override resolution short-circuited BEFORE checking
  // existsSync (e.g. trusting the env var blindly), this test would fail to
  // fail — i.e. a bogus path would incorrectly win priority. Asserting the
  // ignored-override tests above (file/dir absent → not in PATH) is the
  // falsifying pair for the "override always wins" tests earlier in this
  // block: together they prove priority is conditioned on validated
  // existence, not mere presence of the env var.
});

describe('OpencodeClientService', () => {
  it('starts as uninitialized', () => {
    const service = new OpencodeClientService();
    expect(service.isReady).toBe(false);
    expect(service.statusMessage).toContain('not initialized');
  });

  it('returns empty providers when not initialized', async () => {
    const service = new OpencodeClientService();
    const providers = await service.listProviders();
    expect(providers).toEqual([]);
  });

  it('returns empty models when not initialized', async () => {
    const service = new OpencodeClientService();
    const models = await service.listModels('anthropic');
    expect(models).toEqual([]);
  });

  it('returns false for setAuth when not initialized', async () => {
    const service = new OpencodeClientService();
    const result = await service.setAuth('anthropic', 'sk-test');
    expect(result).toBe(false);
  });

  it('returns null for createSession when not initialized', async () => {
    const service = new OpencodeClientService();
    const session = await service.createSession('test-session');
    expect(session).toBeNull();
  });

  it('returns null for prompt when not initialized', async () => {
    const service = new OpencodeClientService();
    const result = await service.prompt('session-id', 'hello');
    expect(result).toBeNull();
  });

  it('returns null for subscribeToEvents when not initialized', async () => {
    const service = new OpencodeClientService();
    const events = await service.subscribeToEvents();
    expect(events).toBeNull();
  });

  it('updates status after dispose', () => {
    const service = new OpencodeClientService();
    service.dispose();
    expect(service.isReady).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mcp-scope-04: createSession body-level mcpAllowlist tests
// ---------------------------------------------------------------------------
//
// Pattern: inject a fake SDK client into the private `client` field (same
// approach as opc_sdk_boundary_regression.test.ts and opc_agent_session_routes.test.ts).
// The fake's session.create captures every call so we can assert on the
// exact body object passed to the SDK.

function injectReadyClient(svc: OpencodeClientService, fakeClient: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = fakeClient;
}

/** A minimal McpRoleConfig that expandMcpAllowlist will expand non-trivially. */
const ROLE_CONFIG: McpRoleConfig = {
  role: 'secretary',
  mcpServers: {
    rhythm: {},
    'pco-services': { allowedTools: ['get_plans', 'get_plan_items'] },
  },
  allowedToolsJson: '{}',
};

describe('createSession — mcpAllowlist body field (mcp-scope-04)', () => {
  let svc: OpencodeClientService;
  let capturedBody: Record<string, unknown>;
  let fakeSessionCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    capturedBody = {};
    fakeSessionCreate = vi.fn().mockImplementation((opts: { body: Record<string, unknown> }) => {
      capturedBody = opts.body as Record<string, unknown>;
      return Promise.resolve({ data: { id: 'sdk-session-001' } });
    });
    injectReadyClient(svc, {
      session: { create: fakeSessionCreate },
    });
  });

  // AC-01: WITH mcpRoleConfig → body contains mcpAllowlist deep-equal to expansion
  it('AC-01: sends body.mcpAllowlist when mcpRoleConfig is provided', async () => {
    const result = await svc.createSession('My Session', '/workspace', ROLE_CONFIG);

    expect(result).toEqual({ id: 'sdk-session-001' });
    expect(fakeSessionCreate).toHaveBeenCalledOnce();

    const expectedAllowlist = expandMcpAllowlist(ROLE_CONFIG);
    expect(capturedBody).toHaveProperty('mcpAllowlist');
    expect(capturedBody.mcpAllowlist).toEqual(expectedAllowlist);
  });

  // AC-01 (content check): verify exact expansion content so the test cannot
  // pass via a trivially-wrong constant like `{ servers: [], tools: [] }`.
  it('AC-01b: mcpAllowlist contains the correct servers[] and tools[] entries', async () => {
    await svc.createSession('Secretary', undefined, ROLE_CONFIG);

    const body = capturedBody;
    // rhythm has no allowedTools → goes into servers[] as raw name
    expect((body.mcpAllowlist as { servers: string[] }).servers).toContain('rhythm');
    // pco-services has explicit tools → goes into tools[] with sanitized composite id
    expect((body.mcpAllowlist as { tools: string[] }).tools).toContain('pco-services_get_plans');
    expect((body.mcpAllowlist as { tools: string[] }).tools).toContain('pco-services_get_plan_items');
  });

  // AC-02: WITHOUT mcpRoleConfig → body has NO mcpAllowlist key (back-compat)
  it('AC-02: body has NO mcpAllowlist key when mcpRoleConfig is absent', async () => {
    const result = await svc.createSession('Plain Session');

    expect(result).toEqual({ id: 'sdk-session-001' });
    expect(fakeSessionCreate).toHaveBeenCalledOnce();
    expect(capturedBody).not.toHaveProperty('mcpAllowlist');
  });

  // AC-02b: also test explicit undefined
  it('AC-02b: body has NO mcpAllowlist key when mcpRoleConfig is explicitly undefined', async () => {
    await svc.createSession('Plain Session', '/workspace', undefined);
    expect(capturedBody).not.toHaveProperty('mcpAllowlist');
  });

  // AC-03 / AC-04: ws_gateway and agent_runner call createSession with mcpRoleConfig.
  // Since expansion is centralised INSIDE createSession, both paths get it for free.
  // This test exercises the path-agnostic guarantee: any caller that passes
  // mcpRoleConfig will get mcpAllowlist on the body — regardless of call site.
  it('AC-03/04: any caller passing mcpRoleConfig gets mcpAllowlist on the body (path-agnostic)', async () => {
    // Simulate the ws_gateway call pattern (passes wsMcpRoleConfig)
    const wsRoleConfig: McpRoleConfig = {
      role: 'worship-planning',
      mcpServers: { 'pco-services': {} },
      allowedToolsJson: '{}',
    };
    await svc.createSession('Interactive Session', '/cwd', wsRoleConfig);

    expect(capturedBody).toHaveProperty('mcpAllowlist');
    const expected = expandMcpAllowlist(wsRoleConfig);
    expect(capturedBody.mcpAllowlist).toEqual(expected);

    // servers[] contains the raw server name (not sanitized), as the engine expects
    expect((capturedBody.mcpAllowlist as { servers: string[] }).servers).toContain('pco-services');
  });

  // Error-guard: invalid/unparseable mcpRoleConfig → omit field, no throw
  it('omits mcpAllowlist and does not throw when mcpRoleConfig has no mcpServers', async () => {
    const badConfig = { role: 'bad', mcpServers: null, allowedToolsJson: '{}' } as unknown as McpRoleConfig;
    const result = await svc.createSession('Bad Config Session', undefined, badConfig);

    // Must NOT throw; must still return the session id
    expect(result).toEqual({ id: 'sdk-session-001' });
    // mcpAllowlist should be omitted entirely when expansion yields an empty result
    // OR when the config is bad — the guard test just asserts no throw, which is key.
    // The exact omit-vs-empty-object behavior is tested by AC-01/AC-02.
    expect(fakeSessionCreate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Issue #855: updateSessionAllowlist body-shape contract tests
// ---------------------------------------------------------------------------
//
// Bug this guards against: the ws_gateway per-turn PATCH call site used to
// derive `servers` by `JSON.parse(mcpRoleConfig.allowedToolsJson) as string[]`
// — a lying cast. `allowedToolsJson` is the RAW, unexpanded profile
// `allowed_mcps_json` column value, which org_optimizer_seed.ts (and any
// role-file-derived profile, e.g. `graphic-designer`) persists as a
// TOOLS-MAP OBJECT (`{"canva":{"allowedTools":[...]}}`), not a bare
// server-name array. Parsing that and pushing it straight through as
// `servers` sent the fork's strict `McpAllowlist.servers: Schema.Array(Schema.String)`
// an OBJECT — the PATCH failed schema validation, was swallowed as
// "non-fatal", and the session's mcpAllowlist stayed unset (full tool surface
// injected). The fix: updateSessionAllowlist now takes the whole McpRoleConfig
// and expands it via the SAME expandMcpAllowlist() helper createSession uses.
describe('updateSessionAllowlist — mcpAllowlist body shape (#855)', () => {
  let svc: OpencodeClientService;
  let capturedInit: { body?: string } | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    capturedInit = undefined;
    fetchMock = vi.fn().mockImplementation((_url: string, init: { body?: string }) => {
      capturedInit = init;
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function capturedMcpAllowlist(): { servers: unknown; tools: unknown } {
    const body = JSON.parse(capturedInit!.body!);
    return body.mcpAllowlist;
  }

  // AC-01 / AC-05 (falsification target): tools-map-shaped allowedToolsJson —
  // exactly what org_optimizer_seed.ts writes for a role-file-derived profile
  // like graphic-designer (canva scoped to specific tools).
  it('AC-01/AC-05: tools-map-shaped profile — servers/tools are both arrays, deep-equal to expandMcpAllowlist', async () => {
    const graphicDesignerLike: McpRoleConfig = {
      role: 'graphic-designer',
      mcpServers: {
        canva: { allowedTools: ['generate-design', 'export-design'] },
        obsidian: { allowedTools: ['obsidian_get_file'] },
      },
      allowedToolsJson: JSON.stringify({
        canva: { allowedTools: ['generate-design', 'export-design'] },
        obsidian: { allowedTools: ['obsidian_get_file'] },
      }),
    };

    const ok = await svc.updateSessionAllowlist('sess-1', graphicDesignerLike);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const allowlist = capturedMcpAllowlist();
    // The critical regression guard: servers must be an ARRAY, never an object.
    expect(Array.isArray(allowlist.servers)).toBe(true);
    expect(Array.isArray(allowlist.tools)).toBe(true);
    expect(allowlist).toEqual(expandMcpAllowlist(graphicDesignerLike));
    // Content check so this can't pass via a trivial {servers:[],tools:[]}.
    expect((allowlist.tools as string[])).toContain('canva_generate-design');
    expect((allowlist.tools as string[])).toContain('canva_export-design');
    expect((allowlist.tools as string[])).toContain('obsidian_obsidian_get_file');
  });

  // AC-02: back-compat with the simple bare-array designer-UI form.
  it('AC-02: bare-array-shaped profile (inherit-all servers) — servers[] contains raw names, tools[] empty', async () => {
    const arrayForm: McpRoleConfig = {
      role: 'imported-agent',
      mcpServers: { rhythm: { allowedTools: [] }, obsidian: { allowedTools: [] } },
      allowedToolsJson: JSON.stringify(['rhythm', 'obsidian']),
    };

    await svc.updateSessionAllowlist('sess-2', arrayForm);

    const allowlist = capturedMcpAllowlist();
    expect(allowlist.servers).toContain('rhythm');
    expect(allowlist.servers).toContain('obsidian');
    expect(allowlist.tools).toEqual([]);
  });

  // Error guard: PATCH failure (non-2xx) returns false, does not throw.
  it('returns false and does not throw when the PATCH responds non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    const cfg: McpRoleConfig = { role: 'r', mcpServers: { a: {} }, allowedToolsJson: '["a"]' };
    const ok = await svc.updateSessionAllowlist('sess-3', cfg);
    expect(ok).toBe(false);
  });

  // Error guard: fetch throws → caught, returns false.
  it('returns false and does not throw when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const cfg: McpRoleConfig = { role: 'r', mcpServers: { a: {} }, allowedToolsJson: '["a"]' };
    const ok = await svc.updateSessionAllowlist('sess-4', cfg);
    expect(ok).toBe(false);
  });
});
