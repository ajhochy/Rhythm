/**
 * Live Postgres bootstrap gate — executes the REAL production DDL.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `src/database/postgres_bootstrap.ts` is the production schema. Until this
 * file landed it was NEVER EXECUTED anywhere in the test suite or in CI. The
 * only guard was `skill_schema_parity.test.ts`, which (a) parses the DDL with a
 * REGEX and (b) compares COLUMN NAMES only, for 10 hand-listed tables. Three
 * whole failure classes sail straight past it:
 *
 *   1. Syntactic validity. A malformed `CREATE TRIGGER ... EXECUTE FUNCTION`
 *      satisfies every string assertion and only explodes on a live boot,
 *      taking `runPostgresBootstrap` — and therefore production startup — with
 *      it. This suite caught exactly that: an `ALTER TABLE
 *      agent_research_qa_links ADD COLUMN ... REFERENCES agent_sessions(id)`
 *      was ordered ~300 lines BEFORE `agent_sessions` was created, so a
 *      bootstrap against a fresh database aborted with `relation
 *      "agent_sessions" does not exist`. The regex guard was green throughout.
 *   2. Semantic divergence inside matching columns — see the `created_at`
 *      case below. Same column name in both engines, different value shape.
 *   3. Trigger firing semantics. A trigger can exist and still not fire.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 * Inert by default: without `RHYTHM_LIVE_PG=1` the whole describe block is
 * skipped, exactly like `live_e2e_self_improvement_foundation.test.ts`. A
 * normal `npx vitest run` never touches Postgres, never touches Docker, and
 * cannot fail because Postgres is absent.
 *
 * The suite needs a POSTGRES, not a Docker — it only ever connects to a URL, so
 * a GitHub Actions `services: postgres` block works unchanged. Locally:
 *
 *   docker run -d --name rhythm-pg-test \
 *     -e POSTGRES_PASSWORD=probe -e POSTGRES_USER=probe -e POSTGRES_DB=probe \
 *     -p 55433:5432 postgres:16
 *
 *   RHYTHM_LIVE_PG=1 \
 *   RHYTHM_LIVE_PG_URL=postgres://probe:probe@127.0.0.1:55433/probe \
 *     npx vitest run src/__tests__/live_postgres_bootstrap.test.ts
 *
 *   docker rm -f rhythm-pg-test
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * `beforeAll` DROPs and recreates the `public` schema, because "boots against a
 * FRESH database" is the entire point — a bootstrap that only works on an
 * already-migrated database is the bug this catches. That is destructive, so
 * `assertDisposableLocalPostgres` refuses any URL whose host is not loopback.
 * Never point RHYTHM_LIVE_PG_URL at a database you care about.
 *
 * ── What this still does NOT cover ──────────────────────────────────────────
 *  • Column TYPES. Only names are compared, because SQLite's affinities do not
 *    map 1:1 onto Postgres types (TEXT/INTEGER vs TIMESTAMPTZ/JSONB/BOOLEAN).
 *    A column that is BOOLEAN in one engine and INTEGER in the other passes.
 *  • NOT NULL / CHECK / UNIQUE constraints, and DEFAULTs other than the one
 *    `created_at` case asserted below.
 *  • Table-SET differences. 22 tables exist only in SQLite (FTS5 shadow tables
 *    and the relay outbox, mostly legitimately) and 3 only in Postgres (the
 *    mobile pairing tables). A NEW single-engine table is therefore invisible
 *    here — the exact hazard `agent_org_proposal_retirements` represents.
 *  • Index and foreign-key parity.
 *  • Every trigger other than the two `agent_org_experiments` guards asserted
 *    below; the rest are only proven to PARSE, not to fire correctly.
 *  • `SQLite IS NOT` vs `Postgres IS DISTINCT FROM` firing semantics are not
 *    differentially tested — only the Postgres side is exercised.
 *  • Runtime behaviour of the app against Postgres. This boots the schema; it
 *    does not run a single repository or route against it.
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

const enabled = process.env.RHYTHM_LIVE_PG === '1';
const describeLive = enabled ? describe : describe.skip;

const PG_URL =
  process.env.RHYTHM_LIVE_PG_URL ??
  'postgres://probe:probe@127.0.0.1:55433/probe';

/** Bootstrapping ~90 tables, indexes, functions and triggers is not fast. */
const BOOTSTRAP_TIMEOUT_MS = 180_000;

/**
 * Refuse to run the destructive schema reset against anything that is not a
 * throwaway local server. Trust boundary — deliberately not simplified away.
 */
function assertDisposableLocalPostgres(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`RHYTHM_LIVE_PG_URL is not a valid URL: ${url}`);
  }
  const loopback = ['127.0.0.1', '::1', 'localhost', '[::1]'];
  if (!loopback.includes(host)) {
    throw new Error(
      `Refusing to DROP SCHEMA on non-loopback host "${host}". This suite is ` +
        `only ever run against a disposable local Postgres.`,
    );
  }
}

/**
 * Cross-engine column divergences that exist TODAY and are not this test's to
 * fix. Everything NOT listed here is locked: any new drift fails the run.
 *
 * This is a characterization baseline, not an exemption policy — shrinking it
 * is the goal. Both remaining entries are intentional (tsvector vs FTS5). The
 * `agent_sessions` / `agent_configs` entries that used to sit here were 13
 * columns of genuine unguarded drift; they are now created by
 * postgres_bootstrap.ts, and both tables were added to the always-on regex
 * guard in skill_schema_parity.test.ts so the class cannot silently return.
 */
const KNOWN_COLUMN_DIVERGENCE: Record<
  string,
  { sqliteOnly?: string[]; postgresOnly?: string[] }
> = {
  // Intentional: Postgres does full-text search with a generated tsvector
  // column; SQLite uses a separate FTS5 virtual table (tasks_fts).
  tasks: { postgresOnly: ['search_vector'] },
  // Intentional: same tsvector-vs-FTS5 split (agent_memory_fts).
  agent_memory: { postgresOnly: ['search_vector'] },
};

function sqliteSchema(): Map<string, string[]> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
  const out = new Map<string, string[]>();
  for (const t of tables) {
    out.set(
      t,
      (db.pragma(`table_info(${t})`) as { name: string }[])
        .map((c) => c.name)
        .sort(),
    );
  }
  db.close();
  return out;
}

async function postgresSchema(pool: Pool): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, column_name`,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const cols = out.get(r.table_name) ?? [];
    cols.push(r.column_name);
    out.set(r.table_name, cols);
  }
  return out;
}

describeLive('live Postgres bootstrap (RHYTHM_LIVE_PG=1)', () => {
  let pool: Pool;
  let pgTables: Map<string, string[]>;
  let sqliteTables: Map<string, string[]>;

  beforeAll(async () => {
    assertDisposableLocalPostgres(PG_URL);
    pool = new Pool({ connectionString: PG_URL });
    // A FRESH database. A bootstrap that only succeeds against an
    // already-migrated schema is precisely the defect this suite exists for.
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');

    // THE syntax gate. Every CREATE TABLE / INDEX / FUNCTION / TRIGGER in
    // postgres_bootstrap.ts is parsed and executed by a real Postgres here.
    await runPostgresBootstrap(pool);

    pgTables = await postgresSchema(pool);
    sqliteTables = sqliteSchema();
  }, BOOTSTRAP_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
  });

  it('materialises a non-trivial schema', () => {
    // If the bootstrap silently no-opped, this is the tripwire.
    expect(pgTables.size).toBeGreaterThan(50);
    for (const t of [
      'users',
      'tasks',
      'agent_sessions',
      'agent_org_experiments',
      'agent_org_experiment_enrollments',
    ]) {
      expect(pgTables.has(t)).toBe(true);
    }
  });

  it('is idempotent — a second bootstrap over a live schema is clean', async () => {
    await runPostgresBootstrap(pool);
    const again = await postgresSchema(pool);
    expect([...again.keys()].sort()).toEqual([...pgTables.keys()].sort());
  }, BOOTSTRAP_TIMEOUT_MS);

  it('agrees with the SQLite migration on every shared table, against the REAL information_schema', () => {
    const drift: string[] = [];
    for (const [table, sqliteCols] of sqliteTables) {
      const pgCols = pgTables.get(table);
      if (!pgCols) continue; // table-set differences are out of scope, see docs
      const known = KNOWN_COLUMN_DIVERGENCE[table] ?? {};
      const sqliteOnly = sqliteCols
        .filter((c) => !pgCols.includes(c))
        .filter((c) => !(known.sqliteOnly ?? []).includes(c));
      const postgresOnly = pgCols
        .filter((c) => !sqliteCols.includes(c))
        .filter((c) => !(known.postgresOnly ?? []).includes(c));
      if (sqliteOnly.length || postgresOnly.length) {
        drift.push(
          `${table}: sqlite-only=[${sqliteOnly}] postgres-only=[${postgresOnly}]`,
        );
      }
    }
    expect(drift).toEqual([]);
  });

  it('enforces ledger immutability — the trigger FIRES, not merely exists', async () => {
    const id = `pgboot-${Date.now()}`;
    const row = {
      id,
      proposal_id: 'p1',
      adapter: 'a1',
      evidence_bundle_json: '{}',
      baseline_spec_json: '{}',
      candidate_spec_json: '{}',
      assignment_key: 'k1',
      stopping_rule_json: '{}',
      max_exposure: 1,
      declared_at: '2026-01-01T00:00:00.000Z',
    };
    const cols = Object.keys(row);
    await pool.query(
      `INSERT INTO agent_org_experiments (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );

    // A guarded column: rejected by trg_agent_org_experiments_spec_immutable.
    await expect(
      pool.query(`UPDATE agent_org_experiments SET adapter = 'a2' WHERE id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/agent org experiment specs are immutable once declared/);

    // Deletes are rejected too.
    await expect(
      pool.query(`DELETE FROM agent_org_experiments WHERE id = $1`, [id]),
    ).rejects.toThrow(/agent org experiment specs are immutable once declared/);

    // An UNguarded column must still be writable, or the trigger's WHEN clause
    // is wrong in the other direction.
    await pool.query(
      `UPDATE agent_org_experiments SET decision = 'ship' WHERE id = $1`,
      [id],
    );
    const { rows } = await pool.query(
      `SELECT decision FROM agent_org_experiments WHERE id = $1`,
      [id],
    );
    expect(rows[0].decision).toBe('ship');
  });

  it('enforces enrollment lifecycle domains and transitions — the Postgres trigger FIRES', async () => {
    const id = `pgenroll-${Date.now()}`;
    const enrollment = {
      id,
      run_episode_id: `${id}-episode`,
      experiment_id: 'experiment-1',
      proposal_id: 'proposal-1',
      profile_id: 'profile-1',
      cohort: 'candidate',
      assignment_digest: 'assignment-digest',
      baseline_target_revision_hash: 'baseline-hash',
      treatment_spec_hash: 'treatment-hash',
      state: 'reserved',
      reserved_at: '2026-01-01T00:00:00.000Z',
    };
    const columns = Object.keys(enrollment);
    await pool.query(
      `INSERT INTO agent_org_experiment_enrollments (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
      Object.values(enrollment),
    );
    await expect(
      pool.query(
        `INSERT INTO agent_org_experiment_enrollments (${columns.join(', ')})
           VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values({ ...enrollment, id: `${id}-duplicate-run` }),
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      pool.query(
        `INSERT INTO agent_org_experiment_enrollments (${columns.join(', ')})
           VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values({
          ...enrollment,
          id: `${id}-invalid-cohort`,
          run_episode_id: `${id}-invalid-cohort-episode`,
          cohort: 'other',
        }),
      ),
    ).rejects.toThrow(/violates check constraint/);

    // Identical writes are legal idempotence, then the normal success path.
    await pool.query(
      `UPDATE agent_org_experiment_enrollments SET state = 'reserved' WHERE id = $1`,
      [id],
    );
    await pool.query(
      `UPDATE agent_org_experiment_enrollments SET state = 'dispatched' WHERE id = $1`,
      [id],
    );

    // Failure metadata cannot hitch a ride on the dispatched → terminalized path.
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_enrollments
            SET state = 'terminalized', failure_code = 'prompt_timeout', failure_reason = 'prompt_timeout'
          WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);
    await pool.query(
      `UPDATE agent_org_experiment_enrollments SET state = 'terminalized' WHERE id = $1`,
      [id],
    );
    await expect(
      pool.query(`UPDATE agent_org_experiment_enrollments SET state = 'reserved' WHERE id = $1`, [id]),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);

    const failedId = `${id}-failed`;
    await pool.query(
      `INSERT INTO agent_org_experiment_enrollments (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
      Object.values({ ...enrollment, id: failedId, run_episode_id: `${failedId}-episode` }),
    );
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_enrollments
            SET state = 'treatment_failed',
                failure_code = 'provider_unavailable',
                failure_reason = 'arbitrary raw provider detail'
          WHERE id = $1`,
        [failedId],
      ),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);
    await pool.query(
      `UPDATE agent_org_experiment_enrollments
          SET state = 'treatment_failed',
              failure_code = 'provider_unavailable',
              failure_reason = 'provider_unavailable'
        WHERE id = $1`,
      [failedId],
    );
  });

  it('SEMANTIC: the Postgres created_at DEFAULT is unambiguous ISO-8601 UTC', async () => {
    const id = `pgtsz-${Date.now()}`;
    const row = {
      id,
      proposal_id: 'p1',
      adapter: 'a1',
      evidence_bundle_json: '{}',
      baseline_spec_json: '{}',
      candidate_spec_json: '{}',
      assignment_key: 'k1',
      stopping_rule_json: '{}',
      max_exposure: 1,
      declared_at: '2026-01-01T00:00:00.000Z',
    };
    const cols = Object.keys(row);
    const pg = await pool.query<{ created_at: string }>(
      `INSERT INTO agent_org_experiments (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING created_at`,
      Object.values(row),
    );
    expect(pg.rows[0].created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  /**
   * FIXED 2026-08-15 — promoted from `it.fails` to a real `it`.
   *
   * The divergence this used to characterize:
   *   Postgres  "2026-08-15T20:08:04.829Z"  -> 2026-08-15T20:08:04.829Z
   *   SQLite    "2026-08-15 20:08:05"       -> 2026-08-16T03:08:05.000Z
   *
   * Same column name — `skill_schema_parity.test.ts` was green on both — but a
   * SEVEN HOUR skew once `new Date(...)` parsed the naive SQLite string as
   * LOCAL time.
   *
   * All 100 SQLite timestamp DEFAULTs now emit `strftime('%Y-%m-%dT%H:%M:%fZ',
   * 'now')`, so a FRESH database matches Postgres byte for byte — which is what
   * this test exercises (`:memory:`).
   *
   * STILL OWED (Stage 2): already-migrated databases. `CREATE TABLE IF NOT
   * EXISTS` cannot alter an existing table's DEFAULT, so existing installs keep
   * writing the naive format until a table-rebuild + backfill migration lands.
   * That boundary — and the mixed-format ordering hazard it implies — is
   * executably documented in `created_at_utc_parity.test.ts`.
   */
  it('SEMANTIC: created_at DEFAULT yields the same instant in both engines', async () => {
    // The column-name guard cannot see this. Postgres defaults to
    // to_char(timezone('utc', now()), ...); SQLite to datetime('now'). Same
    // column name, different value shape.
    const id = `pgts-${Date.now()}`;
    const row = {
      id,
      proposal_id: 'p1',
      adapter: 'a1',
      evidence_bundle_json: '{}',
      baseline_spec_json: '{}',
      candidate_spec_json: '{}',
      assignment_key: 'k1',
      stopping_rule_json: '{}',
      max_exposure: 1,
      declared_at: '2026-01-01T00:00:00.000Z',
      // `idx_agent_org_experiments_one_undecided` is a partial unique index
      // admitting exactly one undecided experiment, and a sibling test above
      // already parks one. Declaring a decision keeps this test independent of
      // execution order without relaxing anything it asserts.
      decision: 'ship',
    };
    const cols = Object.keys(row);
    const pg = await pool.query<{ created_at: string }>(
      `INSERT INTO agent_org_experiments (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING created_at`,
      Object.values(row),
    );

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare(
      `INSERT INTO agent_org_experiments (${cols.join(', ')})
         VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...Object.values(row));
    const sqlite = db
      .prepare(`SELECT created_at FROM agent_org_experiments WHERE id = ?`)
      .get(id) as { created_at: string };
    db.close();

    // Both must be UTC ISO-8601 with an explicit zone, so `new Date(...)` is
    // unambiguous. A naive string here is the whole bug.
    const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(pg.rows[0].created_at).toMatch(ISO_UTC);
    expect(sqlite.created_at).toMatch(ISO_UTC); // <-- fails today: "2026-08-15 20:08:05"

    // And they must denote the same instant, not merely look alike.
    const skewMs = Math.abs(
      new Date(pg.rows[0].created_at).getTime() -
        new Date(sqlite.created_at).getTime(),
    );
    expect(skewMs).toBeLessThan(60_000);
  });
});
