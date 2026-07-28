import { randomUUID } from 'node:crypto';

import { getDb } from '../database/db';
import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../repositories/mobile_devices_repository';
import { MobilePairingService } from './mobile_pairing_service';

let pairingService: MobilePairingService | null = null;
let pairingDatabase: ReturnType<typeof getDb> | null = null;

/**
 * Shared mobile-gateway auth runtime.
 *
 * HTTP routes and WebSocket upgrades must authenticate against the same
 * repository-backed service. Keeping this lazy also preserves createApp()
 * tests that install an in-memory database after importing route modules.
 */
export function getMobilePairingService(): MobilePairingService {
  const db = getDb();
  if (pairingService && pairingDatabase === db) return pairingService;
  initializeMobilePairingSchema(db);
  const repository = new MobileDevicesRepository(db);
  pairingService = new MobilePairingService({
    repository,
    hostId: repository.findHostId() ?? randomUUID(),
  });
  pairingDatabase = db;
  return pairingService;
}

/** Test-only reset for suites that replace the process-global database. */
export function resetMobileGatewayRuntimeForTest(): void {
  if (process.env.VITEST !== 'true') return;
  pairingService = null;
  pairingDatabase = null;
}
