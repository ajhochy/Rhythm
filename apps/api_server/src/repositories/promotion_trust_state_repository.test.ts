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

  test('D4.2 (#1440): auto_promotion_eligible defaults false and never implies auto_promotion_enabled', async () => {
    const repo = new PromotionTrustStateRepository(db);
    const state = await repo.getSingletonAsync();
    expect(state.autoPromotionEligible).toBe(false);
  });

  test('D4.2 (#1440): recordEligibilityAsync updates counts and eligibility only, never the enable gate', async () => {
    const repo = new PromotionTrustStateRepository(db);
    await repo.getSingletonAsync();

    const recorded = await repo.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: 0,
      autoPromotionEligible: true,
    });
    expect(recorded.totalVerified).toBe(10);
    expect(recorded.totalRegressions).toBe(0);
    expect(recorded.autoPromotionEligible).toBe(true);
    // recordEligibilityAsync has no way to touch these — they must stay at
    // their untouched defaults.
    expect(recorded.autoPromotionEnabled).toBe(false);
    expect(recorded.enabledAt).toBeNull();

    const count = db.prepare('SELECT COUNT(*) AS n FROM promotion_trust_state').get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('repair (blocking finding A): the schema itself rejects a second row, not just the repository', async () => {
    const repo = new PromotionTrustStateRepository(db);
    await repo.getSingletonAsync();

    expect(() =>
      db
        .prepare(
          `INSERT INTO promotion_trust_state
             (id, total_verified, total_regressions, auto_promotion_enabled, enabled_at, trust_threshold, updated_at)
           VALUES ('some-other-id', 0, 0, 0, NULL, 10, '2026-08-20T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();

    const count = db.prepare('SELECT COUNT(*) AS n FROM promotion_trust_state').get() as { n: number };
    expect(count.n).toBe(1);
  });
});
