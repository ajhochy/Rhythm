import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import type { LiveArtifactBundle } from '../models/live_artifact';
import { logger } from '../utils/logger';

const STATE_MAX_BYTES = 512 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const artifactRoot = (id: string) => path.join(env.liveArtifactStorageDir, id);

export class LiveArtifactStorage {
  private fail(error: unknown, artifactId: string, kind: 'bundle' | 'state', op: 'read' | 'write'): never {
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    // ponytail: node fs errors embed the storage root in both message and stack.
    logger.error('live-artifact storage operation failed', { artifactId, kind, op, code });
    throw AppError.internal('Live artifact content unavailable');
  }
  validateBundle(value: unknown): LiveArtifactBundle {
    if (!value || typeof value !== 'object') throw AppError.badRequest('bundle is required');
    const bundle = value as Record<string, unknown>;
    if (!['html', 'css', 'js'].every((key) => typeof bundle[key] === 'string') || Object.keys(bundle).some((key) => !['html', 'css', 'js'].includes(key))) throw AppError.badRequest('bundle must contain only html, css, and js strings');
    return bundle as unknown as LiveArtifactBundle;
  }
  validateState(value: unknown): string {
    let encoded: string;
    try { encoded = JSON.stringify(value); } catch { throw AppError.badRequest('state must be JSON'); }
    if (encoded === undefined || Buffer.byteLength(encoded) > STATE_MAX_BYTES) throw AppError.badRequest('state exceeds 512 KiB');
    return encoded;
  }
  bundleHash(bundle: LiveArtifactBundle): string { return hash(JSON.stringify(bundle)); }
  stateHash(encoded: string): string { return hash(encoded); }
  private async validBundle(destination: string, contentHash: string): Promise<boolean> {
    if ((await readdir(destination)).sort().join(',') !== 'app.js,index.html,styles.css') return false;
    const [html, css, js] = await Promise.all(['index.html', 'styles.css', 'app.js'].map((file) => readFile(path.join(destination, file), 'utf8')));
    return this.bundleHash({ html, css, js }) === contentHash;
  }
  private async publishTemporaryBundle(temporary: string, destination: string, contentHash: string): Promise<void> {
    try {
      await rename(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
      if (await this.validBundle(destination, contentHash)) return;
      if ((await readdir(destination)).length !== 0) throw error;
      await rm(destination, { recursive: false });
      try { await rename(temporary, destination); }
      catch (retryError) {
        const retryCode = (retryError as NodeJS.ErrnoException).code;
        if ((retryCode !== 'EEXIST' && retryCode !== 'ENOTEMPTY') || !(await this.validBundle(destination, contentHash))) throw retryError;
      }
    }
  }
  async publishBundle(id: string, contentHash: string, bundle: LiveArtifactBundle): Promise<void> {
    try {
      const destination = path.join(artifactRoot(id), 'bundles', contentHash);
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${randomUUID()}`;
      await mkdir(temporary, { recursive: true });
      try {
        await Promise.all([
          writeFile(path.join(temporary, 'index.html'), bundle.html, 'utf8'),
          writeFile(path.join(temporary, 'styles.css'), bundle.css, 'utf8'),
          writeFile(path.join(temporary, 'app.js'), bundle.js, 'utf8'),
        ]);
        await this.publishTemporaryBundle(temporary, destination, contentHash);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    } catch (error) { this.fail(error, id, 'bundle', 'write'); }
  }
  async publishState(id: string, contentHash: string, encoded: string): Promise<void> {
    try {
      const destination = path.join(artifactRoot(id), 'state', `${contentHash}.json`);
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${randomUUID()}`;
      try { await writeFile(temporary, encoded, 'utf8'); await rename(temporary, destination).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; }); }
      catch (error) { await rm(temporary, { force: true }); throw error; }
    } catch (error) { this.fail(error, id, 'state', 'write'); }
  }
  async removeArtifact(id: string): Promise<void> {
    try { await rm(artifactRoot(id), { recursive: true, force: true }); }
    catch (error) { this.fail(error, id, 'state', 'write'); }
  }
  async readBundle(id: string, contentHash: string): Promise<LiveArtifactBundle> {
    try {
      const root = path.join(artifactRoot(id), 'bundles', contentHash);
      const [html, css, js] = await Promise.all(['index.html', 'styles.css', 'app.js'].map((file) => readFile(path.join(root, file), 'utf8')));
      return { html, css, js };
    } catch (error) { return this.fail(error, id, 'bundle', 'read'); }
  }
  async readState(id: string, contentHash: string): Promise<unknown> {
    try { return JSON.parse(await readFile(path.join(artifactRoot(id), 'state', `${contentHash}.json`), 'utf8')); }
    catch (error) { return this.fail(error, id, 'state', 'read'); }
  }
}
