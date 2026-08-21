/**
 * promotion_trust_state_repository.ts — D4.1 (#1439).
 *
 * Singleton row (fixed id `'promotion_trust_state'`), mirroring
 * OrgSettingsRepository's pattern: there is exactly one trust-state row, so
 * it is keyed by a fixed id rather than looked up, and every method targets
 * that id. Dual-engine: SQLite uses synchronous better-sqlite3 with the
 * throwaway `:memory:` fallback for tests that never called initDb();
 * Postgres queries the pool directly with no fallback.
 */

import Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import { DEFAULT_TRUST_THRESHOLD, type PromotionTrustState } from '../models/promotion_trust_state';

export const PROMOTION_TRUST_STATE_ID = 'promotion_trust_state';

interface PromotionTrustStateRow {
  id: string;
  total_verified: number;
  total_regressions: number;
  auto_promotion_enabled: number | boolean;
  enabled_at: string | Date | null;
  trust_threshold: number;
  auto_promotion_eligible: number | boolean;
  updated_at: string | Date;
}

export interface PromotionTrustStateUpdate {
  totalVerified?: number;
  totalRegressions?: number;
  autoPromotionEnabled?: boolean;
  enabledAt?: string | null;
  trustThreshold?: number;
}

/**
 * D4.2/D4.6 (#1440/#1444) — the ONLY shape trust_counter_service.ts writes
 * through. It excludes `trustThreshold`; a non-zero regression atomically
 * forces the enabled gate off and clears `enabledAt`.
 */
export interface PromotionTrustStateEligibilityUpdate {
  totalVerified: number;
  totalRegressions: number;
  autoPromotionEligible: boolean;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function toBool(value: number | boolean): boolean {
  return value === true || value === 1;
}

function rowToModel(row: PromotionTrustStateRow): PromotionTrustState {
  return {
    totalVerified: Number(row.total_verified),
    totalRegressions: Number(row.total_regressions),
    autoPromotionEnabled: toBool(row.auto_promotion_enabled),
    enabledAt: row.enabled_at ? toIso(row.enabled_at) : null,
    trustThreshold: Number(row.trust_threshold),
    autoPromotionEligible: toBool(row.auto_promotion_eligible),
    updatedAt: toIso(row.updated_at),
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class PromotionTrustStateRepository {
  /** SQLite-only handle. Never populated (and never used) under Postgres. */
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    if (env.dbClient === 'postgres') {
      this.db = null;
      return;
    }
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        this.db = makeInMemoryDb();
      }
    }
  }

  private async readSingletonAsync(): Promise<PromotionTrustState> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM promotion_trust_state WHERE id = $1`,
        [PROMOTION_TRUST_STATE_ID],
      );
      return rowToModel(r.rows[0] as PromotionTrustStateRow);
    }
    const row = this.db!
      .prepare(`SELECT * FROM promotion_trust_state WHERE id = ?`)
      .get(PROMOTION_TRUST_STATE_ID) as PromotionTrustStateRow;
    return rowToModel(row);
  }

  /**
   * The singleton read. Creates the row with defaults on first access:
   * `auto_promotion_enabled=false`, `trust_threshold=10`, zeroed counters,
   * `enabled_at=null`. `ON CONFLICT ... DO NOTHING` makes the create race-safe
   * — a second concurrent first-access reads back the row the first one
   * wrote rather than producing a second row.
   */
  async getSingletonAsync(): Promise<PromotionTrustState> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO promotion_trust_state
           (id, total_verified, total_regressions, auto_promotion_enabled, enabled_at, trust_threshold, updated_at)
         VALUES ($1, 0, 0, FALSE, NULL, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [PROMOTION_TRUST_STATE_ID, DEFAULT_TRUST_THRESHOLD, now],
      );
      return this.readSingletonAsync();
    }
    this.db!
      .prepare(
        `INSERT INTO promotion_trust_state
           (id, total_verified, total_regressions, auto_promotion_enabled, enabled_at, trust_threshold, updated_at)
         VALUES (?, 0, 0, 0, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(PROMOTION_TRUST_STATE_ID, DEFAULT_TRUST_THRESHOLD, now);
    return this.readSingletonAsync();
  }

  /**
   * Partial update of the singleton row. Ensures the row exists first (same
   * default-creating path as {@link getSingletonAsync}), then updates only
   * the fields the caller passed — every omitted field keeps its current
   * value. Always targets the fixed singleton id, so this can never create a
   * second row.
   */
  async updateAsync(update: PromotionTrustStateUpdate): Promise<PromotionTrustState> {
    const current = await this.getSingletonAsync();
    const next: PromotionTrustState = {
      totalVerified: update.totalVerified ?? current.totalVerified,
      totalRegressions: update.totalRegressions ?? current.totalRegressions,
      autoPromotionEnabled: update.autoPromotionEnabled ?? current.autoPromotionEnabled,
      enabledAt: update.enabledAt !== undefined ? update.enabledAt : current.enabledAt,
      trustThreshold: update.trustThreshold ?? current.trustThreshold,
      autoPromotionEligible: current.autoPromotionEligible,
      updatedAt: current.updatedAt,
    };
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE promotion_trust_state
            SET total_verified = $1, total_regressions = $2, auto_promotion_enabled = $3,
                enabled_at = $4, trust_threshold = $5, updated_at = $6
          WHERE id = $7`,
        [
          next.totalVerified,
          next.totalRegressions,
          next.autoPromotionEnabled,
          next.enabledAt,
          next.trustThreshold,
          now,
          PROMOTION_TRUST_STATE_ID,
        ],
      );
      return this.readSingletonAsync();
    }
    this.db!
      .prepare(
        `UPDATE promotion_trust_state
            SET total_verified = ?, total_regressions = ?, auto_promotion_enabled = ?,
                enabled_at = ?, trust_threshold = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.totalVerified,
        next.totalRegressions,
        next.autoPromotionEnabled ? 1 : 0,
        next.enabledAt,
        next.trustThreshold,
        now,
        PROMOTION_TRUST_STATE_ID,
      );
    return this.readSingletonAsync();
  }

  /**
   * D4.2/D4.6 (#1440/#1444) — the ONLY write path trust_counter_service.ts
   * uses. A zero-regression refresh keeps D4.2's existing eligibility
   * behavior. A non-zero regression is monotonic and atomically persists the
   * count, false eligibility, disabled gate, and null enabledAt. Preserving
   * the maximum regression count protects against a stale zero-refresh
   * racing after the durable D2 event has already been observed.
   */
  async recordEligibilityAsync(
    update: PromotionTrustStateEligibilityUpdate,
  ): Promise<PromotionTrustState> {
    await this.getSingletonAsync();
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE promotion_trust_state
            SET total_verified = $1,
                total_regressions = GREATEST(total_regressions, $2),
                auto_promotion_eligible = CASE
                  WHEN GREATEST(total_regressions, $2) > 0 THEN FALSE
                  ELSE $3
                END,
                auto_promotion_enabled = CASE
                  WHEN GREATEST(total_regressions, $2) > 0 THEN FALSE
                  ELSE auto_promotion_enabled
                END,
                enabled_at = CASE
                  WHEN GREATEST(total_regressions, $2) > 0 THEN NULL
                  ELSE enabled_at
                END,
                updated_at = $4
          WHERE id = $5`,
        [
          update.totalVerified,
          update.totalRegressions,
          update.autoPromotionEligible,
          now,
          PROMOTION_TRUST_STATE_ID,
        ],
      );
      return this.readSingletonAsync();
    }
    this.db!
      .prepare(
        `UPDATE promotion_trust_state
            SET total_verified = ?,
                total_regressions = MAX(total_regressions, ?),
                auto_promotion_eligible = CASE
                  WHEN MAX(total_regressions, ?) > 0 THEN 0
                  ELSE ?
                END,
                auto_promotion_enabled = CASE
                  WHEN MAX(total_regressions, ?) > 0 THEN 0
                  ELSE auto_promotion_enabled
                END,
                enabled_at = CASE
                  WHEN MAX(total_regressions, ?) > 0 THEN NULL
                  ELSE enabled_at
                END,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        update.totalVerified,
        update.totalRegressions,
        update.totalRegressions,
        update.autoPromotionEligible ? 1 : 0,
        update.totalRegressions,
        update.totalRegressions,
        now,
        PROMOTION_TRUST_STATE_ID,
      );
    return this.readSingletonAsync();
  }
}
