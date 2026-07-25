import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function importClientModule() {
  const source = await readFile(
    new URL('../lib/opencode/client.ts', import.meta.url),
    'utf8',
  );
  const runtimeSource = source.slice(
    source.indexOf('export type PendingPermissionRequest'),
  );
  const output = ts.transpileModule(
    `
      const Constants = { expoConfig: undefined };
      const encodeBase64 = (value) => Buffer.from(value).toString('base64');
      const createOpencodeClient = () => ({});
      ${runtimeSource}
    `,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

async function importInspectionModule() {
  const source = await readFile(
    new URL('../providers/services/opencode-inspection-service.ts', import.meta.url),
    'utf8',
  );
  const runtimeSource = source.slice(
    source.indexOf('const SENSITIVE_CONFIG_KEY'),
    source.indexOf('export async function listOpenCodeSkills'),
  );
  const output = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

test('issue-1174: custom route preserves prefix, directory, and basic auth', async () => {
  const { requestOpenCodeRoute } = await importClientModule();
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: new Headers(init?.headers) };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const result = await requestOpenCodeRoute(
      {
        serverUrl: 'https://paired.example.test/mobile-gateway/opencode',
        username: 'mobile',
        password: 'device-secret',
        directory: '/safe/project',
      },
      '/skill/reload',
      { method: 'POST' },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(
      captured.url,
      'https://paired.example.test/mobile-gateway/opencode/skill/reload?directory=%2Fsafe%2Fproject',
    );
    assert.equal(
      captured.headers.get('authorization'),
      `Basic ${Buffer.from('mobile:device-secret').toString('base64')}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('issue-1174: custom route errors never expose an upstream response body', async () => {
  const { requestOpenCodeRoute } = await importClientModule();
  const originalFetch = globalThis.fetch;
  const secret = 'sk-live-secret-that-must-never-reach-the-ui';
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: secret.repeat(500) }),
    { status: 502 },
  );
  try {
    await assert.rejects(
      requestOpenCodeRoute(
        {
          serverUrl: 'https://paired.example.test',
          username: '',
          password: '',
          directory: '',
        },
        '/config/reload',
        { method: 'POST' },
      ),
      (error) => {
        assert.equal(error.message, 'OpenCode request failed (502).');
        assert.doesNotMatch(error.message, /sk-live-secret|error/);
        assert.ok(error.message.length < 80);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('issue-1174: config inspection recursively redacts adversarial secrets', async () => {
  const { redactConfigForInspection } = await importInspectionModule();
  const redacted = redactConfigForInspection({
    provider: {
      apiKey: 'secret-1',
      key: 'secret-2',
      nested: [
        { authorization: 'Bearer secret-3' },
        { 'private-key': 'secret-4' },
        { credential_file: 'secret-5' },
      ],
    },
    sessionToken: 'secret-6',
    password: 'secret-7',
    safe: { baseURL: 'https://api.example.test', retries: 3 },
  });
  assert.deepEqual(redacted, {
    provider: {
      apiKey: '[redacted]',
      key: '[redacted]',
      nested: [
        { authorization: '[redacted]' },
        { 'private-key': '[redacted]' },
        { credential_file: '[redacted]' },
      ],
    },
    sessionToken: '[redacted]',
    password: '[redacted]',
    safe: { baseURL: 'https://api.example.test', retries: 3 },
  });
  assert.doesNotMatch(JSON.stringify(redacted), /secret-[1-7]/);
});
