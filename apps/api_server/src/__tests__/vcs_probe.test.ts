import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { probeVcs } from '../services/vcs_probe';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test']);
  git(cwd, ['commit', '--allow-empty', '-q', '-m', 'init']);
}

describe('probeVcs', () => {
  it('returns populated fields for a git repo (current working directory)', () => {
    // The Rhythm repo itself is a git checkout; CI and local both run inside it.
    const info = probeVcs(process.cwd());
    expect(info).not.toBeNull();
    expect(info!.vcsRoot).toBeTruthy();
    // branch may be null in detached HEAD (CI sometimes detaches); accept either.
    if (info!.vcsBranch !== null) {
      expect(typeof info!.vcsBranch).toBe('string');
    }
    expect(typeof info!.vcsDirty).toBe('boolean');
  });

  it('returns null for a non-git temp directory', () => {
    const tmp = makeTmpDir('vcs-probe-nongit-');
    try {
      expect(probeVcs(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flips vcsDirty true when an untracked file exists and false after cleanup', () => {
    const tmp = makeTmpDir('vcs-probe-dirty-');
    try {
      initRepo(tmp);
      const clean = probeVcs(tmp);
      expect(clean).not.toBeNull();
      expect(clean!.vcsDirty).toBe(false);

      fs.writeFileSync(path.join(tmp, 'untracked.txt'), 'x');
      const dirty = probeVcs(tmp);
      expect(dirty!.vcsDirty).toBe(true);

      fs.rmSync(path.join(tmp, 'untracked.txt'));
      const cleanAgain = probeVcs(tmp);
      expect(cleanAgain!.vcsDirty).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns vcsRoot but null vcsBranch when HEAD is detached', () => {
    const tmp = makeTmpDir('vcs-probe-detached-');
    try {
      initRepo(tmp);
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tmp,
        encoding: 'utf8',
      }).trim();
      git(tmp, ['checkout', '-q', '--detach', sha]);
      const info = probeVcs(tmp);
      expect(info).not.toBeNull();
      expect(info!.vcsRoot).toBeTruthy();
      expect(info!.vcsBranch).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when the underlying shell call fails (e.g. git unavailable)', async () => {
    vi.resetModules();
    vi.doMock('child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('spawn failure');
      }),
    }));
    const mod = await import('../services/vcs_probe');
    expect(mod.probeVcs(process.cwd())).toBeNull();
    vi.doUnmock('child_process');
    vi.resetModules();
  });
});
