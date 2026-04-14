import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import { env } from '../config/env';
import type {
  Workspace,
  WorkspaceWithRole,
  WorkspaceMember,
  CreateWorkspaceDto,
} from '../models/workspace';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const UTC_TEXT_NOW =
  `to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

interface WorkspaceRow {
  id: number;
  name: string;
  join_code: string;
  created_by: number | null;
  created_at: string;
}

interface WorkspaceWithRoleRow extends WorkspaceRow {
  role: string;
}

interface MemberRow {
  user_id: number;
  name: string;
  email: string;
  photo_url: string | null;
  role: string;
  joined_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToWorkspaceWithRole(row: WorkspaceWithRoleRow): WorkspaceWithRole {
  return { ...rowToWorkspace(row), role: row.role as 'admin' | 'staff' };
}

function rowToMember(row: MemberRow): WorkspaceMember {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    photoUrl: row.photo_url,
    role: row.role as 'admin' | 'staff',
    joinedAt: row.joined_at,
  };
}

export class WorkspaceRepository {
  create(data: CreateWorkspaceDto): Workspace {
    const db = getDb();
    const joinCode = generateJoinCode();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO workspaces (name, join_code, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(data.name, joinCode, data.createdBy, now);
    const workspaceId = result.lastInsertRowid as number;
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, 'admin', ?)`,
    ).run(workspaceId, data.createdBy, now);
    return rowToWorkspace(
      db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(workspaceId) as WorkspaceRow,
    );
  }

  async createAsync(data: CreateWorkspaceDto): Promise<Workspace> {
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const joinCode = generateJoinCode();
      const now = new Date().toISOString();
      const result = await pool.query<WorkspaceRow>(
        `INSERT INTO workspaces (name, join_code, created_by, created_at)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [data.name, joinCode, data.createdBy, now],
      );
      const ws = result.rows[0];
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, 'admin', $3)`,
        [ws.id, data.createdBy, now],
      );
      return rowToWorkspace(ws);
    }
    return this.create(data);
  }

  joinByCode(joinCode: string, userId: number): Workspace {
    const db = getDb();
    const ws = db
      .prepare(`SELECT * FROM workspaces WHERE join_code = ?`)
      .get(joinCode) as WorkspaceRow | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    const existing = db
      .prepare(`SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
      .get(ws.id, userId);
    if (!existing) {
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'staff', ?)`,
      ).run(ws.id, userId, new Date().toISOString());
    }
    return rowToWorkspace(ws);
  }

  async joinByCodeAsync(joinCode: string, userId: number): Promise<Workspace> {
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const result = await pool.query<WorkspaceRow>(
        `SELECT * FROM workspaces WHERE join_code = $1`,
        [joinCode],
      );
      if (!result.rows[0]) throw AppError.notFound('Workspace');
      const ws = result.rows[0];
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, 'staff', $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [ws.id, userId, new Date().toISOString()],
      );
      return rowToWorkspace(ws);
    }
    return this.joinByCode(joinCode, userId);
  }

  addMemberDirect(workspaceId: number, userId: number): void {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'staff', datetime('now'))`,
      )
      .run(workspaceId, userId);
  }

  async addMemberDirectAsync(workspaceId: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, 'staff', ${UTC_TEXT_NOW})
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspaceId, userId],
      );
      return;
    }
    this.addMemberDirect(workspaceId, userId);
  }

  findForUser(userId: number): WorkspaceWithRole | null {
    const row = getDb()
      .prepare(
        `SELECT w.*, wm.role FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = ?
         LIMIT 1`,
      )
      .get(userId) as WorkspaceWithRoleRow | undefined;
    return row ? rowToWorkspaceWithRole(row) : null;
  }

  async findForUserAsync(userId: number): Promise<WorkspaceWithRole | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<WorkspaceWithRoleRow>(
        `SELECT w.*, wm.role FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1
         LIMIT 1`,
        [userId],
      );
      return result.rows[0] ? rowToWorkspaceWithRole(result.rows[0]) : null;
    }
    return this.findForUser(userId);
  }

  findMember(workspaceId: number, userId: number): WorkspaceMember | null {
    const row = getDb()
      .prepare(
        `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = ? AND wm.user_id = ?`,
      )
      .get(workspaceId, userId) as MemberRow | undefined;
    return row ? rowToMember(row) : null;
  }

  listMembers(workspaceId: number): WorkspaceMember[] {
    return (
      getDb()
        .prepare(
          `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
           FROM workspace_members wm JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = ?
           ORDER BY lower(u.name) ASC`,
        )
        .all(workspaceId) as MemberRow[]
    ).map(rowToMember);
  }

  async listMembersAsync(workspaceId: number): Promise<WorkspaceMember[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<MemberRow>(
        `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1
         ORDER BY lower(u.name) ASC`,
        [workspaceId],
      );
      return result.rows.map(rowToMember);
    }
    return this.listMembers(workspaceId);
  }

  updateMemberRole(workspaceId: number, userId: number, role: 'admin' | 'staff'): void {
    const changes = getDb()
      .prepare(`UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?`)
      .run(role, workspaceId, userId).changes;
    if (changes === 0) throw AppError.notFound('WorkspaceMember');
  }

  async updateMemberRoleAsync(
    workspaceId: number,
    userId: number,
    role: 'admin' | 'staff',
  ): Promise<void> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
        [role, workspaceId, userId],
      );
      if (result.rowCount === 0) throw AppError.notFound('WorkspaceMember');
      return;
    }
    this.updateMemberRole(workspaceId, userId, role);
  }

  removeMember(workspaceId: number, userId: number): void {
    getDb()
      .prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
      .run(workspaceId, userId);
  }

  async removeMemberAsync(workspaceId: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      return;
    }
    this.removeMember(workspaceId, userId);
  }

  regenerateJoinCode(workspaceId: number): string {
    const newCode = generateJoinCode();
    getDb()
      .prepare(`UPDATE workspaces SET join_code = ? WHERE id = ?`)
      .run(newCode, workspaceId);
    return newCode;
  }

  async regenerateJoinCodeAsync(workspaceId: number): Promise<string> {
    if (env.dbClient === 'postgres') {
      const newCode = generateJoinCode();
      await getPostgresPool().query(
        `UPDATE workspaces SET join_code = $1 WHERE id = $2`,
        [newCode, workspaceId],
      );
      return newCode;
    }
    return this.regenerateJoinCode(workspaceId);
  }
}
