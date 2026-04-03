import { AppError } from '../../errors/app_error';
import type { IntegrationAccount } from '../../models/integration_account';

interface GmailListMessage {
  id: string;
  threadId: string;
}

interface GmailListResponse {
  messages?: GmailListMessage[];
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageResponse {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
  };
}

interface NormalizedGmailSignal {
  externalId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
  isUnread: boolean;
}

function parseFromHeader(value: string | null): {
  fromName: string | null;
  fromEmail: string | null;
} {
  if (!value) {
    return { fromName: null, fromEmail: null };
  }

  const match = value.match(/^(.*?)(?:\s*<(.+?)>)?$/);
  if (!match) {
    return { fromName: null, fromEmail: value.trim() || null };
  }

  const rawName = match[1]?.replace(/^"|"$/g, '').trim() || null;
  const rawEmail = match[2]?.trim() || null;
  if (!rawEmail && rawName?.includes('@')) {
    return { fromName: null, fromEmail: rawName };
  }

  return { fromName: rawName, fromEmail: rawEmail };
}

export class GmailService {
  async listRecentInboxSignals(
    account: IntegrationAccount,
  ): Promise<NormalizedGmailSignal[]> {
    if (!account.accessToken) {
      throw AppError.badRequest('Gmail is not connected');
    }

    const listParams = new URLSearchParams({
      labelIds: 'INBOX',
      maxResults: '10',
    });
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`,
      {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      },
    );

    if (!listResponse.ok) {
      const text = await listResponse.text();
      throw AppError.badRequest(`Gmail sync failed: ${text}`);
    }

    const listPayload = (await listResponse.json()) as GmailListResponse;
    const messages = listPayload.messages ?? [];

    const normalized: NormalizedGmailSignal[] = await Promise.all(
      messages.map(async (message) => {
        const detailParams = new URLSearchParams({ format: 'metadata' });
        detailParams.append('metadataHeaders', 'From');
        detailParams.append('metadataHeaders', 'Subject');

        const detailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?${detailParams.toString()}`,
          { headers: { Authorization: `Bearer ${account.accessToken}` } },
        );

        if (!detailResponse.ok) {
          const text = await detailResponse.text();
          throw AppError.badRequest(`Gmail message lookup failed: ${text}`);
        }

        const detail = (await detailResponse.json()) as GmailMessageResponse;
        const headers = detail.payload?.headers ?? [];
        const fromHeader =
          headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? null;
        const subject =
          headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? null;
        const { fromName, fromEmail } = parseFromHeader(fromHeader);

        return {
          externalId: detail.id,
          threadId: detail.threadId,
          fromName,
          fromEmail,
          subject,
          snippet: detail.snippet ?? null,
          receivedAt: detail.internalDate
            ? new Date(Number(detail.internalDate)).toISOString()
            : null,
          isUnread: detail.labelIds?.includes('UNREAD') ?? false,
        };
      }),
    );

    return normalized;
  }
}
