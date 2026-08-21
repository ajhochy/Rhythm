import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import { normalizeTaskTags, type CreateTaskDto, type Task, type TaskCollaborator, type UpdateTaskDto } from '../models/task';
import type { TaskFilter } from '../models/task_filter';
import { scoreDocsBm25 } from '../services/bm25';

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  scheduled_order: number | null;
  locked: number;
  status: string;
  source_type: string | null;
  source_id: string | null;
  source_name: string | null;
  owner_id: number | null;
  goal_id: string | null;
  priority: number | null;
  tags: string | string[] | null;
  energy: string | null;
  workspace_id?: number | null;
  is_shared?: number | null;
  created_at: string;
  updated_at: string;
  preferred_agent: string | null;
}

function rowToTask(row: TaskRow): Task {
  const locked =
    typeof row.locked === 'boolean' ? row.locked : row.locked === 1;
  const storedTags = Array.isArray(row.tags)
    ? row.tags
    : JSON.parse(row.tags ?? '[]');

  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    dueDate: row.due_date,
    scheduledDate: row.scheduled_date ?? null,
    scheduledOrder: row.scheduled_order ?? null,
    locked,
    status: row.status as Task['status'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    ownerId: row.owner_id,
    goalId: row.goal_id ?? null,
    priority: row.priority ?? null,
    tags: normalizeTaskTags(
      Array.isArray(storedTags)
        ? storedTags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    ),
    energy: row.energy ?? null,
    workspaceId: row.workspace_id ?? null,
    isShared: Boolean(row.is_shared),
    collaborators: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preferredAgent: row.preferred_agent ?? null,
  };
}

function attachCollaboratorsToTasks(
  tasks: Task[],
  collabRows: Array<{ task_id: string; user_id: number; name: string; photo_url: string | null }>,
): void {
  const byTaskId = new Map<string, TaskCollaborator[]>();
  for (const r of collabRows) {
    let arr = byTaskId.get(r.task_id);
    if (!arr) { arr = []; byTaskId.set(r.task_id, arr); }
    arr.push({ userId: r.user_id, name: r.name, photoUrl: r.photo_url });
  }
  for (const task of tasks) {
    task.collaborators = byTaskId.get(task.id) ?? [];
  }
}

const taskSharingSelect = (userIdBind: string) =>
  `CASE WHEN tasks.owner_id != ${userIdBind} THEN 1 ELSE 0 END AS is_shared`;

const taskSelect = (sharingUserIdBind?: string) => `
  SELECT
    tasks.*,
    CASE
      WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
      WHEN tasks.source_type = 'recurring_rule' THEN rr.title
      ELSE NULL
    END AS source_name${sharingUserIdBind ? `,
    ${taskSharingSelect(sharingUserIdBind)}` : ''}
  FROM tasks
  LEFT JOIN project_instances pi
    ON tasks.source_type = 'project_step'
   AND tasks.source_id = pi.id
  LEFT JOIN project_templates pt
    ON pi.template_id = pt.id
  LEFT JOIN recurring_task_rules rr
    ON tasks.source_type = 'recurring_rule'
   AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
`;

const TASK_SELECT = taskSelect();

function compareCanonicalTasks(a: Task, b: Task, today: string): number {
  const priority = (task: Task) => task.scheduledDate ?? task.dueDate;
  const overdue = (task: Task) =>
    task.status !== 'done' && priority(task) !== null && priority(task)! < today;
  const overdueOrder = Number(overdue(a)) - Number(overdue(b));
  if (overdueOrder !== 0) return -overdueOrder;

  const compareNullable = (left: string | number | null, right: string | number | null) => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -1 : 1;
  };
  return (
    compareNullable(priority(a), priority(b)) ||
    compareNullable(a.scheduledOrder, b.scheduledOrder) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function rankSearchResults(tasks: Task[], search: string, today: string): Task[] {
  const scores = scoreDocsBm25(search, tasks.map((task) => `${task.title} ${task.notes ?? ''}`));
  return tasks
    .map((task, index) => ({ task, score: scores[index] }))
    .sort((a, b) => b.score - a.score || compareCanonicalTasks(a.task, b.task, today))
    .map(({ task }) => task);
}

function ftsTerms(search: string): string[] {
  return search.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function isFtsUnavailable(error: unknown): boolean {
  return /no such table: tasks_fts|no such module: fts5/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class TasksRepository {
  async findAllAsync(userId: number): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `SELECT tasks.*,
          CASE
            WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
            WHEN tasks.source_type = 'recurring_rule' THEN rr.title
            ELSE NULL
          END AS source_name,
          ${taskSharingSelect('$1')}
         FROM tasks
         LEFT JOIN project_instances pi
           ON tasks.source_type = 'project_step' AND tasks.source_id = pi.id
         LEFT JOIN project_templates pt ON pi.template_id = pt.id
         LEFT JOIN recurring_task_rules rr
           ON tasks.source_type = 'recurring_rule'
          AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
         LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = $2
         WHERE tasks.owner_id = $3 OR tc.user_id IS NOT NULL
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
        [userId, userId, userId],
      );
      const tasks = result.rows.map(rowToTask);
      if (tasks.length > 0) {
        const ids = tasks.map((t) => t.id);
        const cr = await getPostgresPool().query<{ task_id: string; user_id: number; name: string; photo_url: string | null }>(
          `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
           FROM task_collaborators tc
           JOIN users u ON u.id = tc.user_id
           WHERE tc.task_id = ANY($1)`,
          [ids],
        );
        attachCollaboratorsToTasks(tasks, cr.rows);
      }
      return tasks;
    }

    return this.findAll(userId);
  }

  findAll(userId: number): Task[] {
    const rows = getDb()
      .prepare(
        `SELECT tasks.*,
          CASE
            WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
            WHEN tasks.source_type = 'recurring_rule' THEN rr.title
            ELSE NULL
          END AS source_name,
          ${taskSharingSelect('?')}
         FROM tasks
         LEFT JOIN project_instances pi
           ON tasks.source_type = 'project_step' AND tasks.source_id = pi.id
         LEFT JOIN project_templates pt ON pi.template_id = pt.id
         LEFT JOIN recurring_task_rules rr
           ON tasks.source_type = 'recurring_rule'
          AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
         LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = ?
         WHERE tasks.owner_id = ? OR tc.user_id IS NOT NULL
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
      )
      .all(userId, userId, userId) as TaskRow[];
    const tasks = rows.map(rowToTask);
    if (tasks.length > 0) {
      const placeholders = tasks.map(() => '?').join(',');
      const collabRows = getDb()
        .prepare(
          `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
           FROM task_collaborators tc
           JOIN users u ON u.id = tc.user_id
           WHERE tc.task_id IN (${placeholders})`,
        )
        .all(...tasks.map((t) => t.id)) as Array<{ task_id: string; user_id: number; name: string; photo_url: string | null }>;
      attachCollaboratorsToTasks(tasks, collabRows);
    }
    return tasks;
  }

  async findByFilterAsync(filter: TaskFilter): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const { userId, status, scheduledBefore, dueBefore, overdue, today, tag, minPriority } = filter;
      const search = filter.search?.trim();
      const todayForSort = today ?? new Date().toISOString().slice(0, 10);
      const clauses = [
        '(tasks.owner_id = $1 OR EXISTS (SELECT 1 FROM task_collaborators tc WHERE tc.task_id = tasks.id AND tc.user_id = $1))',
      ];
      const params: unknown[] = [userId];
      const bind = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };

      if (status === 'open') clauses.push("tasks.status != 'done'");
      else if (status !== 'all') clauses.push(`tasks.status = ${bind(status)}`);
      if (scheduledBefore !== undefined) {
        clauses.push(`COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL AND COALESCE(tasks.scheduled_date, tasks.due_date) <= ${bind(scheduledBefore)}`);
      }
      if (dueBefore !== undefined) {
        clauses.push(`tasks.due_date IS NOT NULL AND tasks.due_date <= ${bind(dueBefore)}`);
      }
      if (overdue !== undefined) {
        const todayParam = bind(todayForSort);
        clauses.push(overdue
          ? `tasks.status != 'done' AND COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL AND COALESCE(tasks.scheduled_date, tasks.due_date) < ${todayParam}`
          : `(tasks.status = 'done' OR COALESCE(tasks.scheduled_date, tasks.due_date) IS NULL OR COALESCE(tasks.scheduled_date, tasks.due_date) >= ${todayParam})`);
      }
      if (search) {
        clauses.push(`tasks.search_vector @@ plainto_tsquery('english', ${bind(search)})`);
      }
      if (tag !== undefined) {
        clauses.push(`tasks.tags ? ${bind(tag)}`);
      }
      if (minPriority !== undefined) {
        clauses.push(`tasks.priority >= ${bind(minPriority)}`);
      }
      const todayParam = bind(todayForSort);
      const result = await getPostgresPool().query<TaskRow>(
        `SELECT tasks.*,
          CASE
            WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
            WHEN tasks.source_type = 'recurring_rule' THEN rr.title
            ELSE NULL
          END AS source_name,
          ${taskSharingSelect('$1')}
         FROM tasks
         LEFT JOIN project_instances pi
           ON tasks.source_type = 'project_step' AND tasks.source_id = pi.id
         LEFT JOIN project_templates pt ON pi.template_id = pt.id
         LEFT JOIN recurring_task_rules rr
           ON tasks.source_type = 'recurring_rule'
          AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
         WHERE ${clauses.join('\n           AND ')}
         ORDER BY
           CASE WHEN tasks.status != 'done'
             AND COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL
             AND COALESCE(tasks.scheduled_date, tasks.due_date) < ${todayParam}
             THEN 0 ELSE 1 END ASC,
           COALESCE(tasks.scheduled_date, tasks.due_date) ASC NULLS LAST,
           tasks.scheduled_order ASC NULLS LAST,
           tasks.created_at ASC,
           tasks.id ASC`,
        params,
      );
      const tasks = result.rows.map(rowToTask);
      if (tasks.length > 0) {
        const collaborators = await getPostgresPool().query<{ task_id: string; user_id: number; name: string; photo_url: string | null }>(
          `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
           FROM task_collaborators tc JOIN users u ON u.id = tc.user_id
           WHERE tc.task_id = ANY($1)`,
          [tasks.map((task) => task.id)],
        );
        attachCollaboratorsToTasks(tasks, collaborators.rows);
      }
      return search ? rankSearchResults(tasks, search, todayForSort) : tasks;
    }

    return this.findByFilter(filter);
  }

  /**
   * SQLite implementation of findByFilterAsync.
   * Builds the WHERE clause dynamically from the filter, binding all values as
   * parameters to prevent SQL injection.
   */
  findByFilter(filter: TaskFilter): Task[] {
    const { userId, status, scheduledBefore, dueBefore, overdue, today, tag, minPriority } = filter;
    const search = filter.search?.trim();

    const clauses: string[] = [
      // Visibility: own tasks OR tasks the user is a collaborator on.
      '(tasks.owner_id = ? OR EXISTS (SELECT 1 FROM task_collaborators tc WHERE tc.task_id = tasks.id AND tc.user_id = ?))',
    ];
    const params: unknown[] = [userId, userId];

    // --- status ---
    if (status === 'open') {
      clauses.push("tasks.status != 'done'");
    } else if (status !== 'all') {
      clauses.push('tasks.status = ?');
      params.push(status);
    }
    // status === 'all' → no status clause

    // --- scheduled_before: COALESCE(scheduled_date, due_date) <= ? ---
    if (scheduledBefore !== undefined) {
      clauses.push('COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL AND COALESCE(tasks.scheduled_date, tasks.due_date) <= ?');
      params.push(scheduledBefore);
    }

    // --- due_before: due_date IS NOT NULL AND due_date <= ? ---
    if (dueBefore !== undefined) {
      clauses.push('tasks.due_date IS NOT NULL AND tasks.due_date <= ?');
      params.push(dueBefore);
    }

    // --- overdue ---
    if (overdue !== undefined) {
      if (overdue) {
        // Overdue: not done AND priority date < today
        clauses.push(
          "tasks.status != 'done' AND COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL AND COALESCE(tasks.scheduled_date, tasks.due_date) < ?",
        );
        params.push(today ?? new Date().toISOString().slice(0, 10));
      } else {
        // Not overdue: done OR priority date >= today OR no priority date
        clauses.push(
          "(tasks.status = 'done' OR COALESCE(tasks.scheduled_date, tasks.due_date) IS NULL OR COALESCE(tasks.scheduled_date, tasks.due_date) >= ?)",
        );
        params.push(today ?? new Date().toISOString().slice(0, 10));
      }
    }

    if (tag !== undefined) {
      clauses.push('EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE json_each.value = ?)');
      params.push(tag);
    }
    if (minPriority !== undefined) {
      clauses.push('tasks.priority >= ?');
      params.push(minPriority);
    }

    const todayForSort = today ?? new Date().toISOString().slice(0, 10);
    const query = (candidateClause?: string) => {
      const whereClauses = candidateClause ? [...clauses, candidateClause] : clauses;
      const where = whereClauses.map((c, i) => (i === 0 ? `WHERE ${c}` : `AND ${c}`)).join('\n  ');
      return `
      SELECT
        tasks.*,
        CASE
          WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
          WHEN tasks.source_type = 'recurring_rule' THEN rr.title
          ELSE NULL
        END AS source_name,
        ${taskSharingSelect('?')}
      FROM tasks
      LEFT JOIN project_instances pi
        ON tasks.source_type = 'project_step' AND tasks.source_id = pi.id
      LEFT JOIN project_templates pt ON pi.template_id = pt.id
      LEFT JOIN recurring_task_rules rr
        ON tasks.source_type = 'recurring_rule'
       AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
      ${where}
      ORDER BY
        CASE
          WHEN tasks.status != 'done'
           AND COALESCE(tasks.scheduled_date, tasks.due_date) IS NOT NULL
           AND COALESCE(tasks.scheduled_date, tasks.due_date) < ?
          THEN 0 ELSE 1
        END ASC,
        COALESCE(tasks.scheduled_date, tasks.due_date) ASC NULLS LAST,
        tasks.scheduled_order ASC NULLS LAST,
        tasks.created_at ASC
    `;
    };

    let rows: TaskRow[];
    if (!search) {
      rows = getDb().prepare(query()).all(userId, ...params, todayForSort) as TaskRow[];
    } else {
      const terms = ftsTerms(search);
      if (terms.length === 0) return [];
      const ftsQuery = terms.map((term) => `"${term}"`).join(' AND ');
      try {
        rows = getDb()
          .prepare(query('tasks.rowid IN (SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ?)'))
          .all(userId, ...params, ftsQuery, todayForSort) as TaskRow[];
      } catch (error) {
        if (!isFtsUnavailable(error)) throw error;
        console.warn('tasks FTS5 unavailable; using title+notes LIKE fallback');
        const like = `%${search.toLowerCase()}%`;
        rows = getDb()
          .prepare(query("(LOWER(tasks.title) LIKE ? OR LOWER(COALESCE(tasks.notes, '')) LIKE ?)"))
          .all(userId, ...params, like, like, todayForSort) as TaskRow[];
      }
    }

    const tasks = rows.map(rowToTask);

    if (tasks.length > 0) {
      const placeholders = tasks.map(() => '?').join(',');
      const collabRows = getDb()
        .prepare(
          `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
           FROM task_collaborators tc
           JOIN users u ON u.id = tc.user_id
           WHERE tc.task_id IN (${placeholders})`,
        )
        .all(...tasks.map((t) => t.id)) as Array<{ task_id: string; user_id: number; name: string; photo_url: string | null }>;
      attachCollaboratorsToTasks(tasks, collabRows);
    }

    return search ? rankSearchResults(tasks, search, todayForSort) : tasks;
  }

  async findAllIncludingLegacyAsync(): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
      );
      return result.rows.map(rowToTask);
    }
    return this.findAllIncludingLegacy();
  }

  findAllIncludingLegacy(): Task[] {
    const rows = getDb()
      .prepare(
        `${TASK_SELECT}
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
      )
      .all() as TaskRow[];
    return rows.map(rowToTask);
  }

  async findByIdAsync(id: string, userId: number): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${taskSelect('$2')}
         LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = $2
         WHERE tasks.id = $1 AND (tasks.owner_id = $2 OR tc.user_id IS NOT NULL)`,
        [id, userId],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Task');
      const task = rowToTask(row);
      const cr = await getPostgresPool().query<{ task_id: string; user_id: number; name: string; photo_url: string | null }>(
        `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = $1`,
        [id],
      );
      attachCollaboratorsToTasks([task], cr.rows);
      return task;
    }

    return this.findById(id, userId);
  }

  findById(id: string, userId: number): Task {
    const row = getDb()
      .prepare(
        `${taskSelect('?')}
         LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = ?
         WHERE tasks.id = ? AND (tasks.owner_id = ? OR tc.user_id IS NOT NULL)`,
      )
      .get(userId, userId, id, userId) as TaskRow | undefined;
    if (!row) throw AppError.notFound('Task');
    const task = rowToTask(row);
    const collabRows = getDb()
      .prepare(
        `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = ?`,
      )
      .all(id) as Array<{ task_id: string; user_id: number; name: string; photo_url: string | null }>;
    attachCollaboratorsToTasks([task], collabRows);
    return task;
  }

  async findByIdIncludingLegacyAsync(id: string): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT} WHERE tasks.id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Task');
      return rowToTask(row);
    }
    return this.findByIdIncludingLegacy(id);
  }

  findByIdIncludingLegacy(id: string): Task {
    const row = getDb()
      .prepare(`${TASK_SELECT} WHERE tasks.id = ?`)
      .get(id) as TaskRow | undefined;
    if (!row) throw AppError.notFound('Task');
    return rowToTask(row);
  }

  async findBySourceAsync(sourceType: string, sourceId: string): Promise<Task | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT} WHERE tasks.source_type = $1 AND tasks.source_id = $2 LIMIT 1`,
        [sourceType, sourceId],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : null;
    }

    return this.findBySource(sourceType, sourceId);
  }

  findBySource(sourceType: string, sourceId: string): Task | null {
    const row = getDb()
      .prepare(
        `${TASK_SELECT} WHERE tasks.source_type = ? AND tasks.source_id = ? LIMIT 1`,
      )
      .get(sourceType, sourceId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  async findByIdUnsafeAsync(id: string): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT} WHERE tasks.id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Task');
      const task = rowToTask(row);
      const cr = await getPostgresPool().query<{ task_id: string; user_id: number; name: string; photo_url: string | null }>(
        `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = $1`,
        [id],
      );
      attachCollaboratorsToTasks([task], cr.rows);
      return task;
    }

    return this.findByIdUnsafe(id);
  }

  findByIdUnsafe(id: string): Task {
    const row = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE tasks.id = ?`,
      )
      .get(id) as TaskRow | undefined;
    if (!row) throw AppError.notFound('Task');
    const task = rowToTask(row);
    const collabRows = getDb()
      .prepare(
        `SELECT tc.task_id, u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = ?`,
      )
      .all(id) as Array<{ task_id: string; user_id: number; name: string; photo_url: string | null }>;
    attachCollaboratorsToTasks([task], collabRows);
    return task;
  }

  async findBySourceAndDueDateAsync(
    sourceType: string,
    sourceId: string,
    dueDate: string,
  ): Promise<Task | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         WHERE tasks.source_type = $1 AND tasks.source_id = $2 AND tasks.due_date = $3
         LIMIT 1`,
        [sourceType, sourceId, dueDate],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : null;
    }

    const row = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE tasks.source_type = ? AND tasks.source_id = ? AND tasks.due_date = ?
         LIMIT 1`,
      )
      .get(sourceType, sourceId, dueDate) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  async findByWeekAsync(
    weekStart: string,
    weekEnd: string,
    userId: number,
  ): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = $1
         WHERE (tasks.owner_id = $1 OR tc.user_id IS NOT NULL)
           AND (tasks.due_date BETWEEN $2 AND $3 OR tasks.scheduled_date BETWEEN $4 AND $5)
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
        [userId, weekStart, weekEnd, weekStart, weekEnd],
      );
      return result.rows.map(rowToTask);
    }

    return this.findByWeek(weekStart, weekEnd, userId);
  }

  findByWeek(weekStart: string, weekEnd: string, userId: number): Task[] {
    const rows = getDb()
        .prepare(
          `${TASK_SELECT}
        LEFT JOIN task_collaborators tc ON tc.task_id = tasks.id AND tc.user_id = ?
        WHERE (tasks.owner_id = ? OR tc.user_id IS NOT NULL)
           AND (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
       ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
    )
      .all(userId, userId, weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
    return rows.map(rowToTask);
  }

  async findByWeekIncludingLegacyAsync(
    weekStart: string,
    weekEnd: string,
  ): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         WHERE (tasks.due_date BETWEEN $1 AND $2 OR tasks.scheduled_date BETWEEN $3 AND $4)
         ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
        [weekStart, weekEnd, weekStart, weekEnd],
      );
      return result.rows.map(rowToTask);
    }
    const rows = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
         ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
      )
      .all(weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
    return rows.map(rowToTask);
  }

  async findBacklogAsync(startOfWeek: string, userId: number): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         WHERE tasks.status = 'open'
           AND (
             (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
             OR (tasks.scheduled_date IS NULL AND tasks.due_date < $1)
             OR tasks.scheduled_date < $2
           )
           AND (
             tasks.owner_id = $3
             OR EXISTS (
               SELECT 1 FROM task_collaborators tc
               WHERE tc.task_id = tasks.id AND tc.user_id = $3
             )
           )
         ORDER BY
           CASE
             WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
             ELSE tasks.due_date
           END ASC,
           tasks.created_at ASC`,
        [startOfWeek, startOfWeek, userId],
      );
      return result.rows.map(rowToTask);
    }

    const db = getDb();
    const rows = db
      .prepare(
        `${TASK_SELECT}
         WHERE tasks.status = 'open'
           AND (
             (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
             OR (tasks.scheduled_date IS NULL AND tasks.due_date < ?)
             OR tasks.scheduled_date < ?
           )
           AND (
             tasks.owner_id = ?
             OR EXISTS (
               SELECT 1 FROM task_collaborators tc
               WHERE tc.task_id = tasks.id AND tc.user_id = ?
             )
           )
         ORDER BY
           CASE
             WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
             ELSE tasks.due_date
           END ASC,
           tasks.created_at ASC`,
      )
      .all(startOfWeek, startOfWeek, userId, userId) as TaskRow[];
    return rows.map(rowToTask);
  }

  async findBacklogIncludingLegacyAsync(startOfWeek: string): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         WHERE tasks.status = 'open'
           AND (
             (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
             OR (tasks.scheduled_date IS NULL AND tasks.due_date < $1)
             OR tasks.scheduled_date < $2
           )
         ORDER BY
           CASE
             WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
             ELSE tasks.due_date
           END ASC,
           tasks.created_at ASC`,
        [startOfWeek, startOfWeek],
      );
      return result.rows.map(rowToTask);
    }

    const rows = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE tasks.status = 'open'
           AND (
             (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
             OR (tasks.scheduled_date IS NULL AND tasks.due_date < ?)
             OR tasks.scheduled_date < ?
           )
         ORDER BY
           CASE
             WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
             ELSE tasks.due_date
           END ASC,
           tasks.created_at ASC`,
      )
      .all(startOfWeek, startOfWeek) as TaskRow[];
    return rows.map(rowToTask);
  }

  async createAsync(data: CreateTaskDto): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const id = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO tasks (
          id, title, notes, due_date, scheduled_date, locked, status,
          scheduled_order, source_type, source_id, owner_id, preferred_agent,
          goal_id, priority, tags, energy, created_at, updated_at
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18)`,
        [
          id,
          data.title,
          data.notes ?? null,
          data.dueDate ?? null,
          data.scheduledDate ?? null,
          data.locked ?? false,
          data.status ?? 'open',
          data.scheduledOrder ?? null,
          data.sourceType ?? null,
          data.sourceId ?? null,
          data.ownerId ?? null,
          data.preferredAgent ?? null,
          data.goalId ?? null,
          data.priority ?? null,
          JSON.stringify(normalizeTaskTags(data.tags ?? [])),
          data.energy ?? null,
          now,
          now,
        ],
      );
      return this.findByIdIncludingLegacyAsync(id);
    }

    return this.create(data);
  }

  create(data: CreateTaskDto): Task {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tasks (
          id, title, notes, due_date, scheduled_date, locked, status,
          scheduled_order, source_type, source_id, owner_id, preferred_agent,
          goal_id, priority, tags, energy, created_at, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.notes ?? null,
        data.dueDate ?? null,
        data.scheduledDate ?? null,
        data.locked ? 1 : 0,
        data.status ?? 'open',
        data.scheduledOrder ?? null,
        data.sourceType ?? null,
        data.sourceId ?? null,
        data.ownerId ?? null,
        data.preferredAgent ?? null,
        data.goalId ?? null,
        data.priority ?? null,
        JSON.stringify(normalizeTaskTags(data.tags ?? [])),
        data.energy ?? null,
        now,
        now,
      );
    return this.findByIdIncludingLegacy(id);
  }

  async upsertExternalTaskAsync(data: CreateTaskDto): Promise<Task> {
    const existing =
      data.sourceType && data.sourceId
        ? await this.findBySourceAsync(data.sourceType, data.sourceId)
        : null;

    if (!existing) {
      return this.createAsync({
        ...data,
        status: data.status ?? 'open',
      });
    }

    // User has marked this externally-tracked task as done. Don't reopen
    // or otherwise mutate it on subsequent automation syncs.
    if (existing.status === 'done') {
      return existing;
    }

    return this.updateAsync(existing.id, {
      title: data.title,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      scheduledDate: data.scheduledDate ?? null,
      scheduledOrder: data.scheduledOrder ?? null,
      status: data.status ?? 'open',
      locked: data.locked ?? existing.locked,
    });
  }

  upsertExternalTask(data: CreateTaskDto): Task {
    const existing =
      data.sourceType && data.sourceId
        ? this.findBySource(data.sourceType, data.sourceId)
        : null;

    if (!existing) {
      return this.create({
        ...data,
        status: data.status ?? 'open',
      });
    }

    // User has marked this externally-tracked task as done. Don't reopen
    // or otherwise mutate it on subsequent automation syncs.
    if (existing.status === 'done') {
      return existing;
    }

    return this.update(existing.id, {
      title: data.title,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      scheduledDate: data.scheduledDate ?? null,
      scheduledOrder: data.scheduledOrder ?? null,
      status: data.status ?? 'open',
      locked: data.locked ?? existing.locked,
    });
  }

  async markOpenTasksDoneIfMissingAsync(
    sourceType: string,
    activeSourceIds: string[],
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{
        id: string;
        source_id: string | null;
      }>(
        `SELECT id, source_id FROM tasks
         WHERE source_type = $1 AND status = 'open'`,
        [sourceType],
      );

      let changed = 0;
      for (const row of result.rows) {
        if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
        await this.updateAsync(row.id, { status: 'done' });
        changed += 1;
      }
      return changed;
    }

    return this.markOpenTasksDoneIfMissing(sourceType, activeSourceIds);
  }

  markOpenTasksDoneIfMissing(sourceType: string, activeSourceIds: string[]): number {
    const rows = getDb()
      .prepare(
        `SELECT id, source_id FROM tasks
         WHERE source_type = ? AND status = 'open'`,
      )
      .all(sourceType) as Array<{ id: string; source_id: string | null }>;

    let changed = 0;
    for (const row of rows) {
      if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
      this.update(row.id, { status: 'done' });
      changed += 1;
    }
    return changed;
  }

  async deleteTasksMissingFromSourceAsync(
    sourceType: string,
    activeSourceIds: string[],
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{
        id: string;
        source_id: string | null;
      }>(
        `SELECT id, source_id FROM tasks
         WHERE source_type = $1`,
        [sourceType],
      );

      let changed = 0;
      for (const row of result.rows) {
        if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
        await getPostgresPool().query('DELETE FROM tasks WHERE id = $1', [row.id]);
        changed += 1;
      }
      return changed;
    }

    return this.deleteTasksMissingFromSource(sourceType, activeSourceIds);
  }

  deleteTasksMissingFromSource(sourceType: string, activeSourceIds: string[]): number {
    const rows = getDb()
      .prepare(
        `SELECT id, source_id FROM tasks
         WHERE source_type = ?`,
      )
      .all(sourceType) as Array<{ id: string; source_id: string | null }>;

    let changed = 0;
    for (const row of rows) {
      if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
      getDb().prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
      changed += 1;
    }
    return changed;
  }

  async deleteFutureOpenBySourceIdAsync(
    sourceType: string,
    sourceId: string,
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const today = new Date().toISOString().substring(0, 10);
      const result = await getPostgresPool().query(
        `DELETE FROM tasks
         WHERE source_type = $1
           AND (source_id = $2 OR source_id LIKE $2 || ':%')
           AND status = 'open'
           AND (due_date IS NULL OR due_date >= $3)`,
        [sourceType, sourceId, today],
      );
      return result.rowCount ?? 0;
    }

    return this.deleteFutureOpenBySourceId(sourceType, sourceId);
  }

  deleteFutureOpenBySourceId(sourceType: string, sourceId: string): number {
    const today = new Date().toISOString().substring(0, 10);
    const result = getDb()
      .prepare(
        `DELETE FROM tasks
         WHERE source_type = ?
           AND (source_id = ? OR source_id LIKE ? || ':%')
           AND status = 'open'
           AND (due_date IS NULL OR due_date >= ?)`,
      )
      .run(sourceType, sourceId, sourceId, today);
    return result.changes;
  }

  async deleteAllBySourceTypeAsync(sourceType: string): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        'DELETE FROM tasks WHERE source_type = $1',
        [sourceType],
      );
      return result.rowCount ?? 0;
    }

    return this.deleteAllBySourceType(sourceType);
  }

  deleteAllBySourceType(sourceType: string): number {
    const result = getDb()
      .prepare('DELETE FROM tasks WHERE source_type = ?')
      .run(sourceType);
    return result.changes;
  }

  async updateAsync(id: string, data: UpdateTaskDto, userId?: number): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const existing =
        userId != null
          ? await this.findByIdAsync(id, userId)
          : await this.findByIdIncludingLegacyAsync(id);
      const now = new Date().toISOString();
      const nextNotes = data.notes === '' ? null : data.notes;
      const nextDueDate = data.dueDate === '' ? null : data.dueDate;
      const nextScheduledDate =
        data.scheduledDate === '' ? null : data.scheduledDate;
      const nextScheduledOrder =
        data.scheduledOrder === null ? null : data.scheduledOrder;
      const nextPreferredAgent =
        data.preferredAgent === undefined
          ? existing.preferredAgent
          : data.preferredAgent;
      await getPostgresPool().query(
        `UPDATE tasks
         SET title = $1,
             notes = $2,
             due_date = $3,
             status = $4,
             scheduled_date = $5,
             scheduled_order = $6,
             locked = $7,
             owner_id = $8,
             preferred_agent = $9,
             goal_id = $10,
             priority = $11,
             tags = $12::jsonb,
             energy = $13,
             updated_at = $14
         WHERE id = $15`,
        [
          data.title ?? existing.title,
          nextNotes !== undefined ? nextNotes : existing.notes,
          nextDueDate !== undefined ? nextDueDate : existing.dueDate,
          data.status ?? existing.status,
          nextScheduledDate !== undefined
            ? nextScheduledDate
            : existing.scheduledDate,
          data.scheduledOrder !== undefined
            ? nextScheduledOrder
            : existing.scheduledOrder,
          data.locked !== undefined ? data.locked : existing.locked,
          data.ownerId !== undefined ? data.ownerId : existing.ownerId,
          nextPreferredAgent,
          data.goalId !== undefined ? data.goalId : existing.goalId,
          data.priority !== undefined ? data.priority : existing.priority,
          JSON.stringify(data.tags !== undefined ? normalizeTaskTags(data.tags) : existing.tags),
          data.energy !== undefined ? data.energy : existing.energy,
          now,
          id,
        ],
      );
      return userId != null
        ? this.findByIdAsync(id, userId)
        : this.findByIdIncludingLegacyAsync(id);
    }

    return this.update(id, data, userId);
  }

  update(id: string, data: UpdateTaskDto, userId?: number): Task {
    const existing =
      userId != null
        ? this.findById(id, userId)
        : this.findByIdIncludingLegacy(id);
    const now = new Date().toISOString();
    const nextNotes = data.notes === '' ? null : data.notes;
    const nextDueDate = data.dueDate === '' ? null : data.dueDate;
    const nextScheduledDate =
      data.scheduledDate === '' ? null : data.scheduledDate;
    const nextScheduledOrder =
      data.scheduledOrder === null ? null : data.scheduledOrder;
    const nextPreferredAgent =
      data.preferredAgent === undefined
        ? existing.preferredAgent
        : data.preferredAgent;
    getDb()
      .prepare(
        `UPDATE tasks
         SET title = ?, notes = ?, due_date = ?, status = ?,
             scheduled_date = ?, scheduled_order = ?, locked = ?, owner_id = ?,
             preferred_agent = ?, updated_at = ?
             , goal_id = ?, priority = ?, tags = ?, energy = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        nextNotes !== undefined ? nextNotes : existing.notes,
        nextDueDate !== undefined ? nextDueDate : existing.dueDate,
        data.status ?? existing.status,
        nextScheduledDate !== undefined
            ? nextScheduledDate
            : existing.scheduledDate,
        data.scheduledOrder !== undefined
            ? nextScheduledOrder
            : existing.scheduledOrder,
        data.locked !== undefined ? (data.locked ? 1 : 0) : (existing.locked ? 1 : 0),
        data.ownerId !== undefined ? data.ownerId : existing.ownerId,
        nextPreferredAgent,
        now,
        data.goalId !== undefined ? data.goalId : existing.goalId,
        data.priority !== undefined ? data.priority : existing.priority,
        JSON.stringify(data.tags !== undefined ? normalizeTaskTags(data.tags) : existing.tags),
        data.energy !== undefined ? data.energy : existing.energy,
        id,
      );
    return userId != null
      ? this.findById(id, userId)
      : this.findByIdIncludingLegacy(id);
  }

  async deleteAsync(id: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      if (userId != null) {
        await this.findByIdAsync(id, userId);
      } else {
        await this.findByIdIncludingLegacyAsync(id);
      }
      const result = await getPostgresPool().query(
        'DELETE FROM tasks WHERE id = $1',
        [id],
      );
      if ((result.rowCount ?? 0) === 0) throw AppError.notFound('Task');
      return;
    }

    this.delete(id, userId);
  }

  delete(id: string, userId?: number): void {
    if (userId != null) {
      this.findById(id, userId);
    } else {
      this.findByIdIncludingLegacy(id);
    }
    const result = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Task');
  }

  listCollaborators(taskId: string): Array<{ userId: number; name: string; photoUrl: string | null }> {
    const rows = getDb()
      .prepare(
        `SELECT u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = ?`,
      )
      .all(taskId) as Array<{ user_id: number; name: string; photo_url: string | null }>;
    return rows.map((r) => ({ userId: r.user_id, name: r.name, photoUrl: r.photo_url }));
  }

  async listCollaboratorsAsync(taskId: string): Promise<Array<{ userId: number; name: string; photoUrl: string | null }>> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{
        user_id: number;
        name: string;
        photo_url: string | null;
      }>(
        `SELECT u.id AS user_id, u.name, u.photo_url
         FROM task_collaborators tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = $1`,
        [taskId],
      );
      return result.rows.map((r) => ({ userId: r.user_id, name: r.name, photoUrl: r.photo_url }));
    }
    return this.listCollaborators(taskId);
  }

  addCollaborator(taskId: string, collaboratorUserId: number): void {
    getDb()
      .prepare('INSERT OR IGNORE INTO task_collaborators (task_id, user_id) VALUES (?, ?)')
      .run(taskId, collaboratorUserId);
  }

  async addCollaboratorAsync(taskId: string, collaboratorUserId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        'INSERT INTO task_collaborators (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [taskId, collaboratorUserId],
      );
      return;
    }
    this.addCollaborator(taskId, collaboratorUserId);
  }

  removeCollaborator(taskId: string, collaboratorUserId: number): void {
    getDb()
      .prepare('DELETE FROM task_collaborators WHERE task_id = ? AND user_id = ?')
      .run(taskId, collaboratorUserId);
  }

  async removeCollaboratorAsync(taskId: string, collaboratorUserId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        'DELETE FROM task_collaborators WHERE task_id = $1 AND user_id = $2',
        [taskId, collaboratorUserId],
      );
      return;
    }
    this.removeCollaborator(taskId, collaboratorUserId);
  }
}
