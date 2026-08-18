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
      const mobileRuntimeVariant = { serverUrl: 'http://127.0.0.1:4096' };
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
    source.indexOf('function requireData'),
  );
  const output = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

async function importTranscriptModule() {
  const source = await readFile(
    new URL('../lib/opencode/transcript.ts', import.meta.url),
    'utf8',
  );
  const runtimeSource = source.slice(
    source.indexOf('export function findEditableUserTextPart'),
    source.indexOf('export function getTranscriptActivityLabel'),
  );
  const output = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

async function importIdentifierModule() {
  const source = await readFile(
    new URL('../lib/opencode/identifier.ts', import.meta.url),
    'utf8',
  );
  const runtimeSource = source.replace(
    "import { getRandomBytes } from 'expo-crypto';",
    'const getRandomBytes = (length) => new Uint8Array(length).fill(7);',
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
  const secret = 'upstream-sensitive-value-that-must-never-reach-the-ui';
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
        assert.doesNotMatch(error.message, /upstream-sensitive-value|error/);
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

function inspectionClient(resourceList) {
  return {
    app: { skills: async () => ({ data: [] }) },
    global: { config: { get: async () => ({ data: {} }) } },
    experimental: { resource: { list: resourceList } },
    tool: {
      ids: async () => ({ data: [] }),
      list: async () => ({ data: [] }),
    },
  };
}

test('issue-1387: runtime inspection aborts a stalled resource request within its budget', async () => {
  const { loadOpenCodeInspection } = await importInspectionModule();
  let receivedSignal;
  const client = inspectionClient((_parameters, options) => {
    receivedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new Error('<html>cloudflare timed out</html>')),
        { once: true },
      );
    });
  });
  const startedAt = Date.now();

  await assert.rejects(
    loadOpenCodeInspection(client, undefined, undefined, { timeoutMs: 20 }),
    (error) => {
      assert.equal(error.message, 'OpenCode runtime inspection timed out. Try again.');
      assert.doesNotMatch(error.message, /html|cloudflare/i);
      return true;
    },
  );

  assert.equal(receivedSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'inspection should not wait for the upstream 60s timeout');
});

test('issue-1387: runtime inspection never exposes an upstream HTML error body', async () => {
  const { loadOpenCodeInspection } = await importInspectionModule();
  const client = inspectionClient(async () => {
    throw new Error('<html><title>502 Bad gateway</title>cloudflare</html>');
  });

  await assert.rejects(loadOpenCodeInspection(client), (error) => {
    assert.equal(
      error.message,
      'OpenCode runtime inspection is temporarily unavailable. Try again.',
    );
    assert.doesNotMatch(error.message, /502|html|cloudflare|bad gateway/i);
    return true;
  });
});

test('issue-1174: only genuine user text parts are editable', async () => {
  const { findEditableUserTextPart } = await importTranscriptModule();
  const genuine = {
    info: { id: 'message-genuine', role: 'user' },
    parts: [{ id: 'part-genuine', type: 'text', text: 'User-authored prompt' }],
  };
  const synthetic = {
    info: { id: 'message-shell', role: 'user' },
    parts: [{
      id: 'part-shell',
      type: 'text',
      text: '/shell npm test',
      synthetic: true,
    }],
  };
  const assistant = {
    info: { id: 'message-assistant', role: 'assistant' },
    parts: [{ id: 'part-assistant', type: 'text', text: 'Response' }],
  };

  assert.equal(findEditableUserTextPart(genuine)?.id, 'part-genuine');
  assert.equal(findEditableUserTextPart(genuine, 'part-genuine')?.text, 'User-authored prompt');
  assert.equal(findEditableUserTextPart(genuine, 'missing-part'), undefined);
  assert.equal(findEditableUserTextPart(synthetic), undefined);
  assert.equal(findEditableUserTextPart(synthetic, 'part-shell'), undefined);
  assert.equal(findEditableUserTextPart(assistant), undefined);
});

test('issue-1174: session initialization gets fresh ascending message IDs', async () => {
  const { createOpenCodeMessageId } = await importIdentifierModule();
  const first = createOpenCodeMessageId();
  const second = createOpenCodeMessageId();

  assert.match(first, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.match(second, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.notEqual(first, second);
  assert.ok(first < second);
});
