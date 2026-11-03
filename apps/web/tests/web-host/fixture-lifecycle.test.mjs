import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('L1: synthetic web fixture provisions loopback model and profile before engine startup', () => {
  const fixture = `/private/tmp/rhythm-web-fixture-contract-${process.pid}-${Date.now()}`;
  execFileSync(process.execPath, ['tools/dev/sandbox_fixture.mjs', fixture, '--web-host'], { stdio: 'pipe' });
  const config = JSON.parse(fs.readFileSync(`${fixture}/opencode.json`, 'utf8'));
  assert.equal(config.provider?.['web-scripted']?.options?.baseURL, 'http://127.0.0.1:6996/v1');
  assert.equal(config.provider['web-scripted'].options.apiKey, 's0-local-synthetic-key');
  assert.ok(config.provider['web-scripted'].models['s0-local']);
  const rows = execFileSync('sqlite3', ['-readonly', `${fixture}/rhythm.db`, "SELECT model_provider || '/' || model_id FROM agent_configs WHERE id='local-lean'"], { encoding: 'utf8' });
  assert.equal(rows.trim(), 'web-scripted/s0-local');
});
