import { getDb } from '../database/db';
import type { Project } from '../models/project';

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
}

function rowToModel(row: ProjectRow): Project {
  return {
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
  };
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
   * (e.g. nested projects). Strings are compared after stripping trailing
   * slashes; no symlink resolution.
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
    const normalized = sessionCwd.length > 1
      ? sessionCwd.replace(/\/+$/, '')
      : sessionCwd;
    const rows = getDb()
      .prepare(`SELECT * FROM projects WHERE archived_at IS NULL`)
      .all() as ProjectRow[];

    let best: ProjectRow | null = null;
    for (const row of rows) {
      const projectCwd = row.cwd.length > 1 ? row.cwd.replace(/\/+$/, '') : row.cwd;
      if (normalized === projectCwd || normalized.startsWith(projectCwd + '/')) {
        if (!best || projectCwd.length > best.cwd.length) {
          best = row;
        }
      }
    }
    return best ? rowToModel(best) : null;
  }
}
