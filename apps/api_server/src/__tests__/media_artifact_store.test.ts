import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';
import {
  MediaArtifactStore,
  parseByteRange,
  registerGeneratedMediaPart,
  withHostedArtifactMetadata,
} from '../services/media_artifact_store';

describe('media artifact store', () => {
  let db: Database.Database;
  let root: string;
  let store: MediaArtifactStore;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), 'rhythm-media-artifacts-'));
    store = new MediaArtifactStore({ db, root });
  });

  it('deduplicates bytes while retaining independent metadata references', async () => {
    const source = join(root, '..', `generated-${crypto.randomUUID()}.png`);
    writeFileSync(source, Buffer.from('same-image'));

    const first = await store.registerGeneratedMediaFile({
      filePath: source, project: 'project-a', session: 'session-a', mime: 'image/png',
    });
    const second = await store.registerGeneratedMediaFile({
      filePath: source, project: 'project-a', session: 'session-b', mime: 'image/png',
    });

    expect(second.storageKey).toBe(first.storageKey);
    expect(second.id).not.toBe(first.id);
    expect(readFileSync(store.resolveStoragePath(first.storageKey))).toEqual(Buffer.from('same-image'));
    expect(db.prepare('SELECT count(*) AS count FROM media_artifacts').get()).toEqual({ count: 2 });
  });

  it('rejects traversal and non-checksum storage keys', () => {
    expect(() => store.resolveStoragePath('../secret')).toThrow(/traversal|outside|storage key/i);
    expect(() => store.resolveStoragePath('/tmp/secret')).toThrow(/traversal|outside|storage key/i);
    const outside = mkdtempSync(join(tmpdir(), 'rhythm-media-outside-'));
    symlinkSync(outside, join(root, 'bb'));
    expect(() => store.resolveStoragePath(`bb/${'a'.repeat(64)}`)).toThrow(/outside/i);
  });

  it('sweeps expired unpinned metadata and keeps shared bytes until the last reference is gone', async () => {
    const source = join(root, '..', `old-${crypto.randomUUID()}.mp4`);
    writeFileSync(source, Buffer.from('video'));
    const old = '2026-06-01T00:00:00.000Z';
    const first = await store.registerGeneratedMediaFile({
      filePath: source, project: 'project-a', session: 'session-a', mime: 'video/mp4', createdAt: old,
    });
    const pinned = await store.registerGeneratedMediaFile({
      filePath: source, project: 'project-a', session: 'session-b', mime: 'video/mp4', createdAt: old, pinned: true,
    });

    expect(await store.sweepExpiredArtifacts(new Date('2026-08-01T00:00:00.000Z'), 30)).toEqual({ removedMetadata: 1, removedBytes: 0 });
    expect(readFileSync(store.resolveStoragePath(first.storageKey))).toEqual(Buffer.from('video'));
    await store.setPinned(pinned.id, 'project-a', false);
    expect(await store.sweepExpiredArtifacts(new Date('2026-08-01T00:00:00.000Z'), 30)).toEqual({ removedMetadata: 1, removedBytes: 1 });
  });

  it('registers only completed generated image parts using session project context', async () => {
    const source = join(root, '..', `tool-${crypto.randomUUID()}.png`);
    writeFileSync(source, Buffer.from('tool-image'));
    const registered = await registerGeneratedMediaPart({
      type: 'tool', tool: 'image_generation',
      state: { status: 'completed', metadata: { path: source } },
    }, { id: 'session-a', projectId: 'project-a' }, store);
    expect(registered?.project).toBe('project-a');
    expect((await registerGeneratedMediaPart({
      type: 'tool', tool: 'image_generation',
      state: { status: 'completed', metadata: { path: source } },
    }, { id: 'session-a', projectId: 'project-a' }, store))?.id).toBe(registered?.id);
    expect(db.prepare('SELECT count(*) AS count FROM media_artifacts').get()).toEqual({ count: 1 });
    expect(await registerGeneratedMediaPart({
      type: 'tool', tool: 'image_generation',
      state: { status: 'running', metadata: { path: source } },
    }, { id: 'session-a', projectId: 'project-a' }, store)).toBeNull();
  });

  it('adds a mobile-resolvable route while retaining local path metadata', async () => {
    const untouched = await registerGeneratedMediaPart(
      { type: 'tool', tool: 'read', state: { status: 'completed' } },
      { id: 'session-a', projectId: 'project-a' },
    );
    expect(untouched).toBeNull();
    const hosted = withHostedArtifactMetadata(
      { state: { status: 'completed', metadata: { path: '/local/image.png' } } },
      { id: 'artifact-a', project: 'project-a', session: 'session-a', mime: 'image/png', size: 1,
        checksum: 'a'.repeat(64), createdAt: '2026-08-01T00:00:00.000Z', storageKey: `aa/${'a'.repeat(64)}`, pinned: false },
    );
    expect(hosted).toMatchObject({ state: { metadata: {
      path: '/local/image.png', artifactId: 'artifact-a', artifactUrl: '/artifacts/artifact-a',
    } } });
  });

  it('enforces session owner and project binding when local ownership exists', async () => {
    db.prepare(`INSERT INTO users (id, name, email) VALUES (1, 'Owner', 'owner@example.test')`).run();
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES ('project-a', 'A', '/tmp/a', '2026-08-01T00:00:00.000Z')`).run();
    db.prepare(`
      INSERT INTO agent_sessions
        (id, agent_kind, status, cwd, name, project_id, owner_user_id, created_at, updated_at)
      VALUES ('owned-session', 'build', 'idle', '/tmp', 'owned', 'project-a', 1,
              '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
    `).run();
    const artifact = {
      id: 'artifact-owned', project: 'project-a', session: 'owned-session', mime: 'image/png', size: 1,
      checksum: 'a'.repeat(64), createdAt: '2026-08-01T00:00:00.000Z', storageKey: `aa/${'a'.repeat(64)}`, pinned: false,
    };
    expect(store.canUserAccessArtifact(artifact, 1)).toBe(true);
    expect(store.canUserAccessArtifact(artifact, 2)).toBe(false);
    expect(store.canUserAccessArtifact({ ...artifact, project: 'project-b' }, 1)).toBe(false);
  });
});

describe('HTTP byte range parsing', () => {
  it('supports bounded, open-ended, and suffix ranges', () => {
    expect(parseByteRange(undefined, 10)).toBeNull();
    expect(parseByteRange('bytes=1-3', 10)).toEqual({ start: 1, end: 3 });
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
  });

  it('rejects malformed, multi-part, and unsatisfiable ranges', () => {
    for (const range of ['items=0-1', 'bytes=1-2,4-5', 'bytes=20-30', 'bytes=4-2']) {
      expect(() => parseByteRange(range, 10)).toThrow(/range/i);
    }
  });
});
