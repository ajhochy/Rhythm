import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type { ProjectInstance, ProjectInstanceStep } from '../models/project_instance';
import type { Task } from '../models/task';

interface InstanceRow {
  id: string;
  template_id: string;
  name: string | null;
  anchor_date: string;
  status: string;
  owner_id: number | null;
  created_at: string;
}

interface InstanceStepRow {
  id: string;
  instance_id: string;
  step_id: string;
  title: string;
  due_date: string;
  status: string;
  notes: string | null;
}

function rowToStep(row: InstanceStepRow): ProjectInstanceStep {
  return {
    id: row.id,
    instanceId: row.instance_id,
    stepId: row.step_id,
    title: row.title,
    dueDate: row.due_date,
    status: row.status as ProjectInstanceStep['status'],
    notes: row.notes ?? null,
  };
}

function rowToInstance(row: InstanceRow, steps: ProjectInstanceStep[]): ProjectInstance {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name ?? null,
    anchorDate: row.anchor_date,
    status: row.status,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    steps,
  };
}

function stepRowToPlannerTask(row: {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  instance_id: string;
  instance_name: string | null;
}): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    dueDate: row.due_date ?? null,
    scheduledDate: null,
    scheduledOrder: null,
    locked: false,
    status: row.status as Task['status'],
    sourceType: 'project_step',
    sourceId: row.instance_id,
    sourceName: row.instance_name ?? null,
    ownerId: null,
    createdAt: '',
    updatedAt: '',
  };
}

interface PlannerStepRow {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  instance_id: string;
  instance_name: string | null;
}

export class ProjectInstancesRepository {
  private async getStepsAsync(instanceId: string): Promise<ProjectInstanceStep[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<InstanceStepRow>(
        'SELECT * FROM project_instance_steps WHERE instance_id = $1 ORDER BY due_date ASC',
        [instanceId],
      );
      return result.rows.map(rowToStep);
    }
    return this.getSteps(instanceId);
  }

  private async refreshInstanceStatusAsync(instanceId: string): Promise<void> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{ remaining: string }>(
        `SELECT COUNT(*) as remaining
         FROM project_instance_steps
         WHERE instance_id = $1 AND status != 'done'`,
        [instanceId],
      );
      const remaining = Number(result.rows[0]?.remaining ?? 0);
      await getPostgresPool().query(
        'UPDATE project_instances SET status = $1 WHERE id = $2',
        [remaining === 0 ? 'done' : 'active', instanceId],
      );
      return;
    }
    this.refreshInstanceStatus(instanceId);
  }

  async findPlannerStepsDueInRangeAsync(
    startDate: string,
    endDate: string,
  ): Promise<Task[]> {
    const query = `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                          pi.name as instance_name
                   FROM project_instance_steps pis
                   JOIN project_instances pi ON pi.id = pis.instance_id
                   WHERE pis.due_date BETWEEN $1 AND $2 AND pis.due_date IS NOT NULL AND pis.due_date != ''
                   ORDER BY pis.due_date ASC`;

    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<PlannerStepRow>(query, [
        startDate,
        endDate,
      ]);
      return result.rows.map(stepRowToPlannerTask);
    }

    const rows = getDb()
      .prepare(query.replace(/\$1/g, '?').replace(/\$2/g, '?'))
      .all(startDate, endDate) as PlannerStepRow[];
    return rows.map(stepRowToPlannerTask);
  }

  async findPlannerOpenStepsWithoutDueDateAsync(): Promise<Task[]> {
    const query = `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                          pi.name as instance_name
                   FROM project_instance_steps pis
                   JOIN project_instances pi ON pi.id = pis.instance_id
                   WHERE pis.status = 'open' AND (pis.due_date IS NULL OR pis.due_date = '')
                   ORDER BY pi.created_at ASC, pis.title ASC`;

    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<PlannerStepRow>(query);
      return result.rows.map(stepRowToPlannerTask);
    }

    const rows = getDb().prepare(query).all() as PlannerStepRow[];
    return rows.map(stepRowToPlannerTask);
  }

  async findPlannerOpenStepsBeforeDateAsync(date: string): Promise<Task[]> {
    const query = `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                          pi.name as instance_name
                   FROM project_instance_steps pis
                   JOIN project_instances pi ON pi.id = pis.instance_id
                   WHERE pis.status = 'open'
                     AND pis.due_date IS NOT NULL
                     AND pis.due_date != ''
                     AND pis.due_date < $1
                   ORDER BY pis.due_date ASC, pi.created_at ASC`;

    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<PlannerStepRow>(query, [date]);
      return result.rows.map(stepRowToPlannerTask);
    }

    const rows = getDb()
      .prepare(query.replace(/\$1/g, '?'))
      .all(date) as PlannerStepRow[];
    return rows.map(stepRowToPlannerTask);
  }

  private getSteps(instanceId: string): ProjectInstanceStep[] {
    const rows = getDb()
      .prepare('SELECT * FROM project_instance_steps WHERE instance_id = ? ORDER BY due_date ASC')
      .all(instanceId) as InstanceStepRow[];
    return rows.map(rowToStep);
  }

  private refreshInstanceStatus(instanceId: string): void {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) as remaining
         FROM project_instance_steps
         WHERE instance_id = ? AND status != 'done'`,
      )
      .get(instanceId) as { remaining: number };

    getDb()
      .prepare('UPDATE project_instances SET status = ? WHERE id = ?')
      .run(row.remaining === 0 ? 'done' : 'active', instanceId);
  }

  findAll(userId?: number): ProjectInstance[] {
    const rows = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_instances
             WHERE owner_id = ? OR owner_id IS NULL
             ORDER BY created_at DESC`,
          )
          .all(userId)
      : getDb()
          .prepare('SELECT * FROM project_instances ORDER BY created_at DESC')
          .all()) as InstanceRow[];
    return rows.map((row) => rowToInstance(row, this.getSteps(row.id)));
  }

  async findAllAsync(userId?: number): Promise<ProjectInstance[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<InstanceRow>(
              `SELECT * FROM project_instances
               WHERE owner_id = $1 OR owner_id IS NULL
               ORDER BY created_at DESC`,
              [userId],
            )
          : await getPostgresPool().query<InstanceRow>(
              'SELECT * FROM project_instances ORDER BY created_at DESC',
            );
      return Promise.all(
        result.rows.map(async (row) =>
          rowToInstance(row, await this.getStepsAsync(row.id)),
        ),
      );
    }
    return this.findAll(userId);
  }

  findByTemplateId(templateId: string, userId?: number): ProjectInstance[] {
    const rows = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_instances
             WHERE template_id = ? AND (owner_id = ? OR owner_id IS NULL)
             ORDER BY anchor_date DESC`,
          )
          .all(templateId, userId)
      : getDb()
          .prepare(
            'SELECT * FROM project_instances WHERE template_id = ? ORDER BY anchor_date DESC',
          )
          .all(templateId)) as InstanceRow[];
    return rows.map((row) => rowToInstance(row, this.getSteps(row.id)));
  }

  async findByTemplateIdAsync(
    templateId: string,
    userId?: number,
  ): Promise<ProjectInstance[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<InstanceRow>(
              `SELECT * FROM project_instances
               WHERE template_id = $1 AND (owner_id = $2 OR owner_id IS NULL)
               ORDER BY anchor_date DESC`,
              [templateId, userId],
            )
          : await getPostgresPool().query<InstanceRow>(
              'SELECT * FROM project_instances WHERE template_id = $1 ORDER BY anchor_date DESC',
              [templateId],
            );
      return Promise.all(
        result.rows.map(async (row) =>
          rowToInstance(row, await this.getStepsAsync(row.id)),
        ),
      );
    }
    return this.findByTemplateId(templateId, userId);
  }

  findById(id: string, userId?: number): ProjectInstance {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_instances
             WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)`,
          )
          .get(id, userId)
      : getDb()
          .prepare('SELECT * FROM project_instances WHERE id = ?')
          .get(id)) as InstanceRow | undefined;
    if (!row) throw AppError.notFound('ProjectInstance');
    return rowToInstance(row, this.getSteps(id));
  }

  async findByIdAsync(id: string, userId?: number): Promise<ProjectInstance> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<InstanceRow>(
              `SELECT * FROM project_instances
               WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)`,
              [id, userId],
            )
          : await getPostgresPool().query<InstanceRow>(
              'SELECT * FROM project_instances WHERE id = $1',
              [id],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ProjectInstance');
      return rowToInstance(row, await this.getStepsAsync(id));
    }
    return this.findById(id, userId);
  }

  findByTemplateAndAnchor(
    templateId: string,
    anchorDate: string,
    name?: string | null,
    userId?: number | null,
  ): ProjectInstance | null {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM project_instances
             WHERE template_id = ?
               AND anchor_date = ?
               AND COALESCE(name, '') = COALESCE(?, '')
               AND (owner_id = ? OR owner_id IS NULL)`,
          )
          .get(templateId, anchorDate, name ?? null, userId)
      : getDb()
          .prepare(
            `SELECT * FROM project_instances
             WHERE template_id = ? AND anchor_date = ? AND COALESCE(name, '') = COALESCE(?, '')`,
          )
          .get(templateId, anchorDate, name ?? null)) as InstanceRow | undefined;
    if (!row) return null;
    return rowToInstance(row, this.getSteps(row.id));
  }

  async findByTemplateAndAnchorAsync(
    templateId: string,
    anchorDate: string,
    name?: string | null,
    userId?: number | null,
  ): Promise<ProjectInstance | null> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<InstanceRow>(
              `SELECT * FROM project_instances
               WHERE template_id = $1
                 AND anchor_date = $2
                 AND COALESCE(name, '') = COALESCE($3, '')
                 AND (owner_id = $4 OR owner_id IS NULL)`,
              [templateId, anchorDate, name ?? null, userId],
            )
          : await getPostgresPool().query<InstanceRow>(
              `SELECT * FROM project_instances
               WHERE template_id = $1 AND anchor_date = $2 AND COALESCE(name, '') = COALESCE($3, '')`,
              [templateId, anchorDate, name ?? null],
            );
      const row = result.rows[0];
      if (!row) return null;
      return rowToInstance(row, await this.getStepsAsync(row.id));
    }
    return this.findByTemplateAndAnchor(templateId, anchorDate, name, userId);
  }

  createWithSteps(
    templateId: string,
    anchorDate: string,
    name: string | null,
    ownerId: number | null,
    steps: Array<{ stepId: string; title: string; dueDate: string }>,
  ): ProjectInstance {
    const instanceId = uuidv4();
    const now = new Date().toISOString();

    const db = getDb();
    const insertInstance = db.prepare(
      `INSERT INTO project_instances (id, template_id, name, anchor_date, status, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertStep = db.prepare(
      `INSERT INTO project_instance_steps (id, instance_id, step_id, title, due_date, status) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    db.transaction(() => {
      insertInstance.run(
        instanceId,
        templateId,
        name,
        anchorDate,
        'active',
        ownerId,
        now,
      );
      for (const step of steps) {
        insertStep.run(uuidv4(), instanceId, step.stepId, step.title, step.dueDate, 'open');
      }
    })();

    return this.findById(instanceId);
  }

  async createWithStepsAsync(
    templateId: string,
    anchorDate: string,
    name: string | null,
    ownerId: number | null,
    steps: Array<{ stepId: string; title: string; dueDate: string }>,
  ): Promise<ProjectInstance> {
    if (env.dbClient === 'postgres') {
      const instanceId = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO project_instances (id, template_id, name, anchor_date, status, owner_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [instanceId, templateId, name, anchorDate, 'active', ownerId, now],
      );
      for (const step of steps) {
        await getPostgresPool().query(
          `INSERT INTO project_instance_steps (id, instance_id, step_id, title, due_date, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), instanceId, step.stepId, step.title, step.dueDate, 'open'],
        );
      }
      return this.findByIdAsync(instanceId);
    }
    return this.createWithSteps(templateId, anchorDate, name, ownerId, steps);
  }

  updateStep(
    stepId: string,
    data: { title?: string; dueDate?: string; status?: string; notes?: string | null },
    userId?: number,
  ): ProjectInstanceStep {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT pis.*
             FROM project_instance_steps pis
             JOIN project_instances pi ON pi.id = pis.instance_id
             WHERE pis.id = ? AND (pi.owner_id = ? OR pi.owner_id IS NULL)`,
          )
          .get(stepId, userId)
      : getDb()
          .prepare('SELECT * FROM project_instance_steps WHERE id = ?')
          .get(stepId)) as InstanceStepRow | undefined;
    if (!row) throw AppError.notFound('ProjectInstanceStep');

    getDb()
      .prepare(
        `UPDATE project_instance_steps SET title = ?, due_date = ?, status = ?, notes = ? WHERE id = ?`,
      )
      .run(
        data.title ?? row.title,
        data.dueDate ?? row.due_date,
        data.status ?? row.status,
        data.notes !== undefined ? data.notes : row.notes,
        stepId,
      );

    this.refreshInstanceStatus(row.instance_id);

    const updated = getDb()
      .prepare('SELECT * FROM project_instance_steps WHERE id = ?')
      .get(stepId) as InstanceStepRow;
    return rowToStep(updated);
  }

  async updateStepAsync(
    stepId: string,
    data: { title?: string; dueDate?: string; status?: string; notes?: string | null },
    userId?: number,
  ): Promise<ProjectInstanceStep> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<InstanceStepRow>(
              `SELECT pis.*
               FROM project_instance_steps pis
               JOIN project_instances pi ON pi.id = pis.instance_id
               WHERE pis.id = $1 AND (pi.owner_id = $2 OR pi.owner_id IS NULL)`,
              [stepId, userId],
            )
          : await getPostgresPool().query<InstanceStepRow>(
              'SELECT * FROM project_instance_steps WHERE id = $1',
              [stepId],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('ProjectInstanceStep');

      const updatedResult = await getPostgresPool().query<InstanceStepRow>(
        `UPDATE project_instance_steps
         SET title = $1, due_date = $2, status = $3, notes = $4
         WHERE id = $5
         RETURNING *`,
        [
          data.title ?? row.title,
          data.dueDate ?? row.due_date,
          data.status ?? row.status,
          data.notes !== undefined ? data.notes : row.notes,
          stepId,
        ],
      );

      await this.refreshInstanceStatusAsync(row.instance_id);
      return rowToStep(updatedResult.rows[0]);
    }
    return this.updateStep(stepId, data, userId);
  }

  deleteByTemplateId(templateId: string, userId?: number): void {
    if (userId != null) {
      getDb()
        .prepare(
          'DELETE FROM project_instances WHERE template_id = ? AND (owner_id = ? OR owner_id IS NULL)',
        )
        .run(templateId, userId);
      return;
    }
    getDb().prepare('DELETE FROM project_instances WHERE template_id = ?').run(templateId);
  }

  async deleteByTemplateIdAsync(templateId: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      if (userId != null) {
        await getPostgresPool().query(
          'DELETE FROM project_instances WHERE template_id = $1 AND (owner_id = $2 OR owner_id IS NULL)',
          [templateId, userId],
        );
        return;
      }
      await getPostgresPool().query(
        'DELETE FROM project_instances WHERE template_id = $1',
        [templateId],
      );
      return;
    }
    this.deleteByTemplateId(templateId, userId);
  }

  delete(instanceId: string, userId?: number): void {
    this.findById(instanceId, userId);
    const result = (userId != null
      ? getDb()
          .prepare(
            'DELETE FROM project_instances WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)',
          )
          .run(instanceId, userId)
      : getDb().prepare('DELETE FROM project_instances WHERE id = ?').run(instanceId));
    if (result.changes === 0) throw AppError.notFound('ProjectInstance');
  }

  async deleteAsync(instanceId: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(instanceId, userId);
      const result =
        userId != null
          ? await getPostgresPool().query(
              'DELETE FROM project_instances WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)',
              [instanceId, userId],
            )
          : await getPostgresPool().query(
              'DELETE FROM project_instances WHERE id = $1',
              [instanceId],
            );
      if (result.rowCount === 0) throw AppError.notFound('ProjectInstance');
      return;
    }
    this.delete(instanceId, userId);
  }
}
