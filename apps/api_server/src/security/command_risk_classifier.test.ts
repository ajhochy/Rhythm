/**
 * Unit tests for issue #878 — local command risk classifier (smart mode).
 */

import { describe, it, expect } from 'vitest';
import { classifyCommandRisk } from './command_risk_classifier';

describe('classifyCommandRisk (#878)', () => {
  it('classifies git push --force as high risk', () => {
    expect(classifyCommandRisk('git push --force origin main')).toBe('high');
  });

  it('classifies git reset --hard as high risk', () => {
    expect(classifyCommandRisk('git reset --hard HEAD~3')).toBe('high');
  });

  it('classifies a DROP TABLE statement as high risk', () => {
    expect(classifyCommandRisk('psql -c "DROP TABLE users;"')).toBe('high');
  });

  it('classifies a DELETE without WHERE as high risk', () => {
    expect(classifyCommandRisk('psql -c "DELETE FROM users"')).toBe('high');
  });

  it('does not flag a scoped DELETE with a WHERE clause as high risk', () => {
    expect(classifyCommandRisk('psql -c "DELETE FROM users WHERE id = 5"')).not.toBe('high');
  });

  it('classifies common read-only commands as low risk', () => {
    expect(classifyCommandRisk('ls -la')).toBe('low');
    expect(classifyCommandRisk('git status')).toBe('low');
    expect(classifyCommandRisk('git log --oneline')).toBe('low');
    expect(classifyCommandRisk('npm test')).toBe('low');
    expect(classifyCommandRisk('cat package.json')).toBe('low');
    expect(classifyCommandRisk('grep -rn "foo" src')).toBe('low');
  });

  it('classifies an unrecognized command as uncertain (fail-closed for auto-approve)', () => {
    expect(classifyCommandRisk('some-custom-cli --deploy-prod')).toBe('uncertain');
  });

  it('never classifies a high-risk command as low-risk even if it starts with a safe-looking prefix', () => {
    // Starts with "git" (which git-status low-risk pattern anchors on) but is
    // actually a force-push — high-risk classification must win.
    expect(classifyCommandRisk('git push --force')).toBe('high');
  });
});
