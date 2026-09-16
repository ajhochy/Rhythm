import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/auth/hosted-mobile-oauth.ts', import.meta.url),
  'utf8',
);
const prepared = source.replace(
  /^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm,
  '',
);
const stubs = `
const Constants = { expoConfig: { extra: { hostedOAuthOrigin: 'https://api.vcrcapps.com' } } };
const CryptoDigestAlgorithm = { SHA256: 'SHA256' };
const CryptoEncoding = { BASE64: 'BASE64' };
const digestStringAsync = async () => { throw new Error('not injected'); };
const getRandomBytesAsync = async () => { throw new Error('not injected'); };
const openAuthSessionAsync = async () => { throw new Error('not injected'); };
const encodeBase64 = (value) => Buffer.from(value, 'binary').toString('base64');
`;
const transpiled = ts.transpileModule(`${stubs}\n${prepared}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);

const {
  HOSTED_MOBILE_CALLBACK,
  HostedMobileOAuthError,
  buildHostedMobileBeginUrl,
  startHostedMobileOAuth,
  validateHostedMobileCallback,
} = mod;

const code = 'c'.repeat(43);
const state = 's'.repeat(43);

{
  const url = new URL(buildHostedMobileBeginUrl({ codeChallenge: 'p'.repeat(43), appState: state }));
  assert.equal(url.origin, 'https://api.vcrcapps.com');
  assert.equal(url.pathname, '/auth/google/mobile-begin');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    code_challenge: 'p'.repeat(43),
    code_challenge_method: 'S256',
    app_state: state,
  });
}

{
  assert.equal(
    validateHostedMobileCallback(`${HOSTED_MOBILE_CALLBACK}?code=${code}&state=${state}`, state),
    code,
  );
  for (const callback of [
    `rhythmagents://other/callback?code=${code}&state=${state}`,
    `rhythmagents://oauth/wrong?code=${code}&state=${state}`,
    `${HOSTED_MOBILE_CALLBACK}?code=${code}&code=${code}&state=${state}`,
    `${HOSTED_MOBILE_CALLBACK}?code=${code}&state=${'x'.repeat(43)}`,
    `${HOSTED_MOBILE_CALLBACK}?code=short&state=${state}`,
    `${HOSTED_MOBILE_CALLBACK}?code=${code}&state=${state}&token=secret`,
  ]) {
    assert.throws(() => validateHostedMobileCallback(callback, state), HostedMobileOAuthError);
  }
}

{
  const randomValues = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
  let opened;
  const result = await startHostedMobileOAuth({
    randomBytes: async () => randomValues.shift(),
    digest: async () => Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
    openAuthSession: async (url, redirectUrl, options) => {
      opened = { url: new URL(url), redirectUrl, options };
      const generatedState = new URL(url).searchParams.get('app_state');
      return {
        type: 'success',
        url: `${HOSTED_MOBILE_CALLBACK}?code=${code}&state=${generatedState}`,
      };
    },
  });
  assert.equal(opened.redirectUrl, HOSTED_MOBILE_CALLBACK);
  assert.deepEqual(opened.options, { preferEphemeralSession: true });
  assert.match(opened.url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(opened.url.searchParams.get('app_state'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.code, code);
  assert.match(result.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'codeVerifier']);
}

{
  await assert.rejects(
    startHostedMobileOAuth({
      randomBytes: async () => new Uint8Array(32).fill(1),
      digest: async () => Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
      openAuthSession: async () => ({ type: 'cancel' }),
    }),
    (error) => error.cancelled === true && /existing account is unchanged/i.test(error.message),
  );
}

console.log('hosted mobile OAuth tests passed');
