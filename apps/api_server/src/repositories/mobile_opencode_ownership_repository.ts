import type Database from 'better-sqlite3';

import { getDb } from '../database/db';

export type MobileOpenCodeResourceKind = 'session' | 'pty';

export interface MobileOpenCodeOwnershipReader {
  isResourceOwnedBy(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean;
  isResourceExplicitlyOwnedBy?(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean;
}

export interface MobileOpenCodeOwnershipStore
  extends MobileOpenCodeOwnershipReader {
  claimResource(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
    createdAt?: string,
  ): boolean;
  releaseResource(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean;
}

export function initializeMobileOpenCodeOwnershipSchema(
  db: Database.Database,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_opencode_resource_owners (
      resource_kind TEXT NOT NULL
        CHECK (resource_kind IN ('session', 'pty')),
      resource_id TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (resource_kind, resource_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mobile_opencode_resource_owner
      ON mobile_opencode_resource_owners(
        owner_user_id,
        project_id,
        resource_kind
      );
  `);
}

export class MobileOpenCodeOwnershipRepository
  implements MobileOpenCodeOwnershipStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database = getDb()) {
    this.db = db;
    initializeMobileOpenCodeOwnershipSchema(db);
  }

  claimResource(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
    createdAt = new Date().toISOString(),
  ): boolean {
    if (
      !resourceId ||
      !Number.isSafeInteger(ownerUserId) ||
      ownerUserId <= 0 ||
      !projectId
    ) {
      return false;
    }
    if (kind === 'session') {
      const desktopOwner = this.db
        .prepare(
          `SELECT owner_user_id, project_id
             FROM agent_sessions
            WHERE sdk_session_id = ?
            LIMIT 1`,
        )
        .get(resourceId) as {
          owner_user_id: number | null;
          project_id: string | null;
        } | undefined;
      if (desktopOwner) {
        if (
          desktopOwner.owner_user_id !== ownerUserId ||
          desktopOwner.project_id !== projectId
        ) {
          return false;
        }
      }
    }
    this.db
      .prepare(
        `INSERT INTO mobile_opencode_resource_owners
           (resource_kind, resource_id, owner_user_id, project_id, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(resource_kind, resource_id) DO NOTHING`,
      )
      .run(kind, resourceId, ownerUserId, projectId, createdAt);
    return this.isResourceOwnedBy(
      kind,
      resourceId,
      ownerUserId,
      projectId,
    );
  }

  isResourceOwnedBy(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean {
    const owned = this.db
      .prepare(
        `SELECT 1
           FROM mobile_opencode_resource_owners
          WHERE resource_kind = ?
            AND resource_id = ?
            AND owner_user_id = ?
            AND project_id = ?
          LIMIT 1`,
      )
      .get(kind, resourceId, ownerUserId, projectId);
    return owned !== undefined;
  }

  isResourceExplicitlyOwnedBy(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean {
    return this.isResourceOwnedBy(
      kind,
      resourceId,
      ownerUserId,
      projectId,
    );
  }

  releaseResource(
    kind: MobileOpenCodeResourceKind,
    resourceId: string,
    ownerUserId: number,
    projectId: string,
  ): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM mobile_opencode_resource_owners
          WHERE resource_kind = ?
            AND resource_id = ?
            AND owner_user_id = ?
            AND project_id = ?`,
      )
      .run(kind, resourceId, ownerUserId, projectId);
    return result.changes === 1;
  }
}
