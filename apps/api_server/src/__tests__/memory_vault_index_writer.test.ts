import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  regenerateMemoryVaultNavigation,
} from '../services/memory_vault_index_writer';
import { scanVaultNotes } from '../services/memoryVaultSyncService';

let memoryDir: string;

function note(name: string, raw: string): void {
  const abs = path.join(memoryDir, name);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, raw, 'utf8');
}

beforeEach(() => {
  memoryDir = mkdtempSync(path.join(tmpdir(), 'memory-navigation-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(memoryDir, { recursive: true, force: true });
});

describe('OKF memory-vault navigation indexes (#1194)', () => {
  it('writes conforming root/child indexes with descriptions and lifecycle markers', async () => {
    note(
      'fact/zulu.md',
      [
        '---',
        'kind: fact',
        'title: Zulu fact',
        'description: Explicit summary.',
        'status: deprecated',
        '---',
        'Ignored first body line.',
      ].join('\n'),
    );
    note(
      'fact/alpha.md',
      [
        '---',
        'kind: fact',
        'stale_after: 2026-07-26',
        '---',
        '# Alpha first line',
        '',
        'More detail.',
      ].join('\n'),
    );

    const result = await regenerateMemoryVaultNavigation(memoryDir, {
      today: '2026-07-26',
    });
    expect(result).toEqual({ written: 6, unchanged: 0, failed: 0 });

    const root = readFileSync(path.join(memoryDir, 'index.md'), 'utf8');
    expect(root).toMatch(/^---\nokf_version: "0\.2"\n---\n# Memory\n/);
    expect(root).toContain('* [Facts](fact/index.md) - 2 memories.');
    expect(root).toContain('* [People](person/index.md) - 0 memories.');

    const child = readFileSync(path.join(memoryDir, 'fact', 'index.md'), 'utf8');
    expect(child.startsWith('---')).toBe(false);
    expect(child).toBe(
      [
        '# Facts',
        '',
        '* [Alpha](alpha.md) [stale] - Alpha first line',
        '* [Zulu fact](zulu.md) [deprecated] - Explicit summary.',
        '',
      ].join('\n'),
    );
    expect(readFileSync(path.join(memoryDir, 'person', 'index.md'), 'utf8'))
      .toBe('# People\n\n_No memories._\n');
  });

  it('is deterministic and skips byte-identical writes', async () => {
    note('fact/bravo.md', '---\nkind: fact\n---\nBravo.');
    note('fact/alpha.md', '---\nkind: fact\n---\nAlpha.');

    await regenerateMemoryVaultNavigation(memoryDir);
    const files = [
      'index.md',
      ...['fact', 'person', 'project', 'preference', 'context']
        .map((kind) => path.join(kind, 'index.md')),
    ];
    const firstBytes = new Map(
      files.map((file) => [
        file,
        readFileSync(path.join(memoryDir, file), 'utf8'),
      ]),
    );
    for (const file of files) {
      utimesSync(path.join(memoryDir, file), new Date(0), new Date(0));
    }

    const second = await regenerateMemoryVaultNavigation(memoryDir);
    expect(second).toEqual({ written: 0, unchanged: 6, failed: 0 });
    for (const file of files) {
      expect(readFileSync(path.join(memoryDir, file), 'utf8'))
        .toBe(firstBytes.get(file));
      expect(statSync(path.join(memoryDir, file)).mtimeMs).toBe(0);
    }
  });

  it('serializes concurrent runs so an older scan cannot overwrite a newer one', async () => {
    note('fact/alpha.md', '---\nkind: fact\n---\nAlpha.');
    const originalWriteFile = fsPromises.writeFile.bind(fsPromises);
    let releaseFirstWrite!: () => void;
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let signalFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWrite = resolve;
    });
    let blocked = false;
    vi.spyOn(fsPromises, 'writeFile').mockImplementation(
      async (...args: Parameters<typeof fsPromises.writeFile>) => {
        if (!blocked) {
          blocked = true;
          signalFirstWrite();
          await firstWriteReleased;
        }
        return originalWriteFile(...args);
      },
    );

    const first = regenerateMemoryVaultNavigation(memoryDir);
    await firstWriteStarted;
    note('fact/bravo.md', '---\nkind: fact\n---\nBravo.');
    const second = regenerateMemoryVaultNavigation(memoryDir);
    releaseFirstWrite();
    await Promise.all([first, second]);

    const child = readFileSync(path.join(memoryDir, 'fact', 'index.md'), 'utf8');
    expect(child).toContain('[Alpha](alpha.md)');
    expect(child).toContain('[Bravo](bravo.md)');
  });

  it('logs/skips one unwritable index and still writes the remaining navigation', async () => {
    note('fact/kept.md', '---\nkind: fact\n---\nKept note.');
    mkdirSync(path.join(memoryDir, 'fact', 'index.md'));

    const result = await regenerateMemoryVaultNavigation(memoryDir);

    expect(result.failed).toBe(1);
    expect(result.written).toBe(5);
    expect(readFileSync(path.join(memoryDir, 'index.md'), 'utf8'))
      .toContain('* [Facts](fact/index.md) - 1 memory.');
    expect((await scanVaultNotes(memoryDir)).map((entry) => entry.sourceId))
      .toEqual([path.join('fact', 'kept.md')]);
  });

  it('never follows a kind-directory symlink outside the memory root', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'memory-navigation-outside-'));
    try {
      symlinkSync(outside, path.join(memoryDir, 'fact'), 'dir');

      const result = await regenerateMemoryVaultNavigation(memoryDir);

      expect(result).toEqual({ written: 5, unchanged: 0, failed: 1 });
      expect(existsSync(path.join(outside, 'index.md'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('encodes human-authored filenames into valid Markdown link destinations', async () => {
    note(
      'fact/human note (v2).md',
      '---\nkind: fact\n---\nHuman filename.',
    );

    await regenerateMemoryVaultNavigation(memoryDir);

    expect(readFileSync(path.join(memoryDir, 'fact', 'index.md'), 'utf8'))
      .toContain(
        '[Human Note (v2)](human%20note%20%28v2%29.md) - Human filename.',
      );
  });

  it('escapes backslashes before brackets so titles cannot replace note links', async () => {
    note(
      'fact/safe.md',
      [
        '---',
        "title: '\\](https://example.invalid)'",
        'kind: fact',
        '---',
        'Body.',
      ].join('\n'),
    );

    await regenerateMemoryVaultNavigation(memoryDir);

    const line = readFileSync(
      path.join(memoryDir, 'fact', 'index.md'),
      'utf8',
    ).split('\n')[2];
    expect(line.match(/^\* \[(\\+)\]/)?.[1]).toHaveLength(3);
    expect(line.endsWith('](safe.md) - Body.')).toBe(true);
  });

  it('can preserve missing-vault no-op semantics for sync/rebuild callers', async () => {
    const missing = path.join(memoryDir, 'not-created');

    const result = await regenerateMemoryVaultNavigation(missing, {
      createIfMissing: false,
    });

    expect(result).toEqual({ written: 0, unchanged: 0, failed: 0 });
    expect(existsSync(missing)).toBe(false);
  });
});
