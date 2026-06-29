import Database from 'better-sqlite3';
import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type {
  AgentSkill,
  AgentSkillInput,
  AgentSkillVersion,
} from '../models/agent_skill';

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
  version: number | null;
  applied_for_name: string | null;
  base_version: number | null;
  origin_location: string | null;
  is_external: number | null;
  baseline_score: number | null;
  post_score: number | null;
  measure_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentSkillVersionRow {
  id: string;
  skill_id: string;
  version_no: number;
  title: string;
  when_to_use: string | null;
  description: string | null;
  steps_json: string | null;
  tags_json: string | null;
  body: string | null;
  confidence: number;
  source: string | null;
  created_at: string;
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
    version: row.version ?? 1,
    appliedForName: row.applied_for_name ?? null,
    baseVersion: row.base_version ?? null,
    originLocation: row.origin_location ?? null,
    isExternal: row.is_external ?? 0,
    baselineScore: row.baseline_score ?? null,
    postScore: row.post_score ?? null,
    measureReason: row.measure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionRowToModel(row: AgentSkillVersionRow): AgentSkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    versionNo: row.version_no,
    title: row.title,
    whenToUse: row.when_to_use ?? null,
    description: row.description ?? null,
    steps: parseJsonArray(row.steps_json),
    tags: parseJsonArray(row.tags_json),
    stepsJson: row.steps_json ?? null,
    tagsJson: row.tags_json ?? null,
    body: row.body ?? null,
    confidence: row.confidence ?? 0,
    source: row.source ?? null,
    createdAt: row.created_at,
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

  /**
   * #792 — join key onto live engine skills: the SKILL.md frontmatter `name`.
   * That name is stored in the `title` column (the historical dedup key), so
   * this is a case-insensitive `title` lookup. {@link findByTitle} delegates
   * here. Used by #793's unified read to attach this sidecar row onto the live
   * engine skill of the same name.
   */
  findByName(name: string): AgentSkill | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_skills WHERE title = ? COLLATE NOCASE`)
      .get(name) as AgentSkillRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Case-insensitive title lookup, used for dedup. Delegates to findByName. */
  findByTitle(title: string): AgentSkill | null {
    return this.findByName(title);
  }

  create(input: AgentSkillInput): AgentSkill {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_skills
          (id, title, when_to_use, description, steps_json, tags_json, body,
           confidence, status, source, uses, version,
           applied_for_name, base_version, origin_location, is_external,
           baseline_score, post_score, measure_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        1,
        input.appliedForName ?? null,
        input.baseVersion ?? null,
        input.originLocation ?? null,
        input.isExternal ?? 0,
        input.baselineScore ?? null,
        input.postScore ?? null,
        input.measureReason ?? null,
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
    if (patch.appliedForName !== undefined) {
      fields.push('applied_for_name = ?');
      values.push(patch.appliedForName ?? null);
    }
    if (patch.baseVersion !== undefined) {
      fields.push('base_version = ?');
      values.push(patch.baseVersion ?? null);
    }
    if (patch.originLocation !== undefined) {
      fields.push('origin_location = ?');
      values.push(patch.originLocation ?? null);
    }
    if (patch.isExternal !== undefined) {
      fields.push('is_external = ?');
      values.push(patch.isExternal);
    }
    if (patch.baselineScore !== undefined) {
      fields.push('baseline_score = ?');
      values.push(patch.baselineScore ?? null);
    }
    if (patch.postScore !== undefined) {
      fields.push('post_score = ?');
      values.push(patch.postScore ?? null);
    }
    if (patch.measureReason !== undefined) {
      fields.push('measure_reason = ?');
      values.push(patch.measureReason ?? null);
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

  // ── P5-1: version history + non-destructive in-place revision ──────────────

  /**
   * Snapshot the CURRENT state of `id` into agent_skill_versions (recorded under
   * its current version_no), then UPDATE the live row with `newContent` and
   * version+1. Returns the updated skill, or null if `id` does not exist (in
   * which case nothing is written).
   *
   * Only CONTENT columns are revised (title, whenToUse, description, steps,
   * tags, body, confidence, source). Lifecycle (`status`) and `uses` are
   * preserved — a revision improves a skill in place, it does not re-draft it.
   *
   * `source` labels the provenance of the NEW current row (e.g. 'auto-refined',
   * 'teacher-refined'). The snapshot keeps the PRIOR row's source.
   */
  reviseInPlace(
    skillId: string,
    newContent: Partial<AgentSkillInput>,
    source: string,
  ): AgentSkill | null {
    const existing = this.getById(skillId);
    if (!existing) return null;

    const tx = this.db.transaction(() => {
      this.snapshotCurrent(existing);

      const next: AgentSkillInput = {
        title: newContent.title ?? existing.title,
        whenToUse:
          newContent.whenToUse !== undefined ? newContent.whenToUse : existing.whenToUse,
        description:
          newContent.description !== undefined
            ? newContent.description
            : existing.description,
        steps: newContent.steps !== undefined ? newContent.steps : existing.steps ?? null,
        tags: newContent.tags !== undefined ? newContent.tags : existing.tags ?? null,
        body: newContent.body !== undefined ? newContent.body : existing.body,
        confidence:
          newContent.confidence !== undefined ? newContent.confidence : existing.confidence,
        source,
      };

      this.applyContent(skillId, next, existing.version + 1);
    });
    tx();

    return this.getById(skillId);
  }

  /** All recorded versions for a skill, newest version_no first. */
  listVersions(skillId: string): AgentSkillVersion[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_skill_versions WHERE skill_id = ? ORDER BY version_no DESC`,
      )
      .all(skillId) as AgentSkillVersionRow[];
    return rows.map(versionRowToModel);
  }

  /**
   * Restore a prior version's content as the new current row. Non-destructive:
   * the CURRENT row is first snapshotted into history (so the rollback can
   * itself be undone), then the chosen version's content is applied with
   * version+1. Returns the restored skill, or null if the skill or the target
   * version is unknown (nothing written in that case).
   */
  rollback(skillId: string, versionNo: number): AgentSkill | null {
    const existing = this.getById(skillId);
    if (!existing) return null;

    const target = this.db
      .prepare(
        `SELECT * FROM agent_skill_versions WHERE skill_id = ? AND version_no = ?`,
      )
      .get(skillId, versionNo) as AgentSkillVersionRow | undefined;
    if (!target) return null;

    const tx = this.db.transaction(() => {
      this.snapshotCurrent(existing);

      const restored: AgentSkillInput = {
        title: target.title,
        whenToUse: target.when_to_use,
        description: target.description,
        steps: parseJsonArray(target.steps_json),
        tags: parseJsonArray(target.tags_json),
        body: target.body,
        confidence: target.confidence,
        source: target.source,
      };

      this.applyContent(skillId, restored, existing.version + 1);
    });
    tx();

    return this.getById(skillId);
  }

  /** Write a snapshot of `skill`'s current content into agent_skill_versions. */
  private snapshotCurrent(skill: AgentSkill): void {
    this.db
      .prepare(
        `INSERT INTO agent_skill_versions
          (id, skill_id, version_no, title, when_to_use, description,
           steps_json, tags_json, body, confidence, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        skill.id,
        skill.version,
        skill.title,
        skill.whenToUse ?? null,
        skill.description ?? null,
        skill.steps != null ? JSON.stringify(skill.steps) : null,
        skill.tags != null ? JSON.stringify(skill.tags) : null,
        skill.body ?? null,
        skill.confidence ?? 0,
        skill.source ?? null,
        new Date().toISOString(),
      );
  }

  /** Apply revised content + an explicit version number to the live row. */
  private applyContent(
    skillId: string,
    content: AgentSkillInput,
    version: number,
  ): void {
    this.db
      .prepare(
        `UPDATE agent_skills
            SET title = ?, when_to_use = ?, description = ?, steps_json = ?,
                tags_json = ?, body = ?, confidence = ?, source = ?,
                version = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        content.title,
        content.whenToUse ?? null,
        content.description ?? null,
        content.steps != null ? JSON.stringify(content.steps) : null,
        content.tags != null ? JSON.stringify(content.tags) : null,
        content.body ?? null,
        content.confidence ?? 0,
        content.source ?? null,
        version,
        new Date().toISOString(),
        skillId,
      );
  }
}
