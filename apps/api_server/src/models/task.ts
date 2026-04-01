export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  scheduledDate: string | null;
  locked: boolean;
  status: 'open' | 'done';
  sourceType: string | null;
  sourceId: string | null;
  sourceName: string | null;
  ownerId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'done';
  scheduledDate?: string | null;
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
  locked?: boolean;
  ownerId?: number | null;
}
