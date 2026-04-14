import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
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
  assignee_id: number | null;
  assignee_name: string | null;
}

function rowToStep(row: StepRow): ProjectTemplateStep {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    offsetDays: row.offset_days,
    offsetDescription: row.offset_description,
    sortOrder: row.sort_order,
    assigneeId: row.assignee_id ?? null,
    assigneeName: row.assignee_name ?? null,
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
  private async getStepsAsync(templateId: string): Promise<ProjectTemplateStep[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<StepRow>(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.template_id = $1
         ORDER BY pts.sort_order ASC`,
        [templateId],
      );
      return result.rows.map(rowToStep);
    }
    return this.getSteps(templateId);
  }

  private getSteps(templateId: string): ProjectTemplateStep[] {
    const rows = getDb()
      .prepare(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.template_id = ?
         ORDER BY pts.sort_order ASC`,
      )
      .all(templateId) as StepRow[];
    return rows.map(rowToStep);
  }

  async findAllAsync(userId?: number): Promise<ProjectTemplate[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TemplateRow>(
              `SELECT * FROM project_templates
               WHERE owner_id = $1 OR owner_id IS NULL
               ORDER BY created_at ASC`,
              [userId],
            )
          : await getPostgresPool().query<TemplateRow>(
              'SELECT * FROM project_templates ORDER BY created_at ASC',
            );
      return Promise.all(
        result.rows.map(async (row) =>
          rowToTemplate(row, await this.getStepsAsync(row.id)),
        ),
      );
    }
    return this.findAll(userId);
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

  async findByIdAsync(id: string, userId?: number): Promise<ProjectTemplate> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TemplateRow>(
              `SELECT * FROM project_templates
               WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)`,
              [id, userId],
            )
          : await getPostgresPool().query<TemplateRow>(
              'SELECT * FROM project_templates WHERE id = $1',
              [id],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ProjectTemplate');
      return rowToTemplate(row, await this.getStepsAsync(id));
    }
    return this.findById(id, userId);
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

  async findByNameInsensitiveAsync(
    name: string,
    userId?: number,
  ): Promise<ProjectTemplate | null> {
    const normalized = name.trim().toLowerCase();
    const rows = await this.findAllAsync(userId);
    const match = rows.find(
      (row) => row.name.trim().toLowerCase() === normalized,
    );
    return match ?? null;
  }

  findByNameInsensitive(name: string, userId?: number): ProjectTemplate | null {
    const normalized = name.trim().toLowerCase();
    const rows = this.findAll(userId);
    const match = rows.find(
      (row) => row.name.trim().toLowerCase() === normalized,
    );
    return match ?? null;
  }

  async createAsync(data: CreateProjectTemplateDto): Promise<ProjectTemplate> {
    if (env.dbClient === 'postgres') {
      const id = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO project_templates (id, name, description, anchor_type, owner_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          data.name,
          data.description ?? null,
          data.anchorType ?? 'date',
          data.ownerId ?? null,
          now,
        ],
      );
      return this.findByIdAsync(id);
    }
    return this.create(data);
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

  async updateAsync(
    id: string,
    data: UpdateProjectTemplateDto,
    userId?: number,
  ): Promise<ProjectTemplate> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id, userId);
      await getPostgresPool().query(
        `UPDATE project_templates SET name = $1, description = $2, owner_id = $3 WHERE id = $4`,
        [
          data.name ?? existing.name,
          data.description !== undefined ? data.description : existing.description,
          data.ownerId !== undefined ? data.ownerId : existing.ownerId,
          id,
        ],
      );
      return this.findByIdAsync(id, userId);
    }
    return this.update(id, data, userId);
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

  async deleteAsync(id: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(id, userId);
      if (userId != null) {
        await getPostgresPool().query(
          'DELETE FROM project_instances WHERE template_id = $1 AND (owner_id = $2 OR owner_id IS NULL)',
          [id, userId],
        );
        const result = await getPostgresPool().query(
          'DELETE FROM project_templates WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)',
          [id, userId],
        );
        if (result.rowCount === 0) throw AppError.notFound('ProjectTemplate');
        return;
      }
      await getPostgresPool().query(
        'DELETE FROM project_instances WHERE template_id = $1',
        [id],
      );
      const result = await getPostgresPool().query(
        'DELETE FROM project_templates WHERE id = $1',
        [id],
      );
      if (result.rowCount === 0) throw AppError.notFound('ProjectTemplate');
      return;
    }
    this.delete(id, userId);
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

  async addStepAsync(
    templateId: string,
    data: CreateStepDto,
    userId?: number,
  ): Promise<ProjectTemplateStep> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(templateId, userId);
      const id = uuidv4();
      await getPostgresPool().query(
        `INSERT INTO project_template_steps (id, template_id, title, offset_days, offset_description, sort_order, assignee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          templateId,
          data.title,
          data.offsetDays,
          data.offsetDescription ?? null,
          data.sortOrder ?? 0,
          data.assigneeId ?? null,
        ],
      );
      const step = await getPostgresPool().query<StepRow>(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.id = $1`,
        [id],
      );
      return rowToStep(step.rows[0]);
    }
    return this.addStep(templateId, data, userId);
  }

  addStep(templateId: string, data: CreateStepDto, userId?: number): ProjectTemplateStep {
    this.findById(templateId, userId); // ensures template exists
    const id = uuidv4();
    getDb()
      .prepare(
        `INSERT INTO project_template_steps (id, template_id, title, offset_days, offset_description, sort_order, assignee_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        templateId,
        data.title,
        data.offsetDays,
        data.offsetDescription ?? null,
        data.sortOrder ?? 0,
        data.assigneeId ?? null,
      );
    const row = getDb()
      .prepare(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.id = ?`,
      )
      .get(id) as StepRow;
    return rowToStep(row);
  }

  updateStep(stepId: string, data: Partial<CreateStepDto>, userId?: number): ProjectTemplateStep {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT pts.*, u.name AS assignee_name
             FROM project_template_steps pts
             JOIN project_templates pt ON pt.id = pts.template_id
             LEFT JOIN users u ON u.id = pts.assignee_id
             WHERE pts.id = ? AND (pt.owner_id = ? OR pt.owner_id IS NULL)`,
          )
          .get(stepId, userId)
      : getDb()
          .prepare(
            `SELECT pts.*, u.name AS assignee_name
             FROM project_template_steps pts
             LEFT JOIN users u ON u.id = pts.assignee_id
             WHERE pts.id = ?`,
          )
          .get(stepId)) as StepRow | undefined;
    if (!row) throw AppError.notFound('ProjectTemplateStep');
    getDb()
      .prepare(
        `UPDATE project_template_steps
         SET title = ?, offset_days = ?, offset_description = ?, sort_order = ?, assignee_id = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? row.title,
        data.offsetDays ?? row.offset_days,
        data.offsetDescription !== undefined ? data.offsetDescription : row.offset_description,
        data.sortOrder ?? row.sort_order,
        data.assigneeId !== undefined ? data.assigneeId : row.assignee_id,
        stepId,
      );
    const updated = getDb()
      .prepare(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.id = ?`,
      )
      .get(stepId) as StepRow;
    return rowToStep(updated);
  }

  async updateStepAsync(
    stepId: string,
    data: Partial<CreateStepDto>,
    userId?: number,
  ): Promise<ProjectTemplateStep> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<StepRow>(
              `SELECT pts.*, u.name AS assignee_name
               FROM project_template_steps pts
               JOIN project_templates pt ON pt.id = pts.template_id
               LEFT JOIN users u ON u.id = pts.assignee_id
               WHERE pts.id = $1 AND (pt.owner_id = $2 OR pt.owner_id IS NULL)`,
              [stepId, userId],
            )
          : await getPostgresPool().query<StepRow>(
              `SELECT pts.*, u.name AS assignee_name
               FROM project_template_steps pts
               LEFT JOIN users u ON u.id = pts.assignee_id
               WHERE pts.id = $1`,
              [stepId],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ProjectTemplateStep');
      await getPostgresPool().query(
        `UPDATE project_template_steps
         SET title = $1, offset_days = $2, offset_description = $3, sort_order = $4, assignee_id = $5
         WHERE id = $6`,
        [
          data.title ?? row.title,
          data.offsetDays ?? row.offset_days,
          data.offsetDescription !== undefined ? data.offsetDescription : row.offset_description,
          data.sortOrder ?? row.sort_order,
          data.assigneeId !== undefined ? data.assigneeId : row.assignee_id,
          stepId,
        ],
      );
      const refreshed = await getPostgresPool().query<StepRow>(
        `SELECT pts.*, u.name AS assignee_name
         FROM project_template_steps pts
         LEFT JOIN users u ON u.id = pts.assignee_id
         WHERE pts.id = $1`,
        [stepId],
      );
      return rowToStep(refreshed.rows[0]);
    }
    return this.updateStep(stepId, data, userId);
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

  async deleteStepAsync(stepId: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      if (userId != null) {
        const visible = await getPostgresPool().query<{ id: string }>(
          `SELECT pts.id
           FROM project_template_steps pts
           JOIN project_templates pt ON pt.id = pts.template_id
           WHERE pts.id = $1 AND (pt.owner_id = $2 OR pt.owner_id IS NULL)`,
          [stepId, userId],
        );
        if (visible.rows.length === 0) {
          throw AppError.notFound('ProjectTemplateStep');
        }
      }
      const result = await getPostgresPool().query(
        'DELETE FROM project_template_steps WHERE id = $1',
        [stepId],
      );
      if (result.rowCount === 0) throw AppError.notFound('ProjectTemplateStep');
      return;
    }
    this.deleteStep(stepId, userId);
  }
}
