import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`Hermes private preflight blocked: ${message}`); };

/**
 * Metadata-only inspection of the actual pinned Hermes embedded guest.
 * Caller must pass the manifest returned by Rhythm's existing readQualificationFixture
 * helper; this module never opens the manifest, actor token, credential source, or env file.
 * Does not navigate, type, save, submit, or call reveal endpoints.
 */
export async function inspectHermesPreflight({ desktop, manifest, grant, expected, receiptPath }) {
  const root = manifest?.fixtureRoot;
  if (!root || resolve(root) !== root || !root.startsWith('/private/tmp/')) fail('fixture root is not canonical private tmp');
  const rootStat = lstatSync(root);
  if (realpathSync(root) !== root || rootStat.isSymbolicLink() || !rootStat.isDirectory()
    || rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o777) !== 0o700) fail('fixture root ownership/mode mismatch');
  if (manifest.sourceRevision !== expected.rhythmSourceRevision || manifest.ownerUserId !== expected.actorOwnerUserId
    || !manifest.syntheticActor || join(root, 'hermes-home') !== expected.hermesHome) fail('fixture/build/audience binding mismatch');
  const manifestPath = join(root, 'manifest.json');
  const manifestStat = lstatSync(manifestPath);
  if (realpathSync(manifestPath) !== manifestPath || manifestStat.isSymbolicLink() || !manifestStat.isFile()
    || manifestStat.nlink !== 1 || manifestStat.uid !== process.getuid?.() || (manifestStat.mode & 0o777) !== 0o600)
    fail('fixture manifest ownership/mode mismatch');
  const manifestSha256 = sha256(readFileSync(manifestPath));
  if (manifestSha256 !== expected.fixtureManifestSha256) fail('fixture manifest hash mismatch');
  const loan = manifest.syntheticActor.modelLoan;
  if (!loan || loan.decisionPath !== join(root, 'decision-router.json')
    || !/^[a-f0-9]{64}$/.test(loan.decisionSha256) || !Number.isSafeInteger(loan.issuedAt)
    || !Number.isSafeInteger(loan.stopAt) || loan.stopAt <= Date.now()
    || loan.stopAt > loan.issuedAt + 10 * 60_000) fail('bounded model loan is absent or expired');
  if (!/^[a-f0-9]{40}$/.test(expected.hermesSourceRevision || '')
    || expected.provider !== 'openai-api' || expected.model !== 'gpt-6-luna') fail('provider/model grant mismatch');
  const allowedGrantKeys = ['schemaVersion', 'purpose', 'audience', 'fixtureManifestPath', 'fixtureManifestSha256',
    'fixtureRoot', 'actorOwnerUserId', 'rhythmSourceRevision', 'rhythmProductRevision', 'hermesSourceRevision',
    'hermesHome', 'provider', 'model', 'keySourcePath', 'keySourceSha256', 'issuedAt', 'stopAt', 'oneTurnMaximum',
    'screenshots', 'traces', 'video'];
  if (!grant || Object.keys(grant).some(key => !allowedGrantKeys.includes(key))
    || grant.fixtureManifestPath !== manifestPath || grant.screenshots !== false || grant.traces !== false || grant.video !== false
    || grant.schemaVersion !== 1 || grant.purpose !== 'one actual Hermes Luna chat turn using a static Decisions API key'
    || grant.audience !== 'hermes-static-openai-api' || grant.fixtureManifestSha256 !== expected.fixtureManifestSha256
    || grant.fixtureRoot !== root || grant.actorOwnerUserId !== manifest.ownerUserId
    || grant.rhythmSourceRevision !== expected.rhythmSourceRevision
    || grant.rhythmProductRevision !== expected.rhythmProductRevision
    || grant.hermesSourceRevision !== expected.hermesSourceRevision || grant.hermesHome !== expected.hermesHome
    || grant.provider !== 'openai-api' || grant.model !== 'gpt-6-luna'
    || grant.keySourcePath !== loan.decisionPath || grant.keySourceSha256 !== loan.decisionSha256
    || grant.issuedAt !== loan.issuedAt || grant.stopAt !== loan.stopAt || grant.oneTurnMaximum !== 1
    || Date.now() >= grant.stopAt) fail('explicit Hermes audience grant does not match the active loan');

  const result = await desktop.evaluate(async () => {
    const bridge = window.hermesDesktop;
    if (!bridge?.embedded?.enabled || typeof bridge.getConnection !== 'function' || typeof bridge.api !== 'function') {
      throw new Error('pinned embedded Hermes bridge unavailable');
    }
    const connection = await bridge.getConnection();
    const parsed = new URL(connection.baseUrl);
    const isLoopback = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    const origin = isLoopback ? `${parsed.protocol}//${parsed.hostname}:${parsed.port}` : 'non-loopback';

    const env = await bridge.api({ path: '/api/env' });
    const openai = env?.OPENAI_API_KEY;
    const keyMetadata = openai ? {
      present: true,
      isSet: openai.is_set === true,
      provider: typeof openai.provider === 'string' ? openai.provider : '',
      providerLabel: typeof openai.provider_label === 'string' ? openai.provider_label : '',
      category: typeof openai.category === 'string' ? openai.category : '',
    } : { present: false, isSet: false, provider: '', providerLabel: '', category: '' };

    // `/api/model/info` is projected in-page to two non-secret fields only.
    const modelInfo = await bridge.api({ path: '/api/model/info' });
    const model = {
      provider: typeof modelInfo?.provider === 'string' ? modelInfo.provider : '',
      name: typeof modelInfo?.model === 'string' ? modelInfo.model
        : typeof modelInfo?.model_name === 'string' ? modelInfo.model_name : '',
    };
    const status = await bridge.api({ path: '/api/status' });
    return {
      embedded: true,
      connectionMode: typeof connection.mode === 'string' ? connection.mode : '',
      backendOrigin: origin,
      backendLoopback: isLoopback,
      statusVersionPresent: typeof status?.version === 'string',
      installIdPresent: typeof status?.install_id === 'string',
      keyMetadata,
      model,
      settingsRoute: location.hash.includes('tab=providers') ? 'providers' : location.hash.includes('tab=config:model') ? 'model' : 'other',
      openAiGroupVisible: [...document.querySelectorAll('body *')].some(el => el.children.length === 0 && el.textContent?.trim() === 'OpenAI API'),
      keyInputVisible: [...document.querySelectorAll('input')].some(el => el.type === 'password' && el.getClientRects().length > 0),
      chatComposerVisible: [...document.querySelectorAll('[contenteditable="true"]')].some(el => el.getClientRects().length > 0),
    };
  });
  if (!result.backendLoopback) fail('private embedded backend did not resolve to loopback');
  if (result.settingsRoute !== 'providers' || !result.openAiGroupVisible || !result.keyInputVisible)
    fail('OpenAI API key UI is not visibly reachable in the normal provider settings view');
  if (!result.embedded || !result.statusVersionPresent || !result.installIdPresent) fail('actual private Hermes backend did not answer');
  if (result.keyMetadata.provider !== 'openai-api' || result.keyMetadata.category !== 'provider') fail('OpenAI API key row is not catalogued as a provider');
  if (result.keyMetadata.isSet) fail('zero-secret preflight found an already-set OpenAI key; stop for review');

  const receipt = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    rhythmSourceRevision: expected.rhythmSourceRevision,
    rhythmProductRevision: expected.rhythmProductRevision,
    hermesSourceRevision: expected.hermesSourceRevision,
    fixtureRoot: root,
    fixtureManifestSha256: manifestSha256,
    actorOwnerUserId: manifest.ownerUserId,
    audience: grant.audience,
    provider: grant.provider,
    model: grant.model,
    keySourcePath: grant.keySourcePath,
    keySourceSha256: grant.keySourceSha256,
    issuedAt: grant.issuedAt,
    stopAt: grant.stopAt,
    hermesHome: expected.hermesHome,
    metadataOnly: true,
    modelTurnCount: 0,
    observation: result,
  };
  const receiptDir = dirname(receiptPath);
  if (!receiptDir.startsWith('/private/tmp/') || resolve(receiptPath) !== receiptPath) fail('receipt path escaped private tmp');
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(receiptPath, body, { mode: 0o600, flag: 'wx' });
  const st = lstatSync(receiptPath);
  if (st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600 || st.nlink !== 1) fail('receipt ownership/mode invalid');
  return { receiptPath, receiptSha256: sha256(body), observation: result };
}
