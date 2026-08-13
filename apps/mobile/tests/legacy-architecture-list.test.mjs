import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoots = ['app', 'components', 'constants', 'hooks', 'lib', 'providers'];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

test('legacy iOS runtime does not import new-architecture-only FlashList v2', async () => {
  const files = (
    await Promise.all(runtimeRoots.map((root) => sourceFiles(path.join(appRoot, root))))
  ).flat();
  const unsupportedImports = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (source.includes('@shopify/flash-list')) {
      unsupportedImports.push(path.relative(appRoot, file));
    }
  }

  assert.deepEqual(unsupportedImports, []);
});

test('chat transcript uses the React Native FlatList compatibility path', async () => {
  const source = await readFile(
    path.join(appRoot, 'components/chat/chat-content.tsx'),
    'utf8',
  );

  assert.match(source, /import \{[\s\S]*FlatList[\s\S]*\} from 'react-native';/);
  assert.match(source, /<FlatList/);
  assert.match(source, /transcriptNearBottomRef/);
  assert.doesNotMatch(source, /FlashList/);
});
