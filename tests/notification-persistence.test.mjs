import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/notification-persistence.ts', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const {
  parsePendingNotificationSessions,
  serializePendingNotificationSessions,
  resolvePendingNotificationConnection,
} = await import(`data:text/javascript,${encodeURIComponent(output)}`);

const sentinel = 'never-persist-this-password';
const legacy = JSON.stringify({
  'session-1': {
    sessionId: 'session-1',
    sessionTitle: 'Task',
    projectPath: '/workspace',
    settings: {
      serverUrl: 'https://mac.tailnet.ts.net',
      username: 'opencode',
      password: sentinel,
    },
    requestedAt: 123,
  },
});

const parsed = parsePendingNotificationSessions(legacy);
assert.equal(parsed.changed, true);
const serialized = serializePendingNotificationSessions(parsed.sessions);
assert.equal(serialized.includes(sentinel), false);
assert.equal(serialized.includes('password'), false);
assert.deepEqual(parsed.sessions['session-1'].settings, {
  serverUrl: 'https://mac.tailnet.ts.net',
  username: 'opencode',
});

const nonFiniteTimestamp = `{
  "session-2": {
    "sessionId": "session-2",
    "projectPath": "/workspace",
    "settings": {
      "serverUrl": "https://mac.tailnet.ts.net",
      "username": "opencode"
    },
    "requestedAt": 1e999
  }
}`;
assert.deepEqual(parsePendingNotificationSessions(nonFiniteTimestamp).sessions, {});

assert.deepEqual(
  resolvePendingNotificationConnection(
    parsed.sessions['session-1'],
    { serverUrl: 'https://mac.tailnet.ts.net', username: 'opencode' },
    'runtime-only-password',
  ),
  {
    kind: 'ready',
    settings: {
      serverUrl: 'https://mac.tailnet.ts.net',
      username: 'opencode',
      password: 'runtime-only-password',
      directory: '/workspace',
    },
  },
);
assert.equal(
  resolvePendingNotificationConnection(
    parsed.sessions['session-1'],
    { serverUrl: 'https://other.tailnet.ts.net', username: 'opencode' },
    'runtime-only-password',
  ).kind,
  'mismatch',
);
assert.equal(
  resolvePendingNotificationConnection(parsed.sessions['session-1'], {}, undefined).kind, 'unavailable');

console.log('notification persistence tests passed');
