import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

const liveDescribe =
  process.env.RHYTHM_LIVE_POSTGRES_BOOTSTRAP === '1' ? describe : describe.skip;

liveDescribe('Postgres bootstrap live contract', () => {
  it(
    'boots without a projects relation and stores project_id as a logical identifier',
    async () => {
      const connectionString = process.env.RHYTHM_LIVE_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          'RHYTHM_LIVE_POSTGRES_URL is required when RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1',
        );
      }
      expect(env.agentExecutionEnabled).toBe(true);

      const schema = `rhythm_bootstrap_${randomUUID().replaceAll('-', '_')}`;
      const adminPool = new Pool({ connectionString, max: 1 });
      const scopedPool = new Pool({
        connectionString,
        max: 1,
        options: `-c search_path=${schema}`,
      });

      try {
        await adminPool.query(`CREATE SCHEMA "${schema}"`);

        await runPostgresBootstrap(scopedPool);
        await runPostgresBootstrap(scopedPool);

        const projectsRelation = await scopedPool.query<{ relation: string | null }>(
          `SELECT to_regclass('projects')::text AS relation`,
        );
        expect(projectsRelation.rows[0]?.relation).toBeNull();

        const projectColumn = await scopedPool.query<{ is_nullable: string }>(
          `SELECT is_nullable
             FROM information_schema.columns
            WHERE table_schema = $1
              AND table_name = 'agent_sessions'
              AND column_name = 'project_id'`,
          [schema],
        );
        expect(projectColumn.rows).toEqual([{ is_nullable: 'YES' }]);

        const projectForeignKeys = await scopedPool.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
             FROM pg_constraint AS constraint_row
             JOIN pg_class AS table_row
               ON table_row.oid = constraint_row.conrelid
             JOIN pg_namespace AS namespace_row
               ON namespace_row.oid = table_row.relnamespace
            WHERE constraint_row.contype = 'f'
              AND namespace_row.nspname = $1
              AND table_row.relname = 'agent_sessions'
              AND pg_get_constraintdef(constraint_row.oid) ILIKE '%project_id%'`,
          [schema],
        );
        expect(projectForeignKeys.rows).toEqual([]);

        const projectId = `project-${randomUUID()}`;
        await scopedPool.query(
          `INSERT INTO agent_sessions
             (id, agent_kind, status, cwd, name, project_id)
           VALUES ($1, 'opencode', 'starting', '/tmp', 'Live bootstrap', $2)`,
          [`session-${randomUUID()}`, projectId],
        );
        const storedSession = await scopedPool.query<{ project_id: string }>(
          `SELECT project_id
             FROM agent_sessions
            WHERE project_id = $1`,
          [projectId],
        );
        expect(storedSession.rows).toEqual([{ project_id: projectId }]);
      } finally {
        await scopedPool.end();
        await adminPool
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .finally(() => adminPool.end());
      }
    },
    60_000,
  );
});
