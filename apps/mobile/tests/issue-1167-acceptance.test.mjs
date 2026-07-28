import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const foundation = packageJson.scripts['verify:foundation'] ?? '';

for (const requiredScript of [
  'contract:check',
  'lint',
  'typecheck',
  'test:transport-clients',
  'test:rhythm-account',
  'test:google-mobile-oauth',
  'test:e2e:web',
]) {
  assert.match(
    foundation,
    new RegExp(`npm run ${requiredScript.replaceAll(':', '\\:')}`),
    `issue-1167-c1: verify:foundation must include ${requiredScript}`,
  );
}

assert.doesNotThrow(
  () => execFileSync('node', ['./scripts/rhythm-opencode-contract.mjs', '--check'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe',
  }),
  'issue-1167-c1: the contract gate must resolve the Rhythm monorepo from apps/mobile',
);

const trackedMobileFiles = execFileSync(
  'git',
  ['ls-files', 'apps/mobile'],
  {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  },
).trim().split('\n').filter(Boolean);

const credentialPatterns = [
  new RegExp(['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'].join('')),
  /\bgh[opusr]_[A-Za-z0-9_]{36,}\b/,
  /\bsk-(?:live|proj)-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

for (const file of trackedMobileFiles) {
  const contents = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8')
    .catch(() => null);
  if (contents === null) continue;
  for (const pattern of credentialPatterns) {
    assert.doesNotMatch(
      contents,
      pattern,
      `issue-1167-c2: tracked mobile file ${file} contains credential material`,
    );
  }
}

console.log('Issue #1167 acceptance contract checks passed');
