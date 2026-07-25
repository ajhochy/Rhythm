import { createHash, randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { CreativeCapabilityId } from './creative_capabilities';
import type { AgentApproval } from '../repositories/agent_approvals_repository';

export type CreativeInstallStatus = 'installed' | 'already-installed' | 'awaiting-user' | 'denied' | 'failed';
export interface CreativeInstallResult { status: CreativeInstallStatus; id: CreativeCapabilityId; detail: string; }
export interface CreativeInstallRecipe {
  id: CreativeCapabilityId;
  version: string;
  url: string;
  sha256: string;
  commit?: string;
  /** A license acknowledgement is deliberately separate from an install approval. */
  requiresModelLicense?: true;
  awaitingUser?: string;
  argv: readonly string[];
}

// These are reviewed upstream release pins, never caller-provided URLs or paths.
export const CREATIVE_INSTALL_RECIPES: Readonly<Record<CreativeCapabilityId, CreativeInstallRecipe>> = {
  blender: { id: 'blender', version: '5.2.0', url: 'https://download.blender.org/release/Blender5.2/blender-5.2.0-macos-arm64.dmg', sha256: 'ed4d8390166dec5ea0a2813a03db6221f206ce016442be7f59f41d760972568a', awaitingUser: 'Open Blender once to approve its macOS security prompt and enable the local bridge.', argv: ['hdiutil', 'attach', '-nobrowse'] },
  comfyui: { id: 'comfyui', version: '2026-07-24', commit: '36aec0d086f7321d253cde71b4f3b08f63e35d8f', url: 'https://github.com/Comfy-Org/ComfyUI/archive/36aec0d086f7321d253cde71b4f3b08f63e35d8f.tar.gz', sha256: 'b8050b7dd0995995befd5f5221a9e81bfdbcae8d54f46dbdf78cbb694bc9bc73', argv: ['tar', '-xzf'] },
  'comfyui-model-pack': { id: 'comfyui-model-pack', version: '1.0.0', url: 'https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors', sha256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26', requiresModelLicense: true, awaitingUser: 'Accept the model publisher license in the setup UI before this download can start.', argv: ['install-model-pack'] },
  openmontage: { id: 'openmontage', version: '2026-07-24', commit: 'c36e41223e819441748817105635ac4036d41b10', url: 'https://github.com/calesthio/OpenMontage/archive/c36e41223e819441748817105635ac4036d41b10.tar.gz', sha256: '1d75cf672df2605a71933a69327472b9a1fd097b16abf5e4d2ee7f1270ded524', argv: ['tar', '-xzf'] },
  obsidian: { id: 'obsidian', version: '1.0.6', commit: 'd3c0619c9643d739c58c8f625de3118bda59d391', url: 'https://registry.npmjs.org/obsidian-mcp/-/obsidian-mcp-1.0.6.tgz', sha256: '34879c38ee0b2a397fc55a65758deadbae36d4e92904c9467d9ca84024301520', awaitingUser: 'Open Obsidian and enter the vault API key in the bridge settings.', argv: ['npm', 'install', '--ignore-scripts', '--no-save', 'obsidian-mcp@1.0.6'] },
  'document-tools': { id: 'document-tools', version: '2026.7.10', url: 'https://registry.npmjs.org/@modelcontextprotocol/server-filesystem/-/server-filesystem-2026.7.10.tgz', sha256: 'c17c1da371c8089cff2206cce3001194d8276bae2b5ac1e2b425b6612068e3ba', argv: ['python3', '-m', 'venv'] },
  'media-tools': { id: 'media-tools', version: '5.3.0', url: 'https://registry.npmjs.org/ffmpeg-static/-/ffmpeg-static-5.3.0.tgz', sha256: '0525c908c27618582a6fb5d4cc70452a2f2d4f50cb3d88b19b16a3c1cc8df25d', argv: ['npm', 'pack', 'ffmpeg-static@5.3.0'] },
};

export interface CreativeInstallerFs {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}
export interface CreativeInstallerDeps {
  approvals: { list(status: 'approved' | null): AgentApproval[] };
  fs?: CreativeInstallerFs;
  downloader?: (url: string, signal?: AbortSignal) => Promise<Uint8Array>;
  runner?: (argv: readonly string[], options: { cwd: string; signal?: AbortSignal }) => Promise<void>;
  root?: string;
}
export interface CreativeInstallRequest { id: CreativeCapabilityId; sessionId?: string | null; modelLicenseAccepted?: boolean; signal?: AbortSignal; }

const rootFor = () => join(homedir(), 'Library', 'Application Support', 'Rhythm', 'creative-tools');
const defaultFs: CreativeInstallerFs = {
  exists: async (p) => nodeFs.access(p).then(() => true).catch(() => false),
  mkdir: async (p) => { await nodeFs.mkdir(p, { recursive: true }); },
  writeFile: async (p, data) => { await nodeFs.writeFile(p, data); },
  readFile: async (p) => nodeFs.readFile(p),
  rename: async (a, b) => { await nodeFs.rename(a, b); },
  rm: async (p) => { await nodeFs.rm(p, { recursive: true, force: true }); },
};

async function defaultDownload(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Pinned download failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
async function defaultRunner(argv: readonly string[], options: { cwd: string; signal?: AbortSignal }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0], [...argv.slice(1)], { cwd: options.cwd, signal: options.signal, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer command failed (${code})`));
    });
  });
}
function approved(approvals: AgentApproval[], id: CreativeCapabilityId, sessionId?: string | null): boolean {
  return approvals.some((row) => row.action === `install_creative_dependency:${id}` && row.status === 'approved' && (!sessionId || row.sessionId === sessionId));
}
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Installation aborted', 'AbortError'); }

/** Installs only fixed, reviewed recipes; callers cannot supply a command, path, or URL. */
export async function installCreativeDependency(request: CreativeInstallRequest, deps: CreativeInstallerDeps): Promise<CreativeInstallResult> {
  const recipe = CREATIVE_INSTALL_RECIPES[request.id];
  const fs = deps.fs ?? defaultFs; const root = deps.root ?? rootFor(); const final = join(root, recipe.id); const sentinel = join(final, '.rhythm-installed.json');
  if (!approved(deps.approvals.list('approved'), request.id, request.sessionId)) return { status: 'denied', id: request.id, detail: 'An approved install_creative_dependency approval is required for this session.' };
  if (recipe.requiresModelLicense && !request.modelLicenseAccepted) return { status: 'awaiting-user', id: request.id, detail: recipe.awaitingUser! };
  if (await fs.exists(sentinel)) return { status: 'already-installed', id: request.id, detail: 'Pinned recipe already installed.' };
  const staging = join(root, `.install-${recipe.id}-${randomUUID()}`); let created = false;
  try {
    checkAbort(request.signal); await fs.mkdir(staging); created = true;
    const artifact = join(staging, 'artifact'); const bytes = await (deps.downloader ?? defaultDownload)(recipe.url, request.signal);
    checkAbort(request.signal); const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== recipe.sha256) throw new Error('Pinned download checksum did not match.');
    await fs.writeFile(artifact, bytes); await (deps.runner ?? defaultRunner)([...recipe.argv, artifact], { cwd: staging, signal: request.signal });
    await fs.writeFile(join(staging, '.rhythm-installed.json'), JSON.stringify({ id: recipe.id, version: recipe.version, commit: recipe.commit ?? null }));
    await fs.rename(staging, final); created = false;
    return recipe.awaitingUser ? { status: 'awaiting-user', id: request.id, detail: recipe.awaitingUser } : { status: 'installed', id: request.id, detail: 'Pinned recipe installed.' };
  } catch (error) {
    if (created) await fs.rm(staging);
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'failed', id: request.id, detail: error instanceof Error ? error.message : 'Installation failed.' };
  }
}
