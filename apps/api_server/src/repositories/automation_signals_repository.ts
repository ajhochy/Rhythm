import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import type {
  AutomationSignal,
  CreateAutomationSignalDto,
} from '../models/automation_signal';

interface AutomationSignalRow {
  id: string;
  provider: string;
  signal_type: string;
  external_id: string;
  dedupe_key: string;
  occurred_at: string | null;
  synced_at: string;
  source_account_id: string | null;
  source_label: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function rowToSignal(row: AutomationSignalRow): AutomationSignal {
  return {
    id: row.id,
    provider: row.provider as AutomationSignal['provider'],
    signalType: row.signal_type as AutomationSignal['signalType'],
    externalId: row.external_id,
    dedupeKey: row.dedupe_key,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    sourceAccountId: row.source_account_id,
    sourceLabel: row.source_label,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationSignalsRepository {
  upsertMany(items: CreateAutomationSignalDto[]): AutomationSignal[] {
    if (items.length === 0) return [];

    const selectStmt = getDb().prepare(
      'SELECT * FROM automation_signals WHERE dedupe_key = ? LIMIT 1',
    );
    const insertStmt = getDb().prepare(
      `INSERT INTO automation_signals (
        id, provider, signal_type, external_id, dedupe_key, occurred_at,
        synced_at, source_account_id, source_label, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = getDb().prepare(
      `UPDATE automation_signals
       SET provider = ?, signal_type = ?, external_id = ?, occurred_at = ?, synced_at = ?,
           source_account_id = ?, source_label = ?, payload_json = ?, updated_at = ?
       WHERE id = ?`,
    );

    getDb().transaction(() => {
      for (const item of items) {
        const now = new Date().toISOString();
        const existing = selectStmt.get(item.dedupeKey) as
          | AutomationSignalRow
          | undefined;
        if (existing) {
          updateStmt.run(
            item.provider,
            item.signalType,
            item.externalId,
            item.occurredAt ?? null,
            item.syncedAt,
            item.sourceAccountId ?? null,
            item.sourceLabel ?? null,
            JSON.stringify(item.payload),
            now,
            existing.id,
          );
          continue;
        }

        insertStmt.run(
          uuidv4(),
          item.provider,
          item.signalType,
          item.externalId,
          item.dedupeKey,
          item.occurredAt ?? null,
          item.syncedAt,
          item.sourceAccountId ?? null,
          item.sourceLabel ?? null,
          JSON.stringify(item.payload),
          now,
          now,
        );
      }
    })();

    return items.map((item) => this.findByDedupeKey(item.dedupeKey)!);
  }

  findByDedupeKey(dedupeKey: string): AutomationSignal | null {
    const row = getDb()
      .prepare('SELECT * FROM automation_signals WHERE dedupe_key = ? LIMIT 1')
      .get(dedupeKey) as AutomationSignalRow | undefined;
    return row ? rowToSignal(row) : null;
  }

  listRecent(limit = 50): AutomationSignal[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM automation_signals
         ORDER BY synced_at DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as AutomationSignalRow[];
    return rows.map(rowToSignal);
  }
}
