#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQualificationFixture } from './qualification_fixture.mjs';

const root = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const app = realpathSync(process.env.RHYTHM_PACKAGED_APP ?? path.join(root, 'apps/electron/dist/Rhythm.app'));
const localApp = realpathSync(path.join(root, 'apps/electron/dist/Rhythm.app'));
if (app !== localApp) throw new Error('AI qualification requires this worktree’s locally built apps/electron/dist/Rhythm.app');
const identity = JSON.parse(readFileSync(path.join(app, 'Contents/Resources/api_server/build-identity.json'), 'utf8'));
const revision = identity.sourceRevision;
if (identity.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing exact packaged source identity');
execFileSync('git', ['merge-base', '--is-ancestor', 'mega/2026-09-29-consolidation', revision], { cwd: root });
// Tests/docs can advance without rebuilding unchanged product bits. Refuse source drift.
const productPaths = [
  'apps/api_server/src', 'apps/web/src', 'apps/electron/src',
  'apps/opencode_fork/packages/opencode/src', 'apps/mcp_server/src',
  'apps/api_server/package.json', 'apps/web/package.json', 'apps/electron/package.json',
  'apps/api_server/scripts', 'apps/api_server/opencode_plugins', 'apps/api_server/config_seeds',
  'apps/api_server/vendor', 'apps/api_server/resources', 'apps/api_server/tsconfig.json',
  'apps/api_server/package-lock.json', 'apps/web/public', 'apps/web/index.html',
  'apps/web/vite.config.ts', 'apps/web/package-lock.json', 'apps/electron/package-lock.json',
  'apps/electron/scripts', 'apps/electron/native', 'apps/electron/assets',
  'apps/mcp_server/scripts', 'apps/mcp_server/resources', 'apps/mcp_server/package-lock.json',
  'apps/opencode_fork/packages', 'apps/opencode_fork/package.json', 'apps/opencode_fork/bun.lock',
  'package.json', 'package-lock.json',
];
execFileSync('git', ['diff', '--exit-code', revision, '--', ...productPaths], { cwd: root, stdio: 'pipe' });
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...productPaths], { cwd: root, encoding: 'utf8' });
if (untracked.trim()) throw new Error('Untracked product sources require a fresh local build identity before qualification');
const args = process.argv.slice(2);
const syntheticIndex = args.indexOf('--synthetic');
let manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
if (syntheticIndex >= 0) {
  args.splice(syntheticIndex, 1);
  if (manifestPath) throw new Error('Use either a new --synthetic actor or an explicit fixture manifest');
  manifestPath = createQualificationFixture(revision);
  console.log(`Private qualification fixture and evidence: ${path.dirname(manifestPath)}`);
}
console.log(`AI behavior qualification: local bundle source ${revision}; model gate=${process.env.RHYTHM_FEATURE_MODEL ?? 'off'}`);
const result = spawnSync(process.execPath, [
  path.join(root, 'apps/web/node_modules/@playwright/test/cli.js'),
  'test', '-c', 'tests/packaged/packaged-ai-playwright.config.ts', ...args,
], {
  cwd: path.join(root, 'apps/web'), stdio: 'inherit',
  env: { ...process.env, RHYTHM_PACKAGED_APP: app, RHYTHM_FEATURE_EXPECTED_REVISION: revision,
    ...(manifestPath ? { RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: manifestPath,
      RHYTHM_WORKSTREAMS_ENABLED: 'true', RHYTHM_MANAGED_CONTEXT_EXPORTS: '1' } : {}) },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
