import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import type {
  IntegrationAccount,
  IntegrationProvider,
} from '../models/integration_account';

interface IntegrationAccountRow {
  id: string;
  owner_id: number | null;
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
    ownerId: row.owner_id,
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
  async findAllAsync(ownerId?: number): Promise<IntegrationAccount[]> {
    if (env.dbClient === 'postgres') {
      const result = ownerId == null
        ? await getPostgresPool().query<IntegrationAccountRow>(
            'SELECT * FROM integration_accounts ORDER BY provider ASC, created_at ASC',
          )
        : await getPostgresPool().query<IntegrationAccountRow>(
            'SELECT * FROM integration_accounts WHERE owner_id = $1 ORDER BY provider ASC, created_at ASC',
            [ownerId],
          );
      return result.rows.map(rowToAccount);
    }
    return this.findAll(ownerId);
  }

  findAll(ownerId?: number): IntegrationAccount[] {
    const rows = getDb()
      .prepare(
        ownerId == null
            ? 'SELECT * FROM integration_accounts ORDER BY provider ASC, created_at ASC'
            : 'SELECT * FROM integration_accounts WHERE owner_id = ? ORDER BY provider ASC, created_at ASC',
      )
      .all(...(ownerId == null ? [] : [ownerId])) as IntegrationAccountRow[];
    return rows.map(rowToAccount);
  }

  async findByProviderAsync(
    provider: IntegrationProvider,
    ownerId?: number,
  ): Promise<IntegrationAccount | null> {
    if (env.dbClient === 'postgres') {
      const result = ownerId == null
        ? await getPostgresPool().query<IntegrationAccountRow>(
            'SELECT * FROM integration_accounts WHERE provider = $1 LIMIT 1',
            [provider],
          )
        : await getPostgresPool().query<IntegrationAccountRow>(
            'SELECT * FROM integration_accounts WHERE provider = $1 AND owner_id = $2 LIMIT 1',
            [provider, ownerId],
          );
      const row = result.rows[0];
      return row ? rowToAccount(row) : null;
    }
    return this.findByProvider(provider, ownerId);
  }

  findByProvider(
    provider: IntegrationProvider,
    ownerId?: number,
  ): IntegrationAccount | null {
    const row = getDb()
      .prepare(
        ownerId == null
            ? 'SELECT * FROM integration_accounts WHERE provider = ? LIMIT 1'
            : 'SELECT * FROM integration_accounts WHERE provider = ? AND owner_id = ? LIMIT 1',
      )
      .get(...(ownerId == null ? [provider] : [provider, ownerId])) as
      | IntegrationAccountRow
      | undefined;
    return row ? rowToAccount(row) : null;
  }

  async markSyncedAsync(provider: IntegrationProvider, ownerId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `UPDATE integration_accounts
         SET last_synced_at = $1, error_message = NULL, status = 'connected', updated_at = $2
         WHERE provider = $3 AND owner_id = $4`,
        [now, now, provider, ownerId],
      );
      return;
    }
    this.markSynced(provider, ownerId);
  }

  markSynced(provider: IntegrationProvider, ownerId: number): void {
    getDb()
      .prepare(
        `UPDATE integration_accounts
         SET last_synced_at = ?, error_message = NULL, status = 'connected', updated_at = ?
         WHERE provider = ? AND owner_id = ?`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), provider, ownerId);
  }

  async markErrorAsync(
    provider: IntegrationProvider,
    ownerId: number,
    message: string,
  ): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE integration_accounts
         SET status = 'error', error_message = $1, updated_at = $2
         WHERE provider = $3 AND owner_id = $4`,
        [message, new Date().toISOString(), provider, ownerId],
      );
      return;
    }
    this.markError(provider, ownerId, message);
  }

  markError(provider: IntegrationProvider, ownerId: number, message: string): void {
    getDb()
      .prepare(
        `UPDATE integration_accounts
         SET status = 'error', error_message = ?, updated_at = ?
         WHERE provider = ? AND owner_id = ?`,
      )
      .run(message, new Date().toISOString(), provider, ownerId);
  }

  async upsertGoogleAccountAsync(data: {
    ownerId: number;
    externalAccountId: string;
    email: string | null;
    displayName: string | null;
    accessToken: string;
    refreshToken: string | null;
    scope: string | null;
    tokenType: string | null;
    expiresAt: string | null;
  }): Promise<IntegrationAccount[]> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      const providers: IntegrationProvider[] = ['google_calendar', 'gmail'];
      for (const provider of providers) {
        const existing = await this.findByProviderAsync(provider, data.ownerId);
        if (existing) {
          await getPostgresPool().query(
            `UPDATE integration_accounts
             SET external_account_id = $1, email = $2, display_name = $3, status = $4,
                 access_token = $5, refresh_token = $6, scope = $7, token_type = $8,
                 expires_at = $9, error_message = NULL, updated_at = $10
             WHERE id = $11`,
            [
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
            ],
          );
        } else {
          await getPostgresPool().query(
            `INSERT INTO integration_accounts (
              id, owner_id, provider, external_account_id, email, display_name, status,
              access_token, refresh_token, scope, token_type, expires_at,
              last_synced_at, error_message, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              uuidv4(),
              data.ownerId,
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
            ],
          );
        }
      }
      const accounts = await Promise.all(
        providers.map((provider) => this.findByProviderAsync(provider, data.ownerId)),
      );
      return accounts.filter((account): account is IntegrationAccount => account != null);
    }
    return this.upsertGoogleAccount(data);
  }

  upsertGoogleAccount(data: {
    ownerId: number;
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
      const existing = this.findByProvider(provider, data.ownerId);
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
              id, owner_id, provider, external_account_id, email, display_name, status,
              access_token, refresh_token, scope, token_type, expires_at,
              last_synced_at, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            uuidv4(),
            data.ownerId,
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

    const accounts = providers.map(
      (provider) => this.findByProvider(provider, data.ownerId),
    );
    return accounts.filter(
      (account): account is IntegrationAccount => account != null,
    );
  }

  async upsertPlanningCenterAccountAsync(data: {
    ownerId: number;
    externalAccountId: string;
    email: string | null;
    displayName: string | null;
    accessToken: string;
    refreshToken: string | null;
    scope: string | null;
    tokenType: string | null;
    expiresAt: string | null;
  }): Promise<IntegrationAccount> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      const provider: IntegrationProvider = 'planning_center';
      const existing = await this.findByProviderAsync(provider, data.ownerId);
      if (existing) {
        await getPostgresPool().query(
          `UPDATE integration_accounts
           SET external_account_id = $1, email = $2, display_name = $3, status = $4,
               access_token = $5, refresh_token = $6, scope = $7, token_type = $8,
               expires_at = $9, error_message = NULL, updated_at = $10
           WHERE id = $11`,
          [
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
          ],
        );
      } else {
        await getPostgresPool().query(
          `INSERT INTO integration_accounts (
              id, owner_id, provider, external_account_id, email, display_name, status,
              access_token, refresh_token, scope, token_type, expires_at,
              last_synced_at, error_message, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            uuidv4(),
            data.ownerId,
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
          ],
        );
      }
      return (await this.findByProviderAsync(provider, data.ownerId))!;
    }
    return this.upsertPlanningCenterAccount(data);
  }

  upsertPlanningCenterAccount(data: {
    ownerId: number;
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
    const existing = this.findByProvider(provider, data.ownerId);

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
            id, owner_id, provider, external_account_id, email, display_name, status,
            access_token, refresh_token, scope, token_type, expires_at,
            last_synced_at, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuidv4(),
          data.ownerId,
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

    return this.findByProvider(provider, data.ownerId)!;
  }
}
