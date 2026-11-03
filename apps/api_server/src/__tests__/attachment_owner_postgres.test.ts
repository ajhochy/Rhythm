import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import Database from 'better-sqlite3';

const roots: string[] = [];
const artifact = {
  id: 'asset-1', project: 'project-1', session: 'session-1', mime: 'image/png', size: 1,
  checksum: 'a'.repeat(64), createdAt: '2026-10-01T00:00:00.000Z', storageKey: `aa/${'a'.repeat(64)}`, pinned: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('A1 Postgres artifact owner lookup denies another user while retaining owner and unowned session access', async () => {
  vi.stubEnv('DB_CLIENT', 'postgres');
  vi.resetModules();
  const { MediaArtifactStore } = await import('../services/media_artifact_store');
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-a1-pg-owner-'));
  roots.push(root);
  const query = vi.fn(async (_sql: string, _params: unknown[]): Promise<{ rows: Array<{ owner_user_id: number | null; project_id: string | null }> }> => ({ rows: [{ owner_user_id: 7, project_id: 'project-1' }] }));
  const store = new MediaArtifactStore({ pool: { query } as unknown as Pool, root });

  expect(await store.canUserAccessArtifact(artifact, 8)).toBe(false);
  expect(await store.canUserAccessArtifact(artifact, 7)).toBe(true);
  expect(await store.canUserAccessArtifact({ ...artifact, project: 'project-2' }, 7)).toBe(false);
  query.mockResolvedValueOnce({ rows: [{ owner_user_id: null, project_id: 'project-1' }] });
  expect(await store.canUserAccessArtifact(artifact, 8)).toBe(true);
  query.mockResolvedValueOnce({ rows: [] });
  expect(await store.canUserAccessArtifact(artifact, 8)).toBe(true);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('agent_sessions'), ['session-1']);
});

test('A1 artifact GET and PIN wait for a denied owner check before serving bytes or mutating pin', async () => {
  // The store's Postgres branch is exercised above. A local DB handle lets this
  // route test isolate the async owner-check boundary without a PG daemon.
  vi.stubEnv('DB_CLIENT', 'sqlite');
  vi.resetModules();
  const { setDb } = await import('../database/db');
  const db = new Database(':memory:');
  setDb(db);
  const { MediaArtifactStore } = await import('../services/media_artifact_store');
  const { MediaArtifactsController } = await import('../controllers/media_artifacts_controller');
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-a1-pg-route-'));
  roots.push(root);
  vi.stubEnv('ARTIFACT_STORAGE_ROOT', root);
  vi.spyOn(MediaArtifactStore.prototype, 'findProjectArtifact').mockResolvedValue(artifact);
  vi.spyOn(MediaArtifactStore.prototype, 'canUserAccessArtifact').mockImplementation(async () => false as never);
  const createByteStream = vi.spyOn(MediaArtifactStore.prototype, 'createByteStream');
  const setPinned = vi.spyOn(MediaArtifactStore.prototype, 'setPinned');
  const next = vi.fn();
  const req = {
    params: { id: artifact.id }, body: { pinned: true }, auth: { user: { id: 8 } },
    header: (name: string) => name.toLowerCase() === 'x-rhythm-project' ? artifact.project : undefined,
  } as unknown as Request;
  const res = { set: vi.fn(), type: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() } as unknown as Response;
  const controller = new MediaArtifactsController();

  await controller.serve(req, res, next as NextFunction);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  expect(createByteStream).not.toHaveBeenCalled();
  next.mockClear();
  await controller.pin(req, res, next as NextFunction);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  expect(setPinned).not.toHaveBeenCalled();
  db.close();
});
