/**
 * #1133 — containsReal / canonicalize: realpath-based containment guard
 * used by resolveSessionDir and the /opencode/worktrees routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { containsReal } from '../utils/path_containment';

describe('containsReal', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'containment-root-'));
    outside = mkdtempSync(join(tmpdir(), 'containment-outside-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects an in-root symlink pointing outside root (escapes the lexical check, not this one)', () => {
    writeFileSync(join(outside, 'passwd'), 'secret');
    const link = join(root, 'link');
    symlinkSync(outside, link);
    const target = join(link, 'passwd');

    // The lexical string check is fooled (target is prefixed by root); containsReal must not be.
    expect(target.startsWith(root + '/')).toBe(true);
    expect(containsReal(root, target)).toBe(false);
  });

  it('allows a legitimate subdirectory', () => {
    const sub = join(root, 'sub', 'file.ts');
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(sub, 'x');
    expect(containsReal(root, sub)).toBe(true);
  });

  it('does not false-lockout when the root itself is reached through a symlink', () => {
    const child = join(root, 'child.txt');
    writeFileSync(child, 'x');
    const base = mkdtempSync(join(tmpdir(), 'containment-base-'));
    const rootViaSymlink = join(base, 'root-link');
    symlinkSync(root, rootViaSymlink);
    try {
      expect(containsReal(rootViaSymlink, child)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('allows a non-existent write target whose nearest existing parent is inside root', () => {
    const newFile = join(root, 'does-not-exist-yet.txt');
    expect(containsReal(root, newFile)).toBe(true);
  });

  it('fails closed on a dangling symlink', () => {
    const dangling = join(root, 'dangling');
    symlinkSync(join(root, 'nope-does-not-exist'), dangling);
    expect(containsReal(root, dangling)).toBe(false);
    expect(containsReal(root, join(dangling, 'passwd'))).toBe(false);
  });

  it('blocks ../ and direct-outside paths (no regression)', () => {
    expect(containsReal('/a/b', '/a/b/../../etc')).toBe(false);
    expect(containsReal('/a/b', '/etc/passwd')).toBe(false);
  });
});
