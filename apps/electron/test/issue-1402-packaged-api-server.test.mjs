// CONTRACT TESTS — issue #1402. Regression caught: Rhythm.app ships without the
// api_server runtime, so a standalone launch silently depends on a monorepo checkout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findNode, findServerEntry } from '../src/agent-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, '..');
const appRoot = resolve(electronRoot, 'dist/Rhythm.app');
const resources = resolve(appRoot, 'Contents/Resources');

test('issue-1402-c1: package:mac includes the complete api_server runtime shape', async () => {
  const result = await run('npm', ['run', 'package:mac']);
  assert.equal(result.code, 0, `package:mac failed\n${result.stderr}`);

  for (const relativePath of [
    'api_server/dist/server.js',
    'api_server/scripts/postinstall.js',
    'api_server/opencode_plugins/rhythm-anthropic-accounts/dist/index.js',
    'api_server/config_seeds/skills/customize-rhythm/SKILL.md',
    'api_server/config_seeds/tools/node_modules/js-yaml/package.json',
    'api_server/vendor/opencode-ai-sdk/index.js',
    'api_server/resources/openmontage-mcp/openmontage_mcp_server.py',
    'api_server/package.json',
    'api_server/package-lock.json',
    'api_server/node_modules/better-sqlite3/package.json',
    'api_server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'api_server/node_modules/node-pty/package.json',
    'api_server/.mcp-roles/secretary.mcp.json',
    'node/bin/node',
  ]) {
    await assert.doesNotReject(
      () => import('node:fs/promises').then(({ stat }) => stat(resolve(resources, relativePath))),
      `packaged resource is missing: Contents/Resources/${relativePath}`,
    );
  }
  for (const rebuildOnlyPath of [
    'api_server/node_modules/better-sqlite3/build/Makefile',
    'api_server/node_modules/better-sqlite3/build/config.gypi',
  ]) {
    await assert.rejects(
      access(resolve(resources, rebuildOnlyPath)),
      undefined,
      `${rebuildOnlyPath} is rebuild-only metadata and makes signed package bytes nondeterministic`,
    );
  }

  const bundledNode = resolve(resources, 'node/bin/node');
  const sqliteProbe = spawnSync(bundledNode, ['-e', [
    `const root=${JSON.stringify(resolve(resources, 'api_server'))};`,
    "const Database=require(root+'/node_modules/better-sqlite3');",
    "const db=new Database(':memory:');",
    "if(db.prepare('select 1 as x').get().x!==1)process.exit(1);",
  ].join('')], { encoding: 'utf8' });
  assert.equal(sqliteProbe.status, 0, `bundled Node failed its better-sqlite3 ABI probe\n${sqliteProbe.stderr}`);
  const ptyProbe = spawnSync(bundledNode, ['-e', [
    `const root=${JSON.stringify(resolve(resources, 'api_server'))};`,
    "require(root+'/node_modules/node-pty');",
  ].join('')], { encoding: 'utf8' });
  assert.equal(ptyProbe.status, 0, `bundled Node failed its node-pty ABI probe\n${ptyProbe.stderr}`);
});

test('issue-1402-c2: packaged resolution uses only Contents/Resources/api_server', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'rhythm-1402-standalone-'));
  const executable = resolve(fixture, 'Rhythm.app/Contents/MacOS/Rhythm');
  const bundledRoot = resolve(fixture, 'Rhythm.app/Contents/Resources/api_server');
  const bundledEntry = resolve(bundledRoot, 'dist/server.js');
  const bundledNode = resolve(fixture, 'Rhythm.app/Contents/Resources/node/bin/node');
  const nodePath = '/fixture/node';

  try {
    await mkdir(dirname(executable), { recursive: true });
    await mkdir(dirname(bundledEntry), { recursive: true });
    await mkdir(dirname(bundledNode), { recursive: true });
    await writeFile(executable, 'fixture');
    await writeFile(bundledEntry, 'fixture');
    await writeFile(bundledNode, 'fixture');

    assert.equal(await findNode(executable), bundledNode);

    assert.deepEqual(findServerEntry(nodePath, executable), {
      executable: nodePath,
      args: [bundledEntry],
      workingDir: bundledRoot,
      mcpRolesDir: resolve(bundledRoot, '.mcp-roles'),
    });

    await rm(bundledEntry);
    assert.equal(
      findServerEntry(nodePath, executable),
      null,
      'a packaged executable with a missing bundle must fail closed, not walk into a checkout',
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: electronRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}
