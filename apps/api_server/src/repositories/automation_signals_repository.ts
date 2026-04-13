import { env } from "../config/env";
import { v4 as uuidv4 } from "uuid";
import { getDb, getPostgresPool } from "../database/db";
import type {
  AutomationSignal,
  CreateAutomationSignalDto,
} from "../models/automation_signal";

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
    provider: row.provider as AutomationSignal["provider"],
    signalType: row.signal_type as AutomationSignal["signalType"],
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

function materiallyMatches(
  existing: AutomationSignalRow,
  incoming: CreateAutomationSignalDto,
): boolean {
  return (
    existing.provider === incoming.provider &&
    existing.signal_type === incoming.signalType &&
    existing.external_id === incoming.externalId &&
    existing.occurred_at === (incoming.occurredAt ?? null) &&
    existing.source_account_id === (incoming.sourceAccountId ?? null) &&
    existing.source_label === (incoming.sourceLabel ?? null) &&
    existing.payload_json === JSON.stringify(incoming.payload)
  );
}

export interface UpsertAutomationSignalsResult {
  signals: AutomationSignal[];
  changedSignals: AutomationSignal[];
}

export class AutomationSignalsRepository {
  async upsertManyDetailedAsync(
    items: CreateAutomationSignalDto[],
  ): Promise<UpsertAutomationSignalsResult> {
    if (env.dbClient !== "postgres") {
      return this.upsertManyDetailed(items);
    }

    if (items.length === 0) {
      return { signals: [], changedSignals: [] };
    }

    const changedKeys = new Set<string>();

    for (const item of items) {
      const now = new Date().toISOString();
      const existingResult = await getPostgresPool().query<AutomationSignalRow>(
        "SELECT * FROM automation_signals WHERE dedupe_key = $1 LIMIT 1",
        [item.dedupeKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const materialChange = !materiallyMatches(existing, item);
        await getPostgresPool().query(
          `UPDATE automation_signals
             SET provider = $1, signal_type = $2, external_id = $3, occurred_at = $4, synced_at = $5,
                 source_account_id = $6, source_label = $7, payload_json = $8, updated_at = $9
           WHERE id = $10`,
          [
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
          ],
        );
        if (materialChange) changedKeys.add(item.dedupeKey);
        continue;
      }

      await getPostgresPool().query(
        `INSERT INTO automation_signals (
          id, provider, signal_type, external_id, dedupe_key, occurred_at,
          synced_at, source_account_id, source_label, payload_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
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
        ],
      );
      changedKeys.add(item.dedupeKey);
    }

    const signals = await Promise.all(
      items.map(async (item) => this.findByDedupeKeyAsync(item.dedupeKey).then((s) => s!)),
    );
    return {
      signals,
      changedSignals: signals.filter((signal) => changedKeys.has(signal.dedupeKey)),
    };
  }

  upsertManyDetailed(
    items: CreateAutomationSignalDto[],
  ): UpsertAutomationSignalsResult {
    if (items.length === 0) {
      return { signals: [], changedSignals: [] };
    }

    const selectStmt = getDb().prepare(
      "SELECT * FROM automation_signals WHERE dedupe_key = ? LIMIT 1",
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

    const changedKeys = new Set<string>();

    getDb().transaction(() => {
      for (const item of items) {
        const now = new Date().toISOString();
        const existing = selectStmt.get(item.dedupeKey) as
          | AutomationSignalRow
          | undefined;
        if (existing) {
          const materialChange = !materiallyMatches(existing, item);
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
          if (materialChange) {
            changedKeys.add(item.dedupeKey);
          }
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
        changedKeys.add(item.dedupeKey);
      }
    })();

    const signals = items.map((item) => this.findByDedupeKey(item.dedupeKey)!);
    return {
      signals,
      changedSignals: signals.filter((signal) =>
        changedKeys.has(signal.dedupeKey),
      ),
    };
  }

  upsertMany(items: CreateAutomationSignalDto[]): AutomationSignal[] {
    return this.upsertManyDetailed(items).signals;
  }

  async upsertManyAsync(items: CreateAutomationSignalDto[]): Promise<AutomationSignal[]> {
    return (await this.upsertManyDetailedAsync(items)).signals;
  }

  async findByDedupeKeyAsync(dedupeKey: string): Promise<AutomationSignal | null> {
    if (env.dbClient === "postgres") {
      const result = await getPostgresPool().query<AutomationSignalRow>(
        "SELECT * FROM automation_signals WHERE dedupe_key = $1 LIMIT 1",
        [dedupeKey],
      );
      const row = result.rows[0];
      return row ? rowToSignal(row) : null;
    }
    return this.findByDedupeKey(dedupeKey);
  }

  findByDedupeKey(dedupeKey: string): AutomationSignal | null {
    const row = getDb()
      .prepare("SELECT * FROM automation_signals WHERE dedupe_key = ? LIMIT 1")
      .get(dedupeKey) as AutomationSignalRow | undefined;
    return row ? rowToSignal(row) : null;
  }

  async listRecentAsync(limit = 50): Promise<AutomationSignal[]> {
    if (env.dbClient === "postgres") {
      const result = await getPostgresPool().query<AutomationSignalRow>(
        `SELECT * FROM automation_signals
         ORDER BY synced_at DESC, updated_at DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows.map(rowToSignal);
    }
    return this.listRecent(limit);
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
