import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { Pool } from 'pg';

import {
  env,
  resolveMediaArtifactRetentionDays,
  resolveMediaArtifactStorageRoot,
} from '../config/env';
import { getDb, getPostgresPool } from '../database/db';

export interface MediaArtifact {
  id: string;
  project: string;
  session: string;
  mime: string;
  size: number;
  checksum: string;
  createdAt: string;
  storageKey: string;
  pinned: boolean;
}

interface MediaArtifactRow {
  id: string;
  project: string;
  session: string;
  mime: string;
  size: number | string;
  checksum: string;
  created_at: string;
  storage_key: string;
  pinned: number | boolean;
}

function rowToArtifact(row: MediaArtifactRow): MediaArtifact {
  return {
    id: row.id,
    project: row.project,
    session: row.session,
    mime: row.mime,
    size: Number(row.size),
    checksum: row.checksum,
    createdAt: row.created_at,
    storageKey: row.storage_key,
    pinned: row.pinned === true || row.pinned === 1,
  };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

export function mediaMimeForPath(filePath: string): string | null {
  return MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? null;
}

export interface ByteRange {
  start: number;
  end: number;
}

export class InvalidByteRangeError extends Error {}

export function parseByteRange(value: string | undefined, size: number): ByteRange | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) throw new InvalidByteRangeError('Invalid byte range');
  const [, startText, endText] = match;
  if (!startText && !endText) throw new InvalidByteRangeError('Invalid byte range');

  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new InvalidByteRangeError('Invalid byte range');
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= size || end < start
    ) {
      throw new InvalidByteRangeError('Unsatisfiable byte range');
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export class MediaArtifactStore {
  private readonly db?: Database.Database;
  private readonly pool?: Pool;
  readonly root: string;

  constructor(options: { db?: Database.Database; pool?: Pool; root?: string } = {}) {
    this.db = options.db ?? (env.dbClient === 'sqlite' ? getDb() : undefined);
    this.pool = options.pool ?? (env.dbClient === 'postgres' ? getPostgresPool() : undefined);
    const configuredRoot = resolve(options.root ?? resolveMediaArtifactStorageRoot());
    mkdirSync(configuredRoot, { recursive: true });
    this.root = realpathSync(configuredRoot);
  }

  /** Refuse traversal and all keys outside the checksum-addressed layout. */
  resolveStoragePath(storageKey: string): string {
    return this.assertStoragePath(storageKey);
  }

  private assertStoragePath(storageKey: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(storageKey)) {
      throw new Error('Invalid storage key; path traversal outside artifact root refused');
    }
    const candidate = resolve(this.root, storageKey);
    const fromRoot = relative(this.root, candidate);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || fromRoot.startsWith(sep)) {
      throw new Error('Artifact path is outside registered storage root');
    }
    const existingBoundary = existsSync(candidate)
      ? realpathSync(candidate)
      : existsSync(dirname(candidate))
        ? realpathSync(dirname(candidate))
        : this.root;
    const realFromRoot = relative(this.root, existingBoundary);
    if (realFromRoot === '..' || realFromRoot.startsWith(`..${sep}`) || realFromRoot.startsWith(sep)) {
      throw new Error('Artifact path resolves outside registered storage root');
    }
    return candidate;
  }

  async registerGeneratedMediaFile(input: {
    filePath: string;
    project: string;
    session: string;
    mime?: string;
    createdAt?: string;
    pinned?: boolean;
  }): Promise<MediaArtifact> {
    const stat = statSync(input.filePath);
    if (!stat.isFile()) throw new Error('Generated media must be a file');
    const mime = input.mime ?? mediaMimeForPath(input.filePath);
    if (!mime || (!mime.startsWith('image/') && !mime.startsWith('video/'))) {
      throw new Error('Only generated image and video media can be registered');
    }
    const bytes = readFileSync(input.filePath);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `${checksum.slice(0, 2)}/${checksum}`;
    const destination = this.resolveStoragePath(storageKey);
    mkdirSync(dirname(destination), { recursive: true });
    this.assertStoragePath(storageKey);
    if (!existsSync(destination)) {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes, { flag: 'wx' });
      try {
        renameSync(temporary, destination);
      } catch (error) {
        rmSync(temporary, { force: true });
        if (!existsSync(destination)) throw error;
      }
    }

    const artifact: MediaArtifact = {
      id: randomUUID(),
      project: input.project,
      session: input.session,
      mime,
      size: stat.size,
      checksum,
      createdAt: input.createdAt ?? new Date().toISOString(),
      storageKey,
      pinned: input.pinned ?? false,
    };
    if (this.pool) {
      const inserted = await this.pool.query(
        `INSERT INTO media_artifacts
           (id, project, session, mime, size, checksum, created_at, storage_key, pinned)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (project, session, checksum) DO UPDATE SET project = EXCLUDED.project
         RETURNING *`,
        [artifact.id, artifact.project, artifact.session, artifact.mime, artifact.size,
          artifact.checksum, artifact.createdAt, artifact.storageKey, artifact.pinned],
      );
      return rowToArtifact(inserted.rows[0] as MediaArtifactRow);
    } else {
      this.db!.prepare(
        `INSERT INTO media_artifacts
           (id, project, session, mime, size, checksum, created_at, storage_key, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project, session, checksum) DO NOTHING`,
      ).run(artifact.id, artifact.project, artifact.session, artifact.mime, artifact.size,
        artifact.checksum, artifact.createdAt, artifact.storageKey, artifact.pinned ? 1 : 0);
      const stored = this.db!.prepare(
        `SELECT * FROM media_artifacts WHERE project = ? AND session = ? AND checksum = ?`,
      ).get(artifact.project, artifact.session, artifact.checksum) as MediaArtifactRow;
      return rowToArtifact(stored);
    }
  }

  async findProjectArtifact(id: string, project: string): Promise<MediaArtifact | null> {
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT * FROM media_artifacts WHERE id = $1 AND project = $2`, [id, project],
      );
      return result.rows[0] ? rowToArtifact(result.rows[0] as MediaArtifactRow) : null;
    }
    const row = this.db!.prepare(
      `SELECT * FROM media_artifacts WHERE id = ? AND project = ?`,
    ).get(id, project) as MediaArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  async setPinned(id: string, project: string, pinned: boolean): Promise<boolean> {
    if (this.pool) {
      const result = await this.pool.query(
        `UPDATE media_artifacts SET pinned = $1 WHERE id = $2 AND project = $3`,
        [pinned, id, project],
      );
      return (result.rowCount ?? 0) > 0;
    }
    return this.db!.prepare(
      `UPDATE media_artifacts SET pinned = ? WHERE id = ? AND project = ?`,
    ).run(pinned ? 1 : 0, id, project).changes > 0;
  }

  /** Apply local session ownership when that richer model is available. */
  canUserAccessArtifact(artifact: MediaArtifact, userId: number): boolean {
    if (!this.db) return true;
    const session = this.db.prepare(
      `SELECT owner_user_id, project_id
         FROM agent_sessions
        WHERE id = ? OR sdk_session_id = ?
        LIMIT 1`,
    ).get(artifact.session, artifact.session) as {
      owner_user_id: number | null;
      project_id: string | null;
    } | undefined;
    if (!session) return true;
    if (session.project_id !== null && session.project_id !== artifact.project) return false;
    return session.owner_user_id === null || session.owner_user_id === userId;
  }

  async sweepExpiredArtifacts(
    now = new Date(),
    retentionDays = resolveMediaArtifactRetentionDays(),
  ): Promise<{ removedMetadata: number; removedBytes: number }> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
    let storageKeys: string[];
    let removedMetadata: number;
    if (this.pool) {
      const deleted = await this.pool.query(
        `DELETE FROM media_artifacts WHERE pinned = FALSE AND created_at < $1 RETURNING storage_key`,
        [cutoff],
      );
      storageKeys = deleted.rows.map((row) => String(row.storage_key));
      removedMetadata = deleted.rowCount ?? 0;
    } else {
      const rows = this.db!.prepare(
        `SELECT storage_key FROM media_artifacts WHERE pinned = 0 AND created_at < ?`,
      ).all(cutoff) as Array<{ storage_key: string }>;
      this.db!.prepare(
        `DELETE FROM media_artifacts WHERE pinned = 0 AND created_at < ?`,
      ).run(cutoff);
      storageKeys = rows.map((row) => row.storage_key);
      removedMetadata = rows.length;
    }

    let removedBytes = 0;
    for (const storageKey of new Set(storageKeys)) {
      const stillReferenced = this.pool
        ? (await this.pool.query(
          `SELECT 1 FROM media_artifacts WHERE storage_key = $1 LIMIT 1`, [storageKey],
        )).rowCount
        : (this.db!.prepare(
          `SELECT 1 FROM media_artifacts WHERE storage_key = ? LIMIT 1`,
        ).get(storageKey) ? 1 : 0);
      if (stillReferenced) continue;
      rmSync(this.resolveStoragePath(storageKey), { force: true });
      removedBytes += 1;
    }
    return { removedMetadata, removedBytes };
  }

  createByteStream(artifact: MediaArtifact, range: ByteRange | null) {
    return createReadStream(this.resolveStoragePath(artifact.storageKey), range ?? undefined);
  }
}

export async function registerGeneratedMediaFile(input: {
  filePath: string; project: string; session: string; mime?: string;
}): Promise<MediaArtifact> {
  return new MediaArtifactStore().registerGeneratedMediaFile(input);
}

export async function registerGeneratedMediaPart(
  part: Record<string, unknown>,
  session: { id: string; projectId: string | null } | null,
  store?: MediaArtifactStore,
): Promise<MediaArtifact | null> {
  if (!session?.projectId || part.type !== 'tool' || part.tool !== 'image_generation') return null;
  const state = part.state as Record<string, unknown> | undefined;
  const metadata = state?.metadata as Record<string, unknown> | undefined;
  const filePath = metadata?.path;
  if (state?.status !== 'completed' || typeof filePath !== 'string') return null;
  const mime = mediaMimeForPath(filePath);
  if (!mime?.startsWith('image/')) return null;
  return (store ?? new MediaArtifactStore()).registerGeneratedMediaFile({
    filePath, project: session.projectId, session: session.id, mime,
  });
}

export function withHostedArtifactMetadata(
  part: Record<string, unknown>,
  artifact: MediaArtifact,
): Record<string, unknown> {
  const state = (part.state ?? {}) as Record<string, unknown>;
  const metadata = (state.metadata ?? {}) as Record<string, unknown>;
  return {
    ...part,
    state: {
      ...state,
      metadata: {
        ...metadata,
        artifactId: artifact.id,
        artifactUrl: `/artifacts/${artifact.id}`,
      },
    },
  };
}
