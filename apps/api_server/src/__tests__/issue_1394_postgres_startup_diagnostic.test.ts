import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { runPostgresBootstrap } from '../database/postgres_bootstrap';

const builtServer = path.join(process.cwd(), 'dist', 'server.js');
const liveDescribe = process.env.RHYTHM_LIVE_POSTGRES_DIAGNOSTIC === '1'
  ? describe
  : describe.skip;

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000)),
  ]);
}

liveDescribe('#1394 — Postgres startup missing-content diagnostic', () => {
  it.skipIf(!existsSync(builtServer))(
    'reports missing current bundle/state content without blocking health or leaking secrets',
    async () => {
      // Regression caught: production Postgres metadata can outlive artifact bytes;
      // this assertion fails if the real built server starts silently or leaks internals.
      const connectionString = process.env.RHYTHM_LIVE_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          'RHYTHM_LIVE_POSTGRES_URL is required when RHYTHM_LIVE_POSTGRES_DIAGNOSTIC=1',
        );
      }

      const url = new URL(connectionString);
      const schema = `rhythm_1394_${randomUUID().replaceAll('-', '_')}`;
      const artifactId = `artifact-missing-${randomUUID()}`;
      const root = await mkdtemp(path.join(tmpdir(), 'rhythm-1394-postgres-'));
      const storageDir = path.join(root, 'live-artifacts');
      const adminPool = new Pool({ connectionString, max: 1 });
      const scopedPool = new Pool({
        connectionString,
        max: 1,
        options: `-c search_path=${schema}`,
      });
      let child: ChildProcess | undefined;
      let output = '';

      try {
        await adminPool.query(`CREATE SCHEMA "${schema}"`);
        await runPostgresBootstrap(scopedPool);
        const user = await scopedPool.query<{ id: number }>(
          'INSERT INTO users (name,email) VALUES ($1,$2) RETURNING id',
          ['#1394 fixture', `${artifactId}@example.invalid`],
        );
        const userId = user.rows[0]!.id;
        const workspace = await scopedPool.query<{ id: number }>(
          'INSERT INTO workspaces (name,join_code,created_by) VALUES ($1,$2,$3) RETURNING id',
          ['#1394 fixture', `join-${randomUUID()}`, userId],
        );
        await scopedPool.query(
          `INSERT INTO live_artifacts
             (id,type,title,owner_user_id,workspace_id,visibility,
              current_bundle_revision,current_bundle_hash,
              current_state_revision,current_state_hash,updated_by_user_id)
           VALUES ($1,'html',$2,$3,$4,'private',1,$5,1,$6,$3)`,
          [artifactId, '#1394 missing content', userId, workspace.rows[0]!.id, 'a'.repeat(64), 'b'.repeat(64)],
        );

        child = spawn(process.execPath, [builtServer], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AGENT_LOCAL: 'false',
            API_BIND_HOST: '127.0.0.1',
            DB_CLIENT: 'postgres',
            DB_HOST: url.hostname,
            DB_PORT: url.port || '5432',
            DB_NAME: url.pathname.slice(1),
            DB_USER: decodeURIComponent(url.username),
            DB_PASSWORD: decodeURIComponent(url.password),
            DB_SSL: 'false',
            PGOPTIONS: `-c search_path=${schema}`,
            HOME: root,
            LIVE_ARTIFACT_STORAGE_DIR: storageDir,
            PORT: '4994',
            RHYTHM_MOBILE_GATEWAY_PORT: '4996',
            RHYTHM_OPENCODE_ENGINE_PORT: '4995',
            RHYTHM_ROLE: 'cloud',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

        const deadline = Date.now() + 15_000;
        let health: Response | undefined;
        while (Date.now() < deadline) {
          if (child.exitCode !== null || child.signalCode !== null) break;
          try {
            health = await fetch('http://127.0.0.1:4994/health');
            if (health.ok) break;
          } catch {
            // Server has not reached listen yet.
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(health?.status).toBe(200);
        const diagnostic = `[server] LIVE_ARTIFACT_CONTENT_MISSING count=2 artifacts=${artifactId}:bundle,${artifactId}:state`;
        expect(output).toContain(diagnostic);
        expect(output).not.toContain(connectionString);
        expect(output).not.toContain(decodeURIComponent(url.password));
        expect(output).not.toContain(storageDir);
        console.info(`#1394 postgres startup: health=200; ${diagnostic}`);
      } finally {
        if (child) await stopChild(child);
        await scopedPool.end().catch(() => undefined);
        await adminPool
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .finally(() => adminPool.end())
          .catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
