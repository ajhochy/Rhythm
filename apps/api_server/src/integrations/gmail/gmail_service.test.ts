import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GmailService } from './gmail_service';
import type { IntegrationAccount } from '../../models/integration_account';

const mockAccount: IntegrationAccount = {
  id: 'acc-1',
  provider: 'gmail',
  accessToken: 'tok',
  refreshToken: null,
  expiresAt: null,
  email: 'test@example.com',
  displayName: null,
  connectedAt: new Date().toISOString(),
  lastSyncedAt: null,
  lastErrorAt: null,
  lastError: null,
  ownerId: 1,
  sourceAccountId: null,
};

function makeMessageListResponse(ids: string[]) {
  return {
    ok: true,
    json: async () => ({ messages: ids.map((id) => ({ id, threadId: `t-${id}` })) }),
    text: async () => '',
  };
}

function makeMessageDetailResponse(id: string, isUnread: boolean) {
  return {
    ok: true,
    json: async () => ({
      id,
      threadId: `t-${id}`,
      snippet: `snippet-${id}`,
      labelIds: isUnread ? ['INBOX', 'UNREAD'] : ['INBOX'],
      internalDate: '1700000000000',
      payload: {
        headers: [
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'Subject', value: `Subject ${id}` },
        ],
      },
    }),
    text: async () => '',
  };
}

describe('GmailService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches all message details in parallel', async () => {
    const fetchOrder: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes('/messages?')) {
          return makeMessageListResponse(['m1', 'm2', 'm3']);
        }
        const id = u.match(/\/messages\/(m\d)/)?.[1] ?? 'unknown';
        fetchOrder.push(id);
        return makeMessageDetailResponse(id, id === 'm1');
      }),
    );

    const service = new GmailService();
    const results = await service.listRecentInboxSignals(mockAccount);

    expect(results).toHaveLength(3);
    expect(results[0].externalId).toBe('m1');
    expect(results[0].isUnread).toBe(true);
    expect(results[1].isUnread).toBe(false);
    // fetch was called once for list + 3 for details = 4 total
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    expect(fetchOrder).toHaveLength(3);
  });

  it('returns empty array when inbox is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ messages: [] }),
        text: async () => '',
      })),
    );
    const service = new GmailService();
    const results = await service.listRecentInboxSignals(mockAccount);
    expect(results).toHaveLength(0);
  });

  it('rejects when a message detail fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes('/messages?')) {
          return makeMessageListResponse(['m1', 'm2']);
        }
        const id = u.match(/\/messages\/(m\d)/)?.[1] ?? 'unknown';
        // m2 detail fetch fails
        if (id === 'm2') {
          return { ok: false, text: async () => 'Not Found' };
        }
        return makeMessageDetailResponse(id, false);
      }),
    );
    const service = new GmailService();
    await expect(service.listRecentInboxSignals(mockAccount)).rejects.toThrow();
  });

  it('throws when list request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, text: async () => 'Unauthorized' })),
    );
    const service = new GmailService();
    await expect(service.listRecentInboxSignals(mockAccount)).rejects.toThrow(
      'Gmail sync failed',
    );
  });
});
