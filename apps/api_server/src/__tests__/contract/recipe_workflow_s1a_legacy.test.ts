/**
 * CONTRACT TEST for #1485 slice S1a — cookbook schema columns, legacy
 * classification, default-off flag.
 *
 * Recipes stay opaque legacy prompt rows through this slice; only additive,
 * nullable `schema_version` / `definition_json` columns and a derived
 * `format: 'legacy'` DTO field are introduced. No execution path changes.
 * See docs/ai/current-plan-recipes-1485.md "Persistence and compatibility".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

// ── Mocks for the byte-identical run-compilation criterion ────────────────
const { mockAgentRun } = vi.hoisted(() => ({ mockAgentRun: vi.fn() }));
vi.mock('../../services/agent_runner', () => ({
  run: mockAgentRun,
  _activeRunCount: () => 0,
}));
vi.mock('../../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    promptAsync: vi.fn().mockResolvedValue(true),
    abortSession: vi.fn().mockResolvedValue(true),
    listMessages: vi.fn().mockResolvedValue([]),
    reloadConfig: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('#1485 S1a — agent_cookbook columns are additive, nullable and idempotent', () => {
  it('recipe_workflow_s1a:1 — post-migration rows have NULL schema_version/definition_json and byte-identical steps_json', async () => {
    const db = makeDb();
    const { runMigrations } = await import('../../database/migrations');
    runMigrations(db);

    const stepsJson = JSON.stringify([{ action: 'prompt', text: 'Do the thing' }]);
    db.prepare(
      `INSERT INTO agent_cookbook (id, title, description, steps_json, created_at, updated_at)
       VALUES ('legacy-1', 'Legacy recipe', 'desc', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run(stepsJson);

    const row = db
      .prepare(`SELECT * FROM agent_cookbook WHERE id = 'legacy-1'`)
      .get() as Record<string, unknown>;
    expect(row.schema_version).toBeNull();
    expect(row.definition_json).toBeNull();
    expect(row.steps_json).toBe(stepsJson);
  });

  it('recipe_workflow_s1a:2 — running the migration twice is idempotent (no error, no column duplication, no data loss)', async () => {
    const db = makeDb();
    const { runMigrations } = await import('../../database/migrations');
    runMigrations(db);
    db.prepare(
      `INSERT INTO agent_cookbook (id, title, steps_json, created_at, updated_at)
       VALUES ('legacy-2', 'Second recipe', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    expect(() => runMigrations(db)).not.toThrow();

    const cols = (db.pragma('table_info(agent_cookbook)') as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === 'schema_version')).toHaveLength(1);
    expect(cols.filter((c) => c === 'definition_json')).toHaveLength(1);
    const row = db.prepare(`SELECT * FROM agent_cookbook WHERE id = 'legacy-2'`).get() as Record<
      string,
      unknown
    >;
    expect(row.title).toBe('Second recipe');
    expect(row.schema_version).toBeNull();
    expect(row.definition_json).toBeNull();
  });
});

describe('#1485 S1a — DTO gains derived format, existing fields unchanged', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAgentRun.mockResolvedValue({ sessionId: 'sdk-session-run-1', result: 'Done', status: 'done' });

    const db = makeDb();
    const { runMigrations } = await import('../../database/migrations');
    runMigrations(db);
    const { setDb } = await import('../../database/db');
    setDb(db);

    const { UsersRepository } = await import('../../repositories/users_repository');
    const { SessionsRepository } = await import('../../repositories/sessions_repository');
    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Chef', email: 'chef-s1a@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    const { createApp } = await import('../../app');
    const { startTestServer } = await import('../helpers/real_server');
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('recipe_workflow_s1a:3 — GET and list DTOs carry format:"legacy" and never explicit_upgrade_required; existing fields unchanged', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Weekly summary',
        description: 'Summarise the week',
        steps: [{ action: 'prompt', text: 'Summarise tasks' }],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.format).toBe('legacy');
    expect(created).not.toHaveProperty('explicit_upgrade_required');
    // Existing fields are unchanged.
    expect(typeof created.id).toBe('string');
    expect(created.title).toBe('Weekly summary');
    expect(created.description).toBe('Summarise the week');
    expect(typeof created.stepsJson).toBe('string');
    expect(typeof created.createdAt).toBe('string');
    expect(typeof created.updatedAt).toBe('string');

    const getRes = await fetch(`${baseUrl}/agent-cookbook/${created.id}`, { headers: authHeader });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as Record<string, unknown>;
    expect(fetched.format).toBe('legacy');
    expect(fetched).not.toHaveProperty('explicit_upgrade_required');

    const listRes = await fetch(`${baseUrl}/agent-cookbook`, { headers: authHeader });
    const list = (await listRes.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0].format).toBe('legacy');
    expect(list[0]).not.toHaveProperty('explicit_upgrade_required');
  });

  it('recipe_workflow_s1a:4 — POST /agent-cookbook/:id/run on a legacy row compiles a byte-identical prompt', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Multi-step recipe',
        description: 'Process the backlog',
        steps: ['Step A', 'Step B', 'Step C'],
      }),
    });
    const recipe = (await createRes.json()) as { id: string };

    const runRes = await fetch(`${baseUrl}/agent-cookbook/${recipe.id}/run`, {
      method: 'POST',
      headers: authHeader,
    });
    expect(runRes.status).toBe(202);

    const callArgs = mockAgentRun.mock.calls[0][0] as { prompt: string };
    // Pre-change fixture: the exact prompt agentCookbookController._compileStepsToPrompt
    // produced before S1a (description line + "N. text" per step, blank-line joined).
    expect(callArgs.prompt).toBe(
      'Goal: Process the backlog\n\n1. Step A\n2. Step B\n3. Step C',
    );
  });
});

describe('#1485 S1a — env.recipeWorkflowsEnabled defaults off', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('recipe_workflow_s1a:5 — false when unset', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', '');
    delete process.env.RHYTHM_RECIPE_WORKFLOWS_ENABLED;
    const { env } = await import('../../config/env');
    expect(env.recipeWorkflowsEnabled).toBe(false);
  });

  it.each(['false', 'TRUE', '1', 'yes', ' true'])(
    'recipe_workflow_s1a:5 — false for %j (only exact "true" enables it)',
    async (value) => {
      vi.resetModules();
      vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', value);
      const { env } = await import('../../config/env');
      expect(env.recipeWorkflowsEnabled).toBe(false);
    },
  );

  it('recipe_workflow_s1a:5 — true only for the exact literal "true"', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', 'true');
    const { env } = await import('../../config/env');
    expect(env.recipeWorkflowsEnabled).toBe(true);
  });
});

// ── Postgres source-contract check ─────────────────────────────────────────
// Full live-engine parity is covered separately (env-gated PG16 case,
// RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1) — see postgres_bootstrap_live.test.ts for
// the harness this mirrors. Not runnable in this sandbox (no Postgres, no
// production network); this source-contract test is the deterministic proof
// that ships with this slice.
describe('#1485 S1a — postgres_bootstrap adds the same nullable columns', () => {
  it('recipe_workflow_s1a:6 — ADD COLUMN IF NOT EXISTS for both columns, inside the agent-execution-gated block', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );
    const gateIndex = source.indexOf('if (!env.agentExecutionEnabled)');
    const cookbookIndex = source.indexOf('CREATE TABLE IF NOT EXISTS agent_cookbook');
    const schemaVersionIndex = source.indexOf(
      'ALTER TABLE agent_cookbook ADD COLUMN IF NOT EXISTS schema_version INTEGER',
    );
    const definitionJsonIndex = source.indexOf(
      'ALTER TABLE agent_cookbook ADD COLUMN IF NOT EXISTS definition_json TEXT',
    );
    expect(gateIndex).toBeGreaterThan(-1);
    expect(cookbookIndex).toBeGreaterThan(gateIndex);
    expect(schemaVersionIndex).toBeGreaterThan(cookbookIndex);
    expect(definitionJsonIndex).toBeGreaterThan(cookbookIndex);
  });

  const liveDescribe =
    process.env.RHYTHM_LIVE_POSTGRES_BOOTSTRAP === '1' ? describe : describe.skip;

  liveDescribe('live PG16 parity (RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1)', () => {
    it('recipe_workflow_s1a:6-live — columns exist and are nullable after bootstrap', async () => {
      const connectionString = process.env.RHYTHM_LIVE_POSTGRES_URL;
      if (!connectionString) {
        throw new Error('RHYTHM_LIVE_POSTGRES_URL is required when RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1');
      }
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString });
      try {
        vi.stubEnv('RHYTHM_ROLE', 'all');
        const { runPostgresBootstrap } = await import('../../database/postgres_bootstrap');
        await runPostgresBootstrap(pool);
        const result = await pool.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
           WHERE table_name = 'agent_cookbook' AND column_name IN ('schema_version','definition_json')`,
        );
        expect(result.rows).toHaveLength(2);
        for (const row of result.rows) {
          expect(row.is_nullable).toBe('YES');
        }
      } finally {
        await pool.end();
        vi.unstubAllEnvs();
      }
    });
  });
});
