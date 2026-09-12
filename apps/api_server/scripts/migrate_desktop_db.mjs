import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [sourcePath, destinationPath, receiptPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath || !receiptPath || sourcePath === destinationPath) throw new Error('Migration requires distinct source, destination, and receipt paths');
if (existsSync(destinationPath)) throw new Error('Migration destination already exists');
await mkdir(dirname(destinationPath), { recursive: true });
const stagingPath = `${destinationPath}.staging-${process.pid}`;
await rm(stagingPath, { force: true });
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
try { await source.backup(stagingPath); } finally { source.close(); }
const migrated = new Database(stagingPath);
let counts;
try {
  if (migrated.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Migrated database failed integrity check');
  const tables = migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  for (const table of ['scheduled_agent_tasks', 'scheduled_tasks']) if (tables.includes(table)) migrated.prepare(`UPDATE ${table} SET enabled = 0 WHERE enabled != 0`).run();
  counts = Object.fromEntries(tables.sort().map((table) => [table, migrated.prepare(`SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`).get().count]));
} finally { migrated.close(); }
await rename(stagingPath, destinationPath);
await writeFile(receiptPath, `${JSON.stringify({ version: 1, source: 'legacy-rhythm', migratedAt: new Date().toISOString(), counts, schedulesRequireReview: true }, null, 2)}\n`, { mode: 0o600 });
