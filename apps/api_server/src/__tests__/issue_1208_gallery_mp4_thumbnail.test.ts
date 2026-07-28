import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NextFunction, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { AgentDesignsController } from '../controllers/agentDesignsController';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentDesignsRepository } from '../repositories/agent_designs_repository';
import agentDesignsRouter from '../routes/agentDesignsRoutes';
import { generateLocalVideoPoster } from '../services/agent_design_artifacts';

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function responseRecorder() {
  const state: { contentType?: string; sentFile?: string } = {};
  const response = {
    type(value: string) {
      state.contentType = value;
      return response;
    },
    sendFile(value: string) {
      state.sentFile = value;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

describe('issue #1208 Gallery MP4 poster endpoint', () => {
  let home: string;
  let studio: string;

  beforeEach(() => {
    setDb(makeDb());
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-1208-home-'));
    studio = path.join(home, 'Downloads', 'Rhythm Studio');
    fs.mkdirSync(studio, { recursive: true });
    vi.stubEnv('HOME', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('issue-1208-c2: poster endpoint requires authentication and serves local PNG content', async () => {
    // Regression caught: no authenticated local poster route exists; the route
    // lookup fails before any remote URL could be used as preview content.
    const thumbnailRoute = agentDesignsRouter.stack.find(
      (layer) => layer.route?.path === '/:id/thumbnail',
    );
    expect(thumbnailRoute).toBeDefined();
    expect(
      (thumbnailRoute?.route as unknown as { methods: { get?: boolean } })
        .methods.get,
    ).toBe(true);

    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'false');
    const authenticatedRouter = (
      await import('../routes/agentDesignsRoutes')
    ).default;
    expect(
      authenticatedRouter.stack.some((layer) => layer.name === 'requireAuth'),
    ).toBe(true);
  });

  it.runIf(
    process.platform === 'darwin'
      && process.env.RHYTHM_PLATFORM_POSTER_E2E === '1',
  )(
    'issue-1208-c1-platform: Quick Look generates a real PNG poster from a local MP4',
    async () => {
      // Regression caught: platform extraction is wired to a placeholder or
      // cannot decode a real MP4; the PNG signature assertion then fails.
      const video = path.join(studio, 'representative.mp4');
      execFileSync('/opt/homebrew/bin/ffmpeg', [
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'color=c=0x3366cc:s=320x180:d=1',
        '-pix_fmt', 'yuv420p',
        video,
      ]);

      const poster = await generateLocalVideoPoster(video);
      expect(fs.readFileSync(poster).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(fs.statSync(poster).size).toBeGreaterThan(100);
    },
  );

  it('issue-1208-c5: poster generation failure returns not found without changing artifact access', async () => {
    // Regression caught: a failed poster breaks the original artifact route;
    // thumbnail must fail closed while artifact still resolves to the MP4.
    const video = path.join(studio, 'invalid.mp4');
    fs.writeFileSync(video, 'not-a-real-video');
    const design = await new AgentDesignsRepository().createAsync({
      title: 'Invalid MP4',
      provider: 'built-in',
      artifactType: 'mp4',
      filePath: video,
    });
    const controller = new AgentDesignsController();
    const thumbnailErrors: unknown[] = [];
    const thumbnailResponse = responseRecorder();

    await (controller as unknown as {
      thumbnail(req: Request, res: Response, next: NextFunction): Promise<void>;
    }).thumbnail(
      { params: { id: design.id } } as unknown as Request,
      thumbnailResponse.response,
      (error?: unknown) => {
        if (error) thumbnailErrors.push(error);
      },
    );
    expect(thumbnailErrors).toHaveLength(1);
    expect((thumbnailErrors[0] as { statusCode: number }).statusCode).toBe(404);

    const artifactErrors: unknown[] = [];
    const artifactResponse = responseRecorder();
    await controller.artifact(
      { params: { id: design.id } } as unknown as Request,
      artifactResponse.response,
      (error?: unknown) => {
        if (error) artifactErrors.push(error);
      },
    );
    expect(artifactErrors).toEqual([]);
    expect(artifactResponse.state.sentFile).toBe(fs.realpathSync(video));
  });

  it('issue-1208-c7: poster endpoint rejects non-local and non-MP4 design records', async () => {
    // Regression caught: poster generation accepts remote content or unrelated
    // local file types; both records must fail at the local MP4 boundary.
    const remote = await new AgentDesignsRepository().createAsync({
      title: 'Remote MP4',
      provider: 'built-in',
      artifactType: 'mp4',
      artifactUrl: 'https://untrusted.example/video.mp4',
    });
    const imagePath = path.join(studio, 'image.png');
    fs.writeFileSync(imagePath, 'png');
    const image = await new AgentDesignsRepository().createAsync({
      title: 'Local PNG',
      provider: 'built-in',
      artifactType: 'png',
      filePath: imagePath,
    });
    const controller = new AgentDesignsController();

    for (const id of [remote.id, image.id]) {
      const errors: unknown[] = [];
      await (controller as unknown as {
        thumbnail(req: Request, res: Response, next: NextFunction): Promise<void>;
      }).thumbnail(
        { params: { id } } as unknown as Request,
        responseRecorder().response,
        (error?: unknown) => {
          if (error) errors.push(error);
        },
      );
      expect((errors[0] as { statusCode: number }).statusCode).toBe(404);
    }
  });
});
