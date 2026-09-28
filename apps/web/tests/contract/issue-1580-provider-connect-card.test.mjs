// Issue #1580 review fix (major) — AgentSettingsTool.tsx's Accounts-card extraction dropped
// `providersCurrent` from the needs-relogin condition: a provider showing its last-known "Not
// connected" status during an in-flight providers reload/retry must NOT get the warning-colored
// `needs-relogin` styling. Node --test, no browser: renders the extracted `ProviderConnectCard`
// directly via react-dom/server against the real component module (vite ssrLoadModule), so this
// exercises the actual production JSX, not a re-implementation of its className logic.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const baseProvider = { id: 'openai', label: 'OpenAI / Codex', kind: 'oauth', method: 1, detail: 'Sign in with ChatGPT.' };
const noop = () => undefined;

async function loadProviderConnectCard() {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const mod = await vite.ssrLoadModule('/src/components/tools/AgentSettingsTool.tsx');
    return mod.ProviderConnectCard;
  } finally {
    await vite.close();
  }
}

function render(ProviderConnectCard, overrides) {
  return renderToStaticMarkup(createElement(ProviderConnectCard, {
    provider: baseProvider, connected: false, badge: 'Not connected', statusKnown: true, confirmed: true,
    apiKeyValue: '', pending: false, onApiKeyChange: noop, onAuthorize: noop, onSaveKey: noop,
    ...overrides,
  }));
}

test('1580 review-fix: needs-relogin styling requires `confirmed` (providersCurrent && authProviders loaded), not just statusKnown', async () => {
  const ProviderConnectCard = await loadProviderConnectCard();

  // In-flight reload/retry: authProviders still holds its last-known value (statusKnown=true,
  // badge says "Last known Not connected"), but this specific reload hasn't confirmed it yet
  // (providersCurrent=false -> confirmed=false). Must NOT show the warning border.
  const midReload = render(ProviderConnectCard, { statusKnown: true, confirmed: false, badge: 'Last known Not connected' });
  assert.equal(midReload.includes('needs-relogin'), false, 'a stale last-known "Not connected" during an in-flight reload must not get needs-relogin styling');

  // Confirmed and disconnected: the warning border is exactly what should show here.
  const confirmedDisconnected = render(ProviderConnectCard, { statusKnown: true, confirmed: true, badge: 'Not connected' });
  assert.equal(confirmedDisconnected.includes('needs-relogin'), true, 'a confirmed disconnected provider must show needs-relogin styling');

  // Confirmed and connected: never needs-relogin regardless of confirmation.
  const confirmedConnected = render(ProviderConnectCard, { connected: true, statusKnown: true, confirmed: true, badge: 'Connected' });
  assert.equal(confirmedConnected.includes('needs-relogin'), false, 'a connected provider must never show needs-relogin styling');

  // Never-loaded (authProviders === null): statusKnown=false drives the separate "Status
  // unknown" badge styling; it must not by itself trigger needs-relogin either (confirmed is
  // false whenever statusKnown is false, since confirmed = providersCurrent && statusKnown).
  const neverLoaded = render(ProviderConnectCard, { statusKnown: false, confirmed: false, badge: 'Status unknown' });
  assert.equal(neverLoaded.includes('needs-relogin'), false, 'an unloaded provider status must not show needs-relogin styling');
  assert.equal(neverLoaded.includes('agent-settings-status-unknown'), true, 'an unloaded provider status must still get the "Status unknown" badge styling');
});
