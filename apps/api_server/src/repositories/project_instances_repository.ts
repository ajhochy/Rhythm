import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { ProjectInstance, ProjectInstanceStep } from '../models/project_instance';

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

export class ProjectInstancesRepository {
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
}
