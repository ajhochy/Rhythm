import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';

import { runMigrations } from '../database/migrations';
import { PromotionTrustStateRepository } from './promotion_trust_state_repository';

describe('PromotionTrustStateRepository — D4.1 (#1439)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  test('getSingletonAsync creates the row with defaults on first access', async () => {
    const repo = new PromotionTrustStateRepository(db);
    const state = await repo.getSingletonAsync();

    expect(state.totalVerified).toBe(0);
    expect(state.totalRegressions).toBe(0);
    expect(state.autoPromotionEnabled).toBe(false);
    expect(state.enabledAt).toBeNull();
    expect(state.trustThreshold).toBe(10);
  });

  test('singleton is enforced: repeated access never creates a second row', async () => {
    const repo = new PromotionTrustStateRepository(db);
    await repo.getSingletonAsync();
    await repo.getSingletonAsync();
    await repo.updateAsync({ totalVerified: 3 });

    const count = db.prepare('SELECT COUNT(*) AS n FROM promotion_trust_state').get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('updateAsync updates only the provided fields', async () => {
    const repo = new PromotionTrustStateRepository(db);
    await repo.getSingletonAsync();

    const updated = await repo.updateAsync({ totalVerified: 7, totalRegressions: 1 });
    expect(updated.totalVerified).toBe(7);
    expect(updated.totalRegressions).toBe(1);
    expect(updated.trustThreshold).toBe(10);
    expect(updated.autoPromotionEnabled).toBe(false);

    const enabledAt = '2026-08-20T00:00:00.000Z';
    const enabled = await repo.updateAsync({ autoPromotionEnabled: true, enabledAt });
    expect(enabled.autoPromotionEnabled).toBe(true);
    expect(enabled.enabledAt).toBe(enabledAt);
    // Fields not passed this time are preserved from the prior update.
    expect(enabled.totalVerified).toBe(7);
    expect(enabled.totalRegressions).toBe(1);
  });
});
