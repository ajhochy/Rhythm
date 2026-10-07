import { getDb } from '../database/db';
import type { Project } from '../models/project';
import { realpathSync } from 'fs';

interface ProjectRow {
  id: string;
  name: string;
  cwd: string;
  icon: string | null;
  vcs_root: string | null;
  vcs_branch: string | null;
  vcs_dirty: number;
  vcs_checked_at: string | null;
  created_at: string;
  archived_at: string | null;
  coordinator_owner_user_id?: number | null;
  coordinator_setup_key?: string | null;
  coordinator_setup_provenance?: string | null;
  coordinator_workspace_generation?: number | null;
  coordinator_profile_id?: string | null;
}

function rowToModel(row: ProjectRow): Project {
  const project = {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    icon: row.icon,
    vcsRoot: row.vcs_root,
    vcsBranch: row.vcs_branch,
    vcsDirty: Boolean(row.vcs_dirty),
    vcsCheckedAt: row.vcs_checked_at,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  } as Project;
  // Setup provenance is server-internal authorization state, not catalog
  // metadata. Keep it non-enumerable so existing generic project routes never
  // serialize an owner id, command key, profile binding, or workspace version.
  Object.defineProperties(project, {
    coordinatorOwnerUserId: { value: row.coordinator_owner_user_id ?? null, enumerable: false },
    coordinatorSetupKey: { value: row.coordinator_setup_key ?? null, enumerable: false },
    coordinatorSetupProvenance: {
      value: row.coordinator_setup_provenance === 'c2_fresh_owned_workspace_v1'
        ? 'c2_fresh_owned_workspace_v1'
        : null,
      enumerable: false,
    },
    coordinatorWorkspaceGeneration: {
      value: Number.isSafeInteger(row.coordinator_workspace_generation) &&
        (row.coordinator_workspace_generation ?? 0) >= 1
        ? row.coordinator_workspace_generation
        : null,
      enumerable: false,
    },
    coordinatorProfileId: { value: row.coordinator_profile_id ?? null, enumerable: false },
  });
  return project;
}

export interface ProjectVcsFields {
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
  vcsCheckedAt: string | null;
}

export class ProjectsRepository {
  insert(input: {
    name: string;
    cwd: string;
    icon: string | null;
    vcs: ProjectVcsFields;
  }): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO projects (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.name,
        input.cwd,
        input.icon,
        input.vcs.vcsRoot,
        input.vcs.vcsBranch,
        input.vcs.vcsDirty ? 1 : 0,
        input.vcs.vcsCheckedAt,
        now,
      );
    return this.findById(id)!;
  }

  findById(id: string): Project | null {
    const row = getDb()
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(id) as ProjectRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /**
   * The only C2 bootstrap proof for a project with no prior ordinary chat.
   * Generic catalog rows never satisfy this predicate, even if a caller knows
   * their id/cwd. Archive wins over an old setup receipt.
   */
  isCoordinatorOwnedBy(ownerUserId: number, projectId: string): boolean {
    try {
      const project = this.findById(projectId);
      return Boolean(
        project && project.archivedAt === null &&
        project.coordinatorOwnerUserId === ownerUserId &&
        project.coordinatorSetupProvenance === 'c2_fresh_owned_workspace_v1' &&
        typeof project.coordinatorSetupKey === 'string' && project.coordinatorSetupKey.length > 0 &&
        Number.isSafeInteger(project.coordinatorWorkspaceGeneration) &&
        (project.coordinatorWorkspaceGeneration ?? 0) >= 1 &&
        typeof project.coordinatorProfileId === 'string' && project.coordinatorProfileId.length > 0,
      );
    } catch {
      return false;
    }
  }

  /** Exact owner+command replay lookup; no caller-supplied path is consulted. */
  findCoordinatorSetup(ownerUserId: number, setupKey: string): Project | null {
    try {
      const row = getDb().prepare(`SELECT * FROM projects
        WHERE coordinator_owner_user_id=? AND coordinator_setup_key=?
          AND coordinator_setup_provenance='c2_fresh_owned_workspace_v1'
        ORDER BY created_at LIMIT 1`).get(ownerUserId, setupKey) as ProjectRow | undefined;
      return row ? rowToModel(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Insert a server-chosen fresh workspace receipt. The unique owner/key
   * constraint makes a repeated authenticated setup command a replay rather
   * than a second project claim. This method deliberately has no generic cwd
   * input route; its caller has already generated/validated the path.
   */
  createCoordinatorOwned(input: {
    ownerUserId: number;
    setupKey: string;
    cwd: string;
    profileId: string;
    name: string;
    workspaceGeneration: number;
  }): { project: Project; replay: boolean } {
    const db = getDb();
    const existing = this.findCoordinatorSetup(input.ownerUserId, input.setupKey);
    if (existing) return { project: existing, replay: true };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO projects (
        id,name,cwd,icon,vcs_root,vcs_branch,vcs_dirty,vcs_checked_at,created_at,archived_at,
        coordinator_owner_user_id,coordinator_setup_key,coordinator_setup_provenance,
        coordinator_workspace_generation,coordinator_profile_id
      ) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?, 'c2_fresh_owned_workspace_v1',?,?)`).run(
        id, input.name, input.cwd, null, null, null, 0, null, now,
        input.ownerUserId, input.setupKey, input.workspaceGeneration, input.profileId,
      );
      const project = this.findById(id);
      if (!project) throw new Error('coordinator project insert unavailable');
      return { project, replay: false };
    } catch (error) {
      const replay = this.findCoordinatorSetup(input.ownerUserId, input.setupKey);
      if (replay) return { project: replay, replay: true };
      throw error;
    }
  }

  list(opts: { includeArchived?: boolean } = {}): Project[] {
    const includeArchived = opts.includeArchived ?? false;
    const sql = includeArchived
      ? `SELECT * FROM projects ORDER BY created_at DESC`
      : `SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC`;
    const rows = getDb().prepare(sql).all() as ProjectRow[];
    return rows.map(rowToModel);
  }

  updateFields(
    id: string,
    fields: {
      name?: string;
      cwd?: string;
      icon?: string | null;
      archivedAt?: string | null;
    },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      sets.push('name = ?');
      values.push(fields.name);
    }
    if (fields.cwd !== undefined) {
      sets.push('cwd = ?');
      values.push(fields.cwd);
    }
    if (fields.icon !== undefined) {
      sets.push('icon = ?');
      values.push(fields.icon);
    }
    if (fields.archivedAt !== undefined) {
      sets.push('archived_at = ?');
      values.push(fields.archivedAt);
    }
    if (sets.length === 0) return;
    values.push(id);
    getDb()
      .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  updateVcs(id: string, vcs: ProjectVcsFields): void {
    getDb()
      .prepare(
        `UPDATE projects
         SET vcs_root = ?, vcs_branch = ?, vcs_dirty = ?, vcs_checked_at = ?
         WHERE id = ?`,
      )
      .run(vcs.vcsRoot, vcs.vcsBranch, vcs.vcsDirty ? 1 : 0, vcs.vcsCheckedAt, id);
  }

  delete(id: string): void {
    getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  }

  /**
   * Return the non-archived project whose `cwd` is an exact match or a
   * path-prefix of `sessionCwd`. When multiple match, returns the longest
   * (e.g. nested projects). Existing paths are resolved through realpath so
   * symlinked and canonical spellings associate; missing paths fall back to
   * lexical comparison.
   */
  /** Exact-cwd lookup (active rows only). Used by create() to reject duplicates. */
  findByExactCwd(cwd: string): Project | null {
    const normalized = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    const row = getDb()
      .prepare(
        `SELECT * FROM projects WHERE archived_at IS NULL AND cwd = ? LIMIT 1`,
      )
      .get(normalized) as ProjectRow | undefined;
    return row ? rowToModel(row) : null;
  }

  findByCwdPrefix(sessionCwd: string): Project | null {
    const normalizeLexically = (cwd: string): string =>
      cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    const tryRealpath = (cwd: string): string | null => {
      try {
        return realpathSync.native(cwd);
      } catch {
        return null;
      }
    };
    const lexicalSessionCwd = normalizeLexically(sessionCwd);
    const realSessionCwd = tryRealpath(lexicalSessionCwd);
    const rows = getDb()
      .prepare(`SELECT * FROM projects WHERE archived_at IS NULL`)
      .all() as ProjectRow[];

    let best: { row: ProjectRow; normalizedCwd: string } | null = null;
    for (const row of rows) {
      const lexicalProjectCwd = normalizeLexically(row.cwd);
      const realProjectCwd = tryRealpath(lexicalProjectCwd);
      const normalizedSessionCwd = realSessionCwd && realProjectCwd
        ? realSessionCwd
        : lexicalSessionCwd;
      const projectCwd = realSessionCwd && realProjectCwd
        ? realProjectCwd
        : lexicalProjectCwd;
      if (normalizedSessionCwd === projectCwd || normalizedSessionCwd.startsWith(projectCwd + '/')) {
        if (!best || projectCwd.length > best.normalizedCwd.length) {
          best = { row, normalizedCwd: projectCwd };
        }
      }
    }
    return best ? rowToModel(best.row) : null;
  }
}
