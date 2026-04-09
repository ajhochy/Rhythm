import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateProjectTemplateDto,
  CreateStepDto,
  ProjectTemplate,
  ProjectTemplateStep,
  UpdateProjectTemplateDto,
} from '../models/project_template';

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  anchor_type: string;
  owner_id: number | null;
  created_at: string;
}

interface StepRow {
  id: string;
  template_id: string;
  title: string;
  offset_days: number;
  offset_description: string | null;
  sort_order: number;
}

function rowToStep(row: StepRow): ProjectTemplateStep {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    offsetDays: row.offset_days,
    offsetDescription: row.offset_description,
    sortOrder: row.sort_order,
  };
}

function rowToTemplate(row: TemplateRow, steps: ProjectTemplateStep[]): ProjectTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    anchorType: row.anchor_type,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    steps,
  };
}

export class ProjectTemplatesRepository {
  private getSteps(templateId: string): ProjectTemplateStep[] {
    const rows = getDb()
      .prepare('SELECT * FROM project_template_steps WHERE template_id = ? ORDER BY sort_order ASC')
      .all(templateId) as StepRow[];
    return rows.map(rowToStep);
  }

  findAll(userId?: number): ProjectTemplate[] {
    const rows = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_templates
             WHERE owner_id = ? OR owner_id IS NULL
             ORDER BY created_at ASC`,
          )
          .all(userId)
      : getDb()
          .prepare('SELECT * FROM project_templates ORDER BY created_at ASC')
          .all()) as TemplateRow[];
    return rows.map((row) => rowToTemplate(row, this.getSteps(row.id)));
  }

  findById(id: string, userId?: number): ProjectTemplate {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_templates
             WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)`,
          )
          .get(id, userId)
      : getDb().prepare('SELECT * FROM project_templates WHERE id = ?').get(id)) as
      | TemplateRow
      | undefined;
    if (!row) throw AppError.notFound('ProjectTemplate');
    return rowToTemplate(row, this.getSteps(id));
  }

  findByNameInsensitive(name: string, userId?: number): ProjectTemplate | null {
    const normalized = name.trim().toLowerCase();
    const rows = this.findAll(userId);
    const match = rows.find(
      (row) => row.name.trim().toLowerCase() === normalized,
    );
    return match ?? null;
  }

  create(data: CreateProjectTemplateDto): ProjectTemplate {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO project_templates (id, name, description, anchor_type, owner_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.name,
        data.description ?? null,
        data.anchorType ?? 'date',
        data.ownerId ?? null,
        now,
      );
    return this.findById(id);
  }

  update(id: string, data: UpdateProjectTemplateDto, userId?: number): ProjectTemplate {
    const existing = this.findById(id, userId);
    getDb()
      .prepare(`UPDATE project_templates SET name = ?, description = ?, owner_id = ? WHERE id = ?`)
      .run(
        data.name ?? existing.name,
        data.description !== undefined ? data.description : existing.description,
        data.ownerId !== undefined ? data.ownerId : existing.ownerId,
        id,
      );
    return this.findById(id, userId);
  }

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM project_instances WHERE template_id = ?').run(id);
      const result = db.prepare('DELETE FROM project_templates WHERE id = ?').run(id);
      if (result.changes === 0) throw AppError.notFound('ProjectTemplate');
    })();
  }

  addStep(templateId: string, data: CreateStepDto, userId?: number): ProjectTemplateStep {
    this.findById(templateId, userId); // ensures template exists
    const id = uuidv4();
    getDb()
      .prepare(
        `INSERT INTO project_template_steps (id, template_id, title, offset_days, offset_description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, templateId, data.title, data.offsetDays, data.offsetDescription ?? null, data.sortOrder ?? 0);
    const row = getDb().prepare('SELECT * FROM project_template_steps WHERE id = ?').get(id) as StepRow;
    return rowToStep(row);
  }

  updateStep(stepId: string, data: Partial<CreateStepDto>, userId?: number): ProjectTemplateStep {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT pts.*
             FROM project_template_steps pts
             JOIN project_templates pt ON pt.id = pts.template_id
             WHERE pts.id = ? AND (pt.owner_id = ? OR pt.owner_id IS NULL)`,
          )
          .get(stepId, userId)
      : getDb()
          .prepare('SELECT * FROM project_template_steps WHERE id = ?')
          .get(stepId)) as StepRow | undefined;
    if (!row) throw AppError.notFound('ProjectTemplateStep');
    getDb()
      .prepare(
        `UPDATE project_template_steps SET title = ?, offset_days = ?, offset_description = ?, sort_order = ? WHERE id = ?`,
      )
      .run(
        data.title ?? row.title,
        data.offsetDays ?? row.offset_days,
        data.offsetDescription !== undefined ? data.offsetDescription : row.offset_description,
        data.sortOrder ?? row.sort_order,
        stepId,
      );
    const updated = getDb().prepare('SELECT * FROM project_template_steps WHERE id = ?').get(stepId) as StepRow;
    return rowToStep(updated);
  }

  deleteStep(stepId: string, userId?: number): void {
    if (userId != null) {
      const visible = getDb()
        .prepare(
          `SELECT pts.id
           FROM project_template_steps pts
           JOIN project_templates pt ON pt.id = pts.template_id
           WHERE pts.id = ? AND (pt.owner_id = ? OR pt.owner_id IS NULL)`,
        )
        .get(stepId, userId) as { id: string } | undefined;
      if (!visible) throw AppError.notFound('ProjectTemplateStep');
    }
    const result = getDb().prepare('DELETE FROM project_template_steps WHERE id = ?').run(stepId);
    if (result.changes === 0) throw AppError.notFound('ProjectTemplateStep');
  }
}
