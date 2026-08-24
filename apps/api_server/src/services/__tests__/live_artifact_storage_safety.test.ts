import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe('issues #1396/#1397/#1394 live-artifact storage safety', () => {
  it('aborts startup with the resolved path and LIVE_ARTIFACT_STORAGE_DIR when storage is unusable', async () => {
    // Regression caught: boot reported healthy although every later artifact read failed.
    const module = await import('../live_artifact_storage') as Record<string, unknown>;
    expect(module.verifyLiveArtifactStorageDir).toBeTypeOf('function');
    if (typeof module.verifyLiveArtifactStorageDir !== 'function') return;

    const root = await mkdtemp(path.join(tmpdir(), 'rhythm-artifact-startup-'));
    cleanups.push(root);
    const blockingFile = path.join(root, 'not-a-directory');
    await writeFile(blockingFile, 'x');
    const target = path.join(blockingFile, 'live-artifacts');

    await expect(
      (module.verifyLiveArtifactStorageDir as (storageDir: string) => Promise<void>)(target),
    ).rejects.toThrow(new RegExp(`LIVE_ARTIFACT_STORAGE_DIR.*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    const server = await readFile(path.join(process.cwd(), 'src', 'server.ts'), 'utf8');
    expect(server.indexOf('await verifyLiveArtifactStorageDir()')).toBeGreaterThan(-1);
    expect(server.indexOf('await verifyLiveArtifactStorageDir()')).toBeLessThan(
      server.indexOf('await initDb()'),
    );
  });

  it('partitions new relay artifacts while retaining the legacy root as a read fallback', async () => {
    // Regression caught: a relay ID could create a file where live storage needs a directory.
    const module = await import('../../config/env') as Record<string, unknown>;
    expect(module.resolveRelayArtifactStorageDir).toBeTypeOf('function');
    if (typeof module.resolveRelayArtifactStorageDir !== 'function') return;

    const root = await mkdtemp(path.join(tmpdir(), 'rhythm-relay-namespace-'));
    cleanups.push(root);
    process.env.LIVE_ARTIFACT_STORAGE_DIR = root;
    try {
      expect((module.resolveRelayArtifactStorageDir as () => string)()).toBe(
        path.join(root, 'relay-artifacts'),
      );
    } finally {
      delete process.env.LIVE_ARTIFACT_STORAGE_DIR;
    }
  });

  it('exposes an operator-only diagnostic for current hashes with no readable content', async () => {
    // Regression caught: metadata stayed valid while missing bytes remained invisible until a user read.
    const module = await import('../live_artifact_storage') as Record<string, unknown>;
    expect(module.diagnoseLiveArtifactContent).toBeTypeOf('function');
    if (typeof module.diagnoseLiveArtifactContent !== 'function') return;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE live_artifacts (
        id TEXT PRIMARY KEY,
        current_bundle_hash TEXT NOT NULL,
        current_state_hash TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE live_artifact_contents (
        artifact_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        hash TEXT NOT NULL
      );
      INSERT INTO live_artifacts VALUES ('artifact-missing', '${'a'.repeat(64)}', '${'b'.repeat(64)}', NULL);
    `);
    const { setDb } = await import('../../database/db');
    setDb(db);
    try {
      await expect(
        (module.diagnoseLiveArtifactContent as () => Promise<unknown>)(),
      ).resolves.toEqual([
        { artifactId: 'artifact-missing', kind: 'bundle', hash: 'a'.repeat(64) },
        { artifactId: 'artifact-missing', kind: 'state', hash: 'b'.repeat(64) },
      ]);
      const server = await readFile(path.join(process.cwd(), 'src', 'server.ts'), 'utf8');
      expect(server).toContain('LIVE_ARTIFACT_CONTENT_MISSING');
    } finally {
      db.close();
    }
  });

  it('pins the Synology volume name and provides non-destructive pre/post byte checks', async () => {
    // Regression caught: changing the Compose project silently selected a different named volume.
    const compose = await readFile(path.join(process.cwd(), 'docker-compose.synology.yml'), 'utf8');
    expect(compose).toMatch(/rhythm_api_data:[\s\S]*name:\s*\$\{RHYTHM_API_DATA_VOLUME:\?/);

    const checkScript = path.join(process.cwd(), 'scripts', 'check-live-artifact-storage.sh');
    expect(existsSync(checkScript)).toBe(true);
    if (!existsSync(checkScript)) return;
    const script = await readFile(checkScript, 'utf8');
    expect(script).toContain('pre');
    expect(script).toContain('post');
    expect(script).toContain('sha256sum');
  });
});
