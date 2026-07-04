import { describe, expect, it } from 'vitest';

import { checkPythonVersion, parsePythonVersionOutput } from './python_version';

describe('parsePythonVersionOutput', () => {
  it('parses a standard "Python X.Y.Z" string', () => {
    expect(parsePythonVersionOutput('Python 3.11.4')).toEqual({
      major: 3,
      minor: 11,
      patch: 4,
    });
  });

  it('returns null for unparseable output', () => {
    expect(parsePythonVersionOutput('command not found')).toBeNull();
  });
});

describe('checkPythonVersion', () => {
  it('passes when python3 reports a version within the required range', async () => {
    const result = await checkPythonVersion({
      runCommand: async () => ({ stdout: 'Python 3.11.4', ok: true }),
    });
    expect(result.pass).toBe(true);
    expect(result.remediation).toBeUndefined();
  });

  it('fails with remediation when the version is too old', async () => {
    const result = await checkPythonVersion({
      runCommand: async () => ({ stdout: 'Python 3.8.0', ok: true }),
    });
    expect(result.pass).toBe(false);
    expect(result.remediation).toMatch(/3\.10/);
  });

  it('fails gracefully (no throw) when python3 is not installed', async () => {
    const result = await checkPythonVersion({
      runCommand: async () => ({ stdout: '', ok: false }),
    });
    expect(result.pass).toBe(false);
    expect(result.remediation).toBeDefined();
  });
});
