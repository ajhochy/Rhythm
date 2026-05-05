import { Resend } from 'resend';
import { env } from '../config/env';
import type { UsersRepository } from '../repositories/users_repository';

export class EmailService {
  private readonly client: Resend | null;

  constructor(private readonly usersRepo: UsersRepository) {
    this.client = env.resendApiKey ? new Resend(env.resendApiKey) : null;
  }

  async sendTaskAssignedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorName: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.sendCollaborationEmailAsync({
      taskId, taskTitle, actorName, recipientUserId, actorUserId,
      subjectVerb: 'assigned you to',
    });
  }

  async sendCollaboratorAddedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorName: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.sendCollaborationEmailAsync({
      taskId, taskTitle, actorName, recipientUserId, actorUserId,
      subjectVerb: 'added you to',
    });
  }

  private async sendCollaborationEmailAsync(params: {
    taskId: string;
    taskTitle: string;
    actorName: string;
    recipientUserId: number;
    actorUserId: number;
    subjectVerb: string;
  }): Promise<void> {
    if (params.recipientUserId === params.actorUserId) return;
    if (!this.client) return;

    const recipient = await this.usersRepo
      .findByIdAsync(params.recipientUserId)
      .catch(() => null);
    if (!recipient || !recipient.emailNotificationsEnabled || !recipient.email) return;

    const link = `rhythm://tasks/${params.taskId}`;
    const subject = `${params.actorName} ${params.subjectVerb} "${params.taskTitle}" in Rhythm`;
    const html = `
      <p>${escapeHtml(params.actorName)} has invited you to collaborate on
      "<strong>${escapeHtml(params.taskTitle)}</strong>" in Rhythm.</p>
      <p><a href="${link}">Click here to open in Rhythm</a></p>
      <hr>
      <p style="color:#6B7280;font-size:12px">
        You're receiving this because you have email notifications enabled in Rhythm.
      </p>
    `;
    const text = `${params.actorName} has invited you to collaborate on "${params.taskTitle}" in Rhythm.\n\nOpen in Rhythm: ${link}`;

    try {
      await this.client.emails.send({
        from: env.emailFromAddress,
        to: recipient.email,
        subject,
        html,
        text,
      });
    } catch (err) {
      console.error('[email] send failed', err);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}
