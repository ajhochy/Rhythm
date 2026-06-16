import { AppError } from '../../errors/app_error';
import type { IntegrationAccount } from '../../models/integration_account';
import { assertScope, NeedsScopeUpgradeError } from '../google_scope_guard';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiService {
  async searchMessages(
    account: IntegrationAccount,
    query: string,
  ): Promise<unknown> {
    assertScope(account, 'https://www.googleapis.com/auth/gmail.readonly');
    return this.getJson(account, `/messages?q=${encodeURIComponent(query)}`);
  }

  async readMessage(
    account: IntegrationAccount,
    id: string,
  ): Promise<unknown> {
    assertScope(account, 'https://www.googleapis.com/auth/gmail.readonly');
    return this.getJson(
      account,
      `/messages/${encodeURIComponent(id)}?format=full`,
    );
  }

  async sendMessage(
    account: IntegrationAccount,
    msg: { to: string; subject: string; body: string },
  ): Promise<{ id: string }> {
    assertScope(account, 'https://www.googleapis.com/auth/gmail.send');
    const raw = Buffer.from(
      `To: ${msg.to}\r\nSubject: ${msg.subject}\r\n\r\n${msg.body}`,
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const res = await fetch(`${GMAIL}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      throw AppError.badRequest(`Gmail send failed: ${await res.text()}`);
    }
    return (await res.json()) as { id: string };
  }

  private async getJson(
    account: IntegrationAccount,
    path: string,
  ): Promise<unknown> {
    const res = await fetch(`${GMAIL}${path}`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      // A token that still carries gmail.metadata makes Gmail refuse the `q`
      // search parameter (and full-body reads) even when gmail.readonly is also
      // granted (issue #726). Surface this as a structured needs_scope_upgrade
      // (actionable "revoke + re-consent" signal) rather than an opaque 400.
      const mentionsMetadataLimit =
        /Metadata scope does not support/i.test(text) ||
        (res.status === 403 && /metadata/i.test(text));
      if (mentionsMetadataLimit) {
        throw new NeedsScopeUpgradeError(
          'https://www.googleapis.com/auth/gmail.readonly',
        );
      }
      throw AppError.badRequest(`Gmail request failed: ${text}`);
    }
    return res.json();
  }
}
