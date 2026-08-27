import type Database from 'better-sqlite3';

export interface TableSpec {
  name: string;
  key: 'id' | 'profile_id';
}

export const BROAD_TABLES: readonly TableSpec[] = [
  { name: 'agent_configs', key: 'id' },
  { name: 'agent_cookbook', key: 'id' },
  { name: 'agent_skills', key: 'id' },
  { name: 'agent_org_proposals', key: 'id' },
  { name: 'agent_sessions', key: 'id' },
  { name: 'agent_session_messages', key: 'id' },
];

export const INSTALL_TABLES: readonly TableSpec[] = [
  { name: 'agent_configs', key: 'id' },
  { name: 'agent_skills', key: 'id' },
  { name: 'agent_profile_projections', key: 'profile_id' },
];

export type TableRows = Record<string, Array<Record<string, unknown>>>;

export function snapshotTables(db: Database.Database, tables: readonly TableSpec[]): TableRows {
  return Object.fromEntries(tables.map(({ name, key }) => [
    name,
    db.prepare(`SELECT * FROM ${name} ORDER BY ${key}`).all() as Array<Record<string, unknown>>,
  ]));
}

export function snapshotBytes(snapshot: TableRows): string {
  return JSON.stringify(snapshot);
}

export interface RowDiff {
  table: string;
  row: string;
  status: 'added' | 'removed' | 'changed';
  fields: Record<string, { before?: unknown; after?: unknown }>;
}

export function diffTableRows(before: TableRows, after: TableRows, tables: readonly TableSpec[]): RowDiff[] {
  const diffs: RowDiff[] = [];
  for (const { name, key } of tables) {
    const beforeRows = new Map((before[name] ?? []).map((row) => [String(row[key]), row]));
    const afterRows = new Map((after[name] ?? []).map((row) => [String(row[key]), row]));
    for (const rowKey of [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort()) {
      const oldRow = beforeRows.get(rowKey);
      const newRow = afterRows.get(rowKey);
      if (!oldRow) {
        diffs.push({ table: name, row: rowKey, status: 'added', fields: { '*': { after: newRow } } });
        continue;
      }
      if (!newRow) {
        diffs.push({ table: name, row: rowKey, status: 'removed', fields: { '*': { before: oldRow } } });
        continue;
      }
      const fields = Object.fromEntries([...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])]
        .sort()
        .filter((field) => JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field]))
        .map((field) => [field, { before: oldRow[field], after: newRow[field] }]));
      if (Object.keys(fields).length) diffs.push({ table: name, row: rowKey, status: 'changed', fields });
    }
  }
  return diffs;
}

export async function waitForBroadRowsToSettle(
  db: Database.Database,
  options: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TableRows> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  let previous = snapshotTables(db, BROAD_TABLES);
  let lastDiff: RowDiff[] = [];
  do {
    await sleep(intervalMs);
    const current = snapshotTables(db, BROAD_TABLES);
    if (snapshotBytes(current) === snapshotBytes(previous)) return current;
    lastDiff = diffTableRows(previous, current, BROAD_TABLES);
    previous = current;
  } while (Date.now() < deadline);
  throw new Error(`broad rows did not settle: ${JSON.stringify(lastDiff)}`);
}
