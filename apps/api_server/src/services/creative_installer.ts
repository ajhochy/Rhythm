import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as nodeFs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import type { CreativeCapabilityId } from './creative_capabilities';
import {
  CREATIVE_INSTALL_RECIPES,
  CREATIVE_DEPENDENCY_BUNDLES,
  NPM_REGISTRY,
  NPM_ARTIFACT,
  PYPI_INDEX,
  UV_ARTIFACT,
  creativeSetupPlan,
  type CreativeInstallArtifact,
  type CreativeInstallRecipe,
} from './creative_dependency_support';
import {
  COMFYUI_MODEL_FILENAME,
  creativeCapabilityLayout,
} from './creative_install_layout';
import type { AgentApproval } from '../repositories/agent_approvals_repository';

export {
  CREATIVE_INSTALL_RECIPES,
  type CreativeInstallArtifact,
  type CreativeInstallRecipe,
} from './creative_dependency_support';

export type CreativeInstallStatus =
  | 'installed'
  | 'already-installed'
  | 'uninstalled'
  | 'awaiting-user'
  | 'denied'
  | 'failed';

export type CreativeInstallOperation = 'install' | 'repair' | 'uninstall';
export type CreativeInstallProgressPhase =
  | 'planning'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'complete'
  | 'failed';

export interface CreativeInstallProgress {
  phase: CreativeInstallProgressPhase;
  detail: string;
}

export interface CreativeInstallResult {
  status: CreativeInstallStatus;
  id: CreativeCapabilityId;
  detail: string;
  planDigest: string;
  progress: CreativeInstallProgress[];
}

const SHA256 = /^[a-f0-9]{64}$/;

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
  /** Injected only by focused installer tests with complete local fixtures. */
  dependencyBundles?: typeof CREATIVE_DEPENDENCY_BUNDLES;
  onProgress?: (event: CreativeInstallProgress) => void;
}

export interface CreativeInstallRequest {
  id: CreativeCapabilityId;
  operation?: CreativeInstallOperation;
  sessionId?: string | null;
  planDigest?: string;
  modelLicenseAccepted?: boolean;
  signal?: AbortSignal;
}

const rootFor = () =>
  join(homedir(), 'Library', 'Application Support', 'Rhythm', 'creative-tools');

const openMontageBridge = () =>
  join(
    process.env.RHYTHM_CREATIVE_RESOURCES_DIR ??
      join(__dirname, '..', '..', 'resources'),
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
  return {
    ...process.env,
    PATH: path,
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
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
  operation: CreativeInstallOperation,
  planDigest: string,
  sessionId?: string | null,
): boolean {
  return approvals.some(
    (row) =>
      row.action === `${operation}_creative_dependency:${id}` &&
      row.status === 'approved' &&
      row.payloadDigest === planDigest &&
      row.consumedAt === null &&
      (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()) &&
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

async function anyExist(paths: readonly string[]): Promise<boolean> {
  return (await Promise.all(paths.map(exists))).some(Boolean);
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
  resolvedDependencies: Array<Record<string, string | string[]>>;
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
  requirements: readonly string[] | { file: string },
): Promise<void> {
  const uv = join(context.staging, '.uv-cli', 'uv');
  const inputPath = join(context.staging, '.rhythm-python-requirements.in');
  const lockPath = join(context.staging, '.rhythm-python-requirements.lock');
  const supplied =
    'file' in requirements
      ? await nodeFs.readFile(requirements.file, 'utf8')
      : `${requirements.join('\n')}\n`;
  const unsafeRequirementLine = supplied
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(
      (line) =>
        line &&
        !line.startsWith('#') &&
        (line.startsWith('-') ||
          line.startsWith('.') ||
          line.startsWith('/') ||
          /(?:git|ssh|file):/i.test(line)),
    );
  if (
    unsafeRequirementLine ||
    /(^|\s)(?:--extra-index-url|--find-links|--trusted-host|-e)\b/m.test(
      supplied,
    ) ||
    /https?:\/\//i.test(supplied)
  ) {
    throw new Error(
      'Python requirements may resolve only from Rhythm’s disclosed PyPI index.',
    );
  }
  await nodeFs.writeFile(inputPath, supplied, {
    flag: 'wx',
    mode: 0o600,
  });
  await context.run([
    uv,
    'pip',
    'compile',
    '--generate-hashes',
    '--no-build',
    '--python-version',
    '3.11',
    '--index-url',
    PYPI_INDEX,
    '--output-file',
    lockPath,
    inputPath,
  ]);

  const locked = await nodeFs.readFile(lockPath, 'utf8');
  const logicalLines = locked
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (logicalLines.length === 0) {
    throw new Error('Python resolver produced an empty dependency lock.');
  }
  for (const line of logicalLines) {
    if (
      line.includes(' @ ') ||
      /https?:\/\//i.test(line) ||
      !/(?:^|\s)--hash=sha256:[a-f0-9]{64}(?:\s|$)/.test(line)
    ) {
      throw new Error(
        'Python resolver produced a non-wheel, unhashed, or external dependency.',
      );
    }
    const pinned = /^([A-Za-z0-9_.-]+)==([^\s;]+)/.exec(line);
    if (!pinned) {
      throw new Error('Python dependency lock contains an unpinned requirement.');
    }
    context.resolvedDependencies.push({
      ecosystem: 'pypi',
      name: pinned[1],
      version: pinned[2],
      hashes: [...line.matchAll(/--hash=sha256:([a-f0-9]{64})/g)].map(
        (match) => match[1],
      ),
    });
  }
  await context.run([
    python,
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--require-hashes',
    '--only-binary',
    ':all:',
    '--index-url',
    PYPI_INDEX,
    '-r',
    lockPath,
  ]);
}

async function npmInstallArtifact(
  context: InstallContext,
  prefix: string,
  packages?: Readonly<Record<string, string>>,
): Promise<void> {
  const npmRoot = join(context.staging, '.npm-cli');
  await extractManagedCli(context, NPM_ARTIFACT, npmRoot);
  const npm = join(npmRoot, 'bin', 'npm-cli.js');
  const cache = join(context.downloads, '.npm-cache');
  await nodeFs.mkdir(prefix, { recursive: true });
  if (packages) {
    await nodeFs.writeFile(
      join(prefix, 'package.json'),
      JSON.stringify({
        name: 'rhythm-managed-creative-capability',
        private: true,
        version: '1.0.0',
        dependencies: packages,
      }),
      { flag: 'wx', mode: 0o600 },
    );
  }
  await context.run([
    process.execPath,
    npm,
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--registry',
    NPM_REGISTRY,
    '--cache',
    cache,
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    '--prefix',
    prefix,
  ]);

  const lockPath = join(prefix, 'package-lock.json');
  const lock = JSON.parse(await nodeFs.readFile(lockPath, 'utf8')) as {
    lockfileVersion?: unknown;
    packages?: Record<
      string,
      { version?: unknown; resolved?: unknown; integrity?: unknown; link?: unknown }
    >;
  };
  if (
    typeof lock.lockfileVersion !== 'number' ||
    lock.lockfileVersion < 2 ||
    !lock.packages
  ) {
    throw new Error('npm did not produce a complete modern package lock.');
  }
  const resolvedUrls: string[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/')) continue;
    if (
      entry.link === true ||
      typeof entry.version !== 'string' ||
      typeof entry.resolved !== 'string' ||
      typeof entry.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/=_-]+$/.test(entry.integrity)
    ) {
      throw new Error(`npm lock entry is incomplete or unsafe: ${path}`);
    }
    const resolved = new URL(entry.resolved);
    if (
      resolved.protocol !== 'https:' ||
      resolved.origin !== NPM_REGISTRY ||
      resolved.username ||
      resolved.password
    ) {
      throw new Error(`npm lock entry left the disclosed registry: ${path}`);
    }
    resolvedUrls.push(entry.resolved);
    context.resolvedDependencies.push({
      ecosystem: 'npm',
      name: path.slice('node_modules/'.length),
      version: entry.version,
      source: entry.resolved,
      integrity: entry.integrity,
    });
  }
  if (resolvedUrls.length === 0) {
    throw new Error('npm resolver produced an empty dependency lock.');
  }
  for (const resolved of resolvedUrls) {
    await context.run([
      process.execPath,
      npm,
      'cache',
      'add',
      resolved,
      '--ignore-scripts',
      '--registry',
      NPM_REGISTRY,
      '--cache',
      cache,
    ]);
  }
  await context.run([
    process.execPath,
    npm,
    'ci',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    '--cache',
    cache,
    '--prefix',
    prefix,
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
  await nodeFs.copyFile(
    artifact(context, 'blender_mcp_addon.py'),
    join(context.staging, 'blender_mcp_addon.py'),
  );
  const python = await createVenv(context);
  await pipInstall(context, python, ['blender-mcp==1.6.0']);
}

async function installComfyUi(context: InstallContext): Promise<void> {
  await extractTarball(context, 'comfyui.tar.gz');
  const python = await createVenv(context);
  await pipInstall(context, python, {
    file: join(context.staging, 'requirements.txt'),
  });
  await npmInstallArtifact(
    context,
    join(context.staging, 'mcp'),
    { '@peleke.s/comfyui-mcp': '1.0.1' },
  );
}

async function installOpenMontage(context: InstallContext): Promise<void> {
  await extractTarball(context, 'openmontage.tar.gz');
  const python = await createVenv(context);
  await pipInstall(context, python, {
    file: join(context.staging, 'requirements.txt'),
  });
  const composer = join(context.staging, 'remotion-composer');
  if (await exists(join(composer, 'package.json'))) {
    await npmInstallArtifact(context, composer);
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
  await pipInstall(context, python, ['mcp-obsidian==0.2.2']);
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
  await npmInstallArtifact(context, packageRoot, { 'ffmpeg-static': '5.3.0' });
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
  context: Omit<InstallContext, 'artifacts' | 'resolvedDependencies'>,
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
    if (!(await exists(destination))) {
      throw new Error(`Pinned installer artifact is missing: ${item.filename}.`);
    }
    paths.set(item.filename, destination);
  }
  return paths;
}

async function installModelPack(
  recipe: CreativeInstallRecipe,
  context: InstallContext,
): Promise<void> {
  const setup = creativeSetupPlan(recipe.id);
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
      JSON.stringify({
        id: recipe.id,
        version: recipe.version,
        commit: null,
        planDigest: setup.planDigest,
        sources: recipe.artifacts.map(({ url }) => url),
        licenses: setup.dependencies.map(
          ({ name, version, source, license }) => ({
            name,
            version,
            source,
            license,
          }),
        ),
        resolvedDependencies: setup.dependencies.map(({ name, version }) => ({
          ecosystem: 'model',
          name,
          version,
        })),
      }),
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
  const operation = request.operation ?? 'install';
  const setup = creativeSetupPlan(request.id);
  const progress: CreativeInstallProgress[] = [];
  const emit = (phase: CreativeInstallProgressPhase, detail: string) => {
    const event = { phase, detail };
    progress.push(event);
    deps.onProgress?.(event);
  };
  const result = (
    status: CreativeInstallStatus,
    detail: string,
  ): CreativeInstallResult => ({
    status,
    id: request.id,
    detail,
    planDigest: setup.planDigest,
    progress,
  });
  emit(
    'planning',
    `Validated the disclosed ${operation} plan for ${request.id}.`,
  );
  if (
    !request.planDigest ||
    request.planDigest !== setup.planDigest
  ) {
    return result(
      'denied',
      'The setup plan has changed or is missing. Review the current plan before approving it.',
    );
  }
  const root = deps.root ?? rootFor();
  const layout = creativeCapabilityLayout(root, request.id);
  const final = join(root, recipe.id);
  if (relative(root, final) !== recipe.id) {
    return result('failed', 'The fixed managed installation location is invalid.');
  }
  if (
    !approved(
      deps.approvals.list('approved'),
      request.id,
      operation,
      setup.planDigest,
      request.sessionId,
    )
  ) {
    return result(
      'denied',
      `A matching human approval for this exact ${operation} plan is required.`,
    );
  }
  if (recipe.requiresModelLicense && !request.modelLicenseAccepted) {
    return result('awaiting-user', recipe.awaitingUser!);
  }
  if (operation === 'uninstall') {
    try {
      emit(
        'installing',
        `Removing only ${request.id} from Rhythm managed application storage.`,
      );
      if (request.id === 'comfyui-model-pack') {
        for (const path of layout.requiredPaths) {
          await nodeFs.rm(path, { recursive: true, force: true });
        }
      } else {
        await nodeFs.rm(final, { recursive: true, force: true });
      }
      emit('verifying', 'Confirmed the managed capability files were removed.');
      if (await anyExist(layout.requiredPaths)) {
        emit('failed', 'Managed removal verification failed.');
        return result(
          'failed',
          'The managed capability could not be removed completely.',
        );
      }
      emit('complete', 'The capability was removed from Rhythm managed storage.');
      return result('uninstalled', 'The capability was removed and verified.');
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
              .replaceAll(root, 'Rhythm managed application storage')
              .replaceAll(homedir(), 'the user home folder')
          : 'Managed removal failed.';
      emit('failed', detail);
      return result('failed', detail);
    }
  }
  const dependencyBundle = (
    deps.dependencyBundles ?? CREATIVE_DEPENDENCY_BUNDLES
  )[request.id];
  if (!dependencyBundle.complete) {
    return result(
      'failed',
      'The reviewed dependency plan for this capability is not available.',
    );
  }
  if (
    operation === 'install' &&
    (await allExist(layout.requiredPaths)) &&
    (request.id === 'comfyui-model-pack' ||
      (await readSentinelVersion(layout.sentinel)) === recipe.version)
  ) {
    emit('verifying', 'Verified the existing managed files and recipe version.');
    emit('complete', 'The disclosed capability plan is already installed.');
    return result(
      'already-installed',
      'Pinned recipe is installed and its required files are present.',
    );
  }

  const staging = join(root, `.install-${recipe.id}-${randomUUID()}`);
  const downloads = join(staging, '.downloads');
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
    emit('downloading', 'Downloading only the disclosed fixed artifacts and package metadata.');
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
    emit('verifying', 'Verified pinned artifact checksums and registry boundaries.');
    const context: InstallContext = {
      ...baseContext,
      artifacts,
      resolvedDependencies: setup.dependencies.map(({ name, version, source }) => ({
        ecosystem: 'direct',
        name,
        version,
        source,
      })),
    };

    if (recipe.installer === 'comfyui-model-pack') {
      emit('installing', 'Installing the accepted model into the managed model folder.');
      await installModelPack(recipe, context);
      await nodeFs.rm(staging, { recursive: true, force: true });
    } else {
      emit(
        'installing',
        'Resolving integrity locks, populating isolated caches, and installing with scripts disabled.',
      );
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
          planDigest: setup.planDigest,
          sources: [
            ...new Set([
              ...recipe.artifacts.map(({ url }) => url),
              ...(setup.trust.transitiveSource.includes(PYPI_INDEX)
                ? [PYPI_INDEX]
                : []),
              ...(setup.trust.transitiveSource.includes(NPM_REGISTRY)
                ? [NPM_REGISTRY]
                : []),
            ]),
          ],
          licenses: setup.dependencies.map(
            ({ name, version, source, license }) => ({
              name,
              version,
              source,
              license,
            }),
          ),
          resolvedDependencies: context.resolvedDependencies,
        }),
      );

      emit('verifying', 'Checking the staged capability before making it active.');
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
    emit('complete', 'The capability is installed and its required files were verified.');
    return recipe.awaitingUser
      ? result('awaiting-user', recipe.awaitingUser)
      : result('installed', 'Pinned recipe installed and verified.');
  } catch (error) {
    if (promoted) await nodeFs.rm(final, { recursive: true, force: true });
    if (backedUp) await nodeFs.rename(backup, final);
    await nodeFs.rm(staging, { recursive: true, force: true });
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const rawDetail =
      error instanceof Error ? error.message : 'Installation failed.';
    const detail = rawDetail
      .replaceAll(root, 'Rhythm managed application storage')
      .replaceAll(homedir(), 'the user home folder');
    await appendLog(logPath, `FAILED ${recipe.id}@${recipe.version}: ${detail}`).catch(
      () => {},
    );
    emit('failed', detail);
    return result('failed', detail);
  }
}
