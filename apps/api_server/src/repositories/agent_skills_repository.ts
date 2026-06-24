import Database from 'better-sqlite3';
import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { AgentSkill, AgentSkillInput } from '../models/agent_skill';

interface AgentSkillRow {
  id: string;
  title: string;
  when_to_use: string | null;
  description: string | null;
  steps_json: string | null;
  tags_json: string | null;
  body: string | null;
  confidence: number;
  status: string;
  source: string | null;
  uses: number;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function rowToModel(row: AgentSkillRow): AgentSkill {
  return {
    id: row.id,
    title: row.title,
    whenToUse: row.when_to_use ?? null,
    description: row.description ?? null,
    steps: parseJsonArray(row.steps_json),
    tags: parseJsonArray(row.tags_json),
    stepsJson: row.steps_json ?? null,
    tagsJson: row.tags_json ?? null,
    body: row.body ?? null,
    confidence: row.confidence ?? 0,
    status: row.status ?? 'draft',
    source: row.source ?? null,
    uses: row.uses ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentSkillsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        // No global DB initialized — create an in-memory instance (e.g. in tests)
        this.db = makeInMemoryDb();
      }
    }
  }

  list(): AgentSkill[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_skills ORDER BY created_at DESC, title`)
      .all() as AgentSkillRow[];
    return rows.map(rowToModel);
  }

  getById(id: string): AgentSkill | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_skills WHERE id = ?`)
      .get(id) as AgentSkillRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Case-insensitive title lookup, used for dedup. */
  findByTitle(title: string): AgentSkill | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_skills WHERE title = ? COLLATE NOCASE`)
      .get(title) as AgentSkillRow | undefined;
    return row ? rowToModel(row) : null;
  }

  create(input: AgentSkillInput): AgentSkill {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_skills
          (id, title, when_to_use, description, steps_json, tags_json, body,
           confidence, status, source, uses, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.whenToUse ?? null,
        input.description ?? null,
        input.steps != null ? JSON.stringify(input.steps) : null,
        input.tags != null ? JSON.stringify(input.tags) : null,
        input.body ?? null,
        input.confidence ?? 0,
        input.status ?? 'draft',
        input.source ?? null,
        input.uses ?? 0,
        now,
        now,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<AgentSkillInput>): AgentSkill | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
      fields.push('title = ?');
      values.push(patch.title);
    }
    if (patch.whenToUse !== undefined) {
      fields.push('when_to_use = ?');
      values.push(patch.whenToUse ?? null);
    }
    if (patch.description !== undefined) {
      fields.push('description = ?');
      values.push(patch.description ?? null);
    }
    if (patch.steps !== undefined) {
      fields.push('steps_json = ?');
      values.push(patch.steps != null ? JSON.stringify(patch.steps) : null);
    }
    if (patch.tags !== undefined) {
      fields.push('tags_json = ?');
      values.push(patch.tags != null ? JSON.stringify(patch.tags) : null);
    }
    if (patch.body !== undefined) {
      fields.push('body = ?');
      values.push(patch.body ?? null);
    }
    if (patch.confidence !== undefined) {
      fields.push('confidence = ?');
      values.push(patch.confidence);
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.source !== undefined) {
      fields.push('source = ?');
      values.push(patch.source ?? null);
    }
    if (patch.uses !== undefined) {
      fields.push('uses = ?');
      values.push(patch.uses);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);
    this.db
      .prepare(`UPDATE agent_skills SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM agent_skills WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  incrementUses(id: string): void {
    this.db
      .prepare(`UPDATE agent_skills SET uses = uses + 1, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }
}
