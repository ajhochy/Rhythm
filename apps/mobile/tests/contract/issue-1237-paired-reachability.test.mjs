import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoRoot = new URL('../../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repoRoot), 'utf8');

test('issue-1237-c4: authoritative offline copy preserves paired-host distinctions', async () => {
  // Regression caught: treating every saved-host failure as "not paired"
  // erases the actionable iPhone-offline and Tailscale-unreachable states.
  const [store, labels] = await Promise.all([
    read('apps/mobile/lib/pairing/paired-host-store.ts'),
    read('apps/mobile/components/settings/paired-mac-section.tsx'),
  ]);

  assert.match(store, /This iPhone is offline\. Your paired Mac is still saved\./);
  assert.match(store, /Tailscale cannot reach the paired Mac\./);
  assert.match(store, /Pair this iPhone with your Mac to use Rhythm Agents\./);
  assert.match(labels, /offline:\s*'iPhone offline'/);
  assert.match(labels, /tailscaleUnavailable:\s*'Tailscale unavailable'/);
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
    /!pairedHost\.host \|\| pairedHost\.state === 'connected'/,
  );
  assert.ok(
    chatDetail.indexOf('if (!pairedHostAvailable)') <
      chatDetail.indexOf('if (!sessionId || opencode.currentSessionId !== sessionId)'),
    'paired-host loss must exit session loading before rendering its spinner',
  );
  assert.match(
    chatDetail,
    /sessionTransportAvailable[\s\S]*opencode\.connection\.status === 'connected'/,
  );
  assert.match(runtime, /createPairedHostStore/);
  assert.match(fakeState, /mobileReachability:\s*'online'/);
  const { createState } = await import(
    new URL('../fake-opencode/state.mjs', import.meta.url)
  );
  assert.equal(createState('happy-path').mobileReachability, 'online');
});
