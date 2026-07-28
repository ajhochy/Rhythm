import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentApproval } from '../repositories/agent_approvals_repository';
import { listCreativeCapabilities } from '../services/creative_capabilities';
import {
  CREATIVE_INSTALL_RECIPES,
  installCreativeDependency,
  type CreativeInstallArtifact,
  type CreativeInstallerDeps,
} from '../services/creative_installer';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'issue-1227-guided-'));
  roots.push(value);
  return value;
}

function approval(
  action: string,
  payloadDigest: string | null,
): AgentApproval {
  return {
    id: 'approval-1227',
    sessionId: 'session-1227',
    agentConfigId: 'rhythm-setup',
    action,
    preview: null,
    consequence: null,
    status: 'approved',
    actor: 'human',
    decidedAt: new Date().toISOString(),
    securityAction: null,
    payloadDigest,
    taintId: null,
    taintedTurnId: null,
    boundAgent: null,
    expiresAt: null,
    consumedAt: null,
    decisionNonce: null,
    createdAt: '',
  };
}

async function fakeDownload(
  item: CreativeInstallArtifact,
  destination: string,
): Promise<string> {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, item.filename);
  return item.sha256;
}

const completeFixtureBundles = Object.fromEntries(
  Object.keys(CREATIVE_INSTALL_RECIPES).map((id) => [id, { complete: true }]),
) as NonNullable<CreativeInstallerDeps['dependencyBundles']>;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe('issue #1227 guided, verified creative dependency setup', () => {
  it('issue-1227-c1: the setup agent receives a plain-language dependency and provenance plan before approval', async () => {
    // Regression caught: the agent asks for a generic install approval without
    // telling the user what will be downloaded, where it comes from, or why.
    const capabilities = await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: '/Users/private-person',
      tcpProbe: async () => false,
    });
    const documents = capabilities.find(({ id }) => id === 'document-tools') as
      | Record<string, unknown>
      | undefined;

    expect(documents).toMatchObject({
      status: 'missing',
      setup: {
        planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        installLocation: 'Rhythm managed application storage',
        requirements: expect.arrayContaining([expect.any(String)]),
        dependencies: expect.arrayContaining([
          expect.objectContaining({
            name: 'python-pptx',
            version: '1.0.2',
            purpose: expect.any(String),
            source: expect.stringMatching(/^https:\/\//),
            license: 'MIT',
          }),
        ]),
        verifiedArtifacts: expect.arrayContaining([
          expect.objectContaining({
            filename: expect.any(String),
            url: expect.stringMatching(/^https:\/\//),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
        trust: expect.objectContaining({
          transitiveSource: 'https://pypi.org/simple',
          hashVerification: true,
          buildScripts: false,
        }),
        removal: expect.any(String),
      },
    });
    expect(JSON.stringify(documents)).not.toContain('/Users/private-person');
  });

  it('issue-1227-c2: install consent is bound to the disclosed plan and model terms remain separate', async () => {
    // Regression caught: approval for an older or different dependency plan
    // silently authorizes a changed download set.
    const managedRoot = await root();
    const downloader = vi.fn(fakeDownload);
    const result = await installCreativeDependency(
      {
        id: 'document-tools',
        sessionId: 'session-1227',
        planDigest: 'current-plan',
      } as never,
      {
        approvals: {
          list: () => [
            approval('install_creative_dependency:document-tools', 'stale-plan'),
          ],
        },
        downloader,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );

    expect(result).toMatchObject({ status: 'denied' });
    expect(result.detail).toMatch(/plan.*changed|matching.*plan/i);
    expect(downloader).not.toHaveBeenCalled();

    const modelPlan = (await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: managedRoot,
      tcpProbe: async () => false,
    })).find(({ id }) => id === 'comfyui-model-pack') as unknown as Record<
      string,
      unknown
    >;
    expect(modelPlan).toMatchObject({
      setup: {
        additionalLicenseAcceptance: expect.objectContaining({
          required: true,
          license: expect.stringContaining('Stability AI'),
        }),
      },
    });
  });

  it('issue-1227-c3: Python resolution is hash locked, wheel only, and limited to the disclosed index', async () => {
    // Regression caught: pip resolves a transitive dependency from the live
    // index and executes an sdist build hook without a reviewed lock.
    const managedRoot = await root();
    const progress: Array<Record<string, unknown>> = [];
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
            'python-pptx==1.0.2 --hash=sha256:' + 'a'.repeat(64) + '\n',
          );
        }
      },
    );
    const plan = (await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: managedRoot,
      tcpProbe: async () => false,
    })).find(({ id }) => id === 'document-tools') as {
      setup?: { planDigest: string };
    };
    const planDigest = plan.setup?.planDigest ?? 'missing-plan';

    await installCreativeDependency(
      {
        id: 'document-tools',
        sessionId: 'session-1227',
        planDigest,
      } as never,
      {
        approvals: {
          list: () => [
            approval(
              'install_creative_dependency:document-tools',
              planDigest,
            ),
          ],
        },
        downloader: fakeDownload,
        runner,
        resolveExecutable: async (names: readonly string[]) =>
          `/resolved/${names[0]}`,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
        onProgress: (event: Record<string, unknown>) => progress.push(event),
      } as never,
    );

    const calls = vi.mocked(runner).mock.calls.map(([argv]) => argv);
    expect(calls).toContainEqual(
      expect.arrayContaining([
        'compile',
        '--generate-hashes',
        '--no-build',
        '--index-url',
        'https://pypi.org/simple',
      ]),
    );
    expect(calls).toContainEqual(
      expect.arrayContaining([
        'install',
        '--require-hashes',
        '--only-binary',
        ':all:',
        '--index-url',
        'https://pypi.org/simple',
      ]),
    );
    expect(progress.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining(['planning', 'downloading', 'verifying', 'installing']),
    );
  });

  it('issue-1227-c4: Node resolution uses an integrity lock and cannot run lifecycle scripts', async () => {
    // Regression caught: npm resolves or installs a transitive package without
    // integrity metadata, or executes its preinstall/postinstall hook.
    const managedRoot = await root();
    const runner: NonNullable<CreativeInstallerDeps['runner']> = vi.fn(
      async (argv: readonly string[]) => {
        const prefixIndex = argv.indexOf('--prefix');
        if (argv.includes('--package-lock-only') && prefixIndex >= 0) {
          const prefix = argv[prefixIndex + 1];
          await mkdir(prefix, { recursive: true });
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
      },
    );
    const plan = (await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: managedRoot,
      tcpProbe: async () => false,
    })).find(({ id }) => id === 'media-tools') as {
      setup?: { planDigest: string };
    };
    const planDigest = plan.setup?.planDigest ?? 'missing-plan';

    await installCreativeDependency(
      {
        id: 'media-tools',
        sessionId: 'session-1227',
        planDigest,
      } as never,
      {
        approvals: {
          list: () => [
            approval(
              'install_creative_dependency:media-tools',
              planDigest,
            ),
          ],
        },
        downloader: fakeDownload,
        runner,
        resolveExecutable: async (names) => `/resolved/${names[0]}`,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );

    const calls = vi.mocked(runner).mock.calls.map(([argv]) => argv);
    expect(calls).toContainEqual(
      expect.arrayContaining([
        '--package-lock-only',
        '--ignore-scripts',
        '--registry',
        'https://registry.npmjs.org',
      ]),
    );
    expect(calls).toContainEqual(
      expect.arrayContaining(['ci', '--ignore-scripts', '--offline']),
    );
  });

  it('issue-1227-c5: completion records what was installed and reports useful verification progress', async () => {
    // Regression caught: the installer returns success without a durable,
    // inspectable source/license record or without verifying required files.
    const managedRoot = await root();
    const plan = (await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: managedRoot,
      tcpProbe: async () => false,
    })).find(({ id }) => id === 'document-tools') as {
      setup?: { planDigest: string };
    };
    const planDigest = plan.setup?.planDigest ?? 'missing-plan';
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
            'python-pptx==1.0.2 --hash=sha256:' + 'b'.repeat(64) + '\n',
          );
        }
      },
    );

    const result = await installCreativeDependency(
      {
        id: 'document-tools',
        sessionId: 'session-1227',
        planDigest,
      } as never,
      {
        approvals: {
          list: () => [
            approval(
              'install_creative_dependency:document-tools',
              planDigest,
            ),
          ],
        },
        downloader: fakeDownload,
        runner,
        resolveExecutable: async (names) => `/resolved/${names[0]}`,
        root: managedRoot,
        dependencyBundles: completeFixtureBundles,
      },
    );

    expect(result).toMatchObject({
      status: 'installed',
      progress: expect.arrayContaining([
        expect.objectContaining({ phase: 'verifying' }),
        expect.objectContaining({ phase: 'complete' }),
      ]),
    });
    const record = JSON.parse(
      await readFile(
        join(managedRoot, 'document-tools', '.rhythm-installed.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      planDigest,
      sources: expect.arrayContaining(['https://pypi.org/simple']),
      licenses: expect.any(Array),
      resolvedDependencies: expect.any(Array),
    });
  });

  it('issue-1227-c6: repair and uninstall are approval-bound and stay inside Rhythm managed storage', async () => {
    // Regression caught: the setup agent cannot recover/remove an install, or
    // removal follows a caller-controlled path outside the managed root.
    const managedRoot = await root();
    const outside = join(dirname(managedRoot), 'issue-1227-outside');
    await writeFile(outside, 'keep');
    await mkdir(join(managedRoot, 'media-tools', 'bin'), { recursive: true });
    await writeFile(join(managedRoot, 'media-tools', 'bin', 'ffmpeg'), 'binary');
    await writeFile(
      join(managedRoot, 'media-tools', '.rhythm-installed.json'),
      JSON.stringify({ version: '5.3.0-r2' }),
    );
    const plan = (await listCreativeCapabilities({
      existsSync: () => false,
      homeDir: managedRoot,
      tcpProbe: async () => false,
    })).find(({ id }) => id === 'media-tools') as {
      setup?: { planDigest: string };
    };
    const planDigest = plan.setup?.planDigest ?? 'missing-plan';

    const result = await installCreativeDependency(
      {
        id: 'media-tools',
        operation: 'uninstall',
        sessionId: 'session-1227',
        planDigest,
      } as never,
      {
        approvals: {
          list: () => [
            approval(
              'uninstall_creative_dependency:media-tools',
              planDigest,
            ),
          ],
        },
        root: managedRoot,
      },
    );

    expect(result).toMatchObject({ status: 'uninstalled' });
    await expect(readFile(outside, 'utf8')).resolves.toBe('keep');
    await expect(
      readFile(join(managedRoot, 'media-tools', 'bin', 'ffmpeg')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(outside, { force: true });
  });
});
