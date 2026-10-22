/** No-model packaged installer regression. Requires the signed local app. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('0000755', 100);
  header.write('0000000', 108);
  header.write('0000000', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header[156] = 48;
  header.write('ustar\0', 257);
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - body.length % 512) % 512)]);
}

it.skipIf(process.env.RHYTHM_EVAL_NPM_SANDBOX !== '1')(
  'installs a pinned local archive with the actual packaged Node inside the evaluation sandbox', () => {
    const app = resolve(process.env.RHYTHM_PACKAGED_APP ??
      join(__dirname, '../../../../electron/dist/Rhythm.app'));
    const resources = join(app, 'Contents', 'Resources');
    const node = join(resources, 'node', 'bin', 'node');
    const apiRoot = join(resources, 'api_server');
    const signed = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app],
      { stdio: 'ignore', timeout: 30_000 });
    expect(signed.status).toBe(0);
    const { evaluationSandboxPolicy } = require(join(apiRoot, 'dist/services/org_evaluation_runtime.js')) as
      typeof import('../org_evaluation_runtime');
    const { stagePinnedNpmRuntimeForEvaluation } = require(join(apiRoot,
      'dist/services/managed_npm_runtime.js')) as typeof import('../managed_npm_runtime');
    const root = mkdtempSync('/private/tmp/rhythm-eval-npm-sandbox-');
    try {
      const workspace = join(root, 'workspace');
      mkdirSync(workspace);
      mkdirSync(join(root, 'artifacts'));
      copyFileSync('/usr/bin/true', join(root, 'opencode'));
      chmodSync(join(root, 'opencode'), 0o500);
      const archive = gzipSync(Buffer.concat([
        tarEntry('package/package.json', JSON.stringify({ name: 'private-sandbox-tool',
          version: '1.0.0', bin: { 'private-sandbox-tool': 'index.js' } })),
        tarEntry('package/index.js', '#!/usr/bin/env node\nconsole.log("ok")\n'), Buffer.alloc(1024),
      ]));
      const digest = sha256(archive);
      writeFileSync(join(root, 'artifacts', `${digest}.tgz`), archive);
      const npm = stagePinnedNpmRuntimeForEvaluation(root, node);
      const policy = evaluationSandboxPolicy({ workerRoot: root, enginePort: 47997,
        relayPort: 47998, pinnedBinary: join(root, 'opencode'),
        programRoots: [join(apiRoot, 'dist'), join(apiRoot, 'package.json'),
          join(apiRoot, 'node_modules'), join(apiRoot, 'vendor/opencode-ai-sdk'),
          node, join(root, 'opencode')].filter(existsSync) });
      writeFileSync(join(root, 'worker.sb'), policy);
      const worker = `const service=require(${JSON.stringify(join(apiRoot,
        'dist/services/tool_install_apply.js'))});const root=${JSON.stringify(root)};const proposal={id:'private-test',kind:'tool-install',status:'approved',changeJson:JSON.stringify({toolName:'private-sandbox-tool',agentConfigId:'private-profile',packageSource:'local-tarball:sha256:${digest}',installMethod:'local-tarball',testPrompts:['version-check']})};service.applyVettedToolInstallAsync(proposal,undefined,{artifactRoot:root+'/artifacts',managedRoot:root+'/managed',skipSafetyRecheck:true}).then(result=>process.stdout.write(JSON.stringify(result)));`;
      writeFileSync(join(root, 'worker.cjs'), worker);
      const run = spawnSync('/usr/bin/sandbox-exec', ['-f', join(root, 'worker.sb'), node,
        join(root, 'worker.cjs')], { cwd: workspace, encoding: 'utf8', timeout: 20_000,
        env: { PATH: '/usr/bin:/bin', HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
          DB_CLIENT: 'sqlite', RHYTHM_EVALUATION_WORKER: '1',
          RHYTHM_EVALUATION_WORKER_ROOT: root,
          RHYTHM_EVALUATION_NPM_ROOT: npm.npmRoot,
          RHYTHM_EVALUATION_NPM_TREE_SHA256: npm.treeSha256 } });
      expect(run.status, `sandbox exit=${run.status}, stderrBytes=${run.stderr?.length ?? 0}`)
        .toBe(0);
      expect(JSON.parse(run.stdout) as { applied: boolean; reason: string | null })
        .toEqual({ applied: true, reason: null });
      const installed = join(root, 'managed', 'tools', `private-sandbox-tool-${digest.slice(0, 16)}`);
      expect(existsSync(join(installed, 'node_modules', 'private-sandbox-tool', 'package.json'))).toBe(true);
      for (const item of ['.npm-cache', '.npmrc-user', '.npmrc-global'])
        expect(existsSync(join(installed, item))).toBe(false);
      expect(readFileSync(join(installed, '.rhythm-managed-install.json'), 'utf8'))
        .toContain(digest);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
