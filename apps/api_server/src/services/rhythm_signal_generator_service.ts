import { getDb } from "../database/db";
import type { AutomationSignal } from "../models/automation_signal";

function makeSignal(
  signalType: AutomationSignal["signalType"],
  externalId: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): AutomationSignal {
  return {
    id: `rhythm:${signalType}:${externalId}`,
    provider: "rhythm",
    signalType,
    externalId,
    dedupeKey: `rhythm:${signalType}:${externalId}`,
    occurredAt,
    syncedAt: new Date().toISOString(),
    sourceAccountId: null,
    sourceLabel: "Rhythm",
    payload,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  owner_id: number | null;
}

interface StepRow {
  id: string;
  title: string;
  due_date: string;
  instance_id: string;
  instance_name: string | null;
}

export class RhythmSignalGeneratorService {
  generateTaskDueSignals(lookaheadDays = 7): AutomationSignal[] {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setUTCDate(cutoff.getUTCDate() + lookaheadDays);
    const todayStr = today.toISOString().slice(0, 10);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = getDb()
      .prepare(
        `SELECT id, title, due_date, owner_id
         FROM tasks
         WHERE status = 'open'
           AND due_date IS NOT NULL
           AND due_date >= ?
           AND due_date <= ?`,
      )
      .all(todayStr, cutoffStr) as TaskRow[];

    return rows.map((row) => {
      const dueDate = row.due_date!;
      const daysUntilDue = Math.floor(
        (new Date(`${dueDate}T00:00:00Z`).getTime() -
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          )) /
          (1000 * 60 * 60 * 24),
      );
      return makeSignal(
        "task_due",
        row.id,
        {
          title: row.title,
          dueDate,
          daysUntilDue,
          ownerId: row.owner_id,
        },
        `${dueDate}T00:00:00.000Z`,
      );
    });
  }

  generateProjectStepDueSignals(lookaheadDays = 7): AutomationSignal[] {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setUTCDate(cutoff.getUTCDate() + lookaheadDays);
    const todayStr = today.toISOString().slice(0, 10);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = getDb()
      .prepare(
        `SELECT pis.id, pis.title, pis.due_date, pis.instance_id,
                COALESCE(pi.name, pt.name) AS instance_name
         FROM project_instance_steps pis
         JOIN project_instances pi ON pis.instance_id = pi.id
         JOIN project_templates pt ON pi.template_id = pt.id
         WHERE pis.status = 'open'
           AND pis.due_date >= ?
           AND pis.due_date <= ?`,
      )
      .all(todayStr, cutoffStr) as StepRow[];

    return rows.map((row) => {
      const daysUntilDue = Math.floor(
        (new Date(`${row.due_date}T00:00:00Z`).getTime() -
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          )) /
          (1000 * 60 * 60 * 24),
      );
      return makeSignal(
        "project_step_due",
        row.id,
        {
          title: row.title,
          dueDate: row.due_date,
          daysUntilDue,
          instanceId: row.instance_id,
          instanceName: row.instance_name,
        },
        `${row.due_date}T00:00:00.000Z`,
      );
    });
  }
}
