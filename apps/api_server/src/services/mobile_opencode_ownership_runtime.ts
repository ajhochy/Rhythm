import { getDb } from '../database/db';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';

let ownershipRepository: MobileOpenCodeOwnershipRepository | null = null;
let ownershipDatabase: ReturnType<typeof getDb> | null = null;

export function getMobileOpenCodeOwnershipRepository():
  MobileOpenCodeOwnershipRepository {
  const db = getDb();
  if (ownershipRepository && ownershipDatabase === db) {
    return ownershipRepository;
  }
  ownershipRepository = new MobileOpenCodeOwnershipRepository(db);
  ownershipDatabase = db;
  return ownershipRepository;
}

export function resetMobileOpenCodeOwnershipRuntimeForTest(): void {
  if (process.env.VITEST !== 'true') return;
  ownershipRepository = null;
  ownershipDatabase = null;
}
