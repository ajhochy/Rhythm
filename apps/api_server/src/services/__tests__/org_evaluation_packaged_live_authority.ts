/** Tests-only authority for gated real-model runs against the signed local app. */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface FixtureManifest {
  fixtureRoot: string;
  dbPath: string;
  sourceRevision: string;
  syntheticActor?: { modelLoan?: { provider?: string; accountPath: string; stopAt: number } };
}

// Same product-source boundary as tools/testing/run_packaged_ai.mjs. Tests and
// docs may advance after signing, but changed executable source needs a rebuild.
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

export interface PackagedOrgEvaluationAuthority {
  revision: string;
  engineBinary: string;
  createOrgEvaluationRuntimeAdapter: typeof import('../org_evaluation_runtime').createOrgEvaluationRuntimeAdapter;
  OrgEvaluationProviderRelay: typeof import('../org_evaluation_provider_relay').OrgEvaluationProviderRelay;
  resolveConfiguredEvaluationUpstream: typeof import('../org_evaluation_provider_relay').resolveConfiguredEvaluationUpstream;
  assertCurrentLoan(): void;
}

/** Never reads a normal account path or imports its singleton before fixture binding. */
export async function loadPackagedOrgEvaluationAuthorityAsync(): Promise<PackagedOrgEvaluationAuthority> {
  const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
  const revision = process.env.RHYTHM_QUALIFICATION_SOURCE_REVISION;
  if (!manifestPath || !revision || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Gated evaluation requires an exact approved private fixture revision');
  }
  const fixtureModule = await import(pathToFileURL(resolve(__dirname,
    '../../../../../tools/testing/qualification_fixture.mjs')).href) as {
    readQualificationFixture(path: string, revision: string): { manifest: FixtureManifest };
  };
  const assertCurrentLoan = (): void => {
    const manifest = fixtureModule.readQualificationFixture(manifestPath, revision).manifest;
    const loan = manifest.syntheticActor?.modelLoan;
    if (manifest.sourceRevision !== revision || loan?.provider !== 'anthropic' ||
        loan.accountPath !== join(manifest.fixtureRoot, 'anthropic-accounts.json') ||
        loan.stopAt <= Date.now() + 120_000 || process.env.DB_CLIENT !== 'sqlite' ||
        process.env.DB_PATH !== manifest.dbPath || process.env.RHYTHM_ACCOUNTS_FILE !== loan.accountPath) {
      throw new Error('Gated evaluation is not bound to the selected private Anthropic loan and database');
    }
  };
  const initial = fixtureModule.readQualificationFixture(manifestPath, revision).manifest;
  const loan = initial.syntheticActor?.modelLoan;
  if (initial.sourceRevision !== revision || loan?.provider !== 'anthropic' ||
      loan.accountPath !== join(initial.fixtureRoot, 'anthropic-accounts.json') ||
      loan.stopAt <= Date.now() + 120_000) {
    throw new Error('Gated evaluation requires a fresh selected private Anthropic loan');
  }
  const repoRoot = resolve(__dirname, '../../../../..');
  const appRoot = join(repoRoot, 'apps', 'electron', 'dist', 'Rhythm.app');
  const resources = join(appRoot, 'Contents', 'Resources');
  const apiRoot = join(resources, 'api_server');
  const identity = JSON.parse(readFileSync(join(apiRoot, 'build-identity.json'), 'utf8')) as {
    schemaVersion?: number; sourceRevision?: string;
  };
  if (identity.schemaVersion !== 1 || identity.sourceRevision !== revision) {
    throw new Error('Signed application and fixture source revisions differ');
  }
  try {
    execFileSync('git', ['diff', '--exit-code', revision, '--', ...productPaths],
      { cwd: repoRoot, stdio: 'pipe', timeout: 30_000 });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...productPaths],
      { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
    if (untracked.trim()) throw new Error('Untracked product source');
  } catch {
    throw new Error('Packaged evaluation refuses product source drift from signed revision');
  }
  const engineBinary = join(resources, 'opencode_bin', 'opencode');
  const runtimePath = join(apiRoot, 'dist', 'services', 'org_evaluation_runtime.js');
  const relayPath = join(apiRoot, 'dist', 'services', 'org_evaluation_provider_relay.js');
  const accountsPath = join(apiRoot, 'dist', 'services', 'anthropic_accounts_service.js');
  for (const file of [engineBinary, runtimePath, relayPath, accountsPath]) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file) {
      throw new Error('Signed evaluation resource is not a regular packaged file');
    }
  }
  if (!(lstatSync(engineBinary).mode & 0o111)) throw new Error('Packaged engine is not executable');
  execFileSync('codesign', ['--verify', '--deep', '--strict', appRoot], { timeout: 30_000, stdio: 'ignore' });
  const engineVersion = execFileSync(engineBinary, ['--version'], { timeout: 10_000, encoding: 'utf8' }).trim();
  if (engineVersion !== `0.0.0-rhythm-${revision}`) throw new Error('Packaged engine revision differs from fixture');

  // vitest.setup may choose another disposable DB. The packaged module must
  // see the approved authority paths at its first import.
  process.env.DB_CLIENT = 'sqlite';
  process.env.DB_PATH = initial.dbPath;
  process.env.RHYTHM_ACCOUNTS_FILE = loan.accountPath;
  assertCurrentLoan();
  const { createOrgEvaluationRuntimeAdapter } = require(runtimePath) as typeof import('../org_evaluation_runtime');
  const { OrgEvaluationProviderRelay, resolveConfiguredEvaluationUpstream } =
    require(relayPath) as typeof import('../org_evaluation_provider_relay');
  const { anthropicAccountsService } = require(accountsPath) as typeof import('../anthropic_accounts_service');
  if (anthropicAccountsService.storePath !== loan.accountPath) {
    throw new Error('Packaged provider singleton is outside the private selected account');
  }
  return { revision, engineBinary, createOrgEvaluationRuntimeAdapter,
    OrgEvaluationProviderRelay, resolveConfiguredEvaluationUpstream, assertCurrentLoan };
}
