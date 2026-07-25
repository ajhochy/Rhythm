import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/opencode/connection-persistence.ts', import.meta.url),
  'utf8',
);
const persistenceHookSource = await readFile(
  new URL('../providers/use-opencode-persistence.ts', import.meta.url),
  'utf8',
);
const credentialStoreSource = await readFile(
  new URL('../lib/security/connection-credential-store.ts', import.meta.url),
  'utf8',
);
const serializerSource = source.slice(
  source.indexOf('export function serializePublicConnectionSettings'),
  source.indexOf('export function parseStoredConnectionSettings'),
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const {
  createCredentialWriteQueue,
  migrateLegacyConnectionPassword,
  parseStoredConnectionSettings,
  serializePublicConnectionSettings,
} = await import(`data:text/javascript,${encodeURIComponent(output)}`);

const settings = {
  serverUrl: 'https://mac.tailnet.ts.net',
  username: 'opencode',
  password: 'do-not-persist',
  directory: '/allowed/project',
};

const serialized = serializePublicConnectionSettings(settings);
assert.equal(serialized.includes(settings.password), false);
assert.deepEqual(JSON.parse(serialized), {
  serverUrl: settings.serverUrl,
  username: settings.username,
  directory: settings.directory,
});

assert.deepEqual(parseStoredConnectionSettings(JSON.stringify(settings)), {
  publicSettings: {
    serverUrl: settings.serverUrl,
    username: settings.username,
    directory: settings.directory,
  },
  legacyPassword: settings.password,
});

assert.deepEqual(parseStoredConnectionSettings('{bad json'), {
  publicSettings: {},
});

const order = [];
await migrateLegacyConnectionPassword({
  legacyPassword: 'legacy-secret',
  writePassword: async () => order.push('secure'),
  writePublicSettings: async () => order.push('public'),
});
assert.deepEqual(order, ['secure', 'public']);

const failedOrder = [];
await assert.rejects(() =>
  migrateLegacyConnectionPassword({
    legacyPassword: 'legacy-secret',
    writePassword: async () => {
      failedOrder.push('secure');
      throw new Error('secure unavailable');
    },
    writePublicSettings: async () => failedOrder.push('public'),
  }),
);
assert.deepEqual(failedOrder, ['secure']);

const writes = [];
const errors = [];
const enqueue = createCredentialWriteQueue(
  async (password) => {
    if (password === 'first') throw new Error('write failed');
    writes.push(password);
  },
  () => errors.push('credential-write-failed'),
);
await Promise.all([enqueue('first'), enqueue('second')]);
assert.deepEqual(errors, ['credential-write-failed']);
assert.deepEqual(writes, ['second']);

assert.match(persistenceHookSource, /const \[isConnectionPersistenceReady, setIsConnectionPersistenceReady\]/);
assert.match(persistenceHookSource, /Connection credential could not be read\./);
assert.match(persistenceHookSource, /Connection credential could not be migrated\./);
assert.match(persistenceHookSource, /Connection settings could not be saved\./);
assert.match(persistenceHookSource, /Connection credential could not be saved\./);
assert.match(persistenceHookSource, /credentialWriteQueueRef/);
assert.match(persistenceHookSource, /Promise\.all\(/);
assert.doesNotMatch(persistenceHookSource, /serializePublicConnectionSettings\(settings\)/);
assert.match(persistenceHookSource, /if \(parsed\.legacyPassword\) \{/);
assert.match(persistenceHookSource, /serializePublicConnectionSettings\(publicSettings\)/);
assert.match(
  persistenceHookSource,
  /if \(securePassword\) \{\s+await AsyncStorage\.setItem\([\s\S]*?serializePublicConnectionSettings\(publicSettings\)/,
);
assert.doesNotMatch(serializerSource, /password/);
assert.match(credentialStoreSource, /connectionCredentialStore\.setPassword\(''\)/);

console.log('connection persistence tests passed');
