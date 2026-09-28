import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHermesAccountsMain } from '../src/hermes-accounts-main.mjs';

function fixture(t, { source = { openai: { type: 'api', key: 'synthetic-secret' } }, nativeEnv, nativeAuth } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-eligibility-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), hermesHome = path.join(home, '.hermes'), grants = path.join(root, 'grants');
  fs.mkdirSync(path.join(home, '.local/share/opencode'), { recursive: true, mode: 0o700 }); fs.mkdirSync(hermesHome, { mode: 0o700 }); fs.mkdirSync(grants, { mode: 0o700 });
  const authPath = path.join(home, '.local/share/opencode/auth.json');
  if (source !== null) fs.writeFileSync(authPath, typeof source === 'string' ? source : JSON.stringify(source), { mode: 0o600 });
  if (nativeEnv !== undefined) fs.writeFileSync(path.join(hermesHome, '.env'), nativeEnv, { mode: 0o600 });
  if (nativeAuth !== undefined) fs.writeFileSync(path.join(hermesHome, 'auth.json'), JSON.stringify(nativeAuth), { mode: 0o600 });
  const contents = {}, frame = {}, event = { sender: contents, senderFrame: frame };
  const adapter = createHermesAccountsMain({ osHome: home, hermesHome, grantsPath: path.join(grants, 'grants.json'), getAuthState: () => ({ authenticated: true, serverOrigin: 'https://rhythm.test', userId: '7', authGeneration: 'fixture' }), getDocumentState: () => ({ contents, frame, url: 'rhythm://app/index.html', epoch: 1 }), confirmNative: async () => true, disposeOwnedBackend: async () => {} });
  return { adapter, event, authPath, hermesHome, status: () => adapter.getStatus(event) };
}
for (const [name, options, expected] of [
  ['static Rhythm key', {}, ['static-api-key', 'absent', 'eligible']],
  ['native env takes precedence', { nativeEnv: 'OPENAI_API_KEY=synthetic-native\n' }, ['static-api-key', 'present', 'hermes-owned']],
  ['native-only env is never mislabeled Rhythm shareable', { source: null, nativeEnv: 'OPENAI_API_KEY=synthetic-native\n' }, ['absent', 'present', 'hermes-owned']],
  ['unreadable oversized env stays unknown', { nativeEnv: 'x'.repeat(1024 * 1024 + 1) }, ['static-api-key', 'unknown', 'source-unavailable']],
  ['malformed native auth stays unknown', { nativeAuth: 'invalid-shape' }, ['static-api-key', 'unknown', 'source-unavailable']],
  ['native auth provider is presence only', { nativeAuth: { version: 1, providers: { openai: { type: 'oauth', refresh_token: 'synthetic-private' } } } }, ['static-api-key', 'present', 'hermes-owned']],
  ['OAuth is never shared', { source: { openai: { type: 'oauth', refresh: 'synthetic-private' } } }, ['oauth', 'absent', 'oauth-not-shareable']],
  ['missing source stays absent', { source: null }, ['absent', 'absent', 'source-missing']],
  ['malformed source stays unknown', { source: '{invalid' }, ['unknown', 'absent', 'source-unavailable']],
  ['future native schema blocks sharing', { nativeAuth: { version: 999, providers: {} } }, ['static-api-key', 'unknown', 'source-unavailable']],
  ['newline key is not eligible', { source: { openai: { type: 'api', key: 'synthetic\nsecret' } } }, ['unknown', 'absent', 'source-unavailable']],
  ['NUL key is not eligible', { source: { openai: { type: 'api', key: 'synthetic\0secret' } } }, ['unknown', 'absent', 'source-unavailable']],
]) test(`S4-M: ${name}`, async t => {
  const f = fixture(t, options); const status = await f.status(); const provider = status.providers.openai;
  assert.deepEqual([provider.rhythmSourceState, provider.hermesSourceState, provider.sharingEligibility], expected);
  assert.equal(JSON.stringify(status).includes('synthetic'), false, 'No value or fingerprint may enter the DTO');
});
test('S4-M: grant reference survives source removal but no longer claims eligible', async t => {
  const f = fixture(t); await f.adapter.setGrant(f.event, { action: 'enable', provider: 'openai', source: 'opencode-auth-json' });
  fs.unlinkSync(f.authPath);
  const status = await f.status();
  assert.equal(status.providers.openai.grantEnabled, true);
  assert.equal(status.providers.openai.applicationState, 'configured');
  assert.equal(status.providers.openai.sharingEligibility, 'source-missing');
});
