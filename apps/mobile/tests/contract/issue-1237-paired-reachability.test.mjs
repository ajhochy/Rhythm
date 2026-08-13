import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = new URL('../../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repoRoot), 'utf8');

test('issue-1237-c4: authoritative offline copy preserves paired-host distinctions', async () => {
  // Regression caught: treating every saved-host failure as "not paired"
  // erases the actionable iPhone-offline and gateway-unreachable states.
  const [store, labels] = await Promise.all([
    read('apps/mobile/lib/pairing/paired-host-store.ts'),
    read('apps/mobile/components/settings/paired-mac-section.tsx'),
  ]);

  assert.match(store, /This iPhone is offline\. Your paired Mac is still saved\./);
  assert.match(store, /Rhythm Cloud Gateway cannot reach your Mac\./);
  assert.match(store, /Pair this iPhone with your Mac to use Rhythm Agents\./);
  assert.match(labels, /offline:\s*'iPhone offline'/);
  assert.match(labels, /tailscaleUnavailable:\s*'Cloud gateway unavailable'/);
  assert.match(labels, /unpaired:\s*'Not paired'/);
});

test('issue-1237-c6: one bounded paired-host probe drives all paired surfaces', async () => {
  // Regression caught: restoring independent Settings and OpenCode state
  // machines makes Settings stale while Agents is already offline.
  const [pairedProvider, opencodeProvider, settings, agentChat, chatLanding] =
    await Promise.all([
      read('apps/mobile/providers/paired-host-provider.tsx'),
      read('apps/mobile/providers/opencode-provider.tsx'),
      read('apps/mobile/app/(tabs)/settings.tsx'),
      read('apps/mobile/providers/agent-chat-provider.tsx'),
      read('apps/mobile/app/agents/chat.tsx'),
    ]);

  assert.match(pairedProvider, /PAIRED_HOST_PROBE_TIMEOUT_MS\s*=\s*\d+/);
  assert.match(pairedProvider, /PAIRED_HOST_PROBE_INTERVAL_MS\s*=\s*\d+/);
  assert.match(pairedProvider, /refreshInFlightRef/);
  assert.match(pairedProvider, /clientScopeRef/);
  assert.match(
    pairedProvider,
    /if \(clientScopeRef\.current !== nextClientScope\)/,
  );
  assert.match(
    pairedProvider,
    /if \(!current\.host\) return Promise\.resolve\(current\)/,
  );
  assert.match(opencodeProvider, /pairedHost\.state/);
  assert.match(opencodeProvider, /pairedHost\.refresh/);
  assert.match(opencodeProvider, /reachabilityFailureReported/);
  assert.match(settings, /pairedHost\.state/);
  assert.match(
    agentChat,
    /!pairedHost\.host \|\| pairedHost\.state === 'connected'/,
  );
  assert.match(chatLanding, /usePairedHost/);
  assert.doesNotMatch(
    settings,
    /connection\.status === 'connected'\s*\?\s*'Connected to OpenCode'/,
  );
});

test('issue-1237-backoff: unreachable probes back off and every recovery trigger resets to 5s', async (t) => {
  const pairedProvider = await read(
    'apps/mobile/providers/paired-host-provider.tsx',
  );
  const scheduling = pairedProvider.match(
    /export const PAIRED_HOST_PROBE_TIMEOUT_MS[\s\S]*?(?=export interface PairedHostContextValue)/,
  )?.[0];
  assert.ok(scheduling, 'provider must expose its bounded probe schedule');
  const compiled = ts.transpileModule(scheduling, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  Function('module', 'exports', compiled)(module, module.exports);
  const {
    PAIRED_HOST_PROBE_TIMEOUT_MS,
    PAIRED_HOST_PROBE_INTERVAL_MS,
    PAIRED_HOST_PROBE_BACKOFF_MS,
    nextPairedHostProbeInterval,
  } = module.exports;

  assert.equal(PAIRED_HOST_PROBE_TIMEOUT_MS, 4_000);
  assert.equal(PAIRED_HOST_PROBE_INTERVAL_MS, 5_000);
  assert.deepEqual(PAIRED_HOST_PROBE_BACKOFF_MS, [
    5_000,
    10_000,
    20_000,
    60_000,
  ]);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const firedAt = [];
  let elapsed = 0;
  let delay = PAIRED_HOST_PROBE_INTERVAL_MS;
  const schedule = () => {
    setTimeout(() => {
      elapsed += delay;
      firedAt.push(elapsed);
      delay = nextPairedHostProbeInterval(delay);
      schedule();
    }, delay);
  };
  schedule();
  for (const advance of [5_000, 10_000, 20_000, 60_000, 60_000]) {
    t.mock.timers.tick(advance);
  }
  assert.deepEqual(firedAt, [5_000, 15_000, 35_000, 95_000, 155_000]);

  assert.match(
    pairedProvider,
    /if \(next\.state === 'connected'\) resetProbeInterval\(\)/,
    'a successful recovery must restore the base cadence',
  );
  assert.match(
    pairedProvider,
    /state === 'active'[\s\S]*resetProbeInterval\(\)[\s\S]*runBoundedRefresh/,
    'foregrounding must reset before the immediate probe',
  );
  assert.match(
    pairedProvider,
    /const refresh = useCallback\([\s\S]*resetProbeInterval\(\)[\s\S]*return runBoundedRefresh/,
    'the public user retry must reset before probing',
  );
  assert.match(
    pairedProvider,
    /snapshot\.state === 'offline'[\s\S]*backOffProbeInterval/,
    'backoff must only advance after an offline state already exists',
  );
});

test('issue-1237-regression: unpaired direct-web chat stays online', async () => {
  // Regression caught: requiring PairedHostState=connected disables every
  // pre-existing fake-engine flow, because those tests intentionally never pair.
  const [agentChat, chatDetail, runtime, fakeState] = await Promise.all([
    read('apps/mobile/providers/agent-chat-provider.tsx'),
    read('apps/mobile/app/agents/chats/[sessionId].tsx'),
    read('apps/mobile/lib/runtime/mobile-runtime.e2e.ts'),
    read('apps/mobile/tests/fake-opencode/state.mjs'),
  ]);

  assert.match(
    agentChat,
    /connection\.status === 'connected'[\s\S]*!pairedHost\.host/,
  );
  assert.match(
    chatDetail,
    /!pairedHostRecord \|\| pairedHostState === 'connected'/,
  );
  assert.match(
    chatDetail,
    /pairedHostAvailable[\s\S]*'Loading the transcript and agent state\.'[\s\S]*pairedHostMessage/,
    'paired-host loss must replace generic transcript loading copy with the actionable gateway state',
  );
  assert.match(runtime, /createPairedHostStore/);
  assert.match(fakeState, /mobileReachability:\s*'online'/);
  const { createState } = await import(
    new URL('../fake-opencode/state.mjs', import.meta.url)
  );
  assert.equal(createState('happy-path').mobileReachability, 'online');
});

test('issue-1387-c3: relay health never masks a catalog connection error', async () => {
  // Regression caught: paired-host relay health was rendered as Connected even
  // while the authenticated projects request had failed with status 502.
  const settings = await read('apps/mobile/app/(tabs)/settings.tsx');

  assert.doesNotMatch(
    settings,
    /status:\s*pairedHost\.state === 'connected'\s*\?\s*'connected'\s*:\s*'error'/,
  );
  assert.match(
    settings,
    /pairedHost\.state !== 'connected'[\s\S]*connection\.status === 'connected'/,
  );
});

test('issue-1387-c5: every paired-host catalog skips project engine fan-out', async () => {
  const agentChat = await read(
    'apps/mobile/providers/agent-chat-provider.tsx',
  );

  assert.match(
    agentChat,
    /usePairedCatalogRef\s*=\s*useRef\(Boolean\(pairedHost\.host\)\)/,
  );
  assert.match(
    agentChat,
    /skipProjectScopedSweep:\s*usePairedCatalogRef\.current/,
  );
});

test('issue-1387-c8-stream-guard: relay stream reconnect never downgrades paired-host reachability', async () => {
  const provider = await read('apps/mobile/providers/opencode-provider.tsx');

  assert.match(
    provider,
    /pairedHostClient\s*&&\s*pairedHostRecord\?\.relayUrl\s*==\s*null\s*&&\s*!reachabilityFailureReported/,
    'an SSE reconnect may probe direct Tailscale, but relay reachability is owned by the independent health probe',
  );
});

test('issue-1387-c10: relay UI does not present the legacy Tailscale route', async () => {
  const [pairedSection, pairScreen, toolState] = await Promise.all([
    read('apps/mobile/components/settings/paired-mac-section.tsx'),
    read('apps/mobile/app/pair.tsx'),
    read('apps/mobile/components/tools/tool-screen-state.tsx'),
  ]);

  assert.doesNotMatch(pairedSection, /Tailscale|host\.gatewayUrl\.replace/);
  assert.match(pairedSection, /Rhythm Cloud Gateway/);
  assert.doesNotMatch(pairScreen, /Tailscale/);
  assert.match(pairScreen, /Rhythm Cloud Gateway/);
  assert.doesNotMatch(toolState, /Tailscale/);
  assert.match(toolState, /cloud gateway/i);
});

test('issue-1387-c11: owner discovery uses the generic relay tunnel catalog route', async () => {
  const client = await read('apps/mobile/lib/opencode/client.ts');

  assert.match(
    client,
    /sdkPath === '\/experimental\/session'[\s\S]*owner-unscoped[\s\S]*'\/mobile-gateway\/chat-catalog'/,
  );
});
