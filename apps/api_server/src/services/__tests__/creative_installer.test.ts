import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CREATIVE_INSTALL_RECIPES,
  installCreativeDependency,
  type CreativeInstallArtifact,
  type CreativeInstallerDeps,
} from '../creative_installer';

const roots: string[] = [];

const approval = (
  id: keyof typeof CREATIVE_INSTALL_RECIPES,
  sessionId: string | null = 'session-1',
) => ({
  id: 'approval',
  sessionId,
  agentConfigId: null,
  action: `install_creative_dependency:${id}`,
  preview: null,
  consequence: null,
  status: 'approved' as const,
  actor: null,
  decidedAt: null,
  createdAt: '',
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'rhythm-creative-installer-'));
  roots.push(path);
  return path;
}

async function fakeDownload(
  item: CreativeInstallArtifact,
  destination: string,
): Promise<string> {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, item.filename);
  return item.sha256;
}

const resolveExecutable: NonNullable<CreativeInstallerDeps['resolveExecutable']> =
  async (names) => `/resolved/${names[0]}`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe('installCreativeDependency', () => {
  it('exposes only seven reviewed recipes with fixed, checksummed artifacts', () => {
    expect(Object.keys(CREATIVE_INSTALL_RECIPES)).toHaveLength(7);
    expect(JSON.stringify(CREATIVE_INSTALL_RECIPES)).not.toMatch(
      /rembg|real-esrgan/i,
    );
    for (const recipe of Object.values(CREATIVE_INSTALL_RECIPES)) {
      expect(recipe.installer).toBe(recipe.id);
      for (const item of recipe.artifacts) {
        expect(item.filename).not.toContain('/');
        expect(item.url).toMatch(/^https:\/\//);
        expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('requires a matching approved action and session before downloading', async () => {
    const downloader = vi.fn(fakeDownload);
    await expect(
      installCreativeDependency(
        { id: 'media-tools', sessionId: 'other' },
        {
          approvals: { list: () => [approval('media-tools')] },
          downloader,
          root: await root(),
        },
      ),
    ).resolves.toMatchObject({ status: 'denied' });
    expect(downloader).not.toHaveBeenCalled();
  });

  it('keeps model license acceptance separate from install approval', async () => {
    const downloader = vi.fn(fakeDownload);
    await expect(
      installCreativeDependency(
        { id: 'comfyui-model-pack', sessionId: 'session-1' },
        {
          approvals: { list: () => [approval('comfyui-model-pack')] },
          downloader,
          root: await root(),
        },
      ),
    ).resolves.toMatchObject({ status: 'awaiting-user' });
    expect(downloader).not.toHaveBeenCalled();
  });

  it('installs the REST-compatible Obsidian wheel into the exact curated command path', async () => {
    const managedRoot = await root();
    const runner: NonNullable<CreativeInstallerDeps['runner']> = vi.fn(
      async (argv: readonly string[]) => {
        if (argv.includes('venv')) {
          const venv = argv.at(-1)!;
          await mkdir(join(venv, 'bin'), { recursive: true });
          await writeFile(join(venv, 'bin', 'python'), '');
        }
        if (argv.includes('pip')) {
          const python = argv[0];
          await writeFile(
            join(dirname(python), 'mcp-obsidian'),
            `#!/bin/sh\nexec "${python}" "$@"\n`,
          );
        }
      },
    );

    const result = await installCreativeDependency(
      { id: 'obsidian', sessionId: 'session-1' },
      {
        approvals: { list: () => [approval('obsidian')] },
        downloader: fakeDownload,
        runner,
        resolveExecutable,
        root: managedRoot,
      },
    );

    expect(result).toMatchObject({ status: 'awaiting-user' });
    await expect(
      access(join(managedRoot, 'obsidian', '.venv', 'bin', 'mcp-obsidian')),
    ).resolves.toBeUndefined();
    const sentinel = JSON.parse(
      await readFile(
        join(managedRoot, 'obsidian', '.rhythm-installed.json'),
        'utf8',
      ),
    ) as { version: string };
    expect(sentinel.version).toBe('0.2.2-r2');
    expect(
      await readFile(
        join(managedRoot, 'obsidian', '.venv', 'bin', 'mcp-obsidian'),
        'utf8',
      ),
    ).not.toContain('.install-obsidian-');
    expect(runner).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('.venv/bin/python'),
        '-m',
        'pip',
        'install',
        expect.stringContaining('mcp_obsidian-0.2.2-py3-none-any.whl'),
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining('/opt/homebrew/bin'),
        }),
        logPath: expect.stringContaining('creative-install.log'),
      }),
    );
  });

  it('installs ffmpeg from the checksummed tarball instead of appending it to npm pack', async () => {
    const managedRoot = await root();
    const runner: NonNullable<CreativeInstallerDeps['runner']> = vi.fn(
      async (argv: readonly string[]) => {
        if (argv.some((part) => part.includes('npm-cli.js'))) {
          const prefix = argv[argv.indexOf('--prefix') + 1];
          const ffmpeg = join(
            prefix,
            'node_modules',
            'ffmpeg-static',
            'ffmpeg',
          );
          await mkdir(dirname(ffmpeg), { recursive: true });
          await writeFile(ffmpeg, 'binary');
        }
      },
    );

    const result = await installCreativeDependency(
      { id: 'media-tools', sessionId: 'session-1' },
      {
        approvals: { list: () => [approval('media-tools')] },
        downloader: fakeDownload,
        runner,
        resolveExecutable,
        root: managedRoot,
      },
    );

    expect(result).toMatchObject({ status: 'installed' });
    const npmArgv = vi
      .mocked(runner)
      .mock.calls.map(([argv]) => argv)
      .find((argv) => argv.some((part) => part.includes('npm-cli.js')))!;
    expect(npmArgv).toContainEqual(
      expect.stringContaining('ffmpeg-static-5.3.0.tgz'),
    );
    expect(npmArgv).not.toContain('ffmpeg-static@5.3.0');
    expect(
      await readFile(join(managedRoot, 'media-tools', 'bin', 'ffmpeg'), 'utf8'),
    ).toBe('binary');
  });

  it('does not trust a sentinel when required runtime files are absent', async () => {
    const managedRoot = await root();
    await mkdir(join(managedRoot, 'obsidian'), { recursive: true });
    await writeFile(
      join(managedRoot, 'obsidian', '.rhythm-installed.json'),
      JSON.stringify({ version: '0.2.2-r2' }),
    );
    const downloader = vi.fn(fakeDownload);
    const result = await installCreativeDependency(
      { id: 'obsidian', sessionId: 'session-1' },
      {
        approvals: { list: () => [approval('obsidian')] },
        downloader,
        runner: async () => {},
        resolveExecutable,
        root: managedRoot,
      },
    );
    expect(result.status).toBe('failed');
    expect(downloader).toHaveBeenCalled();
  });

  it('rolls back only its staging path on checksum failure and honors aborts', async () => {
    const managedRoot = await root();
    const result = await installCreativeDependency(
      { id: 'media-tools', sessionId: 'session-1' },
      {
        approvals: { list: () => [approval('media-tools')] },
        downloader: async (_item, destination) => {
          await writeFile(destination, 'bad');
          return '0'.repeat(64);
        },
        root: managedRoot,
      },
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect((await readdir(managedRoot)).some((name) => name.startsWith('.install-')))
      .toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(
      installCreativeDependency(
        {
          id: 'media-tools',
          sessionId: 'session-1',
          signal: controller.signal,
        },
        {
          approvals: { list: () => [approval('media-tools')] },
          downloader: fakeDownload,
          root: managedRoot,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
