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
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'done';
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface UpdateTaskDto {
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'done';
  scheduledDate?: string | null;
  locked?: boolean;
}
