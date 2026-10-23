// Real identity guards, no mocked OS calls. Requires the owned live sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sandboxEngineAttachment, recordSandboxEngineOwnership, validateSandboxEngineOwnership } = require('../../apps/api_server/src/services/sandbox_engine_attachment.ts');
const live = process.env.RHYTHM_LIVE_E2E === '1';

test('ordinary startup never attaches', () => {
  assert.equal(sandboxEngineAttachment(4797), null);
});
test('sandbox attachment accepts exact owned engine and rejects production/identity changes', { skip: !live }, () => {
  const sb = '/private/tmp/rhythm-coordinator-repair-sandbox';
  const keys = ['RHYTHM_SANDBOX_ATTACH_ENGINE_PID', 'RHYTHM_SANDBOX_DIR', 'DB_PATH', 'OPENCODE_DB', 'RHYTHM_OPENCODE_BIN_DIR', 'NODE_ENV',
    'PORT', 'RHYTHM_OPENCODE_ENGINE_PORT', 'RHYTHM_MOBILE_GATEWAY_PORT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.argv.push(`--rhythm-sandbox=${sb}`);
  try {
    Object.assign(process.env, {
      RHYTHM_SANDBOX_ATTACH_ENGINE_PID: readFileSync(`${sb}/opencode_engine.pid`, 'utf8').trim(),
      RHYTHM_SANDBOX_DIR: sb, DB_PATH: `${sb}/rhythm.db`, OPENCODE_DB: 'opencode-rhythm-sandbox.db',
      PORT: '4798', RHYTHM_OPENCODE_ENGINE_PORT: '4797', RHYTHM_MOBILE_GATEWAY_PORT: '4799',
      XDG_CONFIG_HOME: `${sb}/home/.config`, XDG_DATA_HOME: `${sb}/home/.local/share`, XDG_CACHE_HOME: `${sb}/home/.cache`,
      RHYTHM_OPENCODE_BIN_DIR: new URL('../../apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin', import.meta.url).pathname,
    });
    recordSandboxEngineOwnership(sb, 4797, Number(readFileSync(`${sb}/api_server.pid`, 'utf8')));
    assert.equal(sandboxEngineAttachment(4797), 'http://127.0.0.1:4797');
    // Regression: records or config can be replaced with same-owner symlinks,
    // or config bytes changed after the launch binding was recorded.
    for (const relative of ['opencode_engine.pid', 'opencode_engine.ownership.json', 'home/.config/opencode/opencode.json']) {
      const path = `${sb}/${relative}`;
      renameSync(path, `${path}.r0-saved`);
      symlinkSync(`${path}.r0-saved`, path);
      try { assert.throws(() => sandboxEngineAttachment(4797), /Refusing/, relative); }
      finally { unlinkSync(path); renameSync(`${path}.r0-saved`, path); }
    }
    const configPath = `${sb}/home/.config/opencode/opencode.json`;
    const configBytes = readFileSync(configPath);
    try {
      writeFileSync(configPath, configBytes.toString() + '\n');
      assert.throws(() => sandboxEngineAttachment(4797), /Refusing/);
    } finally { writeFileSync(configPath, configBytes); }
    assert.equal(sandboxEngineAttachment(4797), 'http://127.0.0.1:4797');
    process.env.NODE_ENV = 'production';
    assert.throws(() => sandboxEngineAttachment(4797), /Refusing/);
    delete process.env.NODE_ENV;
    assert.throws(() => sandboxEngineAttachment(4096), /Refusing/);
    process.env.RHYTHM_SANDBOX_ATTACH_ENGINE_PID = String(process.pid);
    assert.throws(() => sandboxEngineAttachment(4797), /Refusing/);
  } finally {
    process.argv.pop();
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('same-binary foreign HOME/config/session store and wrong executable cannot attach', { skip: !live }, async () => {
  // Regression: PID/UID/executable alone accepts a foreign same-binary engine.
  // Every listener below is our own disposable child, never a live port/process.
  const sb = '/private/tmp/rhythm-coordinator-repair-sandbox';
  const originalEnv = { ...process.env };
  const record = `${sb}/opencode_engine.pid`;
  const original = readFileSync(record);
  const work = mkdtempSync(`${sb}/tmp/r0-foreign-`);
  process.argv.push(`--rhythm-sandbox=${sb}`);
  try {
    const bin = new URL('../../apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode', import.meta.url).pathname;
    Object.assign(process.env, { RHYTHM_SANDBOX_DIR: sb, DB_PATH: `${sb}/rhythm.db`,
      OPENCODE_DB: 'opencode-rhythm-sandbox.db', RHYTHM_OPENCODE_BIN_DIR: bin.slice(0, -9),
      PORT: '4798', RHYTHM_OPENCODE_ENGINE_PORT: '4797', RHYTHM_MOBILE_GATEWAY_PORT: '4799',
      XDG_CONFIG_HOME: `${sb}/home/.config`, XDG_DATA_HOME: `${sb}/home/.local/share`, XDG_CACHE_HOME: `${sb}/home/.cache` });
    for (const [name, delta] of [
      ['HOME', { HOME: work }],
      ['config', { XDG_CONFIG_HOME: `${work}/config` }],
      ['session-store', { XDG_DATA_HOME: `${work}/data` }],
      ['database', { OPENCODE_DB: 'foreign.db' }],
      ['config-override', { OPENCODE_CONFIG_CONTENT: '{"mcp":{}}' }],
      ['wrong-executable', {}],
    ]) {
      mkdirSync(`${work}/config/opencode`, { recursive: true });
      writeFileSync(`${work}/config/opencode/opencode.json`, '{"mcp":{}}');
      const allocation = createServer();
      allocation.listen(0, '127.0.0.1');
      await once(allocation, 'listening');
      const port = allocation.address().port;
      await new Promise(resolve => allocation.close(resolve));
      const child = name === 'wrong-executable'
        ? spawn(process.execPath, ['-e', `require('node:http').createServer((q,s)=>s.end('{}')).listen(${port},'127.0.0.1')`], { env: process.env, stdio: 'ignore' })
        : spawn(bin, ['serve', '--hostname=127.0.0.1', `--port=${port}`,
          '--cors=http://127.0.0.1:4175', '--cors=rhythm://app'], {
          env: { ...process.env, RHYTHM_OPENCODE_ENGINE_PORT: String(port), OPENCODE_CONFIG_CONTENT: '{}', ...delta }, stdio: 'ignore' });
      try {
        let listening = false;
        for (let i = 0; i < 100; i++) {
          try { listening = (await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(300) })).ok; }
          catch { /* startup is bounded below */ }
          if (listening) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(listening, true, `${name}: disposable listener did not start`);
        writeFileSync(record, `${child.pid}\n`);
        process.env.RHYTHM_OPENCODE_ENGINE_PORT = String(port);
        process.env.RHYTHM_SANDBOX_ATTACH_ENGINE_PID = String(child.pid);
        assert.throws(() => sandboxEngineAttachment(port), /Refusing/, name);
        process.kill(child.pid, 0);
        assert.deepEqual(readFileSync(record), Buffer.from(`${child.pid}\n`));
      } finally {
        child.kill('SIGTERM');
        if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
        writeFileSync(record, original);
      }
    }
  } finally {
    process.argv.pop();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    writeFileSync(record, original);
    rmSync(work, { recursive: true });
  }
});

for (const field of ['pid', 'start']) {
  test(`R0 repair2 refuses forged original launch parent ${field} without signalling`, { skip: !live }, () => {
    const sb = '/private/tmp/rhythm-coordinator-repair-sandbox';
    const api = Number(readFileSync(`${sb}/api_server.pid`, 'utf8'));
    const engine = Number(readFileSync(`${sb}/opencode_engine.pid`, 'utf8'));
    recordSandboxEngineOwnership(sb, 4797, api);
    const file = `${sb}/opencode_engine.ownership.json`;
    const original = readFileSync(file);
    try {
      const forged = JSON.parse(original);
      forged.parent[field] = field === 'pid' ? process.pid : 'not-the-launch-parent-start';
      writeFileSync(file, JSON.stringify(forged));
      assert.throws(() => validateSandboxEngineOwnership(sb, 4797), /Refusing/);
    } finally {
      writeFileSync(file, original);
      process.kill(api, 0);
      process.kill(engine, 0);
      validateSandboxEngineOwnership(sb, 4797);
    }
  });
}
