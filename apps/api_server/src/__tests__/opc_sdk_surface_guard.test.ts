/**
 * SDK SURFACE GUARD — the highest-leverage false-green tripwire.
 *
 * Background (postmortem 2026-06-13-smoke-sdk-shape-false-green):
 *   The hand-written `src/@types/opencode-ai-sdk.d.ts` once declared shapes that
 *   did NOT match the real installed `@opencode-ai/sdk`. Production followed the
 *   d.ts (e.g. `client.agents(...)`, `raw.data` for the event stream); tests
 *   mocked ABOVE the SDK boundary with fakes that ALSO matched the wrong d.ts.
 *   tsc + vitest were green; production threw `client.agents is not a function`
 *   and silently dropped the event stream.
 *
 * This file imports the REAL SDK, instantiates a REAL client, and asserts that
 * every namespace/method our production code calls actually exists on it. It is
 * deliberately independent of our service layer: it checks the SDK surface our
 * code DEPENDS ON against the SDK that is actually installed. If `@opencode-ai/
 * sdk` ships a breaking rename, or someone edits the hand-written d.ts to
 * declare a method the real SDK lacks, THIS test goes red — before a smoke does.
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
  // Top-level method (NOT under a namespace) — the permission responder.
  'postSessionIdPermissionsPermissionId',
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
let sdkModule: Record<string, unknown>;

beforeAll(async () => {
  // Native ESM import — vitest handles this; production uses the Function shim.
  sdkModule = (await import('@opencode-ai/sdk')) as Record<string, unknown>;
  const createOpencodeClient = sdkModule.createOpencodeClient as (cfg: {
    baseUrl: string;
  }) => Record<string, unknown>;
  // No network is performed by instantiation. baseUrl is a parked address.
  realClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:1' });
});

describe('SDK surface guard: every production call site exists on the REAL client', () => {
  it('exposes createOpencodeClient + OpencodeClient from the real module', () => {
    expect(typeof sdkModule.createOpencodeClient).toBe('function');
    expect(typeof sdkModule.OpencodeClient).toBe('function');
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

describe('SDK surface guard: hand-written d.ts namespaces all exist on the REAL client', () => {
  // Read the hand-written declaration file and assert each top-level namespace
  // it declares under `interface OpencodeClient` is present on the real client.
  // This is the drift detector: a d.ts that invents a namespace the real SDK
  // lacks will fail here even if no code calls it yet.
  const DTS_PATH = join(__dirname, '..', '@types', 'opencode-ai-sdk.d.ts');

  // Namespaces our d.ts declares on OpencodeClient. Kept explicit (rather than
  // regex-scraped) so the assertion itself is reviewable; the test below also
  // proves these strings actually appear in the d.ts so the list can't silently
  // drift from the file.
  const DECLARED_NAMESPACES = [
    'config',
    'session',
    'mcp',
    'provider',
    'auth',
    'event',
    'command',
    'app',
  ];

  let dtsText: string;
  beforeAll(() => {
    dtsText = readFileSync(DTS_PATH, 'utf8');
  });

  it.each(DECLARED_NAMESPACES)('d.ts declares `%s` AND it exists on the real client', (ns) => {
    // 1. The namespace is actually declared in our d.ts (keeps this list honest).
    expect(dtsText).toMatch(new RegExp(`\\n\\s*${ns}\\s*:\\s*\\{`));
    // 2. It exists on the real client object.
    expect(typeof resolvePath(realClient, ns)).toBe('object');
  });

  it('declares the top-level permission method that the real client exposes', () => {
    expect(dtsText).toContain('postSessionIdPermissionsPermissionId');
    expect(typeof realClient.postSessionIdPermissionsPermissionId).toBe('function');
  });
});

describe('SDK surface guard: event.subscribe is an SSE { stream } result, NOT a { data,error } envelope', () => {
  // This is the #685 shape. We cannot CALL subscribe without a live engine, so
  // we prove the shape three ways from source-of-truth files (the documented
  // fallback when a method can't be runtime-exercised):
  //   1. The real SSE result type carries `stream`, not an envelope.
  //   2. The real sdk.gen.d.ts types subscribe() as a ServerSentEventsResult.
  //   3. Our hand-written d.ts declares subscribe() -> { stream }, NOT SdkEnvelope.
  // Resolve the SDK's generated-types dir by walking up from this file looking
  // for node_modules/@opencode-ai/sdk/dist/gen. This is layout-agnostic: locally
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
        'dist',
        'gen',
      );
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      'Could not locate @opencode-ai/sdk/dist/gen in any ancestor node_modules. ' +
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

  it('our hand-written d.ts declares event.subscribe() -> { stream }, not SdkEnvelope', () => {
    const dts = readFileSync(join(__dirname, '..', '@types', 'opencode-ai-sdk.d.ts'), 'utf8');
    const eventBlock = dts.match(/event:\s*\{([\s\S]*?)\n\s{4}\};/);
    expect(eventBlock, 'Could not find the event namespace in the hand-written d.ts').not.toBeNull();
    // Strip comment lines — explanatory prose mentions "SdkEnvelope" on purpose;
    // we only care about the actual declaration.
    const code = eventBlock![1]
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).toMatch(/stream\s*:\s*AsyncIterable<Event>/);
    // Regression guard: the wrong shape wrapped the subscribe return in SdkEnvelope.
    expect(code).not.toMatch(/subscribe\([\s\S]*?Promise<\s*SdkEnvelope/);
    expect(code).not.toContain('SdkEnvelope');
  });
});
