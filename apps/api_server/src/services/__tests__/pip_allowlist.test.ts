/**
 * pip_allowlist.test.ts — #876: the curated PyPI allowlist is a maintained,
 * code-reviewed static list — this test only pins its shape/behavior, not
 * pushes new packages into it (that's a separate PR per the issue's
 * "additions require a code review, not a config change" constraint).
 */
import { describe, it, expect } from 'vitest';
import { PIP_ALLOWLIST, isAllowedPackage } from '../pip_allowlist';

describe('pip_allowlist (#876)', () => {
  it('is a non-empty static list', () => {
    expect(PIP_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it('recognizes a known-good package', () => {
    expect(isAllowedPackage('httpx')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowedPackage('HTTPX')).toBe(true);
  });

  it('rejects an arbitrary/unknown package name', () => {
    expect(isAllowedPackage('super-sketchy-pkg')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isAllowedPackage('')).toBe(false);
  });
});
