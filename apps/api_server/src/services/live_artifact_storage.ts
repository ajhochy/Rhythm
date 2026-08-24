import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, resolveLiveArtifactStorageDir } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type { LiveArtifactBundle } from '../models/live_artifact';
import { logger } from '../utils/logger';

const STATE_MAX_BYTES = 512 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const artifactRoot = (id: string) => path.join(env.liveArtifactStorageDir, id);

type ContentKind = 'bundle' | 'state';

export interface MissingLiveArtifactContent {
  artifactId: string;
  kind: ContentKind;
  hash: string;
}

/** Fail boot before a bad mount can advertise a healthy API (#1396). */
export async function verifyLiveArtifactStorageDir(
  storageDir = resolveLiveArtifactStorageDir(),
): Promise<void> {
  const probe = path.join(storageDir, `.rhythm-storage-probe-${process.pid}-${randomUUID()}`);
  try {
    await mkdir(storageDir, { recursive: true });
    await access(storageDir, constants.R_OK | constants.W_OK);
    await readdir(storageDir);
    await writeFile(probe, 'ok', { flag: 'wx' });
    await readFile(probe, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    throw new Error(
      `LIVE_ARTIFACT_STORAGE_DIR is not readable and writable at resolved path "${storageDir}" (${code})`,
      { cause: error },
    );
  } finally {
    await rm(probe, { force: true }).catch(() => undefined);
  }
}

async function legacyContentExists(row: MissingLiveArtifactContent): Promise<boolean> {
  const root = artifactRoot(row.artifactId);
  const files = row.kind === 'bundle'
    ? ['index.html', 'styles.css', 'app.js'].map((file) => path.join(root, 'bundles', row.hash, file))
    : [path.join(root, 'state', `${row.hash}.json`)];
  return (await Promise.all(files.map((file) => access(file, constants.R_OK).then(() => true).catch(() => false))))
    .every(Boolean);
}

/** Find published pointers with no database or legacy-disk content (#1394). */
export async function diagnoseLiveArtifactContent(): Promise<MissingLiveArtifactContent[]> {
  const sql = `
    SELECT a.id AS artifact_id, 'bundle' AS kind, a.current_bundle_hash AS hash
      FROM live_artifacts a
      LEFT JOIN live_artifact_contents c
        ON c.artifact_id = a.id AND c.kind = 'bundle' AND c.hash = a.current_bundle_hash
      WHERE a.deleted_at IS NULL AND c.artifact_id IS NULL
    UNION ALL
    SELECT a.id AS artifact_id, 'state' AS kind, a.current_state_hash AS hash
      FROM live_artifacts a
      LEFT JOIN live_artifact_contents c
        ON c.artifact_id = a.id AND c.kind = 'state' AND c.hash = a.current_state_hash
      WHERE a.deleted_at IS NULL AND c.artifact_id IS NULL`;
  const rows = env.dbClient === 'postgres'
    ? (await getPostgresPool().query<{ artifact_id: string; kind: ContentKind; hash: string }>(sql)).rows
    : getDb().prepare(sql).all() as { artifact_id: string; kind: ContentKind; hash: string }[];
  const candidates = rows.map((row) => ({
    artifactId: row.artifact_id,
    kind: row.kind,
    hash: row.hash,
  }));
  const existence = await Promise.all(candidates.map(legacyContentExists));
  return candidates.filter((_, index) => !existence[index]);
}

/**
 * Content is stored in the database alongside the revision rows that reference
 * it. It used to live only on disk under LIVE_ARTIFACT_STORAGE_DIR, which meant
 * a container recreated without a persistent mount silently lost every
 * artifact while Postgres still advertised valid revisions and hashes — every
 * read then failed with "Live artifact content unavailable" (observed
 * 2026-08-15, all four artifacts, including ones never written that day).
 *
 * Reads fall back to the legacy on-disk copy and write it back into the
 * database, so existing artifacts migrate themselves on first access with no
 * separate backfill step and no downtime.
 *
 * Relay mobile files use the partitioned `relay-artifacts/` child. Reads keep
 * a legacy root fallback so production files migrate without a big-bang move.
 */
export class LiveArtifactStorage {
  private fail(error: unknown, artifactId: string, kind: ContentKind, op: 'read' | 'write'): never {
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    // ponytail: node fs errors embed the storage root in both message and stack.
    logger.error('live-artifact storage operation failed', { artifactId, kind, op, code });
    throw AppError.internal('Live artifact content unavailable');
  }

  private async writeContent(id: string, kind: ContentKind, contentHash: string, body: string): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        'INSERT INTO live_artifact_contents (artifact_id,kind,hash,body,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (artifact_id,kind,hash) DO NOTHING',
        [id, kind, contentHash, body, new Date().toISOString()],
      );
      return;
    }
    getDb()
      .prepare('INSERT OR IGNORE INTO live_artifact_contents (artifact_id,kind,hash,body,created_at) VALUES (?,?,?,?,?)')
      .run(id, kind, contentHash, body, new Date().toISOString());
  }

  private async readContent(id: string, kind: ContentKind, contentHash: string): Promise<string | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{ body: string }>(
        'SELECT body FROM live_artifact_contents WHERE artifact_id = $1 AND kind = $2 AND hash = $3',
        [id, kind, contentHash],
      );
      return result.rows[0]?.body ?? null;
    }
    const row = getDb()
      .prepare('SELECT body FROM live_artifact_contents WHERE artifact_id = ? AND kind = ? AND hash = ?')
      .get(id, kind, contentHash) as { body: string } | undefined;
    return row?.body ?? null;
  }

  /** Adopt a pre-migration on-disk copy so old artifacts heal on first read. */
  private async adoptLegacy(id: string, kind: ContentKind, contentHash: string, body: string): Promise<void> {
    try {
      await this.writeContent(id, kind, contentHash, body);
      logger.info('migrated live-artifact content to database', { artifactId: id, kind });
    } catch (error) {
      // A failed adoption must not fail the read the caller actually asked for.
      logger.error('live-artifact content adoption failed', { artifactId: id, kind, error: String(error) });
    }
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
  async publishBundle(id: string, contentHash: string, bundle: LiveArtifactBundle): Promise<void> {
    try {
      await this.writeContent(id, 'bundle', contentHash, JSON.stringify(bundle));
    } catch (error) { this.fail(error, id, 'bundle', 'write'); }
  }
  async publishState(id: string, contentHash: string, encoded: string): Promise<void> {
    try {
      await this.writeContent(id, 'state', contentHash, encoded);
    } catch (error) { this.fail(error, id, 'state', 'write'); }
  }
  async removeArtifact(id: string): Promise<void> {
    try {
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query('DELETE FROM live_artifact_contents WHERE artifact_id = $1', [id]);
      } else {
        getDb().prepare('DELETE FROM live_artifact_contents WHERE artifact_id = ?').run(id);
      }
      // Legacy on-disk copies are removed best-effort; their absence is not an error.
      await rm(artifactRoot(id), { recursive: true, force: true }).catch(() => {});
    } catch (error) { this.fail(error, id, 'state', 'write'); }
  }
  async readBundle(id: string, contentHash: string): Promise<LiveArtifactBundle> {
    try {
      const stored = await this.readContent(id, 'bundle', contentHash);
      if (stored !== null) return JSON.parse(stored) as LiveArtifactBundle;
      const root = path.join(artifactRoot(id), 'bundles', contentHash);
      const [html, css, js] = await Promise.all(
        ['index.html', 'styles.css', 'app.js'].map((file) => readFile(path.join(root, file), 'utf8')),
      );
      const bundle: LiveArtifactBundle = { html, css, js };
      await this.adoptLegacy(id, 'bundle', contentHash, JSON.stringify(bundle));
      return bundle;
    } catch (error) { return this.fail(error, id, 'bundle', 'read'); }
  }
  async readState(id: string, contentHash: string): Promise<unknown> {
    try {
      const stored = await this.readContent(id, 'state', contentHash);
      if (stored !== null) return JSON.parse(stored);
      const encoded = await readFile(path.join(artifactRoot(id), 'state', `${contentHash}.json`), 'utf8');
      await this.adoptLegacy(id, 'state', contentHash, encoded);
      return JSON.parse(encoded);
    } catch (error) { return this.fail(error, id, 'state', 'read'); }
  }
}
