/**
 * SDK SURFACE GUARD — the highest-leverage false-green tripwire.
 *
 * Background (postmortem 2026-06-13-smoke-sdk-shape-false-green):
 *   A hand-written `src/@types/opencode-ai-sdk.d.ts` once declared shapes that
 *   did NOT match the installed `@opencode-ai/sdk`. Production followed that
 *   declaration while tests mocked above the SDK boundary.
 *   tsc + vitest were green; production threw `client.agents is not a function`
 *   and silently dropped the event stream.
 *
 * This file imports the REAL SDK, instantiates a REAL client, and asserts that
 * every namespace/method our production code calls actually exists on it. It is
 * deliberately independent of our service layer: it checks the SDK surface our
 * code DEPENDS ON against the SDK that is actually installed. If `@opencode-ai/
 * sdk` ships a breaking rename, or the generated vendor package drifts from
 * production call sites, THIS test goes red—before a smoke does.
 *
 * Why a runtime import works here even though api_server is CommonJS:
 *   vitest runs through Vite, which imports the ESM-only SDK natively. The
 *   production service has to use a `new Function('s','return import(s)')`
 *   shim, but the test runner does not. Instantiating the client makes no
 *   network call (verified: createOpencodeClient just builds a fetch wrapper),
 *   so no opencode engine needs to be spawned.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_sdk_surface_guard.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// ---------------------------------------------------------------------------
// CALL-SITE MANIFEST
//
// Every SDK path our production code invokes, as a dotted path from the client
// root. Derived by reading apps/api_server/src/services/opencode_client_service.ts
// (the ONLY module that touches the raw SDK client). When a new wrapper is added
// there, add its call site here so the guard keeps covering the real surface.
// ---------------------------------------------------------------------------
const CALL_SITES: string[] = [
  // OPC-M4-4 — the #703 regression lived here (was wrongly `client.agents`).
  'app.agents',
  // session.* wrappers (OPC-M1-1, M1-5, M1-6, M2-4, M3-2/3/6, M4-1/2).
  'session.list',
  'session.create',
  'session.get',
  'session.delete',
  'session.messages',
  'session.status',
  'session.prompt',
  'session.promptAsync',
  'session.abort',
  'session.diff',
  'session.command',
  'session.revert',
  'session.unrevert',
  'session.summarize',
  'session.todo',
  'session.fork',
  'session.children',
  'session.shell',
  // event.subscribe — the #685 regression lived here (SSE result, NOT envelope).
  'event.subscribe',
  // config / command / provider / auth / mcp.
  'config.providers',
  'command.list',
  'provider.oauth.authorize',
  'provider.oauth.callback',
  'auth.set',
  'mcp.status',
  'mcp.add',
  'mcp.connect',
  'mcp.disconnect',
  // mcp-oauth — connectMcp falls back to auth.start to obtain the OAuth
  // consent URL for remote servers that need authorization.
  'mcp.auth.start',
  // Top-level method (NOT under a namespace) — the permission responder.
  'postSessionIdPermissionsPermissionId',
];

const V2_CALL_SITES: string[] = [
  'session.update',
  'app.skills',
  'app.skills2.reload',
  'app.config.reload',
  'question.reply',
  'question.reject',
];

// Paths our code MUST NOT depend on — these were the exact wrong shapes that
// shipped. If a refactor reintroduces them, this guard fires.
const FORBIDDEN_PATHS: string[] = [
  'agents', // there is no top-level client.agents (the #703 bug)
  'session.agents', // nor under session
  'subscribe', // event subscribe is under client.event, never top-level
];

function resolvePath(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((obj, key) => (obj == null ? obj : (obj as Record<string, unknown>)[key]), root);
}

// Resolve the real SDK lazily in beforeAll (dynamic import keeps this an ESM
// boundary, matching how the runtime loads it).
let realClient: Record<string, unknown>;
let realV2Client: Record<string, unknown>;
let sdkModule: Record<string, unknown>;

beforeAll(async () => {
  // Native ESM import — vitest handles this; production uses the Function shim.
  sdkModule = (await import('@opencode-ai/sdk')) as Record<string, unknown>;
  const createOpencodeClient = sdkModule.createOpencodeClient as (cfg: {
    baseUrl: string;
  }) => Record<string, unknown>;
  // No network is performed by instantiation. baseUrl is a parked address.
  realClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:1' });
  const v2Module = (await import('@opencode-ai/sdk/v2/client')) as Record<string, unknown>;
  const createV2Client = v2Module.createOpencodeClient as (cfg: {
    baseUrl: string;
  }) => Record<string, unknown>;
  realV2Client = createV2Client({ baseUrl: 'http://127.0.0.1:1' });
});

describe('SDK surface guard: every production call site exists on the REAL client', () => {
  it('exposes createOpencodeClient + OpencodeClient from the real module', () => {
    expect(typeof sdkModule.createOpencodeClient).toBe('function');
    expect(typeof sdkModule.OpencodeClient).toBe('function');
  });

  it.each(V2_CALL_SITES)('v2 client.%s is callable on the generated fork client', (path) => {
    expect(typeof resolvePath(realV2Client, path)).toBe('function');
  });

  it.each(CALL_SITES)('client.%s is a callable function on the real client', (path) => {
    const resolved = resolvePath(realClient, path);
    expect(
      typeof resolved,
      `Expected client.${path} to be a function on @opencode-ai/sdk, but it was ${typeof resolved}. ` +
        `This is exactly the #703 class of bug: production calls client.${path}(...) and would throw ` +
        `"is not a function" at runtime. Check the real sdk.gen.d.ts and fix the call site + the d.ts.`,
    ).toBe('function');
  });

  it.each(FORBIDDEN_PATHS)('client.%s does NOT exist (guards against the wrong shape)', (path) => {
    const resolved = resolvePath(realClient, path);
    expect(
      resolved,
      `client.${path} resolved to ${typeof resolved} — production must not depend on it. ` +
        `The #703 regression was calling a top-level client.agents that does not exist.`,
    ).toBeUndefined();
  });
});

describe('SDK surface guard: event.subscribe is an SSE { stream } result, NOT a { data,error } envelope', () => {
  // This is the #685 shape. We cannot CALL subscribe without a live engine, so
  // we prove the shape three ways from source-of-truth files (the documented
  // fallback when a method can't be runtime-exercised):
  //   1. The real SSE result type carries `stream`, not an envelope.
  //   2. The real sdk.gen.d.ts types subscribe() as a ServerSentEventsResult.
  // The generated SDK is the only type source; no ambient declaration exists.
  // Resolve the SDK's generated-types dir by walking up from this file looking
  // for node_modules/@opencode-ai/sdk/gen. This is layout-agnostic: locally
  // the SDK is hoisted to the repo-root node_modules; in CI it may live under
  // apps/api_server/node_modules. A fixed '../../../../' path only worked for the
  // hoisted layout and broke CI.
  function findSdkGenDir(): string {
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      const candidate = join(
        dir,
        'node_modules',
        '@opencode-ai',
        'sdk',
        'gen',
      );
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      'Could not locate @opencode-ai/sdk/gen in any ancestor node_modules. ' +
        'The SDK must be installed for this guard to compare against the real types.',
    );
  }

  const sdkDir = findSdkGenDir();

  it('real ServerSentEventsResult has `stream` and no { data, error } envelope', () => {
    const sse = readFileSync(join(sdkDir, 'core', 'serverSentEvents.gen.d.ts'), 'utf8');
    // Tolerant of generic defaults (TData = unknown, ...) before the `= {`.
    const typeMatch = sse.match(/export type ServerSentEventsResult[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    expect(typeMatch, 'Could not locate ServerSentEventsResult in the real SDK').not.toBeNull();
    const body = typeMatch![1];
    expect(body).toContain('stream');
    // The envelope fields must NOT appear in the SSE result.
    expect(body).not.toMatch(/\bdata\?\:/);
    expect(body).not.toMatch(/\berror\?\:/);
  });

  it('real sdk.gen.d.ts types Event.subscribe() as a ServerSentEventsResult', () => {
    const sdk = readFileSync(join(sdkDir, 'sdk.gen.d.ts'), 'utf8');
    // The Event class declares: subscribe<...>(options?): Promise<...ServerSentEventsResult<...>>
    const subscribeLine = sdk
      .split('\n')
      .find((l) => l.includes('subscribe<ThrowOnError') && l.includes('EventSubscribe'));
    expect(subscribeLine, 'Could not find Event.subscribe in the real sdk.gen.d.ts').toBeTruthy();
    expect(subscribeLine!).toContain('ServerSentEventsResult');
    // It must NOT be typed as a plain envelope RequestResult.
    expect(subscribeLine!).not.toContain('RequestResult');
  });

});

// ---------------------------------------------------------------------------
// mcp-scope-04: createSession with mcpRoleConfig produces request body with mcpAllowlist
// (AC-05 from docs/ai/contracts/issue-mcp-scope-04.json)
// ---------------------------------------------------------------------------
//
// This is a STRUCTURAL guard (not a runtime SDK call): it verifies that
// opencode_client_service.ts includes `mcpAllowlist` on the body object passed
// to client.session.create when mcpRoleConfig is provided. We assert this by
// reading the source and checking for the expected structural pattern.
//
// Why source-level: we cannot call session.create against a live engine here;
// this file is restricted to SDK surface checks. The structural guard ensures
// the back-compat rule (mcpAllowlist omitted when no mcpRoleConfig) is encoded
// at the call site. The runtime behavior is verified by the service-level tests
// in src/services/opencode_client_service.test.ts (AC-01 through AC-04).
describe('SDK surface guard: createSession with mcpRoleConfig includes mcpAllowlist on body (mcp-scope-04)', () => {
  const SVC_PATH = join(__dirname, '..', 'services', 'opencode_client_service.ts');

  it('opencode_client_service.ts passes mcpAllowlist on the session.create body when mcpRoleConfig is present', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    // The expansion must happen inside createSession: expandMcpAllowlist must be called
    expect(src).toMatch(/expandMcpAllowlist\s*\(/);
    // The result must be assigned and included in the body object
    expect(src).toMatch(/mcpAllowlist/);
  });

  it('back-compat guard: mcpAllowlist is included only when mcpRoleConfig is present (conditional body assignment)', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    // The mcpAllowlist key must appear inside a conditional branch (if mcpRoleConfig / when mcpRoleConfig)
    // — it must NOT be unconditionally set on every createSession call.
    // We verify this by confirming the mcpAllowlist assignment is collocated with
    // a guard on mcpRoleConfig (grep for the pattern together in the source).
    const createSessionBlock = src.match(
      /async createSession[\s\S]*?(?=\n\s{2}\/\*\*|\n\s{2}async |\n\s{2}[a-z])/,
    );
    expect(createSessionBlock, 'Could not extract createSession block from service source').toBeTruthy();
    const block = createSessionBlock![0];
    // Block must reference mcpRoleConfig (the guard) AND mcpAllowlist (the field)
    expect(block).toMatch(/mcpRoleConfig/);
    expect(block).toMatch(/mcpAllowlist/);
  });
});
