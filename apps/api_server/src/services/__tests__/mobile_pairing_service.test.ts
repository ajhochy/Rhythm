import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../../repositories/mobile_devices_repository';
import { MobilePairingService } from '../mobile_pairing_service';

const { timingSafeEqualSpy } = vi.hoisted(() => ({
  timingSafeEqualSpy: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return {
    ...actual,
    timingSafeEqual: timingSafeEqualSpy,
  };
});

describe('mobile pairing schema', () => {
  it('creates the pairing tables additively and idempotently', () => {
    const db = new Database(':memory:');

    initializeMobilePairingSchema(db);
    initializeMobilePairingSchema(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('mobile_pairing_codes', 'mobile_devices')
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      'mobile_devices',
      'mobile_pairing_codes',
    ]);
    db.close();
  });
});

describe('MobilePairingService', () => {
  let db: Database.Database;
  let service: MobilePairingService;
  let now: Date;

  beforeEach(() => {
    timingSafeEqualSpy.mockClear();
    db = new Database(':memory:');
    initializeMobilePairingSchema(db);
    now = new Date('2026-07-24T18:00:00.000Z');
    service = new MobilePairingService({
      repository: new MobileDevicesRepository(db),
      hostId: 'host-a',
      now: () => now,
      pairingCodeTtlMs: 60_000,
    });
  });

  it('generates a 32-byte pairing code and persists only its SHA-256 verifier', () => {
    const result = service.createPairingCode(1);
    const row = db
      .prepare('SELECT code_verifier FROM mobile_pairing_codes WHERE id = ?')
      .get(result.id) as { code_verifier: string };

    expect(Buffer.from(result.pairingCode, 'base64url')).toHaveLength(32);
    expect(row.code_verifier).toMatch(/^[a-f0-9]{64}$/);
    expect(row.code_verifier).not.toContain(result.pairingCode);
    expect(JSON.stringify(row)).not.toContain(result.pairingCode);
  });

  it('pairs a device with a 32-byte token and persists only its SHA-256 verifier', () => {
    const { pairingCode } = service.createPairingCode(1);

    const result = service.pair({
      pairingCode,
      userId: 1,
      deviceName: 'AJ iPhone',
    });
    const row = db
      .prepare('SELECT token_verifier FROM mobile_devices WHERE id = ?')
      .get(result.deviceId) as { token_verifier: string };

    expect(Buffer.from(result.deviceToken, 'base64url')).toHaveLength(32);
    expect(row.token_verifier).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_verifier).not.toContain(result.deviceToken);
    expect(result).toMatchObject({
      hostId: 'host-a',
      gatewayVersion: '1',
      rhythmVersion: '0.1.0',
      opencodeVersion: '1.14.49',
      contractFingerprint: 'fd0aae2af9c69775409c399056cffeb39fd1f248f56abff7dae391895ca1add8',
      features: ['pairing', 'device-revocation'],
      minimumMobileVersion: '0.1.0',
    });
  });

  it('allows a pairing code to be used only once', () => {
    const { pairingCode } = service.createPairingCode(1);
    service.pair({ pairingCode, userId: 1, deviceName: 'First iPhone' });

    expect(() =>
      service.pair({ pairingCode, userId: 1, deviceName: 'Second iPhone' }),
    ).toThrowError('Pairing code has already been used');
  });

  it('rejects an expired pairing code without creating a device', () => {
    const { pairingCode } = service.createPairingCode(1);
    now = new Date('2026-07-24T18:01:00.001Z');

    expect(() =>
      service.pair({ pairingCode, userId: 1, deviceName: 'AJ iPhone' }),
    ).toThrowError('Pairing code has expired');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').get(),
    ).toEqual({ count: 0 });
  });

  it('treats the exact expiration instant as expired', () => {
    const { pairingCode } = service.createPairingCode(1);
    now = new Date('2026-07-24T18:01:00.000Z');

    expect(() =>
      service.pair({ pairingCode, userId: 1, deviceName: 'AJ iPhone' }),
    ).toThrowError('Pairing code has expired');
  });

  it('rejects a pairing attempt from a different Rhythm user', () => {
    const { pairingCode } = service.createPairingCode(1);

    expect(() =>
      service.pair({ pairingCode, userId: 2, deviceName: 'AJ iPhone' }),
    ).toThrowError('Pairing code belongs to a different Rhythm user');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').get(),
    ).toEqual({ count: 0 });
  });

  it('replaces the active host for a Rhythm user', () => {
    const firstCode = service.createPairingCode(1).pairingCode;
    const first = service.pair({
      pairingCode: firstCode,
      userId: 1,
      deviceName: 'AJ iPhone',
    });
    const replacementService = new MobilePairingService({
      repository: new MobileDevicesRepository(db),
      hostId: 'host-b',
      now: () => now,
    });
    const replacementCode = replacementService.createPairingCode(1).pairingCode;
    const replacement = replacementService.pair({
      pairingCode: replacementCode,
      userId: 1,
      deviceName: 'AJ iPhone',
    });

    const rows = db
      .prepare(
        `SELECT id, host_id, revoked_at FROM mobile_devices
         WHERE user_id = ? ORDER BY created_at, id`,
      )
      .all(1) as Array<{ id: string; host_id: string; revoked_at: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.deviceId)?.revoked_at).not.toBeNull();
    expect(rows.find((row) => row.id === replacement.deviceId)).toMatchObject({
      host_id: 'host-b',
      revoked_at: null,
    });
    expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
  });

  it('revokes a device token and excludes it from authentication', () => {
    const pairingCode = service.createPairingCode(1).pairingCode;
    const paired = service.pair({
      pairingCode,
      userId: 1,
      deviceName: 'AJ iPhone',
    });

    expect(service.authenticateDevice(paired.deviceToken)?.id).toBe(paired.deviceId);
    expect(service.authenticateDevice('x'.repeat(paired.deviceToken.length))).toBeNull();
    expect(service.revokeDevice(paired.deviceId, 1)).toBe(true);
    expect(service.authenticateDevice(paired.deviceToken)).toBeNull();
    expect(service.listDevices(1)).toEqual([
      expect.objectContaining({ id: paired.deviceId, revokedAt: now.toISOString() }),
    ]);
  });

  it('uses Node constant-time comparison for pairing codes and device tokens', () => {
    const pairingCode = service.createPairingCode(1).pairingCode;
    const paired = service.pair({
      pairingCode,
      userId: 1,
      deviceName: 'AJ iPhone',
    });

    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
    expect(timingSafeEqualSpy.mock.calls[0][0]).toHaveLength(32);
    expect(timingSafeEqualSpy.mock.calls[0][1]).toHaveLength(32);

    expect(service.authenticateDevice(paired.deviceToken)?.id).toBe(
      paired.deviceId,
    );
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);
    expect(timingSafeEqualSpy.mock.calls[1][0]).toHaveLength(32);
    expect(timingSafeEqualSpy.mock.calls[1][1]).toHaveLength(32);
  });
});
