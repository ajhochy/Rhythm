/** Immutable, code-owned local artifact contract for D1 managed installs. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve, relative, join } from 'node:path';
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

function parseTarSize(field: Buffer): number | null {
  const value = field.toString('ascii').replace(/\0.*$/, '').trim();
  return /^[0-7]*$/.test(value) ? Number.parseInt(value || '0', 8) : null;
}

function hasValidChecksum(header: Buffer): boolean {
  const declared = parseTarSize(header.subarray(148, 156));
  if (declared === null) return false;
  let sum = 0;
  for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index];
  return sum === declared;
}

function isUnambiguousTarPath(name: string): boolean {
  return !!name && !name.includes('\0') && !name.includes('\\') && !name.startsWith('/') &&
    !name.endsWith('/') && posix.normalize(name) === name && !name.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

/** Validates all archive bytes that may reach npm; never trusts a partial tar scan. */
export function validateImmutableLocalTarballBytes(archive: Buffer, digest: string, expectedToolName: string): { packageName: string } | null {
  if (!DIGEST.test(digest) || createHash('sha256').update(archive).digest('hex') !== digest) return null;
  let tar: Buffer;
  try { tar = gunzipSync(archive); } catch { return null; }
  const paths = new Set<string>();
  let packageJson: Buffer | null = null;
  let offset = 0;
  for (; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.subarray(offset).every((byte) => byte === 0)) break;
      return null;
    }
    if (!hasValidChecksum(header) || !header.subarray(345, 500).every((byte) => byte === 0)) return null;
    const size = parseTarSize(header.subarray(124, 136));
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (size === null || !Number.isSafeInteger(size) || size < 0 || !isUnambiguousTarPath(name) || type !== '0' || paths.has(name)) return null;
    if (name === 'package/node_modules' || name.startsWith('package/node_modules/')) return null;
    paths.add(name);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) return null;
    if (name === 'package/package.json') {
      packageJson = tar.subarray(bodyStart, bodyEnd);
    }
    const nextOffset = bodyStart + Math.ceil(size / 512) * 512;
    if (nextOffset > tar.length) return null;
    offset = nextOffset;
  }
  const terminated = offset + 1024 <= tar.length && tar.subarray(offset, offset + 1024).every((byte) => byte === 0);
  if (!terminated || !tar.subarray(offset).every((byte) => byte === 0)) return null;
  if (!packageJson) return null;
  try {
    const parsed = JSON.parse(packageJson.toString('utf8')) as Record<string, unknown>;
    const forbidden = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'scripts'];
    if (typeof parsed.name !== 'string' || parsed.name !== expectedToolName || forbidden.some((key) => key in parsed)) return null;
    return { packageName: parsed.name };
  } catch { return null; }
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
    const metadata = validateImmutableLocalTarballBytes(bytes, digest, expectedToolName);
    if (!metadata) return null;
    return { digest, path, packageName: metadata.packageName };
  } catch { return null; }
}
