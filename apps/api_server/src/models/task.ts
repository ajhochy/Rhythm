export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  scheduledDate: string | null;
  scheduledOrder: number | null;
  locked: boolean;
  status: 'open' | 'done';
  sourceType: string | null;
  sourceId: string | null;
  sourceName: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isAllDay?: boolean;
  ownerId: number | null;
  workspaceId?: number | null;
  isShared?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'done';
  scheduledDate?: string | null;
  scheduledOrder?: number | null;
  locked?: boolean;
  sourceType?: string | null;
  sourceId?: string | null;
  ownerId?: number | null;
}

export interface UpdateTaskDto {
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'done';
  scheduledDate?: string | null;
  scheduledOrder?: number | null;
  locked?: boolean;
  ownerId?: number | null;
}
