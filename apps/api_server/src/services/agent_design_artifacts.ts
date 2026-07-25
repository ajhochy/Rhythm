import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { containsReal } from '../utils/path_containment';

const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.svg', '.mp4', '.pdf']);

export function artifactTypeForPath(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase();
  return allowedExtensions.has(extension) ? extension.slice(1) : null;
}

export function isArtifactType(value: string): boolean {
  return allowedExtensions.has(`.${value.toLowerCase()}`);
}

export function resolveLocalArtifact(filePath: string, userApprovedPath = false): { path: string; artifactType: string } {
  if (!filePath || !existsSync(filePath)) throw new Error('Local artifact file does not exist');
  const resolved = realpathSync(filePath);
  if (!statSync(resolved).isFile()) throw new Error('Local artifact must be a file');
  const artifactType = artifactTypeForPath(resolved);
  if (!artifactType) throw new Error('Unsupported local artifact type');
  const studio = resolve(process.env.HOME ?? '', 'Downloads', 'Rhythm Studio');
  if (!userApprovedPath && !containsReal(studio, resolved)) {
    throw new Error('Local artifact must be under ~/Downloads/Rhythm Studio or explicitly approved');
  }
  return { path: resolved, artifactType };
}

export function isCanvaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com'));
  } catch {
    return false;
  }
}
