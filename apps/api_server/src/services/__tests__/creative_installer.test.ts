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
import type { AgentApproval } from '../../repositories/agent_approvals_repository';
import { creativeSetupPlan } from '../creative_dependency_support';

const roots: string[] = [];

const approval = (
  id: keyof typeof CREATIVE_INSTALL_RECIPES,
  sessionId: string | null = 'session-1',
): AgentApproval => ({
  id: 'approval',
  sessionId,
  agentConfigId: null,
  action: `install_creative_dependency:${id}`,
  preview: null,
  consequence: null,
  status: 'approved',
  actor: null,
  decidedAt: null,
  securityAction: null,
  payloadDigest: creativeSetupPlan(id).planDigest,
  taintId: null,
  taintedTurnId: null,
  boundAgent: null,
  expiresAt: null,
  consumedAt: null,
  decisionNonce: null,
  createdAt: '',
});

const installRequest = (
  id: keyof typeof CREATIVE_INSTALL_RECIPES,
  input: Record<string, unknown> = {},
) => ({
  id,
  sessionId: 'session-1',
  planDigest: creativeSetupPlan(id).planDigest,
  ...input,
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
const completeFixtureBundles = Object.fromEntries(
  Object.keys(CREATIVE_INSTALL_RECIPES).map((id) => [id, { complete: true }]),
) as NonNullable<CreativeInstallerDeps['dependencyBundles']>;

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
    expect(CREATIVE_INSTALL_RECIPES.blender).toMatchObject({
      version: '5.2.0+mcp-1.6.0-r4',
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(
            /^https:\/\/mirrors\.ocf\.berkeley\.edu\/blender\/release\//,
          ),
          sha256:
            'ed4d8390166dec5ea0a2813a03db6221f206ce016442be7f59f41d760972568a',
        }),
        expect.objectContaining({
          filename: 'blender_mcp_addon.py',
          url: expect.stringContaining(
            '/ahujasid/blender-mcp/494fb5bba603fb650f20c507adce994dffbd6dae/addon.py',
          ),
          sha256:
            'd43484fcd9a4a33f1561ab69676f5d33d0aa7c649d5e2f5fd34ddd78615ee734',
        }),
      ]),
    });
  });

  it('requires a matching approved action and session before downloading', async () => {
    const downloader = vi.fn(fakeDownload);
    await expect(
      installCreativeDependency(
        installRequest('media-tools', { sessionId: 'other' }),
        {
          approvals: { list: () => [approval('media-tools')] },
          downloader,
          root: await root(),
          dependencyBundles: completeFixtureBundles,
        },
      ),
    ).resolves.toMatchObject({ status: 'denied' });
    expect(downloader).not.toHaveBeenCalled();
  });

  it('keeps model license acceptance separate from install approval', async () => {
    const downloader = vi.fn(fakeDownload);
    await expect(
      installCreativeDependency(
        installRequest('comfyui-model-pack'),
        {
          approvals: { list: () => [approval('comfyui-model-pack')] },
          downloader,
          root: await root(),
          dependencyBundles: completeFixtureBundles,
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
        const outputIndex = argv.indexOf('--output-file');
        if (argv.includes('compile') && outputIndex >= 0) {
          await writeFile(
            argv[outputIndex + 1],
            `mcp-obsidian==0.2.2 --hash=sha256:${'c'.repeat(64)}\n`,
          );
        }
        if (argv[1] === '-m' && argv[2] === 'pip') {
          const python = argv[0];
          await writeFile(
            join(dirname(python), 'mcp-obsidian'),
            `#!/bin/sh\nexec "${python}" "$@"\n`,
          );
        }
      },
    );

    const result = await installCreativeDependency(
      installRequest('obsidian'),
      {
        approvals: { list: () => [approval('obsidian')] },
        downloader: fakeDownload,
        runner,
        resolveExecutable,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
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
        '--require-hashes',
        '--only-binary',
        ':all:',
        '--index-url',
        'https://pypi.org/simple',
        '-r',
        expect.stringContaining('.rhythm-python-requirements.lock'),
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining('/opt/homebrew/bin'),
        }),
        logPath: expect.stringContaining('creative-install.log'),
      }),
    );
  });

  it('installs ffmpeg from an integrity-locked npm cache with scripts disabled', async () => {
    const managedRoot = await root();
    const runner: NonNullable<CreativeInstallerDeps['runner']> = vi.fn(
      async (argv: readonly string[]) => {
        const prefixIndex = argv.indexOf('--prefix');
        if (argv.includes('--package-lock-only') && prefixIndex >= 0) {
          const prefix = argv[prefixIndex + 1];
          await writeFile(
            join(prefix, 'package-lock.json'),
            JSON.stringify({
              lockfileVersion: 3,
              packages: {
                'node_modules/ffmpeg-static': {
                  version: '5.3.0',
                  resolved:
                    'https://registry.npmjs.org/ffmpeg-static/-/ffmpeg-static-5.3.0.tgz',
                  integrity: 'sha512-valid-lock-entry',
                },
              },
            }),
          );
        }
        if (argv.includes('ci') && prefixIndex >= 0) {
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
      installRequest('media-tools'),
      {
        approvals: { list: () => [approval('media-tools')] },
        downloader: fakeDownload,
        runner,
        resolveExecutable,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );

    expect(result).toMatchObject({ status: 'installed' });
    const resolveArgv = vi
      .mocked(runner)
      .mock.calls.map(([argv]) => argv)
      .find((argv) => argv.includes('--package-lock-only'))!;
    expect(resolveArgv).toEqual(
      expect.arrayContaining([
        '--ignore-scripts',
        '--registry',
        'https://registry.npmjs.org',
      ]),
    );
    const installArgv = vi
      .mocked(runner)
      .mock.calls.map(([argv]) => argv)
      .find((argv) => argv.includes('ci'))!;
    expect(installArgv).toEqual(
      expect.arrayContaining(['--ignore-scripts', '--offline']),
    );
    expect(
      await readFile(join(managedRoot, 'media-tools', 'bin', 'ffmpeg'), 'utf8'),
    ).toBe('binary');
  });

  it('finds the packaged OpenMontage bridge independently of process.cwd()', async () => {
    const managedRoot = await root();
    const previousResourceDir = process.env.RHYTHM_CREATIVE_RESOURCES_DIR;
    delete process.env.RHYTHM_CREATIVE_RESOURCES_DIR;
    vi.spyOn(process, 'cwd').mockReturnValue('/not-the-api-server');
    const runner: NonNullable<CreativeInstallerDeps['runner']> = vi.fn(
      async (argv: readonly string[]) => {
        if (argv.includes('-xzf') && argv.includes('--strip-components=1')) {
          const destination = argv[argv.indexOf('-C') + 1];
          await mkdir(destination, { recursive: true });
          if (argv.some((part) => part.includes('openmontage.tar.gz'))) {
            await writeFile(join(destination, 'requirements.txt'), '');
          } else {
            await writeFile(join(destination, 'uv'), '');
          }
        }
        if (argv.includes('venv')) {
          const venv = argv.at(-1)!;
          await mkdir(join(venv, 'bin'), { recursive: true });
          await writeFile(join(venv, 'bin', 'python'), '');
        }
        const outputIndex = argv.indexOf('--output-file');
        if (argv.includes('compile') && outputIndex >= 0) {
          await writeFile(
            argv[outputIndex + 1],
            `requests==2.32.4 --hash=sha256:${'d'.repeat(64)}\n`,
          );
        }
      },
    );

    try {
      const result = await installCreativeDependency(
        installRequest('openmontage'),
        {
          approvals: { list: () => [approval('openmontage')] },
          downloader: fakeDownload,
          runner,
          resolveExecutable,
          root: managedRoot,
          dependencyBundles: completeFixtureBundles,
        },
      );

      expect(result).toMatchObject({ status: 'installed' });
      await expect(
        access(
          join(
            managedRoot,
            'openmontage',
            'openmontage-mcp',
            'openmontage_mcp_server.py',
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      if (previousResourceDir === undefined) {
        delete process.env.RHYTHM_CREATIVE_RESOURCES_DIR;
      } else {
        process.env.RHYTHM_CREATIVE_RESOURCES_DIR = previousResourceDir;
      }
    }
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
      installRequest('obsidian'),
      {
        approvals: { list: () => [approval('obsidian')] },
        downloader,
        runner: async () => {},
        resolveExecutable,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );
    expect(result.status).toBe('failed');
    expect(downloader).toHaveBeenCalled();
  });

  it('rolls back only its staging path on checksum failure and honors aborts', async () => {
    const managedRoot = await root();
    const result = await installCreativeDependency(
      installRequest('media-tools'),
      {
        approvals: { list: () => [approval('media-tools')] },
        downloader: async (_item, destination) => {
          await writeFile(destination, 'bad');
          return '0'.repeat(64);
        },
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect((await readdir(managedRoot)).some((name) => name.startsWith('.install-')))
      .toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(
      installCreativeDependency(
        installRequest('media-tools', { signal: controller.signal }),
        {
          approvals: { list: () => [approval('media-tools')] },
          downloader: fakeDownload,
          root: managedRoot,
          dependencyBundles: completeFixtureBundles,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
