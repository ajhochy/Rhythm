import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

let security;
try {
  security = await import('../src/production-api-config.mjs');
} catch (error) {
  test('bucket-a-repair-c2: production API security helpers are importable', () => {
    assert.fail(`production-api-config.mjs must exist: ${error instanceof Error ? error.message : error}`);
  });
}

if (security) {
  const { createProductionApiConfig, createProductionApiSetHandler, normalizeProductionApiBase } = security;

  test('bucket-a-repair-c2a: unauthorized production API updates reject without persistence', async () => {
    // Regression caught: an untrusted renderer can persist a production destination.
    let saves = 0;
    const allowedSender = {};
    const handler = createProductionApiSetHandler({ allowedSender: () => allowedSender, save: async () => { saves += 1; } });
    await assert.rejects(handler({ sender: {} }, 'https://example.com'), /denied/i);
    assert.equal(saves, 0);
  });

  test('bucket-a-repair-c2b: unsafe production API values reject without persistence', async () => {
    // Regression caught: file URLs or authority modifiers cross the main-process persistence boundary.
    let saves = 0;
    const sender = {};
    const handler = createProductionApiSetHandler({ allowedSender: () => sender, save: async (value) => { saves += 1; return normalizeProductionApiBase(value); } });
    for (const value of [
      'file:///tmp/api',
      'http://api.example.com',
      'https://user@example.com',
      'https://example.com?x=1',
      'https://example.com#x',
      'https://localhost',
      'https://localhost.',
      'https://preview.localhost',
      'https://127.0.0.1:4001',
      'https://127.42.0.7',
      'https://2130706433',
      'https://0x7f000001',
      'https://[::1]:4001',
      'https://[::ffff:127.0.0.1]',
    ]) {
      await assert.rejects(handler({ sender }, value), /production api url/i, value);
    }
    assert.equal(saves, 0);
  });

  test('bucket-a-repair-c2c: persisted production API config is exactly mode 0600', async () => {
    // Regression caught: persisted server selection is readable by other local users.
    const directory = await mkdtemp(resolve(tmpdir(), 'rhythm-production-api-'));
    try {
      const configPath = resolve(directory, 'server-config.json');
      const config = createProductionApiConfig({ configPath, defaultBase: 'https://default.example', env: {} });
      assert.equal(await config.save('https://saved.example'), 'https://saved.example');
      assert.equal((await stat(configPath)).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { serverUrl: 'https://saved.example' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
