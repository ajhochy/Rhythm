import { describe, expect, it, vi } from 'vitest';

import { mergeDotenvContent, writeEnvConfig } from './write_env_config';

describe('mergeDotenvContent', () => {
  it('appends new keys to empty existing content', () => {
    const merged = mergeDotenvContent('', { ANTHROPIC_API_KEY: 'sk-test' });
    expect(merged).toContain('ANTHROPIC_API_KEY=sk-test');
  });

  it('updates an existing key in place rather than duplicating it', () => {
    const existing = 'ANTHROPIC_API_KEY=old-value\nOTHER=keep\n';
    const merged = mergeDotenvContent(existing, { ANTHROPIC_API_KEY: 'new-value' });
    const matches = merged.split('\n').filter((l) => l.startsWith('ANTHROPIC_API_KEY='));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('ANTHROPIC_API_KEY=new-value');
    expect(merged).toContain('OTHER=keep');
  });

  it('leaves unrelated keys untouched', () => {
    const existing = 'FOO=bar\n';
    const merged = mergeDotenvContent(existing, { ANTHROPIC_API_KEY: 'sk-test' });
    expect(merged).toContain('FOO=bar');
    expect(merged).toContain('ANTHROPIC_API_KEY=sk-test');
  });
});

describe('writeEnvConfig', () => {
  it('writes the merged file atomically (temp file + rename) with 0600 permissions', async () => {
    const writeFileSync = vi.fn();
    const renameSync = vi.fn();
    const chmodSync = vi.fn();

    await writeEnvConfig(
      { ANTHROPIC_API_KEY: 'sk-test' },
      {
        path: '/fake/.env',
        existsSync: () => false,
        readFileSync: () => '',
        writeFileSync,
        renameSync,
        chmodSync,
      },
    );

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [tempPath] = writeFileSync.mock.calls[0];
    expect(tempPath).not.toBe('/fake/.env');
    expect(renameSync).toHaveBeenCalledWith(tempPath, '/fake/.env');
    expect(chmodSync).toHaveBeenCalledWith(tempPath, 0o600);
  });

  it('never writes a partial file when the writer throws mid-way', async () => {
    const writeFileSync = vi.fn(() => {
      throw new Error('disk full');
    });
    const renameSync = vi.fn();

    await expect(
      writeEnvConfig(
        { ANTHROPIC_API_KEY: 'sk-test' },
        {
          path: '/fake/.env',
          existsSync: () => false,
          readFileSync: () => '',
          writeFileSync,
          renameSync,
          chmodSync: vi.fn(),
        },
      ),
    ).rejects.toThrow('disk full');

    // The rename (which makes the write visible at the real path) must never
    // have been called — the original file (if any) is untouched.
    expect(renameSync).not.toHaveBeenCalled();
  });
});
