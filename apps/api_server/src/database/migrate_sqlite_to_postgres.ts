import 'dotenv/config';
import Database from 'better-sqlite3';
import { Pool } from 'pg';

type TablePlan = {
  name: string;
  booleanColumns?: string[];
};

const TABLES: TablePlan[] = [
  { name: 'users', booleanColumns: ['is_facilities_manager'] },
  { name: 'sessions' },
  { name: 'facilities' },
  { name: 'project_templates' },
  { name: 'project_template_steps' },
  { name: 'project_instances' },
  { name: 'project_instance_steps' },
  { name: 'tasks', booleanColumns: ['locked'] },
  { name: 'recurring_task_rules', booleanColumns: ['enabled'] },
  { name: 'weekly_plans' },
  { name: 'integration_accounts' },
  { name: 'integration_preferences' },
  { name: 'calendar_shadow_events', booleanColumns: ['is_all_day'] },
  { name: 'gmail_signals', booleanColumns: ['is_unread'] },
  { name: 'automation_rules', booleanColumns: ['enabled'] },
  { name: 'automation_signals' },
  { name: 'message_threads' },
  { name: 'thread_participants' },
  { name: 'thread_reads' },
  { name: 'messages' },
  { name: 'reservation_series' },
  { name: 'reservation_groups' },
  {
    name: 'reservations',
    booleanColumns: ['created_by_rhythm', 'is_conflicted'],
  },
];

const REVERSE_TABLES = [...TABLES].reverse();
const IDENTITY_TABLES = [
  ['users', 'id'],
  ['message_threads', 'id'],
  ['messages', 'id'],
  ['facilities', 'id'],
  ['reservations', 'id'],
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSqlitePath(): string {
  return process.env.SQLITE_MIGRATION_PATH ?? process.env.DB_PATH ?? './rhythm.db';
}

function buildPool(): Pool {
  return new Pool({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? '5432'),
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    ssl:
      process.env.DB_SSL === 'true'
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
  });
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeValue(
  value: unknown,
  booleanColumns: Set<string>,
  column: string,
): unknown {
  if (!booleanColumns.has(column)) return value;
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value === 'true';
  return value;
}

async function assertTargetEmpty(pool: Pool): Promise<void> {
  for (const table of TABLES) {
    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(table.name)} LIMIT 1) AS has_rows`,
    );
    if (result.rows[0]?.has_rows) {
      throw new Error(
        `Target Postgres table "${table.name}" is not empty. Re-run with --reset-target if you intend to replace it.`,
      );
    }
  }
}

async function resetTarget(pool: Pool): Promise<void> {
  const tableList = REVERSE_TABLES.map((table) => quoteIdentifier(table.name)).join(', ');
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

async function migrateTable(
  sqlite: Database.Database,
  pool: Pool,
  plan: TablePlan,
): Promise<number> {
  const rows = sqlite
    .prepare(`SELECT * FROM ${quoteIdentifier(plan.name)}`)
    .all() as Record<string, unknown>[];

  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const sql = `
    INSERT INTO ${quoteIdentifier(plan.name)} (${quotedColumns})
    VALUES (${placeholders})
    ON CONFLICT DO NOTHING
  `;

  const booleanColumns = new Set(plan.booleanColumns ?? []);

  for (const row of rows) {
    const values = columns.map((column) =>
      normalizeValue(row[column], booleanColumns, column),
    );
    await pool.query(sql, values);
  }

  return rows.length;
}

async function resetIdentitySequences(pool: Pool): Promise<void> {
  for (const [table, column] of IDENTITY_TABLES) {
    await pool.query(
      `
        SELECT setval(
          pg_get_serial_sequence($1, $2),
          COALESCE((SELECT MAX(${quoteIdentifier(column)}) FROM ${quoteIdentifier(table)}), 1),
          EXISTS (SELECT 1 FROM ${quoteIdentifier(table)})
        )
      `,
      [table, column],
    );
  }
}

async function main(): Promise<void> {
  const sqlitePath = getSqlitePath();
  const resetTargetFirst = process.argv.includes('--reset-target');

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = buildPool();

  try {
    await pool.query('SELECT 1');

    if (resetTargetFirst) {
      await resetTarget(pool);
    } else {
      await assertTargetEmpty(pool);
    }

    const counts: Array<{ table: string; rows: number }> = [];
    for (const table of TABLES) {
      const rows = await migrateTable(sqlite, pool, table);
      counts.push({ table: table.name, rows });
    }

    await resetIdentitySequences(pool);

    const migratedSummary = counts
      .map(({ table, rows }) => `${table}: ${rows}`)
      .join(', ');
    console.log(`SQLite to Postgres migration complete. ${migratedSummary}`);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
