import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { containsReal } from '../utils/path_containment';

const allowedExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.tif', '.tiff', '.exr',
  '.pdf', '.pptx', '.docx', '.xlsx', '.csv', '.mp4', '.mov', '.webm',
  '.glb', '.gltf', '.obj',
]);

export interface ValidatedAgentDesignInput {
  title: string;
  provider: string;
  artifactType: string;
  localPath?: string;
  artifactUrl?: string;
  projectUrl?: string;
  sessionId?: string;
}

export function artifactTypeForPath(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase();
  return allowedExtensions.has(extension) ? extension.slice(1) : null;
}

export function isArtifactType(value: string): boolean {
  return allowedExtensions.has(`.${value.toLowerCase()}`);
}

function normalizeHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be an HTTPS URL`);
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${field} must be an HTTPS URL`);
  }
}

function normalizeProvider(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Provider is required');
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new Error('Provider must be a non-empty normalized ID');
  }
  return provider;
}

/** The sole validation boundary for direct API and MCP-created artifact records. */
export function validateAgentDesignInput(input: Record<string, unknown>): ValidatedAgentDesignInput {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('Title is required');
  const provider = normalizeProvider(input.provider);
  const localPath = typeof input.localPath === 'string' && input.localPath.trim() ? input.localPath : undefined;
  const artifactUrl = typeof input.artifactUrl === 'string' && input.artifactUrl.trim()
    ? normalizeHttpsUrl(input.artifactUrl, 'Artifact URL') : undefined;
  if (Boolean(localPath) === Boolean(artifactUrl)) {
    throw new Error('Provide exactly one finished deliverable locator: localPath or artifactUrl');
  }
  if (input.thumbnailUrl !== undefined) {
    throw new Error('Remote thumbnails are not supported; use the authenticated artifact API for local previews');
  }
  if (input.userApprovedPath !== undefined) {
    throw new Error('userApprovedPath is not accepted; local artifacts must remain under ~/Downloads/Rhythm Studio');
  }
  const projectUrlValue = input.projectUrl ?? input.canvaUrl;
  const projectUrl = projectUrlValue === undefined ? undefined : normalizeHttpsUrl(projectUrlValue, 'Project URL');
  if (input.projectUrl !== undefined && input.canvaUrl !== undefined && input.projectUrl !== input.canvaUrl) {
    throw new Error('Provide one project URL');
  }

  const localArtifact = localPath
    ? resolveLocalArtifact(localPath)
    : undefined;
  const remoteType = artifactUrl ? artifactTypeForPath(new URL(artifactUrl).pathname) : undefined;
  if (artifactUrl && !remoteType) throw new Error('Unsupported finished artifact URL type');
  const artifactType = localArtifact?.artifactType ?? remoteType!;
  if (typeof input.artifactType === 'string' && input.artifactType.toLowerCase() !== artifactType) {
    throw new Error('Artifact type does not match the finished deliverable');
  }
  return {
    title,
    provider,
    artifactType,
    localPath: localArtifact?.path,
    artifactUrl,
    projectUrl,
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
  };
}

export function resolveLocalArtifact(filePath: string): { path: string; artifactType: string } {
  if (!filePath || !existsSync(filePath)) throw new Error('Local artifact file does not exist');
  const resolved = realpathSync(filePath);
  if (!statSync(resolved).isFile()) throw new Error('Local artifact must be a file');
  const artifactType = artifactTypeForPath(resolved);
  if (!artifactType) throw new Error('Unsupported local artifact type');
  const studio = resolve(process.env.HOME ?? '', 'Downloads', 'Rhythm Studio');
  if (!containsReal(studio, resolved)) {
    throw new Error('Local artifact must be under ~/Downloads/Rhythm Studio');
  }
  return { path: resolved, artifactType };
}

const posterCacheDirectory = join(tmpdir(), 'rhythm-gallery-posters');

/**
 * Generates a cached PNG poster using macOS Quick Look. The input must already
 * have passed the local Rhythm Studio boundary before this function is called.
 */
export async function generateLocalVideoPoster(filePath: string): Promise<string> {
  const artifact = resolveLocalArtifact(filePath);
  if (artifact.artifactType !== 'mp4') {
    throw new Error('Poster frames are supported only for local MP4 artifacts');
  }

  const sourceStat = statSync(artifact.path);
  const cacheKey = createHash('sha256')
    .update(`${artifact.path}\0${sourceStat.size}\0${sourceStat.mtimeMs}`)
    .digest('hex');
  mkdirSync(posterCacheDirectory, { recursive: true });
  const cachedPoster = join(posterCacheDirectory, `${cacheKey}.png`);
  if (existsSync(cachedPoster)) return cachedPoster;

  const outputDirectory = mkdtempSync(join(tmpdir(), 'rhythm-gallery-poster-'));
  try {
    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        '/usr/bin/qlmanage',
        ['-t', '-s', '1200', '-o', outputDirectory, artifact.path],
        { timeout: 5_000, maxBuffer: 1024 * 1024 },
        (error) => {
          if (error) reject(error);
          else resolvePromise();
        },
      );
    });
    const generated = readdirSync(outputDirectory)
      .find((entry) => entry.toLowerCase().endsWith('.png'));
    if (!generated) throw new Error('Quick Look did not produce a poster frame');
    copyFileSync(join(outputDirectory, generated), cachedPoster);
    return cachedPoster;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export function isCanvaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com'));
  } catch {
    return false;
  }
}
