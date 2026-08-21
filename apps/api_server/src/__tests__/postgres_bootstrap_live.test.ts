import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

const liveDescribe =
  process.env.RHYTHM_LIVE_POSTGRES_BOOTSTRAP === '1' ? describe : describe.skip;

type BootstrapRole = 'default' | 'all' | 'local' | 'cloud' | 'relay';

const agentSessionColumns = [
  'id',
  'task_id',
  'agent_kind',
  'profile_id',
  'status',
  'session_token',
  'cwd',
  'name',
  'last_preview',
  'last_activity_at',
  'created_at',
  'updated_at',
  'scheduled_task_id',
  'parent_session_id',
  'is_system',
  'owner_user_id',
  'delegation_depth',
  'status_message',
  'task_title',
  'sdk_session_id',
  'mcp_allowed_tools_json',
  'anthropic_account_id',
  'worktree_name',
  'worktree_path',
  'worktree_branch',
  'project_id',
  'mcp_role',
  'category',
] as const;

const agentSessionIndexes = [
  'agent_sessions_pkey',
  'idx_agent_sessions_category',
  'idx_agent_sessions_is_system',
  'idx_agent_sessions_owner_activity',
] as const;

async function withFreshSchema(
  role: BootstrapRole,
  assertion: (context: {
    pool: Pool;
    runBootstrap: () => Promise<void>;
    schema: string;
  }) => Promise<void>,
): Promise<void> {
  const connectionString = process.env.RHYTHM_LIVE_POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      'RHYTHM_LIVE_POSTGRES_URL is required when RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1',
    );
  }

  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', role === 'default' ? '' : role);
  const { env } = await import('../config/env');
  const { runPostgresBootstrap } = await import('../database/postgres_bootstrap');
  expect(env.role).toBe(role === 'default' ? 'all' : role);
  expect(env.agentExecutionEnabled).toBe(
    role === 'default' || role === 'all' || role === 'local',
  );

  const schema = `rhythm_bootstrap_${randomUUID().replaceAll('-', '_')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({
    connectionString,
    max: 1,
    options: `-c search_path=${schema}`,
  });

  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await assertion({
      pool,
      schema,
      runBootstrap: () => runPostgresBootstrap(pool),
    });
  } finally {
    await pool.end();
    await adminPool
      .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .finally(() => adminPool.end());
  }
}

async function expectCompleteAgentSessionsSchema(
  pool: Pool,
  schema: string,
): Promise<void> {
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'agent_sessions'
      ORDER BY column_name`,
    [schema],
  );
  expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
    [...agentSessionColumns].sort(),
  );

  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'agent_sessions'
      ORDER BY indexname`,
    [schema],
  );
  expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
    [...agentSessionIndexes].sort(),
  );

  const qaForeignKey = await pool.query<{
    referenced_column: string;
    referenced_table: string;
    source_column: string;
  }>(
    `SELECT source_attribute.attname AS source_column,
            referenced_table.relname AS referenced_table,
            referenced_attribute.attname AS referenced_column
       FROM pg_constraint AS constraint_row
       JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
       JOIN pg_namespace AS namespace_row ON namespace_row.oid = source_table.relnamespace
       JOIN pg_class AS referenced_table ON referenced_table.oid = constraint_row.confrelid
       JOIN pg_attribute AS source_attribute
         ON source_attribute.attrelid = source_table.oid
        AND source_attribute.attnum = constraint_row.conkey[1]
       JOIN pg_attribute AS referenced_attribute
         ON referenced_attribute.attrelid = referenced_table.oid
        AND referenced_attribute.attnum = constraint_row.confkey[1]
      WHERE constraint_row.contype = 'f'
        AND namespace_row.nspname = $1
        AND source_table.relname = 'agent_research_qa_links'
        AND source_attribute.attname = 'agent_session_id'`,
    [schema],
  );
  expect(qaForeignKey.rows).toEqual([
    {
      referenced_column: 'id',
      referenced_table: 'agent_sessions',
      source_column: 'agent_session_id',
    },
  ]);
}

async function expectProductionTablesOnly(pool: Pool): Promise<void> {
  const relations = await pool.query<{ relation: string | null }>(
    `SELECT to_regclass('agent_sessions')::text AS agent_sessions,
            to_regclass('agent_scheduled_tasks')::text AS agent_scheduled_tasks,
            to_regclass('pending_claude_triggers')::text AS pending_claude_triggers`,
  );
  expect(relations.rows).toEqual([
    {
      agent_scheduled_tasks: 'agent_scheduled_tasks',
      agent_sessions: null,
      pending_claude_triggers: 'pending_claude_triggers',
    },
  ]);
}

liveDescribe('Postgres bootstrap live contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each<BootstrapRole>(['default', 'all', 'local'])(
    'fresh %s role bootstraps twice with the complete agent_sessions schema',
    async (role) => {
      // Regression: the QA-link FK must not run before agent_sessions exists.
      await withFreshSchema(role, async ({ pool, runBootstrap, schema }) => {
        await runBootstrap();
        await runBootstrap();
        await expectCompleteAgentSessionsSchema(pool, schema);
      });
    },
    60_000,
  );

  it.each<BootstrapRole>(['cloud', 'relay'])(
    'fresh %s role skips agent_sessions but retains production scheduler tables',
    async (role) => {
      await withFreshSchema(role, async ({ pool, runBootstrap }) => {
        await runBootstrap();
        await runBootstrap();
        await expectProductionTablesOnly(pool);
      });
    },
    60_000,
  );

  it(
    'preserves a populated agent_sessions row and values on the second bootstrap',
    async () => {
      await withFreshSchema('all', async ({ pool, runBootstrap }) => {
        await runBootstrap();
        const sessionId = `session-${randomUUID()}`;
        await pool.query(
          `INSERT INTO agent_sessions
             (id, agent_kind, profile_id, status, session_token, cwd, name,
              last_preview, last_activity_at, is_system, delegation_depth,
              status_message, task_title, sdk_session_id, mcp_allowed_tools_json,
              anthropic_account_id, worktree_name, worktree_path, worktree_branch,
              project_id, mcp_role, category)
           VALUES
             ($1, 'opencode', 'research', 'running', 'sentinel-token', '/sentinel',
              'Sentinel session', 'sentinel preview', '2026-08-20T12:00:00.000Z',
              1, 2, 'sentinel status', 'Sentinel task', 'sdk-sentinel', '["read"]',
              'account-sentinel', 'sentinel-tree', '/sentinel/tree', 'sentinel-branch',
              'project-sentinel', 'research', 'self_improvement')`,
          [sessionId],
        );

        const before = await pool.query(
          `SELECT * FROM agent_sessions WHERE id = $1`,
          [sessionId],
        );
        await runBootstrap();
        const after = await pool.query(
          `SELECT * FROM agent_sessions WHERE id = $1`,
          [sessionId],
        );
        expect(after.rows).toEqual(before.rows);
      });
    },
    60_000,
  );

  it(
    'a third bootstrap leaves agent_sessions data and schema unchanged',
    async () => {
      await withFreshSchema('local', async ({ pool, runBootstrap, schema }) => {
        await runBootstrap();
        await pool.query(
          `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, category)
           VALUES ('third-run-sentinel', 'opencode', 'running', '/tmp', 'Third run', 'chat')`,
        );
        await runBootstrap();
        const before = await pool.query(
          `SELECT row_to_json(session_row) AS row
             FROM agent_sessions AS session_row
            WHERE id = 'third-run-sentinel'`,
        );
        await expectCompleteAgentSessionsSchema(pool, schema);

        await runBootstrap();
        const after = await pool.query(
          `SELECT row_to_json(session_row) AS row
             FROM agent_sessions AS session_row
            WHERE id = 'third-run-sentinel'`,
        );
        expect(after.rows).toEqual(before.rows);
        await expectCompleteAgentSessionsSchema(pool, schema);
      });
    },
    60_000,
  );
});
