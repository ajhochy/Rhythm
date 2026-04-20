import type { NotificationsRepository } from '../repositories/notifications_repository';

export class NotificationService {
  constructor(private readonly repo: NotificationsRepository) {}

  async notifyTaskAssignedAsync(
    entityId: string,
    entityTitle: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    if (recipientUserId === actorUserId) return;
    await this.repo.insertAsync({
      recipientUserId,
      type: 'task_assigned',
      entityType: 'task',
      entityId,
      message: `You were assigned to "${entityTitle}"`,
    });
  }

  async notifyCollaboratorAddedAsync(
    entityType: string,
    entityId: string,
    entityTitle: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    if (recipientUserId === actorUserId) return;
    await this.repo.insertAsync({
      recipientUserId,
      type: 'collaborator_added',
      entityType,
      entityId,
      message: `You were added as a collaborator on "${entityTitle}"`,
    });
  }

  async notifyStepCompletedAsync(
    entityType: string,
    entityId: string,
    entityTitle: string,
    stepTitle: string,
    collaboratorUserIds: number[],
    actorUserId: number,
  ): Promise<void> {
    const recipients = collaboratorUserIds.filter((id) => id !== actorUserId);
    await Promise.all(
      recipients.map((recipientUserId) =>
        this.repo.insertAsync({
          recipientUserId,
          type: 'step_completed',
          entityType,
          entityId,
          message: `"${stepTitle}" was completed in "${entityTitle}"`,
        }),
      ),
    );
  }

  async notifyStepDueAsync(
    entityId: string,
    entityTitle: string,
    stepTitle: string,
    assigneeUserId: number,
  ): Promise<void> {
    await this.repo.insertAsync({
      recipientUserId: assigneeUserId,
      type: 'step_due',
      entityType: 'rhythm',
      entityId,
      message: `Step "${stepTitle}" is due in "${entityTitle}"`,
    });
  }

  async notifyStepUnlockedAsync(
    rhythmId: string,
    rhythmTitle: string,
    stepTitle: string,
    assigneeUserId: number,
  ): Promise<void> {
    await this.repo.insertAsync({
      recipientUserId: assigneeUserId,
      type: 'rhythm_step_unlocked',
      entityType: 'rhythm',
      entityId: rhythmId,
      message: `Your step "${stepTitle}" is now ready in "${rhythmTitle}"`,
    });
  }
}
