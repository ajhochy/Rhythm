export interface Task {
  id: string;
  title: string;
  dueDate: string | null;
  status: 'open' | 'done';
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  title: string;
  dueDate?: string | null;
  status?: 'open' | 'done';
}

export interface UpdateTaskDto {
  title?: string;
  dueDate?: string | null;
  status?: 'open' | 'done';
}
