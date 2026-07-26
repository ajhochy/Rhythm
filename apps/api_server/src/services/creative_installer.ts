import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as nodeFs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import type { CreativeCapabilityId } from './creative_capabilities';
import {
  COMFYUI_MODEL_FILENAME,
  creativeCapabilityLayout,
} from './creative_install_layout';
import type { AgentApproval } from '../repositories/agent_approvals_repository';

export type CreativeInstallStatus =
  | 'installed'
  | 'already-installed'
  | 'awaiting-user'
  | 'denied'
  | 'failed';

export interface CreativeInstallResult {
  status: CreativeInstallStatus;
  id: CreativeCapabilityId;
  detail: string;
}

export interface CreativeInstallArtifact {
  filename: string;
  url: string;
  sha256: string;
}

type CreativeInstallerKind =
  | 'blender'
  | 'comfyui'
  | 'comfyui-model-pack'
  | 'openmontage'
  | 'obsidian'
  | 'document-tools'
  | 'media-tools';

export interface CreativeInstallRecipe {
  id: CreativeCapabilityId;
  version: string;
  installer: CreativeInstallerKind;
  artifacts: readonly CreativeInstallArtifact[];
  commit?: string;
  /** A license acknowledgement is deliberately separate from an install approval. */
  requiresModelLicense?: true;
  awaitingUser?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

const UV_ARTIFACT: CreativeInstallArtifact =
  process.arch === 'arm64'
    ? {
        filename: 'uv-aarch64-apple-darwin-0.11.32.tar.gz',
        url: 'https://github.com/astral-sh/uv/releases/download/0.11.32/uv-aarch64-apple-darwin.tar.gz',
        sha256: 'ed336d0ba49db8ef89b2b41fffa372ce63bd032f22a56f001c265891aec32829',
      }
    : {
        filename: 'uv-x86_64-apple-darwin-0.11.32.tar.gz',
        url: 'https://github.com/astral-sh/uv/releases/download/0.11.32/uv-x86_64-apple-darwin.tar.gz',
        sha256: '77f5ca26c0de20e992a3677a174fe1121ee25c36f9b1434a863f75bf077a05eb',
      };

const NPM_ARTIFACT: CreativeInstallArtifact = {
  filename: 'npm-11.11.0.tgz',
  url: 'https://registry.npmjs.org/npm/-/npm-11.11.0.tgz',
  sha256: 'cbcf4cc03148ccdb586a8bf2093c952f093fb43d5cbc97593c98b67ef8c003b0',
};

// Reviewed upstream release pins. The installer accepts no caller-provided
// command, package, URL, checksum, or destination.
export const CREATIVE_INSTALL_RECIPES: Readonly<
  Record<CreativeCapabilityId, CreativeInstallRecipe>
> = {
  blender: {
    id: 'blender',
    version: '5.2.0+mcp-1.6.0-r2',
    installer: 'blender',
    artifacts: [
      {
        filename: 'blender.dmg',
        url: 'https://download.blender.org/release/Blender5.2/blender-5.2.0-macos-arm64.dmg',
        sha256: 'ed4d8390166dec5ea0a2813a03db6221f206ce016442be7f59f41d760972568a',
      },
      {
        filename: 'blender_mcp-1.6.0-py3-none-any.whl',
        url: 'https://files.pythonhosted.org/packages/86/7b/2ed3deb36c87ff03e1c1947732305321b10cdb3bace2b308c0406433c63c/blender_mcp-1.6.0-py3-none-any.whl',
        sha256: 'eeff867ae71740473d36945e45577fe3888e6a1c7f8d2376be0169975ac343a0',
      },
      UV_ARTIFACT,
    ],
    awaitingUser:
      'Open Blender once, install and enable the Blender MCP add-on, then start its local bridge.',
  },
  comfyui: {
    id: 'comfyui',
    version: '2026-07-24+mcp-1.0.1',
    commit: '36aec0d086f7321d253cde71b4f3b08f63e35d8f',
    installer: 'comfyui',
    artifacts: [
      {
        filename: 'comfyui.tar.gz',
        url: 'https://github.com/Comfy-Org/ComfyUI/archive/36aec0d086f7321d253cde71b4f3b08f63e35d8f.tar.gz',
        sha256: 'b8050b7dd0995995befd5f5221a9e81bfdbcae8d54f46dbdf78cbb694bc9bc73',
      },
      {
        filename: 'comfyui-mcp-1.0.1.tgz',
        url: 'https://registry.npmjs.org/@peleke.s/comfyui-mcp/-/comfyui-mcp-1.0.1.tgz',
        sha256: 'cd7386713fbe003c9c9a9b597ba7a1d61ef5bbe897789fe859f22674b2502f05',
      },
      UV_ARTIFACT,
      NPM_ARTIFACT,
    ],
    awaitingUser:
      'Start ComfyUI with its managed Python environment, then verify the localhost service.',
  },
  'comfyui-model-pack': {
    id: 'comfyui-model-pack',
    version: '1.0.0',
    installer: 'comfyui-model-pack',
    artifacts: [
      {
        filename: COMFYUI_MODEL_FILENAME,
        url: 'https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors',
        sha256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26',
      },
    ],
    requiresModelLicense: true,
    awaitingUser:
      'Accept the model publisher license in the setup UI before this download can start.',
  },
  openmontage: {
    id: 'openmontage',
    version: '2026-07-24',
    commit: 'c36e41223e819441748817105635ac4036d41b10',
    installer: 'openmontage',
    artifacts: [
      {
        filename: 'openmontage.tar.gz',
        url: 'https://github.com/calesthio/OpenMontage/archive/c36e41223e819441748817105635ac4036d41b10.tar.gz',
        sha256: '1d75cf672df2605a71933a69327472b9a1fd097b16abf5e4d2ee7f1270ded524',
      },
      UV_ARTIFACT,
      NPM_ARTIFACT,
    ],
  },
  obsidian: {
    id: 'obsidian',
    version: '0.2.2-r2',
    installer: 'obsidian',
    artifacts: [
      {
        filename: 'mcp_obsidian-0.2.2-py3-none-any.whl',
        url: 'https://files.pythonhosted.org/packages/00/ea/90c6f7030537dbf88a06b8dce767f6e40bb490ebec3c6d8e916b0ce3a8e5/mcp_obsidian-0.2.2-py3-none-any.whl',
        sha256: 'a43aa01ff9f20b48145ce31cd10bcb1b1ff4001277e09248cefc31477888b396',
      },
      UV_ARTIFACT,
    ],
    awaitingUser:
      'Open Obsidian, enable the Local REST API plugin, and enter its API key in Rhythm.',
  },
  'document-tools': {
    id: 'document-tools',
    version: '2026.7.26',
    installer: 'document-tools',
    artifacts: [UV_ARTIFACT],
  },
  'media-tools': {
    id: 'media-tools',
    version: '5.3.0',
    installer: 'media-tools',
    artifacts: [
      {
        filename: 'ffmpeg-static-5.3.0.tgz',
        url: 'https://registry.npmjs.org/ffmpeg-static/-/ffmpeg-static-5.3.0.tgz',
        sha256: '0525c908c27618582a6fb5d4cc70452a2f2d4f50cb3d88b19b16a3c1cc8df25d',
      },
      NPM_ARTIFACT,
    ],
  },
};

interface RunnerOptions {
  cwd: string;
  signal?: AbortSignal;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export interface CreativeInstallerDeps {
  approvals: { list(status: 'approved' | null): AgentApproval[] };
  downloader?: (
    artifact: CreativeInstallArtifact,
    destination: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  runner?: (argv: readonly string[], options: RunnerOptions) => Promise<void>;
  resolveExecutable?: (names: readonly string[]) => Promise<string>;
  root?: string;
}

export interface CreativeInstallRequest {
  id: CreativeCapabilityId;
  sessionId?: string | null;
  modelLicenseAccepted?: boolean;
  signal?: AbortSignal;
}

const rootFor = () =>
  join(homedir(), 'Library', 'Application Support', 'Rhythm', 'creative-tools');

const openMontageBridge = () =>
  join(
    process.env.RHYTHM_CREATIVE_RESOURCES_DIR ?? join(process.cwd(), 'resources'),
    'openmontage-mcp',
    'openmontage_mcp_server.py',
  );

const KNOWN_BIN_DIRS = [
  dirname(process.execPath),
  '/opt/homebrew/bin',
  '/opt/homebrew/opt/python@3.13/bin',
  '/opt/homebrew/opt/python@3.12/bin',
  '/opt/homebrew/opt/python@3.11/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

function commandEnvironment(): NodeJS.ProcessEnv {
  const inherited = (process.env.PATH ?? '')
    .split(':')
    .filter(Boolean);
  const path = [...new Set([...KNOWN_BIN_DIRS, ...inherited])].join(':');
  return { ...process.env, PATH: path };
}

async function defaultResolveExecutable(names: readonly string[]): Promise<string> {
  const dirs = commandEnvironment().PATH?.split(':').filter(Boolean) ?? [];
  for (const name of names) {
    if (name.includes('/')) {
      try {
        await nodeFs.access(name, constants.X_OK);
        return name;
      } catch {
        continue;
      }
    }
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try {
        await nodeFs.access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next fixed candidate.
      }
    }
  }
  throw new Error(
    `Required installer executable not found: ${names.join(' or ')}. ` +
      `Checked Rhythm's managed GUI PATH (${dirs.join(':')}).`,
  );
}

async function appendLog(logPath: string, line: string): Promise<void> {
  await nodeFs.mkdir(dirname(logPath), { recursive: true });
  await nodeFs.appendFile(logPath, `${new Date().toISOString()} ${line}\n`);
}

async function defaultRunner(
  argv: readonly string[],
  options: RunnerOptions,
): Promise<void> {
  await appendLog(
    options.logPath,
    `RUN cwd=${options.cwd} command=${argv.map((part) => JSON.stringify(part)).join(' ')}`,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0], [...argv.slice(1)], {
      cwd: options.cwd,
      signal: options.signal,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => {
      chunks.push(chunk);
      while (
        chunks.reduce((sum, value) => sum + value.byteLength, 0) > 64 * 1024 &&
        chunks.length > 1
      ) {
        chunks.shift();
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', async (error) => {
      await appendLog(options.logPath, `SPAWN FAILED ${String(error)}`);
      reject(error);
    });
    child.once('exit', async (code, signal) => {
      const output = Buffer.concat(chunks).toString('utf8').trim();
      if (output) await appendLog(options.logPath, output);
      if (code === 0) {
        await appendLog(options.logPath, 'EXIT 0');
        resolve();
        return;
      }
      const suffix = output.split('\n').filter(Boolean).slice(-3).join(' | ');
      const outcome = signal ? `signal ${signal}` : `exit ${String(code)}`;
      await appendLog(options.logPath, `FAILED ${outcome}`);
      reject(
        new Error(
          `Installer command failed (${outcome})${suffix ? `: ${suffix}` : ''}. ` +
            `See ${options.logPath}`,
        ),
      );
    });
  });
}

async function defaultDownload(
  artifact: CreativeInstallArtifact,
  destination: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(artifact.url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Pinned download failed (${response.status})`);
  }
  const hash = createHash('sha256');
  const output = await nodeFs.open(destination, 'wx');
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      checkAbort(signal);
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await output.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        offset += bytesWritten;
      }
    }
  } catch (error) {
    await nodeFs.rm(destination, { force: true });
    throw error;
  } finally {
    await output.close();
  }
  return hash.digest('hex');
}

function approved(
  approvals: AgentApproval[],
  id: CreativeCapabilityId,
  sessionId?: string | null,
): boolean {
  return approvals.some(
    (row) =>
      row.action === `install_creative_dependency:${id}` &&
      row.status === 'approved' &&
      (!sessionId || row.sessionId === sessionId),
  );
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Installation aborted', 'AbortError');
}

async function exists(path: string): Promise<boolean> {
  return nodeFs
    .access(path)
    .then(() => true)
    .catch(() => false);
}

async function allExist(paths: readonly string[]): Promise<boolean> {
  return (await Promise.all(paths.map(exists))).every(Boolean);
}

async function readSentinelVersion(path: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await nodeFs.readFile(path, 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

async function relocateVenvScripts(staging: string, final: string): Promise<void> {
  const bin = join(staging, '.venv', 'bin');
  if (!(await exists(bin))) return;
  for (const entry of await nodeFs.readdir(bin, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(bin, entry.name);
    const contents = await nodeFs.readFile(path);
    const text = contents.toString('utf8');
    if (!text.includes(staging)) continue;
    const stat = await nodeFs.stat(path);
    await nodeFs.writeFile(path, text.replaceAll(staging, final), {
      mode: stat.mode,
    });
  }
}

interface InstallContext {
  root: string;
  staging: string;
  downloads: string;
  artifacts: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  run(argv: readonly string[], cwd?: string): Promise<void>;
  resolve(names: readonly string[]): Promise<string>;
}

async function extractManagedCli(
  context: InstallContext,
  archive: CreativeInstallArtifact,
  destination: string,
): Promise<void> {
  if (await exists(destination)) return;
  await nodeFs.mkdir(destination, { recursive: true });
  const tar = await context.resolve(['tar']);
  await context.run([
    tar,
    '-xzf',
    artifact(context, archive.filename),
    '--strip-components=1',
    '-C',
    destination,
  ]);
}

async function createVenv(context: InstallContext): Promise<string> {
  const uvRoot = join(context.staging, '.uv-cli');
  await extractManagedCli(context, UV_ARTIFACT, uvRoot);
  const uv = join(uvRoot, 'uv');
  await context.run([
    uv,
    'venv',
    '--python',
    '3.11',
    '--python-preference',
    'only-managed',
    '--seed',
    join(context.staging, '.venv'),
  ]);
  return join(context.staging, '.venv', 'bin', 'python');
}

async function pipInstall(
  context: InstallContext,
  python: string,
  packages: readonly string[],
): Promise<void> {
  await context.run([
    python,
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    ...packages,
  ]);
}

async function npmInstallArtifact(
  context: InstallContext,
  prefix: string,
  artifact: string,
): Promise<void> {
  const npmRoot = join(context.staging, '.npm-cli');
  await extractManagedCli(context, NPM_ARTIFACT, npmRoot);
  const npm = join(npmRoot, 'bin', 'npm-cli.js');
  await context.run([
    process.execPath,
    npm,
    'install',
    '--no-audit',
    '--no-fund',
    '--no-save',
    '--omit=dev',
    '--prefix',
    prefix,
    artifact,
  ]);
}

function artifact(context: InstallContext, filename: string): string {
  const path = context.artifacts.get(filename);
  if (!path) throw new Error(`Installer artifact missing from fixed recipe: ${filename}`);
  return path;
}

async function extractTarball(
  context: InstallContext,
  filename: string,
): Promise<void> {
  const tar = await context.resolve(['tar']);
  await context.run([
    tar,
    '-xzf',
    artifact(context, filename),
    '--strip-components=1',
    '-C',
    context.staging,
  ]);
}

async function installBlender(context: InstallContext): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The managed Blender recipe currently supports macOS only.');
  }
  if (process.arch !== 'arm64') {
    throw new Error(
      'The reviewed Blender 5.2 recipe currently supports Apple silicon Macs only.',
    );
  }
  const hdiutil = await context.resolve(['/usr/bin/hdiutil', 'hdiutil']);
  const ditto = await context.resolve(['/usr/bin/ditto', 'ditto']);
  const mount = join(context.staging, '.mount');
  await nodeFs.mkdir(mount);
  let attached = false;
  try {
    await context.run([
      hdiutil,
      'attach',
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mount,
      artifact(context, 'blender.dmg'),
    ]);
    attached = true;
    await context.run([
      ditto,
      join(mount, 'Blender.app'),
      join(context.staging, 'Blender.app'),
    ]);
  } finally {
    if (attached) {
      await context.run([hdiutil, 'detach', mount]);
    }
  }
  await nodeFs.rm(mount, { recursive: true, force: true });
  const python = await createVenv(context);
  await pipInstall(context, python, [
    artifact(context, 'blender_mcp-1.6.0-py3-none-any.whl'),
  ]);
}

async function installComfyUi(context: InstallContext): Promise<void> {
  await extractTarball(context, 'comfyui.tar.gz');
  const python = await createVenv(context);
  await pipInstall(context, python, ['-r', join(context.staging, 'requirements.txt')]);
  await npmInstallArtifact(
    context,
    join(context.staging, 'mcp'),
    artifact(context, 'comfyui-mcp-1.0.1.tgz'),
  );
}

async function installOpenMontage(context: InstallContext): Promise<void> {
  await extractTarball(context, 'openmontage.tar.gz');
  const python = await createVenv(context);
  await pipInstall(context, python, ['-r', join(context.staging, 'requirements.txt')]);
  const composer = join(context.staging, 'remotion-composer');
  if (await exists(join(composer, 'package.json'))) {
    const npmRoot = join(context.staging, '.npm-cli');
    await extractManagedCli(context, NPM_ARTIFACT, npmRoot);
    const npm = join(npmRoot, 'bin', 'npm-cli.js');
    await context.run(
      [
        process.execPath,
        npm,
        'install',
        '--no-audit',
        '--no-fund',
        '--omit=dev',
      ],
      composer,
    );
  }
  const bridgeDir = join(context.staging, 'openmontage-mcp');
  await nodeFs.mkdir(bridgeDir, { recursive: true });
  await nodeFs.copyFile(
    openMontageBridge(),
    join(bridgeDir, 'openmontage_mcp_server.py'),
  );
}

async function installObsidian(context: InstallContext): Promise<void> {
  const python = await createVenv(context);
  await pipInstall(context, python, [
    artifact(context, 'mcp_obsidian-0.2.2-py3-none-any.whl'),
  ]);
}

async function installDocumentTools(context: InstallContext): Promise<void> {
  const python = await createVenv(context);
  await pipInstall(context, python, [
    'python-pptx==1.0.2',
    'python-docx==1.2.0',
    'openpyxl==3.1.5',
    'reportlab==4.4.3',
    'pypdf==6.0.0',
    'pdfplumber==0.11.7',
  ]);
}

async function installMediaTools(context: InstallContext): Promise<void> {
  const packageRoot = join(context.staging, 'package');
  await npmInstallArtifact(
    context,
    packageRoot,
    artifact(context, 'ffmpeg-static-5.3.0.tgz'),
  );
  const source = join(packageRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  const bin = join(context.staging, 'bin');
  await nodeFs.mkdir(bin, { recursive: true });
  await nodeFs.copyFile(source, join(bin, 'ffmpeg'));
  await nodeFs.chmod(join(bin, 'ffmpeg'), 0o755);
}

async function runStandardInstaller(
  recipe: CreativeInstallRecipe,
  context: InstallContext,
): Promise<void> {
  switch (recipe.installer) {
    case 'blender':
      return installBlender(context);
    case 'comfyui':
      return installComfyUi(context);
    case 'openmontage':
      return installOpenMontage(context);
    case 'obsidian':
      return installObsidian(context);
    case 'document-tools':
      return installDocumentTools(context);
    case 'media-tools':
      return installMediaTools(context);
    case 'comfyui-model-pack':
      throw new Error('Model packs use the dedicated atomic file installer.');
  }
}

async function downloadArtifacts(
  recipe: CreativeInstallRecipe,
  context: Omit<InstallContext, 'artifacts'>,
  downloader: NonNullable<CreativeInstallerDeps['downloader']>,
  logPath: string,
): Promise<ReadonlyMap<string, string>> {
  const paths = new Map<string, string>();
  await nodeFs.mkdir(context.downloads, { recursive: true });
  for (const item of recipe.artifacts) {
    checkAbort(context.signal);
    if (basename(item.filename) !== item.filename) {
      throw new Error(`Invalid reviewed artifact filename: ${item.filename}`);
    }
    if (!SHA256.test(item.sha256)) {
      throw new Error(`Invalid reviewed checksum for ${item.filename}`);
    }
    const destination = join(context.downloads, item.filename);
    await appendLog(logPath, `DOWNLOAD ${item.url}`);
    const digest = await downloader(item, destination, context.signal);
    if (digest !== item.sha256) {
      throw new Error(`Pinned download checksum did not match for ${item.filename}.`);
    }
    paths.set(item.filename, destination);
  }
  return paths;
}

async function installModelPack(
  recipe: CreativeInstallRecipe,
  context: InstallContext,
): Promise<void> {
  const comfyLayout = creativeCapabilityLayout(context.root, 'comfyui');
  if (!(await allExist(comfyLayout.requiredPaths.slice(0, 2)))) {
    throw new Error('Install ComfyUI before installing its starter model pack.');
  }
  const models = join(context.root, 'comfyui', 'models');
  const checkpoints = join(models, 'checkpoints');
  await nodeFs.mkdir(checkpoints, { recursive: true });
  const source = artifact(context, COMFYUI_MODEL_FILENAME);
  const destination = join(checkpoints, COMFYUI_MODEL_FILENAME);
  const temporary = `${destination}.rhythm-${randomUUID()}`;
  await nodeFs.rename(source, temporary);
  try {
    await nodeFs.rename(temporary, destination);
    await nodeFs.writeFile(
      join(models, '.rhythm-model-pack'),
      JSON.stringify({ id: recipe.id, version: recipe.version, commit: null }),
    );
  } catch (error) {
    await nodeFs.rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Installs only fixed, reviewed recipes; callers cannot supply a command, path,
 * package, URL, checksum, or destination.
 */
export async function installCreativeDependency(
  request: CreativeInstallRequest,
  deps: CreativeInstallerDeps,
): Promise<CreativeInstallResult> {
  const recipe = CREATIVE_INSTALL_RECIPES[request.id];
  const root = deps.root ?? rootFor();
  const layout = creativeCapabilityLayout(root, request.id);
  if (!approved(deps.approvals.list('approved'), request.id, request.sessionId)) {
    return {
      status: 'denied',
      id: request.id,
      detail: 'An approved install_creative_dependency approval is required for this session.',
    };
  }
  if (recipe.requiresModelLicense && !request.modelLicenseAccepted) {
    return {
      status: 'awaiting-user',
      id: request.id,
      detail: recipe.awaitingUser!,
    };
  }
  if (
    (await allExist(layout.requiredPaths)) &&
    (request.id === 'comfyui-model-pack' ||
      (await readSentinelVersion(layout.sentinel)) === recipe.version)
  ) {
    return {
      status: 'already-installed',
      id: request.id,
      detail: 'Pinned recipe is installed and its required files are present.',
    };
  }

  const staging = join(root, `.install-${recipe.id}-${randomUUID()}`);
  const downloads = join(staging, '.downloads');
  const final = join(root, recipe.id);
  const backup = join(root, `.backup-${recipe.id}-${randomUUID()}`);
  const logPath = join(dirname(root), 'logs', 'creative-install.log');
  const runner = deps.runner ?? defaultRunner;
  const resolve = deps.resolveExecutable ?? defaultResolveExecutable;
  let backedUp = false;
  let promoted = false;
  try {
    checkAbort(request.signal);
    await nodeFs.mkdir(staging, { recursive: true });
    await appendLog(logPath, `BEGIN ${recipe.id}@${recipe.version}`);
    const baseContext = {
      root,
      staging,
      downloads,
      signal: request.signal,
      run: (argv: readonly string[], cwd = staging) =>
        runner(argv, {
          cwd,
          signal: request.signal,
          env: commandEnvironment(),
          logPath,
        }),
      resolve,
    };
    const artifacts = await downloadArtifacts(
      recipe,
      baseContext,
      deps.downloader ?? defaultDownload,
      logPath,
    );
    const context: InstallContext = { ...baseContext, artifacts };

    if (recipe.installer === 'comfyui-model-pack') {
      await installModelPack(recipe, context);
      await nodeFs.rm(staging, { recursive: true, force: true });
    } else {
      await runStandardInstaller(recipe, context);
      await relocateVenvScripts(staging, final);
      await nodeFs.rm(join(staging, '.uv-cli'), {
        recursive: true,
        force: true,
      });
      await nodeFs.rm(join(staging, '.npm-cli'), {
        recursive: true,
        force: true,
      });
      await nodeFs.rm(downloads, { recursive: true, force: true });
      await nodeFs.writeFile(
        join(staging, '.rhythm-installed.json'),
        JSON.stringify({
          id: recipe.id,
          version: recipe.version,
          commit: recipe.commit ?? null,
        }),
      );

      const stagedRequired = layout.requiredPaths.map((path) =>
        join(staging, relative(final, path)),
      );
      if (!(await allExist(stagedRequired))) {
        throw new Error(
          `Installer finished without producing required files for ${recipe.id}. See ${logPath}`,
        );
      }
      if (await exists(final)) {
        await nodeFs.rename(final, backup);
        backedUp = true;
      }
      await nodeFs.rename(staging, final);
      promoted = true;
      if (!(await allExist(layout.requiredPaths))) {
        throw new Error(`Installed layout verification failed for ${recipe.id}.`);
      }
      if (backedUp) {
        await nodeFs.rm(backup, { recursive: true, force: true });
        backedUp = false;
      }
    }

    await appendLog(logPath, `SUCCESS ${recipe.id}@${recipe.version}`);
    return recipe.awaitingUser
      ? {
          status: 'awaiting-user',
          id: request.id,
          detail: recipe.awaitingUser,
        }
      : {
          status: 'installed',
          id: request.id,
          detail: 'Pinned recipe installed and verified.',
        };
  } catch (error) {
    if (promoted) await nodeFs.rm(final, { recursive: true, force: true });
    if (backedUp) await nodeFs.rename(backup, final);
    await nodeFs.rm(staging, { recursive: true, force: true });
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const detail = error instanceof Error ? error.message : 'Installation failed.';
    await appendLog(logPath, `FAILED ${recipe.id}@${recipe.version}: ${detail}`).catch(
      () => {},
    );
    return { status: 'failed', id: request.id, detail };
  }
}
