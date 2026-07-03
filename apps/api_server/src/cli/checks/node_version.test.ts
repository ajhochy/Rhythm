import { describe, expect, it } from 'vitest';

import { checkNodeVersion } from './node_version';

describe('checkNodeVersion', () => {
  it('passes when the running Node version satisfies the declared engines range', () => {
    const result = checkNodeVersion({ nodeVersion: 'v20.14.0', enginesRange: '>=20 <25' });
    expect(result.pass).toBe(true);
    expect(result.remediation).toBeUndefined();
  });

  it('fails with remediation when the running Node version is too old', () => {
    const result = checkNodeVersion({ nodeVersion: 'v18.19.0', enginesRange: '>=20 <25' });
    expect(result.pass).toBe(false);
    expect(result.remediation).toMatch(/20/);
  });

  it('fails with remediation when the running Node version is too new', () => {
    const result = checkNodeVersion({ nodeVersion: 'v25.0.0', enginesRange: '>=20 <25' });
    expect(result.pass).toBe(false);
  });

  it('does not throw when the engines range is missing from package.json', () => {
    const result = checkNodeVersion({ nodeVersion: 'v20.14.0', enginesRange: undefined });
    expect(result.pass).toBe(true);
  });
});
