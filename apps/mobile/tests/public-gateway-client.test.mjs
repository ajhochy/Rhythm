import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const [apiErrorSource, requestHelperSource, clientSource] = await Promise.all([
  readFile(new URL('../lib/transport/api-error.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../lib/transport/request-helper.ts', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../lib/transport/public-gateway-client.ts', import.meta.url),
    'utf8',
  ),
]);

const prepare = (source) =>
  source
    .replace(/^import\b[^'"]*from\s+['"]\.[^'"]*['"]\s*;?\n?/gm, '')
    .replace(/^export\s+type\s+\{[^}]*\}\s*;?\n?/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*;?\n?/gm, '');

const transpiled = ts.transpileModule(
  [apiErrorSource, requestHelperSource, clientSource].map(prepare).join('\n'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      strict: false,
    },
  },
).outputText;

const { ApiError, PublicGatewayClient } = await import(
  `data:text/javascript,${encodeURIComponent(transpiled)}`
);

const client = new PublicGatewayClient({
  baseUrl: 'https://host.tailnet.ts.net',
});

{
  let observed;
  const result = await client.requestPublic(
    '/mobile-gateway/health',
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Unrelated-Diagnostic': 'must-not-leave',
      },
    },
    async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify({ status: 'ready' }), {
        status: 200,
      });
    },
  );
  assert.deepEqual(result, { status: 'ready' });
  const headers = new Headers(observed.init.headers);
  assert.equal(observed.url, 'https://host.tailnet.ts.net/mobile-gateway/health');
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('x-unrelated-diagnostic'), null);
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('cookie'), null);
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.redirect, 'error');
}

for (const [header, secret] of [
  ['Authorization', 'Bearer cloud-session-must-not-leave'],
  ['Cookie', 'rhythm_session=must-not-leave'],
  ['X-Api-Key', 'must-not-leave'],
]) {
  let fetchCalled = false;
  let caught;
  try {
    await client.requestPublic(
      '/mobile-gateway/pair',
      {
        method: 'POST',
        headers: { [header]: secret },
        body: '{}',
      },
      async () => {
        fetchCalled = true;
        throw new Error('unreachable');
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ApiError);
  assert.equal(caught.code, 'PUBLIC_GATEWAY_REQUEST_BLOCKED');
  assert.equal(fetchCalled, false);
  assert.doesNotMatch(`${caught.message}\n${caught.stack ?? ''}`, new RegExp(secret));
}

for (const [path, method] of [
  ['/mobile-gateway/devices', 'GET'],
  ['/mobile-gateway/health', 'POST'],
  ['/mobile-gateway/pair', 'GET'],
]) {
  assert.throws(
    () =>
      client.requestPublic(path, { method }, async () => {
        throw new Error('unreachable');
      }),
    (error) =>
      error instanceof ApiError &&
      error.code === 'PUBLIC_GATEWAY_REQUEST_BLOCKED',
  );
}

console.log(
  'Public gateway capability test passed (exact endpoints; no caller auth headers)',
);
