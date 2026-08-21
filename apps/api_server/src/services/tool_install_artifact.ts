/** Immutable, code-owned local artifact contract for D1 managed installs. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const LOCAL_TARBALL_INSTALL_METHOD = 'local-tarball';
const DIGEST = /^[a-f0-9]{64}$/;
const SOURCE = /^local-tarball:sha256:([a-f0-9]{64})$/;

export interface ImmutableToolArtifact {
  digest: string;
  path: string;
  packageName: string;
}

export function parseImmutableLocalTarballSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return SOURCE.exec(value)?.[1] ?? null;
}

function canonicalOwnedDirectory(root: string): string | null {
  try {
    const configured = resolve(root);
    const canonical = realpathSync(configured);
    const stat = lstatSync(configured);
    // An OS-owned ancestor alias such as /var -> /private is acceptable; the
    // configured leaf itself must still be a real directory, and every child
    // is compared against this canonical root below.
    return stat.isDirectory() && !stat.isSymbolicLink() ? canonical : null;
  } catch {
    return null;
  }
}

function readPackageMetadata(archive: Buffer): { name: string; dependencies: boolean; scripts: boolean } | null {
  let tar: Buffer;
  try { tar = gunzipSync(archive); } catch { return null; }
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (!Number.isSafeInteger(size) || size < 0 || !name || name.includes('..') || name.startsWith('/') || !['0', ''].includes(type)) return null;
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) return null;
    if (name === 'package/package.json') {
      try {
        const parsed = JSON.parse(tar.subarray(bodyStart, bodyEnd).toString('utf8')) as Record<string, unknown>;
        const dependencies = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies'].some((key) =>
          key in parsed && Object.keys((parsed[key] ?? {}) as object).length > 0,
        );
        return {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          dependencies,
          scripts: !!parsed.scripts && Object.keys(parsed.scripts as object).length > 0,
        };
      } catch { return null; }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

/**
 * Proves the exact bytes are an ordinary local tarball owned by the configured
 * artifact root. It deliberately accepts no path from a proposal.
 */
export function inspectImmutableLocalTarball(
  artifactRoot: string,
  digest: string,
  expectedToolName: string,
): ImmutableToolArtifact | null {
  if (!DIGEST.test(digest)) return null;
  const root = canonicalOwnedDirectory(artifactRoot);
  if (!root) return null;
  const path = join(root, `${digest}.tgz`);
  try {
    const stat = lstatSync(path);
    const canonicalPath = realpathSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || relative(root, canonicalPath).startsWith('..')) return null;
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== digest) return null;
    const metadata = readPackageMetadata(bytes);
    if (!metadata || metadata.name !== expectedToolName || metadata.dependencies || metadata.scripts) return null;
    return { digest, path, packageName: metadata.name };
  } catch { return null; }
}
