/**
 * #894 — capability status checker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { IntegrationAccountsRepository } from '../../repositories/integration_accounts_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { checkCapabilities } from '../capability_status_checker';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('checkCapabilities', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('reports database ok and every OAuth integration down when nothing is connected', async () => {
    const status = await checkCapabilities();

    expect(status.capabilities.database.state).toBe('ok');
    expect(status.capabilities.planning_center.state).toBe('down');
    expect(status.capabilities.gmail.state).toBe('down');
    expect(status.capabilities.google_calendar.state).toBe('down');
    expect(status.capabilities.rhythm_mcp.state).toBe('ok');
    expect(status.checkedAt).toBeTruthy();
  });

  it('reports planning_center ok once an account is connected', async () => {
    const user = new UsersRepository().create({ name: 'Staff', email: 'staff@church.org' });
    await new IntegrationAccountsRepository().upsertPlanningCenterAccountAsync({
      ownerId: user.id,
      externalAccountId: 'pco-123',
      email: 'staff@church.org',
      displayName: 'Staff',
      accessToken: 'tok',
      refreshToken: 'refresh',
      scope: null,
      tokenType: 'Bearer',
      expiresAt: null,
    });

    const status = await checkCapabilities();

    expect(status.capabilities.planning_center.state).toBe('ok');
    // Unrelated integrations are unaffected.
    expect(status.capabilities.gmail.state).toBe('down');
  });
});
