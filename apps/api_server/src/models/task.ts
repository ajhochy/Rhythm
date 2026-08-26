export interface TaskCollaborator {
  userId: number;
  name: string;
  photoUrl: string | null;
}

export type TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'deferred';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  scheduledDate: string | null;
  scheduledOrder: number | null;
  locked: boolean;
  status: TaskStatus;
  sourceType: string | null;
  sourceId: string | null;
  sourceName: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isAllDay?: boolean;
  ownerId: number | null;
  goalId?: string | null;
  priority: number | null;
  tags: string[];
  energy: string | null;
  workspaceId?: number | null;
  isShared?: boolean;
  collaborators: TaskCollaborator[];
  createdAt: string;
  updatedAt: string;
  preferredAgent: string | null;
}

export interface CreateTaskDto {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  scheduledDate?: string | null;
  scheduledOrder?: number | null;
  locked?: boolean;
  sourceType?: string | null;
  sourceId?: string | null;
  ownerId?: number | null;
  goalId?: string | null;
  priority?: number | null;
  tags?: string[];
  energy?: string | null;
  preferredAgent?: string | null;
}

export interface UpdateTaskDto {
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  scheduledDate?: string | null;
  scheduledOrder?: number | null;
  locked?: boolean;
  ownerId?: number | null;
  goalId?: string | null;
  priority?: number | null;
  tags?: string[];
  energy?: string | null;
  preferredAgent?: string | null;
}

/** Canonical storage/filter form for task tags. */
export function normalizeTaskTags(tags: string[]): string[] {
  return [...new Set(
    tags
      .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
      .filter((tag) => tag.length > 0),
  )];
}
