import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from './test-utils/semverRangeCheck';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

describe('single host-owned React runtime', () => {
  it('declares react and react-dom as peerDependencies, never as a bundled dependency', () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty('react');
    expect(pkg.dependencies ?? {}).not.toHaveProperty('react-dom');
    expect(pkg.peerDependencies).toHaveProperty('react');
    expect(pkg.peerDependencies).toHaveProperty('react-dom');
  });

  it('accepts both React 18.3.1 and React 19.2.0 under its declared peer range', () => {
    expect(semver.satisfies('18.3.1', pkg.peerDependencies.react)).toBe(true);
    expect(semver.satisfies('19.2.0', pkg.peerDependencies.react)).toBe(true);
    expect(semver.satisfies('18.3.1', pkg.peerDependencies['react-dom'])).toBe(true);
    expect(semver.satisfies('19.2.0', pkg.peerDependencies['react-dom'])).toBe(true);
  });

  it('rejects a pre-18.3 React so the peer contract stays exact, not accidentally permissive', () => {
    expect(semver.satisfies('18.2.0', pkg.peerDependencies.react)).toBe(false);
    expect(semver.satisfies('17.0.2', pkg.peerDependencies.react)).toBe(false);
  });
});
