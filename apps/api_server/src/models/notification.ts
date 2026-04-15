export interface Notification {
  id: number;
  recipientUserId: number;
  type: 'task_assigned' | 'collaborator_added' | 'step_completed' | 'step_due';
  entityType: 'task' | 'rhythm' | 'project';
  entityId: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface InsertNotificationDto {
  recipientUserId: number;
  type: string;
  entityType: string;
  entityId: string;
  message: string;
}
