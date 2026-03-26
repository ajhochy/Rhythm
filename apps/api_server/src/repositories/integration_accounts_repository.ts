import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import type {
  IntegrationAccount,
  IntegrationProvider,
} from '../models/integration_account';

interface IntegrationAccountRow {
  id: string;
  provider: string;
  external_account_id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expires_at: string | null;
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAccount(row: IntegrationAccountRow): IntegrationAccount {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    externalAccountId: row.external_account_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status as IntegrationAccount['status'],
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope,
    tokenType: row.token_type,
    expiresAt: row.expires_at,
    lastSyncedAt: row.last_synced_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class IntegrationAccountsRepository {
  findAll(): IntegrationAccount[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM integration_accounts ORDER BY provider ASC, created_at ASC',
      )
      .all() as IntegrationAccountRow[];
    return rows.map(rowToAccount);
  }

  findByProvider(provider: IntegrationProvider): IntegrationAccount | null {
    const row = getDb()
      .prepare('SELECT * FROM integration_accounts WHERE provider = ? LIMIT 1')
      .get(provider) as IntegrationAccountRow | undefined;
    return row ? rowToAccount(row) : null;
  }

  markSynced(provider: IntegrationProvider): void {
    getDb()
      .prepare(
        `UPDATE integration_accounts
         SET last_synced_at = ?, error_message = NULL, status = 'connected', updated_at = ?
         WHERE provider = ?`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), provider);
  }

  markError(provider: IntegrationProvider, message: string): void {
    getDb()
      .prepare(
        `UPDATE integration_accounts
         SET status = 'error', error_message = ?, updated_at = ?
         WHERE provider = ?`,
      )
      .run(message, new Date().toISOString(), provider);
  }

  upsertGoogleAccount(data: {
    externalAccountId: string;
    email: string | null;
    displayName: string | null;
    accessToken: string;
    refreshToken: string | null;
    scope: string | null;
    tokenType: string | null;
    expiresAt: string | null;
  }): IntegrationAccount[] {
    const now = new Date().toISOString();
    const providers: IntegrationProvider[] = ['google_calendar', 'gmail'];

    for (const provider of providers) {
      const existing = this.findByProvider(provider);
      if (existing) {
        getDb()
          .prepare(
            `UPDATE integration_accounts
             SET external_account_id = ?, email = ?, display_name = ?, status = ?,
                 access_token = ?, refresh_token = ?, scope = ?, token_type = ?,
                 expires_at = ?, error_message = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            data.externalAccountId,
            data.email,
            data.displayName,
            'connected',
            data.accessToken,
            data.refreshToken ?? existing.refreshToken,
            data.scope,
            data.tokenType,
            data.expiresAt,
            now,
            existing.id,
          );
      } else {
        getDb()
          .prepare(
            `INSERT INTO integration_accounts (
              id, provider, external_account_id, email, display_name, status,
              access_token, refresh_token, scope, token_type, expires_at,
              last_synced_at, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            uuidv4(),
            provider,
            data.externalAccountId,
            data.email,
            data.displayName,
            'connected',
            data.accessToken,
            data.refreshToken,
            data.scope,
            data.tokenType,
            data.expiresAt,
            null,
            null,
            now,
            now,
          );
      }
    }

    const accounts = providers.map((provider) => this.findByProvider(provider));
    return accounts.filter(
      (account): account is IntegrationAccount => account != null,
    );
  }

  upsertPlanningCenterAccount(data: {
    externalAccountId: string;
    email: string | null;
    displayName: string | null;
    accessToken: string;
    refreshToken: string | null;
    scope: string | null;
    tokenType: string | null;
    expiresAt: string | null;
  }): IntegrationAccount {
    const now = new Date().toISOString();
    const provider: IntegrationProvider = 'planning_center';
    const existing = this.findByProvider(provider);

    if (existing) {
      getDb()
        .prepare(
          `UPDATE integration_accounts
           SET external_account_id = ?, email = ?, display_name = ?, status = ?,
               access_token = ?, refresh_token = ?, scope = ?, token_type = ?,
               expires_at = ?, error_message = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          data.externalAccountId,
          data.email,
          data.displayName,
          'connected',
          data.accessToken,
          data.refreshToken ?? existing.refreshToken,
          data.scope,
          data.tokenType,
          data.expiresAt,
          now,
          existing.id,
        );
    } else {
      getDb()
        .prepare(
          `INSERT INTO integration_accounts (
            id, provider, external_account_id, email, display_name, status,
            access_token, refresh_token, scope, token_type, expires_at,
            last_synced_at, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuidv4(),
          provider,
          data.externalAccountId,
          data.email,
          data.displayName,
          'connected',
          data.accessToken,
          data.refreshToken,
          data.scope,
          data.tokenType,
          data.expiresAt,
          null,
          null,
          now,
          now,
        );
    }

    return this.findByProvider(provider)!;
  }
}
