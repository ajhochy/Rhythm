import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { env } from '../../config/env';
import { AgentResearchController } from '../../controllers/agentResearchController';
import { HealthController } from '../../controllers/health_controller';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { UsersRepository } from '../../repositories/users_repository';

type SqliteColumn = { name: string };
type SqliteForeignKey = { table: string; from: string; to: string };

const FOUNDATION_TABLES = [
  'agent_research_projects',
  'agent_research_project_runs',
  'agent_research_artifacts',
  'agent_research_curated_sources',
  'agent_research_qa_links',
  'agent_research_pass_relationships',
] as const;

const JOB_FOUNDATION_COLUMNS = [
  'project_id',
  'project_run_id',
  'pass_role',
  'pass_ordinal',
  'run_config_json',
  'progress_json',
  'classification_json',
] as const;

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

function insertResearchJob(
  db: Database.Database,
  ownerUserId: number | null,
  status = 'error',
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_research_jobs
       (id, query, status, sources_json, report, error, research_type, title,
        agent_profile_id, origin, requested_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, '[]', NULL, 'fixture failure', 'generic', ?, 'research',
             'page', ?, ?, ?)`,
  ).run(id, `query ${id}`, status, `title ${id}`, ownerUserId, now, now);
  return id;
}

function authenticatedUsers(db: Database.Database) {
  setDb(db);
  const users = new UsersRepository();
  const owner = users.create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const stranger = users.create({ name: 'Stranger', email: `${randomUUID()}@example.com` });
  return { owner, stranger };
}

type ControllerResult = {
  status: number;
  body: unknown;
  ended: boolean;
  error: unknown;
};

async function callController(
  method: 'list' | 'get' | 'retry' | 'remove' | 'updateStatus',
  options: {
    userId?: number;
    id?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<ControllerResult> {
  const result: ControllerResult = {
    status: 200,
    body: undefined,
    ended: false,
    error: undefined,
  };
  const response = {
    status(status: number) {
      result.status = status;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
    end() {
      result.ended = true;
      return this;
    },
  } as unknown as Response;
  const request = {
    params: { id: options.id ?? '' },
    body: options.body ?? {},
    auth:
      options.userId === undefined
        ? undefined
        : { user: { id: options.userId } },
  } as unknown as Request;
  const next: NextFunction = (error?: unknown) => {
    result.error = error;
  };
  await new AgentResearchController()[method](request, response, next);
  return result;
}

function expectNotFound(result: ControllerResult): void {
  expect(result.error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
}

describe('issue #1288 acceptance contract', () => {
  it('issue-1288-c1: flag-off behavior is regression-tested', async () => {
    // Regression caught: an unset flag accidentally enables project behavior or
    // removes the legacy research list route. The boolean/default and HTTP
    // assertions below fail respectively for those regressions.
    expect(
      (env as typeof env & { researchProjectsEnabled?: boolean })
        .researchProjectsEnabled,
    ).toBe(false);

    let diagnostics: unknown;
    await new HealthController().getHealth(
      { header: () => undefined } as unknown as Request,
      { json: (body: unknown) => { diagnostics = body; } } as unknown as Response,
    );
    expect(diagnostics).toMatchObject({
      features: { researchProjectsEnabled: false },
    });

    const db = migratedDb();
    const { owner } = authenticatedUsers(db);
    const response = await callController('list', { userId: owner.id });
    expect(response.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('issue-1288-c2: SQLite and Postgres schemas, indexes, and foreign keys are equivalent', () => {
    // Regression caught: a foundation table/relationship ships in SQLite but
    // not hosted Postgres (or vice versa). The schema/index/FK assertions fail.
    const db = migratedDb();
    const sqliteTables = new Set(
      (db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map((row) => row.name),
    );
    const postgresBootstrap = readFileSync(
      path.resolve(__dirname, '../../database/postgres_bootstrap.ts'),
      'utf8',
    );

    for (const table of FOUNDATION_TABLES) {
      expect(sqliteTables, `SQLite is missing ${table}`).toContain(table);
      expect(postgresBootstrap, `Postgres is missing ${table}`).toContain(
        `CREATE TABLE IF NOT EXISTS ${table}`,
      );
      const indexes = db
        .prepare(`PRAGMA index_list('${table}')`)
        .all() as Array<{ name: string }>;
      expect(indexes.length, `${table} needs a query-supporting index`).toBeGreaterThan(0);
      expect(postgresBootstrap).toMatch(
        new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^\\n]+[\\s\\S]{0,180}ON ${table}\\b`),
      );
    }

    const jobColumns = new Set(
      (db.pragma('table_info(agent_research_jobs)') as SqliteColumn[]).map(
        (column) => column.name,
      ),
    );
    for (const column of JOB_FOUNDATION_COLUMNS) {
      expect(jobColumns, `SQLite job schema is missing ${column}`).toContain(column);
      expect(postgresBootstrap, `Postgres job schema is missing ${column}`).toContain(column);
    }

    const requiredForeignKeys: Record<string, string[]> = {
      agent_research_project_runs: ['agent_research_projects'],
      agent_research_artifacts: ['agent_research_projects', 'agent_research_project_runs'],
      agent_research_curated_sources: ['agent_research_projects'],
      agent_research_qa_links: ['agent_research_projects'],
      agent_research_pass_relationships: ['agent_research_jobs'],
    };
    for (const [table, referencedTables] of Object.entries(requiredForeignKeys)) {
      const sqliteReferences = new Set(
        (db.pragma(`foreign_key_list('${table}')`) as SqliteForeignKey[]).map(
          (foreignKey) => foreignKey.table,
        ),
      );
      for (const referencedTable of referencedTables) {
        expect(sqliteReferences, `${table} must reference ${referencedTable}`).toContain(
          referencedTable,
        );
        expect(postgresBootstrap).toMatch(
          new RegExp(
            `CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*?REFERENCES ${referencedTable}\\b`,
          ),
        );
      }
    }
  });

  it('issue-1288-c3: migration succeeds on empty and populated databases without rewriting legacy rows', () => {
    // Regression caught: additive migration backfills or mutates a legacy job.
    // The exact legacy projection and nullable foundation fields detect it.
    const empty = migratedDb();
    for (const table of FOUNDATION_TABLES) {
      expect(
        empty
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table),
      ).toEqual({ name: table });
    }

    const id = randomUUID();
    const createdAt = '2026-07-01T12:34:56.000Z';
    empty.prepare(
      `INSERT INTO agent_research_jobs
         (id, query, status, sources_json, report, error, agent_session_id,
          research_type, title, agent_profile_id, origin, vault_path,
          requested_by_user_id, created_at, updated_at)
       VALUES (?, 'legacy query', 'done', '["https://example.test/source"]',
               'legacy report', NULL, 'legacy-session', 'generic', 'Legacy title',
               'research', 'page', 'Areas/Research/legacy.md', NULL, ?, ?)`,
    ).run(id, createdAt, createdAt);

    const legacyColumns = [
      'id',
      'query',
      'status',
      'sources_json',
      'report',
      'error',
      'agent_session_id',
      'research_type',
      'title',
      'agent_profile_id',
      'origin',
      'vault_path',
      'requested_by_user_id',
      'created_at',
      'updated_at',
    ];
    const before = empty
      .prepare(`SELECT ${legacyColumns.join(', ')} FROM agent_research_jobs WHERE id = ?`)
      .get(id);

    expect(() => runMigrations(empty)).not.toThrow();
    const after = empty
      .prepare(`SELECT ${legacyColumns.join(', ')} FROM agent_research_jobs WHERE id = ?`)
      .get(id);
    expect(after).toEqual(before);

    const foundationProjection = empty
      .prepare(
        `SELECT ${JOB_FOUNDATION_COLUMNS.join(', ')}
           FROM agent_research_jobs WHERE id = ?`,
      )
      .get(id) as Record<string, unknown>;
    expect(Object.values(foundationProjection).every((value) => value === null)).toBe(true);
  });

  it('issue-1288-c4: all item-level research operations enforce ownership', async () => {
    // Regression caught: PATCH /status omitted the ownership check while get,
    // retry, and delete enforced it. Every cross-owner request must be 404 and
    // the stored job must remain untouched.
    const db = migratedDb();
    const { owner, stranger } = authenticatedUsers(db);
    const jobId = insertResearchJob(db, owner.id);

    expectNotFound(await callController('get', { userId: stranger.id, id: jobId }));
    expectNotFound(await callController('retry', { userId: stranger.id, id: jobId }));
    expectNotFound(
      await callController('updateStatus', {
        userId: stranger.id,
        id: jobId,
        body: { status: 'gathering', sources: ['https://example.test/stolen'] },
      }),
    );
    expectNotFound(await callController('remove', { userId: stranger.id, id: jobId }));
    expect(
      db.prepare('SELECT status, report, error FROM agent_research_jobs WHERE id = ?').get(jobId),
    ).toEqual({ status: 'error', report: null, error: 'fixture failure' });
  });

  it('issue-1288-c5: repository and route tests cover owner, cross-owner, ownerless legacy, and local-agent modes', async () => {
    // Regression caught: ownership remains embedded in the controller and the
    // trusted tokenless local surface lists only ownerless rows. Repository
    // existence plus the four visibility assertions detect both failures.
    const repositorySource = path.resolve(
      __dirname,
      '../../repositories/agent_research_repository.ts',
    );
    expect(() => readFileSync(repositorySource, 'utf8')).not.toThrow();

    const db = migratedDb();
    const { owner, stranger } = authenticatedUsers(db);
    const mine = insertResearchJob(db, owner.id, 'done');
    const foreign = insertResearchJob(db, stranger.id, 'done');
    const legacy = insertResearchJob(db, null, 'done');
    const routeSource = readFileSync(
      path.resolve(__dirname, '../../routes/agentResearchRoutes.ts'),
      'utf8',
    );
    for (const operation of ['controller.list', 'controller.get', 'controller.retry', 'controller.remove', 'controller.updateStatus']) {
      expect(routeSource).toContain(operation);
    }

    const ownerGet = await callController('get', { userId: owner.id, id: mine });
    expect(ownerGet.error).toBeUndefined();
    expect(ownerGet.body).toMatchObject({ id: mine });
    expectNotFound(await callController('get', { userId: stranger.id, id: mine }));
    const legacyGet = await callController('get', { userId: owner.id, id: legacy });
    expect(legacyGet.error).toBeUndefined();
    expect(legacyGet.body).toMatchObject({ id: legacy });

    const ownerList = (await callController('list', { userId: owner.id }))
      .body as Array<{ id: string }>;
    expect(ownerList.map((job) => job.id)).toEqual(
      expect.arrayContaining([mine, legacy]),
    );
    expect(ownerList.map((job) => job.id)).not.toContain(foreign);

    const localList = await callController('list');
    expect(localList.error).toBeUndefined();
    expect((localList.body as Array<{ id: string }>).map((job) => job.id)).toEqual(
      expect.arrayContaining([mine, foreign, legacy]),
    );
  });
});
