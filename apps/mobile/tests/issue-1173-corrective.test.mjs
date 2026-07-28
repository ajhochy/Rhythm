import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('issue-1173-c13: tool cache keys are stable and isolated across account lifecycle', async () => {
  const toolsProvider = await import('../providers/services/rhythm-tools-service.ts');
  assert.equal(
    typeof toolsProvider.deriveToolsCacheScope,
    'function',
    'the provider must expose its account cache-scope policy for executable verification',
  );
  assert.equal(
    typeof toolsProvider.getToolCacheStorageKey,
    'function',
    'the exact persisted key must be verifiable',
  );

  const unpairedA = toolsProvider.deriveToolsCacheScope({
    accountUserId: 7,
    pairedHost: null,
    runtimeCacheScope: null,
  });
  const unpairedAAgain = toolsProvider.deriveToolsCacheScope({
    accountUserId: 7,
    pairedHost: null,
    runtimeCacheScope: null,
  });
  const unpairedB = toolsProvider.deriveToolsCacheScope({
    accountUserId: 8,
    pairedHost: null,
    runtimeCacheScope: null,
  });
  const signedOut = toolsProvider.deriveToolsCacheScope({
    accountUserId: null,
    pairedHost: null,
    runtimeCacheScope: null,
  });
  const pairedA = toolsProvider.deriveToolsCacheScope({
    accountUserId: 7,
    pairedHost: { hostId: 'mac-a', deviceId: 'iphone-a' },
    runtimeCacheScope: null,
  });

  assert.equal(unpairedA, unpairedAAgain, 'a signed-in account scope must be stable');
  assert.notEqual(unpairedA, unpairedB, 'two signed-in accounts must never share offline data');
  assert.notEqual(unpairedA, signedOut, 'sign-out must leave the previous account cache behind');
  assert.notEqual(unpairedA, pairedA, 'paired and unpaired resource scopes must not alias');

  for (const tool of ['email', 'gallery']) {
    const keys = [unpairedA, unpairedB, signedOut, pairedA].map((scope) =>
      toolsProvider.getToolCacheStorageKey(scope, tool),
    );
    assert.equal(new Set(keys).size, keys.length, `${tool} cache keys must remain account isolated`);
  }
});

test('issue-1173-c18: Card actions are direct children so native Paper does not inject props into a Fragment', async () => {
  const source = await readFile(
    new URL('../app/tools/[tool].tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const actions = renderActions\(item\);/,
    'render actions once before constructing the Paper Card',
  );
  assert.doesNotMatch(
    source,
    /\{renderActions\(item\) \? \(\s*<>\s*<Divider \/>/,
    'Paper Card clones direct children with index; a Fragment here triggers a native warning',
  );
  assert.match(
    source,
    /\{actions \? <Divider \/> : null\}\s*\{actions \? <Card\.Actions>\{actions\}<\/Card\.Actions> : null\}/,
    'Divider and Card.Actions must remain direct Card children',
  );
});
