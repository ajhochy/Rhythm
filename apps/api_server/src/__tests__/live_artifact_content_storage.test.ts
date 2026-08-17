import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { env } from '../config/env';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { LiveArtifactStorage } from '../services/live_artifact_storage';
import { UsersRepository } from '../repositories/users_repository';
import { LiveArtifactsRepository } from '../repositories/live_artifacts_repository';

const bundle = { html: '<h1>Dashboard</h1>', css: 'h1{color:red}', js: 'window.ok = true;' };

describe('live artifact content storage (durability)', () => {
  let db: Database.Database;
  let storage: LiveArtifactStorage;
  let artifactId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    storage = new LiveArtifactStorage();

    const user = new UsersRepository().create({ name: 'AJ', email: `aj-${Date.now()}@example.invalid` });
    const workspaceId = Number(
      db.prepare('INSERT INTO workspaces (name, join_code, created_by) VALUES (?, ?, ?)')
        .run('fixture', `code-${Date.now()}`, user.id).lastInsertRowid,
    );
    artifactId = `art-${Date.now()}`;
    await new LiveArtifactsRepository().create({
      id: artifactId,
      type: 'html',
      title: 'Fixture',
      ownerUserId: user.id,
      workspaceId,
      visibility: 'private',
      currentBundleRevision: 1,
      currentBundleHash: storage.bundleHash(bundle),
      currentStateRevision: 1,
      currentStateHash: storage.stateHash('{}'),
      declaredCapabilities: [],
    } as never);
  });

  afterEach(async () => {
    db.close();
    await rm(env.liveArtifactStorageDir, { recursive: true, force: true });
  });

  it('round-trips bundle and state through the database, not the filesystem', async () => {
    // Regression caught: content lived only on disk, so a container recreated
    // without a persistent mount lost every artifact while Postgres still
    // advertised valid revisions — every read then 500'd.
    const bundleHash = storage.bundleHash(bundle);
    const encoded = JSON.stringify({ projects: 20 });
    const stateHash = storage.stateHash(encoded);

    await storage.publishBundle(artifactId, bundleHash, bundle);
    await storage.publishState(artifactId, stateHash, encoded);

    expect(await storage.readBundle(artifactId, bundleHash)).toEqual(bundle);
    expect(await storage.readState(artifactId, stateHash)).toEqual({ projects: 20 });

    const rows = getDb()
      .prepare('SELECT kind, hash FROM live_artifact_contents WHERE artifact_id = ? ORDER BY kind')
      .all(artifactId) as { kind: string; hash: string }[];
    expect(rows).toEqual([
      { kind: 'bundle', hash: bundleHash },
      { kind: 'state', hash: stateHash },
    ]);

    // Nothing was written under the storage directory for this artifact.
    expect(existsSync(path.join(env.liveArtifactStorageDir, artifactId))).toBe(false);
  });

  it('survives losing the storage directory entirely', async () => {
    const bundleHash = storage.bundleHash(bundle);
    await storage.publishBundle(artifactId, bundleHash, bundle);
    await rm(env.liveArtifactStorageDir, { recursive: true, force: true });
    expect(await storage.readBundle(artifactId, bundleHash)).toEqual(bundle);
  });

  it('adopts pre-migration on-disk content on first read', async () => {
    // Existing artifacts must heal themselves without a separate backfill.
    const bundleHash = storage.bundleHash(bundle);
    const legacy = path.join(env.liveArtifactStorageDir, artifactId, 'bundles', bundleHash);
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'index.html'), bundle.html, 'utf8');
    await writeFile(path.join(legacy, 'styles.css'), bundle.css, 'utf8');
    await writeFile(path.join(legacy, 'app.js'), bundle.js, 'utf8');

    expect(await storage.readBundle(artifactId, bundleHash)).toEqual(bundle);

    const adopted = getDb()
      .prepare('SELECT body FROM live_artifact_contents WHERE artifact_id = ? AND kind = ?')
      .get(artifactId, 'bundle') as { body: string } | undefined;
    expect(adopted && JSON.parse(adopted.body)).toEqual(bundle);

    // Now readable with the legacy copy gone.
    await rm(env.liveArtifactStorageDir, { recursive: true, force: true });
    expect(await storage.readBundle(artifactId, bundleHash)).toEqual(bundle);
  });

  it('adopts pre-migration on-disk state on first read', async () => {
    const encoded = JSON.stringify({ restored: true });
    const stateHash = storage.stateHash(encoded);
    const legacy = path.join(env.liveArtifactStorageDir, artifactId, 'state');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, `${stateHash}.json`), encoded, 'utf8');

    expect(await storage.readState(artifactId, stateHash)).toEqual({ restored: true });
    await rm(env.liveArtifactStorageDir, { recursive: true, force: true });
    expect(await storage.readState(artifactId, stateHash)).toEqual({ restored: true });
  });

  it('reports missing content rather than inventing it', async () => {
    await expect(storage.readState(artifactId, storage.stateHash('{"absent":true}')))
      .rejects.toThrow(/Live artifact content unavailable/);
  });

  it('republishing identical content is idempotent', async () => {
    const bundleHash = storage.bundleHash(bundle);
    await storage.publishBundle(artifactId, bundleHash, bundle);
    await storage.publishBundle(artifactId, bundleHash, bundle);
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM live_artifact_contents WHERE artifact_id = ? AND kind = ?')
      .get(artifactId, 'bundle') as { n: number };
    expect(count.n).toBe(1);
  });

  it('removing an artifact clears its stored content', async () => {
    const bundleHash = storage.bundleHash(bundle);
    await storage.publishBundle(artifactId, bundleHash, bundle);
    await storage.removeArtifact(artifactId);
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM live_artifact_contents WHERE artifact_id = ?')
      .get(artifactId) as { n: number };
    expect(count.n).toBe(0);
  });
});
