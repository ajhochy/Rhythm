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

import { createHash } from 'node:crypto';

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

  it('enforces calibration immutability without blocking deletion of the historical owner', async () => {
    const suffix = `${Date.now()}`;
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users(name, email, role)
       VALUES ('Calibration Owner', $1, 'admin') RETURNING id`,
      [`calibration-owner-${suffix}@example.test`],
    );
    const observationId = `calibration-${suffix}`;
    await pool.query(
      `INSERT INTO calibration_observations(
         id, owner_id, source_event_id, observation_type, proposal_id,
         generator_version, detector_version, kind, treatment_version,
         metric_version, initial_confidence
       ) VALUES ($1,$2,$3,'experiment-decision','proposal-1','gen-v1','det-v1',
                 'refine-config','system-prompt-v1','metric-v1',0.5)`,
      [observationId, user.rows[0].id, `event-${suffix}`],
    );

    await expect(
      pool.query(`UPDATE calibration_observations SET initial_confidence = 0.9 WHERE id = $1`, [observationId]),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query(`DELETE FROM calibration_observations WHERE id = $1`, [observationId]),
    ).rejects.toThrow(/immutable/);

    await pool.query(`DELETE FROM users WHERE id = $1`, [user.rows[0].id]);
    const row = await pool.query<{ owner_id: number }>(
      `SELECT owner_id FROM calibration_observations WHERE id = $1`,
      [observationId],
    );
    expect(row.rows[0].owner_id).toBe(user.rows[0].id);
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

  it('C2-B: the Postgres treatment-receipt insert-binding and immutability triggers FIRE against a real dispatched enrollment', async () => {
    const id = `pgreceipt-${Date.now()}`;
    const hex64 = (seed: string) =>
      createHash('sha256').update(seed).digest('hex');
    const enrollment = {
      id,
      run_episode_id: `${id}-episode`,
      experiment_id: 'receipt-experiment-1',
      proposal_id: 'receipt-proposal-1',
      profile_id: 'receipt-profile-1',
      cohort: 'candidate',
      assignment_digest: 'receipt-assignment-digest-1',
      baseline_target_revision_hash: `sha256:${hex64(`${id}-baseline`)}`,
      treatment_spec_hash: hex64(`${id}-spec`),
      state: 'reserved',
      reserved_at: '2026-01-01T00:00:00.000Z',
    };
    const enrollmentColumns = Object.keys(enrollment);
    await pool.query(
      `INSERT INTO agent_org_experiment_enrollments (${enrollmentColumns.join(', ')})
         VALUES (${enrollmentColumns.map((_, index) => `$${index + 1}`).join(', ')})`,
      Object.values(enrollment),
    );

    function receiptRow(overrides: Record<string, unknown> = {}) {
      return {
        id: `${id}-receipt`,
        schema_version: 1,
        enrollment_id: enrollment.id,
        run_episode_id: enrollment.run_episode_id,
        experiment_id: enrollment.experiment_id,
        proposal_id: enrollment.proposal_id,
        profile_id: enrollment.profile_id,
        cohort: enrollment.cohort,
        assignment_digest: enrollment.assignment_digest,
        adapter: 'system-prompt-v1',
        target_ref: `agent_config:${enrollment.profile_id}`,
        baseline_target_revision_hash: enrollment.baseline_target_revision_hash,
        profile_revision: 1,
        treatment_spec_hash: enrollment.treatment_spec_hash,
        effective_prompt_hash: hex64(`${id}-effective`),
        finalized_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }
    async function insertReceipt(row: Record<string, unknown>) {
      const columns = Object.keys(row);
      return pool.query(
        `INSERT INTO agent_org_experiment_treatment_receipts (${columns.join(', ')})
           VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(row),
      );
    }
    async function expectRejectedWithNoRow(
      row: Record<string, unknown>,
      matcher: RegExp,
    ) {
      await expect(insertReceipt(row)).rejects.toThrow(matcher);
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM agent_org_experiment_treatment_receipts WHERE id = $1`,
        [row.id],
      );
      expect(rows[0].n).toBe(0);
    }

    // Rejected: the enrollment is still `reserved`, not `dispatched`.
    await expectRejectedWithNoRow(
      receiptRow(),
      /does not match its bound dispatched enrollment/,
    );

    // Transition to dispatched — mirrors the repository's own reserved ->
    // dispatched + insert-receipt ordering.
    await pool.query(
      `UPDATE agent_org_experiment_enrollments SET state = 'dispatched' WHERE id = $1`,
      [enrollment.id],
    );

    // A second, unrelated, already-dispatched enrollment whose bound fields
    // all differ from `enrollment`'s — used below to prove that pointing a
    // receipt's enrollment_id at a REAL row is not enough; every copied
    // binding field must also match THAT row.
    const otherId = `${id}-other`;
    const otherEnrollment = {
      id: otherId,
      run_episode_id: `${otherId}-episode`,
      experiment_id: 'receipt-experiment-2',
      proposal_id: 'receipt-proposal-2',
      profile_id: 'receipt-profile-2',
      cohort: 'candidate',
      assignment_digest: 'receipt-assignment-digest-2',
      baseline_target_revision_hash: `sha256:${hex64(`${otherId}-baseline`)}`,
      treatment_spec_hash: hex64(`${otherId}-spec`),
      state: 'dispatched',
      reserved_at: '2026-01-01T00:00:00.000Z',
    };
    const otherEnrollmentColumns = Object.keys(otherEnrollment);
    await pool.query(
      `INSERT INTO agent_org_experiment_enrollments (${otherEnrollmentColumns.join(', ')})
         VALUES (${otherEnrollmentColumns.map((_, index) => `$${index + 1}`).join(', ')})`,
      Object.values(otherEnrollment),
    );

    const BINDING_MISMATCH = /does not match its bound dispatched enrollment/;
    const CHECK_VIOLATION = /violates check constraint/;

    // Table-driven: every noncanonical variant must be rejected, and none may
    // leave a partial row behind — checked per-attempt via a unique receipt id.
    const variants: Array<{
      label: string;
      overrides: Record<string, unknown>;
      matcher: RegExp;
    }> = [
      {
        label: 'nonexistent-enrollment-id',
        overrides: { enrollment_id: `${id}-does-not-exist` },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-enrollment-id',
        // Points at a REAL, dispatched enrollment — but every other field
        // below still describes the ORIGINAL enrollment, so nothing matches.
        overrides: { enrollment_id: otherId },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-run-episode-id',
        overrides: { run_episode_id: `${id}-wrong-episode` },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-experiment-id',
        overrides: { experiment_id: 'wrong-experiment' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-proposal-id',
        overrides: { proposal_id: 'wrong-proposal' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-profile-id',
        // target_ref is recomputed to be CANONICAL for the wrong profile_id,
        // so the local CHECK passes and the binding trigger is what fires.
        overrides: { profile_id: 'wrong-profile', target_ref: 'agent_config:wrong-profile' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-cohort',
        overrides: { cohort: 'baseline' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-assignment-digest',
        overrides: { assignment_digest: 'wrong-assignment-digest' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-baseline-target-revision-hash',
        overrides: {
          baseline_target_revision_hash: `sha256:${hex64('wrong-baseline')}`,
        },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-treatment-spec-hash',
        overrides: { treatment_spec_hash: hex64('wrong-spec') },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'wrong-target-ref',
        overrides: { target_ref: 'agent_config:some-other-profile' },
        matcher: CHECK_VIOLATION,
      },
      {
        // baseline_target_revision_hash is one of the fields the BEFORE
        // INSERT binding trigger compares against the dispatched enrollment,
        // and that trigger fires before table CHECK constraints are
        // evaluated — so an invalid value here never reaches the CHECK,
        // it trips the binding guard first.
        label: 'invalid-baseline-target-hash-format',
        overrides: { baseline_target_revision_hash: 'not-a-hex-hash' },
        matcher: BINDING_MISMATCH,
      },
      {
        // Same trigger-order reasoning as above: treatment_spec_hash is
        // enrollment-bound, so the binding trigger fires first.
        label: 'invalid-treatment-spec-hash-format',
        overrides: { treatment_spec_hash: 'not-a-hex-hash' },
        matcher: BINDING_MISMATCH,
      },
      {
        label: 'invalid-effective-prompt-hash-format',
        overrides: { effective_prompt_hash: 'not-a-hex-hash' },
        matcher: CHECK_VIOLATION,
      },
      {
        label: 'invalid-adapter',
        overrides: { adapter: 'system-prompt-v2' },
        matcher: CHECK_VIOLATION,
      },
      {
        label: 'invalid-profile-revision',
        overrides: { profile_revision: -1 },
        matcher: CHECK_VIOLATION,
      },
      {
        label: 'invalid-schema-version',
        overrides: { schema_version: 2 },
        matcher: CHECK_VIOLATION,
      },
      {
        // cohort is also enrollment-bound and compared by the BEFORE INSERT
        // binding trigger before the CHECK constraint runs, so an invalid
        // cohort value trips the binding guard first, not the CHECK.
        label: 'invalid-cohort',
        overrides: { cohort: 'other' },
        matcher: BINDING_MISMATCH,
      },
    ];

    for (const variant of variants) {
      await expectRejectedWithNoRow(
        receiptRow({ id: `${id}-receipt-${variant.label}`, ...variant.overrides }),
        variant.matcher,
      );
    }

    // No attempt above — legal or otherwise — left a row behind for the
    // enrollment under test.
    const noPartialRow = await pool.query(
      `SELECT COUNT(*)::int AS n FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = $1`,
      [enrollment.id],
    );
    expect(noPartialRow.rows[0].n).toBe(0);

    // Legal: the receipt matches the now-dispatched enrollment exactly.
    await insertReceipt(receiptRow());
    const readback = await pool.query(
      `SELECT * FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = $1`,
      [enrollment.id],
    );
    expect(readback.rows).toHaveLength(1);
    expect(readback.rows[0].effective_prompt_hash).toBe(hex64(`${id}-effective`));

    // Immutable: UPDATE and DELETE are both rejected, and the original row
    // remains exactly as inserted.
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_treatment_receipts SET profile_revision = 99 WHERE enrollment_id = $1`,
        [enrollment.id],
      ),
    ).rejects.toThrow(/treatment receipts are immutable once finalized/);
    await expect(
      pool.query(`DELETE FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = $1`, [enrollment.id]),
    ).rejects.toThrow(/treatment receipts are immutable once finalized/);
    const afterAttempts = await pool.query(
      `SELECT * FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = $1`,
      [enrollment.id],
    );
    expect(afterAttempts.rows).toEqual(readback.rows);
  });

  it('C2-A: the Postgres trigger enforces a legal reserved -> treatment_failed / target_drifted transition and rejects every noncanonical variant with NO partial mutation', async () => {
    const baseId = `pgdrift-${Date.now()}`;
    const enrollmentTemplate = {
      experiment_id: 'experiment-drift-1',
      proposal_id: 'proposal-drift-1',
      profile_id: 'profile-drift-1',
      cohort: 'candidate',
      assignment_digest: 'assignment-digest-drift',
      baseline_target_revision_hash: 'baseline-hash-drift',
      treatment_spec_hash: 'treatment-hash-drift',
      state: 'reserved',
      reserved_at: '2026-01-01T00:00:00.000Z',
    };
    const columns = ['id', 'run_episode_id', ...Object.keys(enrollmentTemplate)];

    async function insertReserved(id: string) {
      const row = { id, run_episode_id: `${id}-episode`, ...enrollmentTemplate };
      await pool.query(
        `INSERT INTO agent_org_experiment_enrollments (${columns.join(', ')})
           VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        columns.map((c) => (row as Record<string, string>)[c]),
      );
    }

    async function readRow(id: string) {
      const { rows } = await pool.query(
        `SELECT state, failure_code, failure_reason FROM agent_org_experiment_enrollments WHERE id = $1`,
        [id],
      );
      return rows[0] as { state: string; failure_code: string | null; failure_reason: string | null };
    }

    // ── Legal: reserved -> treatment_failed with canonical target_drifted metadata ──
    const legalId = `${baseId}-legal`;
    await insertReserved(legalId);
    await pool.query(
      `UPDATE agent_org_experiment_enrollments
          SET state = 'treatment_failed', failure_code = 'target_drifted', failure_reason = 'target_drifted'
        WHERE id = $1`,
      [legalId],
    );
    const legalAfter = await readRow(legalId);
    expect(legalAfter).toEqual({
      state: 'treatment_failed',
      failure_code: 'target_drifted',
      failure_reason: 'target_drifted',
    });

    // ── Rejected: target_drifted with an arbitrary/noncanonical reason ──
    const arbitraryReasonId = `${baseId}-arbitrary-reason`;
    await insertReserved(arbitraryReasonId);
    const beforeArbitraryReason = await readRow(arbitraryReasonId);
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_enrollments
            SET state = 'treatment_failed', failure_code = 'target_drifted', failure_reason = 'the config drifted because someone edited it'
          WHERE id = $1`,
        [arbitraryReasonId],
      ),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);
    expect(await readRow(arbitraryReasonId)).toEqual(beforeArbitraryReason);

    // ── Rejected: target_drifted with a NULL reason ──
    const nullReasonId = `${baseId}-null-reason`;
    await insertReserved(nullReasonId);
    const beforeNullReason = await readRow(nullReasonId);
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_enrollments
            SET state = 'treatment_failed', failure_code = 'target_drifted', failure_reason = NULL
          WHERE id = $1`,
        [nullReasonId],
      ),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);
    expect(await readRow(nullReasonId)).toEqual(beforeNullReason);

    // ── Rejected: an invalid/noncanonical failure_code entirely ──
    const invalidCodeId = `${baseId}-invalid-code`;
    await insertReserved(invalidCodeId);
    const beforeInvalidCode = await readRow(invalidCodeId);
    await expect(
      pool.query(
        `UPDATE agent_org_experiment_enrollments
            SET state = 'treatment_failed', failure_code = 'target_drifted_typo', failure_reason = 'target_drifted_typo'
          WHERE id = $1`,
        [invalidCodeId],
      ),
    ).rejects.toThrow(/agent_org_experiment_enrollments state transition is invalid/);
    expect(await readRow(invalidCodeId)).toEqual(beforeInvalidCode);
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
