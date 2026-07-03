/**
 * Unit tests for issue #878 — persistent "always allow" approval store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApprovalStore } from './approval_store';

describe('ApprovalStore (#878)', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-approval-store-test-'));
    filePath = join(tempDir, '.rhythm_command_approvals.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports not-allowed when the file is absent', () => {
    const store = new ApprovalStore(filePath);
    expect(store.isAlwaysAllowed('ls -la')).toBe(false);
  });

  it('alwaysAllow persists and is honored on a subsequent call without prompting', () => {
    const store = new ApprovalStore(filePath);
    store.alwaysAllow('ls -la');
    expect(store.isAlwaysAllowed('ls -la')).toBe(true);
    expect(store.isAlwaysAllowed('git push')).toBe(false);
  });

  it('persists across a new store instance reading the same file (restart simulation)', () => {
    const first = new ApprovalStore(filePath);
    first.alwaysAllow('npm test');
    const second = new ApprovalStore(filePath);
    expect(second.isAlwaysAllowed('npm test')).toBe(true);
  });

  it('stores command patterns, not secrets', () => {
    const store = new ApprovalStore(filePath);
    store.alwaysAllow('npm test');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed).toEqual({ alwaysAllowed: ['npm test'] });
  });

  it('does not crash on a malformed file and self-heals on next write', () => {
    writeFileSync(filePath, 'not json {{{');
    const store = new ApprovalStore(filePath);
    expect(() => store.isAlwaysAllowed('ls')).not.toThrow();
    expect(store.isAlwaysAllowed('ls')).toBe(false);
    store.alwaysAllow('ls');
    expect(store.isAlwaysAllowed('ls')).toBe(true);
  });

  it('does not duplicate entries when the same command is allowed twice', () => {
    const store = new ApprovalStore(filePath);
    store.alwaysAllow('ls -la');
    store.alwaysAllow('ls -la');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { alwaysAllowed: string[] };
    expect(parsed.alwaysAllowed).toEqual(['ls -la']);
  });
});
