import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('MEM-OKF #1187 runtime packaging', () => {
  it('declares js-yaml as a runtime dependency and bundles production dependencies in desktop release', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'apps/api_server/package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.['js-yaml']).toMatch(/^\^4/);
    expect(packageJson.devDependencies?.['@types/js-yaml']).toBeTruthy();

    const apiLock = readFileSync(
      path.join(REPO_ROOT, 'apps/api_server/package-lock.json'),
      'utf8',
    );
    expect(apiLock).toContain('"node_modules/js-yaml"');

    const release = readFileSync(
      path.join(REPO_ROOT, '.github/workflows/desktop_release.yml'),
      'utf8',
    );
    expect(release).toContain('cp ../api_server/package-lock.json "$DEST/"');
    expect(release).toContain('npm install --omit=dev');
  });
});
