import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { rememberToVault } from '../services/memoryVaultWriteService';

const roots: string[] = [];
const index = {
  upsertNote: async () => {},
  removeNote: async () => {},
} as never;

function fixture(): { vault: string; memory: string; outside: string } {
  const vault = mkdtempSync(join(tmpdir(), 'issue-1229-vault-'));
  const outside = mkdtempSync(join(tmpdir(), 'issue-1229-outside-'));
  roots.push(vault, outside);
  const memory = join(vault, 'memory');
  mkdirSync(memory);
  return { vault, memory, outside };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('issue #1229 memory-vault symlink contracts', () => {
  it('issue-1229-c1: real parent containment blocks an outside write', async () => {
    // Regression caught: lexical containment accepts `memory/fact` when fact is an outside symlink.
    const { memory, outside } = fixture();
    symlinkSync(outside, join(memory, 'fact'));
    await expect(
      rememberToVault(
        { kind: 'fact', content: 'Outside parent canary.' },
        { memoryDir: memory, index },
      ),
    ).rejects.toThrow(/symlink|outside|vault/i);
    expect(existsSync(join(outside, 'outside-parent-canary.md'))).toBe(false);
  });

  it('issue-1229-c2: a symlinked destination component is rejected', async () => {
    // Regression caught: a nested path component is followed before the write.
    const { memory, outside } = fixture();
    symlinkSync(outside, join(memory, 'preference'));
    await expect(
      rememberToVault(
        {
          kind: 'preference',
          content: 'Nested component canary.',
        },
        { memoryDir: memory, index },
      ),
    ).rejects.toThrow();
    expect(existsSync(join(outside, 'nested-component-canary.md'))).toBe(false);
  });

  it('issue-1229-c3: a destination symlink is rejected without modifying its target', async () => {
    // Regression caught: writeFile follows an existing note symlink and overwrites its target.
    const { memory, outside } = fixture();
    mkdirSync(join(memory, 'fact'));
    const target = join(outside, 'canary.md');
    writeFileSync(target, 'outside-canary');
    symlinkSync(target, join(memory, 'fact', 'destination-symlink.md'));
    await expect(
      rememberToVault(
        { kind: 'fact', content: 'Destination symlink.' },
        { memoryDir: memory, index },
      ),
    ).rejects.toThrow(/symlink/i);
    expect(readFileSync(target, 'utf8')).toBe('outside-canary');
  });

  it('rejects a parent-directory swap immediately before promotion', async () => {
    // Regression caught: an attacker swaps the validated parent for a symlink
    // after the temp write but before rename, redirecting promotion outside.
    const { memory, outside } = fixture();
    const movedParent = join(memory, 'fact-before-swap');
    await expect(
      rememberToVault(
        { kind: 'fact', content: 'Parent swap canary.' },
        {
          memoryDir: memory,
          index,
          beforeNotePromotion: async (parent) => {
            renameSync(parent, movedParent);
            symlinkSync(outside, parent);
          },
        },
      ),
    ).rejects.toThrow(/symlink|changed|unsafe/i);
    expect(existsSync(join(outside, 'parent-swap-canary.md'))).toBe(false);
  });

  it('detects a parent-directory swap immediately after promotion', async () => {
    // Regression caught: promotion succeeds but the parent is swapped before
    // the caller/index observes the destination.
    const { memory, outside } = fixture();
    const movedParent = join(memory, 'fact-after-swap');
    await expect(
      rememberToVault(
        { kind: 'fact', content: 'Post promotion canary.' },
        {
          memoryDir: memory,
          index,
          afterNotePromotion: async (parent) => {
            renameSync(parent, movedParent);
            symlinkSync(outside, parent);
          },
        },
      ),
    ).rejects.toThrow(/symlink|changed|unsafe/i);
    expect(existsSync(join(outside, 'post-promotion-canary.md'))).toBe(false);
  });

  it('issue-1229-c4: normal nested writes remain functional', async () => {
    // Regression caught: symlink defense rejects ordinary newly-created kind directories.
    const { memory } = fixture();
    const result = await rememberToVault(
      { kind: 'preference', content: 'Normal nested write.' },
      { memoryDir: memory, index },
    );
    expect(existsSync(join(memory, 'preference', 'normal-nested-write.md'))).toBe(
      true,
    );
    expect(result.path).toContain('preference/normal-nested-write.md');
  });
});
