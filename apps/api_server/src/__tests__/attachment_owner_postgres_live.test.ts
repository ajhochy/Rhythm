import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';

const liveTest = process.env.RHYTHM_A1_PG_TEST === '1' ? test : test.skip;

liveTest('A1 real Postgres denies another owner on artifact GET and PIN, and permits the owner', async () => {
  const port = Number(process.env.RHYTHM_A1_PG_PORT);
  const expectedDataDirectory = '/private/tmp/rhythm-a1-owner-pg-20261001';
  if (port !== 15483) throw new Error('The A1 isolated Postgres port 15483 is required');
  const pool = new Pool({
    host: '127.0.0.1', port, database: 'postgres', user: process.env.USER,
    max: 1, application_name: 'rhythm_a1_owner_live_test',
  });
  const root = mkdtempSync(join(tmpdir(), 'rhythm-a1-real-pg-artifacts-'));
  const filePath = join(root, 'fixture.png');
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(filePath, bytes);
  vi.stubEnv('DB_CLIENT', 'postgres');
  vi.stubEnv('ARTIFACT_STORAGE_ROOT', root);
  vi.resetModules();
  vi.doMock('../database/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../database/db')>()),
    getPostgresPool: () => pool,
  }));
  const schema = `rhythm_a1_owner_${process.pid}_${Date.now()}`;
  let createdSchema = false;

  try {
    const actualDataDirectory = (await pool.query('SHOW data_directory')).rows[0].data_directory;
    if (actualDataDirectory !== expectedDataDirectory) {
      throw new Error(`Refusing unexpected Postgres data directory: ${actualDataDirectory}`);
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    createdSchema = true;
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`CREATE TABLE agent_sessions (
      id text PRIMARY KEY, sdk_session_id text, owner_user_id integer, project_id text
    )`);
    await pool.query(`CREATE TABLE media_artifacts (
      id text PRIMARY KEY, project text NOT NULL, session text NOT NULL,
      mime text NOT NULL, size bigint NOT NULL, checksum text NOT NULL,
      created_at text NOT NULL, storage_key text NOT NULL, pinned boolean NOT NULL DEFAULT false,
      UNIQUE (project, session, checksum)
    )`);
    await pool.query(
      'INSERT INTO agent_sessions (id, sdk_session_id, owner_user_id, project_id) VALUES ($1,$2,$3,$4)',
      ['local-session-1', 'sdk-session-1', 7, 'project-1'],
    );
    const { MediaArtifactStore } = await import('../services/media_artifact_store');
    const { MediaArtifactsController } = await import('../controllers/media_artifacts_controller');
    const store = new MediaArtifactStore({ pool, root });
    const artifact = await store.registerGeneratedMediaFile({
      filePath, project: 'project-1', session: 'sdk-session-1', mime: 'image/png',
    });
    expect(artifact.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await store.canUserAccessArtifact(artifact, 8)).toBe(false);
    expect(await store.canUserAccessArtifact(artifact, 7)).toBe(true);

    const controller = new MediaArtifactsController();
    const makeReq = (userId: number, pinned = true) => ({
      params: { id: artifact.id }, body: { pinned }, auth: { user: { id: userId } },
      header: (name: string) => name.toLowerCase() === 'x-rhythm-project' ? 'project-1' : undefined,
    }) as unknown as Request;
    const deniedNext = vi.fn();
    const deniedRes = {
      set: vi.fn(), type: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn(),
    } as unknown as Response;
    await controller.serve(makeReq(8), deniedRes, deniedNext as NextFunction);
    expect(deniedNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(deniedRes.set).not.toHaveBeenCalled();
    deniedNext.mockClear();
    await controller.pin(makeReq(8), deniedRes, deniedNext as NextFunction);
    expect(deniedNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect((await pool.query('SELECT pinned FROM media_artifacts WHERE id = $1', [artifact.id])).rows[0].pinned).toBe(false);

    const ownerRes = new PassThrough() as PassThrough & Response;
    ownerRes.set = vi.fn().mockReturnValue(ownerRes);
    ownerRes.type = vi.fn().mockReturnValue(ownerRes);
    ownerRes.status = vi.fn().mockReturnValue(ownerRes);
    const received: Buffer[] = [];
    ownerRes.on('data', (chunk: Buffer) => received.push(chunk));
    const finished = once(ownerRes, 'finish');
    const ownerNext = vi.fn();
    await controller.serve(makeReq(7), ownerRes, ownerNext as NextFunction);
    await finished;
    expect(ownerNext).not.toHaveBeenCalled();
    expect(Buffer.concat(received)).toEqual(bytes);

    const pinRes = { json: vi.fn() } as unknown as Response;
    await controller.pin(makeReq(7), pinRes, ownerNext as NextFunction);
    expect(ownerNext).not.toHaveBeenCalled();
    expect(pinRes.json).toHaveBeenCalledWith({ id: artifact.id, pinned: true });
    expect((await pool.query('SELECT pinned FROM media_artifacts WHERE id = $1', [artifact.id])).rows[0].pinned).toBe(true);
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
    rmSync(root, { recursive: true, force: true });
    vi.doUnmock('../database/db');
    vi.unstubAllEnvs();
  }
});
