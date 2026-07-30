import type Database from 'better-sqlite3';

export interface MobilePairingCodeRecord {
  id: string;
  hostId: string;
  userId: number;
  codeVerifier: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface MobileDeviceRecord {
  id: string;
  hostId: string;
  userId: number;
  name: string;
  tokenVerifier: string;
  revokedAt: string | null;
  createdAt: string;
}

function pairingCodeFromRow(row: Record<string, unknown>): MobilePairingCodeRecord {
  return {
    id: row.id as string,
    hostId: row.host_id as string,
    userId: row.user_id as number,
    codeVerifier: row.code_verifier as string,
    expiresAt: row.expires_at as string,
    consumedAt: (row.consumed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function deviceFromRow(row: Record<string, unknown>): MobileDeviceRecord {
  return {
    id: row.id as string,
    hostId: row.host_id as string,
    userId: row.user_id as number,
    name: row.name as string,
    tokenVerifier: row.token_verifier as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function initializeMobilePairingSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_pairing_codes (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      code_verifier TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mobile_devices (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token_verifier TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function findSolePairedUserId(
  db: Database.Database,
): number | null {
  const pairingSchemaExists = db
    .prepare(
      `SELECT 1
         FROM sqlite_master
        WHERE type = 'table' AND name = 'mobile_devices'
        LIMIT 1`,
    )
    .get();
  if (!pairingSchemaExists) return null;

  const rows = db
    .prepare(
      `SELECT DISTINCT user_id
         FROM mobile_devices
        ORDER BY user_id
        LIMIT 2`,
    )
    .all() as Array<{ user_id: number }>;
  if (rows.length !== 1) return null;

  const userId = rows[0].user_id;
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export class MobileDevicesRepository {
  constructor(private readonly db: Database.Database) {}

  insertPairingCode(record: MobilePairingCodeRecord): void {
    this.db
      .prepare(
        `INSERT INTO mobile_pairing_codes
           (id, host_id, user_id, code_verifier, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.hostId,
        record.userId,
        record.codeVerifier,
        record.expiresAt,
        record.consumedAt,
        record.createdAt,
      );
  }

  listPairingCodes(): MobilePairingCodeRecord[] {
    const rows = this.db.prepare('SELECT * FROM mobile_pairing_codes').all();
    return (rows as Record<string, unknown>[]).map(pairingCodeFromRow);
  }

  findHostId(): string | null {
    const row = this.db
      .prepare(
        `SELECT host_id FROM mobile_devices
         UNION ALL
         SELECT host_id FROM mobile_pairing_codes
         LIMIT 1`,
      )
      .get() as { host_id: string } | undefined;
    return row?.host_id ?? null;
  }

  consumePairingCodeAndCreateDevice(
    pairingCodeId: string,
    device: MobileDeviceRecord,
    consumedAt: string,
  ): boolean {
    return this.db.transaction(() => {
      const consumed = this.db
        .prepare(
          `UPDATE mobile_pairing_codes
           SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .run(consumedAt, pairingCodeId);
      if (consumed.changes !== 1) return false;

      this.db
        .prepare(
          `INSERT INTO mobile_devices
             (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          device.id,
          device.hostId,
          device.userId,
          device.name,
          device.tokenVerifier,
          device.revokedAt,
          device.createdAt,
        );
      return true;
    })();
  }

  listDevices(userId?: number): MobileDeviceRecord[] {
    const rows = userId === undefined
      ? this.db.prepare('SELECT * FROM mobile_devices ORDER BY created_at DESC').all()
      : this.db
          .prepare('SELECT * FROM mobile_devices WHERE user_id = ? ORDER BY created_at DESC')
          .all(userId);
    return (rows as Record<string, unknown>[]).map(deviceFromRow);
  }

  revokeDevice(id: string, userId: number, revokedAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE mobile_devices SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(revokedAt, id, userId);
    return result.changes === 1;
  }
}
