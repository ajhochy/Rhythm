// Real controlled-child kernel/holder-binding regression, NOT API/engine proof.
// No listeners, grants, model outputs, signals or cleanup; fixtures stay retained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${sourceRoot}/apps/api_server/package.json`);
const ts = require('typescript');
process.env.PORT = '4798';
process.env.RHYTHM_MOBILE_GATEWAY_PORT = '4799';
const context = vm.createContext({ require, exports: {}, process, Buffer, console, __dirname: sourceRoot });
const source = fs.readFileSync(`${sourceRoot}/apps/api_server/src/services/sandbox_engine_attachment.ts`, 'utf8');
new vm.Script(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText + `
globalThis.kernelLaunch = launchArguments;
globalThis.kernelStart = pid => ps(pid, 'lstart');
globalThis.validateBinding = typeof validateHolderBinding === 'function' ? validateHolderBinding : null;
`).runInContext(context);

async function childReady(child) {
  child.exitResult = once(child, 'exit');
  child.stderr.on('data', () => {});
  const [ready] = await once(child.stdout, 'data');
  assert.equal(String(ready), 'inspector-ready\n');
}

test('empty Bash kernel envelope needs a real exec-observed immutable holder binding, never an empty-envelope exemption', async () => {
  // Regression: requiring unreadable platform-Bash env rejects genuine holders;
  // accepting {} or an unbound file instead would admit foreign/stale holders.
  const root = fs.mkdtempSync('/private/tmp/rhythm-holder-envelope-contract-');
  fs.mkdirSync(`${root}/tools/dev`, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${root}/tools/dev/sandbox.sh`,
    '#!/bin/bash\nprintf "inspector-ready\\n"\nIFS= read -r line\n', { flag: 'wx', mode: 0o500 });
  fs.writeFileSync(`${root}/fixture-label.json`, '{"kind":"INSPECTOR_ONLY","codingAuthority":false,"humanApproval":false}\n', { flag: 'wx' });
  const sb = `${root}/synthetic-sandbox-not-runtime`;
  const expected = { RHYTHM_SANDBOX_DIR: sb, RHYTHM_SANDBOX_API_PORT: '4798',
    RHYTHM_SANDBOX_ENGINE_PORT: '4797', RHYTHM_SANDBOX_GATEWAY_PORT: '4799' };
  const holder = spawn('/bin/bash', ['tools/dev/sandbox.sh', 'up', '--foreground'], {
    cwd: root, env: { HOME: '/private/tmp', PATH: '/usr/bin:/bin', ...expected },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const children = [holder];
  try {
    await childReady(holder);
    const raw = context.kernelLaunch(holder.pid);
    assert.deepEqual(Object.keys(expected).filter(key => key in raw.env), [],
      'deterministically reproduce real platform Bash missing keys, do not invent them');
    const binding = { version: 1, pid: holder.pid, start: context.kernelStart(holder.pid),
      root, sandbox: sb, ports: { api: 4798, engine: 4797, gateway: 4799 } };
    const encoded = JSON.stringify(binding);
    const witness = spawn(process.execPath, ['-e',
      'process.stdout.write("inspector-ready\\n"); process.stdin.resume();'], {
      cwd: root, env: { HOME: '/private/tmp', PATH: '/usr/bin:/bin', ...expected,
        RHYTHM_SANDBOX_HOLDER_BINDING: encoded }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(witness);
    await childReady(witness);
    const observed = context.kernelLaunch(witness.pid).env;
    // RED before implementation: actual reader omits this exec-supplied seal.
    assert.equal(observed.RHYTHM_SANDBOX_HOLDER_BINDING, encoded);
    assert.doesNotThrow(() => context.validateBinding(sb, 4797, holder.pid, root, observed));
    for (const changed of [undefined, '{}', JSON.stringify({ ...binding, pid: witness.pid }),
      JSON.stringify({ ...binding, start: 'stale captured start' }),
      JSON.stringify({ ...binding, sandbox: sb + '-foreign' }),
      JSON.stringify({ ...binding, root: root + '-foreign' }),
      JSON.stringify({ ...binding, ports: { api: 4798, engine: 4796, gateway: 4799 } }),
      JSON.stringify({ ...binding, version: 2 }), JSON.stringify({ ...binding, extra: true })]) {
      const env = { HOME: '/private/tmp', PATH: '/usr/bin:/bin', ...expected };
      if (changed !== undefined) env.RHYTHM_SANDBOX_HOLDER_BINDING = changed;
      const rejected = spawn(process.execPath, ['-e',
        'process.stdout.write("inspector-ready\\n"); process.stdin.resume();'], {
        cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.push(rejected);
      await childReady(rejected);
      const rejectedKernelEnv = context.kernelLaunch(rejected.pid).env;
      assert.throws(() => context.validateBinding(sb, 4797, holder.pid, root, rejectedKernelEnv),
      'missing/foreign/stale/changed binding must fail closed');
    }
    assert.equal(context.kernelStart(holder.pid), binding.start);
    console.log(JSON.stringify({ fixtureOnly: true, bashEnvelopeKeys: 0,
      validExecBinding: 'PASS', deniedBindings: 9, root, authority: 'NONE' }));
  } finally {
    for (const child of children) child.stdin.end('\n');
    for (const child of children) {
      const [code] = await child.exitResult;
      assert.equal(code, 0, 'controlled child must exit normally; no signals');
    }
  }
});
