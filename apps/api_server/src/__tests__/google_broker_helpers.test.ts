import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertScope,
  NeedsScopeUpgradeError,
} from '../integrations/google_scope_guard';
import { GmailApiService } from '../integrations/gmail/gmail_api_service';
import { GoogleCalendarService } from '../integrations/google_calendar/google_calendar_service';
import type { IntegrationAccount } from '../models/integration_account';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(
  scope: string | null,
  accessToken = 'tok-123',
): IntegrationAccount {
  return {
    id: 'acct-1',
    ownerId: 1,
    provider: 'google_calendar',
    externalAccountId: 'sub-1',
    email: 'user@example.com',
    displayName: 'Test User',
    status: 'connected',
    accessToken,
    refreshToken: null,
    scope,
    tokenType: 'Bearer',
    expiresAt: null,
    lastSyncedAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// assertScope
// ---------------------------------------------------------------------------

describe('assertScope — exact-token matching', () => {
  it('passes when the scope string contains the exact token', () => {
    const account = makeAccount(
      'https://www.googleapis.com/auth/gmail.readonly openid email',
    );
    expect(() =>
      assertScope(account, 'https://www.googleapis.com/auth/gmail.readonly'),
    ).not.toThrow();
  });

  it('passes for full calendar scope when present', () => {
    const account = makeAccount(
      'openid https://www.googleapis.com/auth/calendar',
    );
    expect(() =>
      assertScope(account, 'https://www.googleapis.com/auth/calendar'),
    ).not.toThrow();
  });

  it('FAILS with NeedsScopeUpgradeError for calendar.readonly when full calendar is required', () => {
    // This is the key correctness test: calendar.readonly is a DIFFERENT token
    // than calendar, so assertScope must not allow it to satisfy the full write scope.
    const account = makeAccount(
      'openid https://www.googleapis.com/auth/calendar.readonly',
    );
    expect(() =>
      assertScope(account, 'https://www.googleapis.com/auth/calendar'),
    ).toThrow(NeedsScopeUpgradeError);
  });

  it('throws NeedsScopeUpgradeError when scope is null', () => {
    const account = makeAccount(null);
    expect(() =>
      assertScope(account, 'https://www.googleapis.com/auth/gmail.send'),
    ).toThrow(NeedsScopeUpgradeError);
  });

  it('throws NeedsScopeUpgradeError when scope is empty string', () => {
    const account = makeAccount('');
    expect(() =>
      assertScope(account, 'https://www.googleapis.com/auth/gmail.send'),
    ).toThrow(NeedsScopeUpgradeError);
  });

  it('exposes the required scope on the error', () => {
    const account = makeAccount('openid');
    let err: NeedsScopeUpgradeError | undefined;
    try {
      assertScope(account, 'https://www.googleapis.com/auth/calendar');
    } catch (e) {
      err = e as NeedsScopeUpgradeError;
    }
    expect(err).toBeInstanceOf(NeedsScopeUpgradeError);
    expect(err?.requiredScope).toBe(
      'https://www.googleapis.com/auth/calendar',
    );
    expect(err?.name).toBe('NeedsScopeUpgradeError');
  });
});

// ---------------------------------------------------------------------------
// GmailApiService
// ---------------------------------------------------------------------------

describe('GmailApiService', () => {
  describe('sendMessage', () => {
    it('throws NeedsScopeUpgradeError when account lacks gmail.send scope', async () => {
      const account = makeAccount(
        'openid https://www.googleapis.com/auth/gmail.readonly',
      );
      const svc = new GmailApiService();
      await expect(
        svc.sendMessage(account, {
          to: 'other@example.com',
          subject: 'Hi',
          body: 'Hello',
        }),
      ).rejects.toThrow(NeedsScopeUpgradeError);
    });

    it('sends email and returns {id} when gmail.send scope is present', async () => {
      const account = makeAccount(
        'openid https://www.googleapis.com/auth/gmail.send',
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ id: 'm1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const svc = new GmailApiService();
      const result = await svc.sendMessage(account, {
        to: 'other@example.com',
        subject: 'Test subject',
        body: 'Test body',
      });
      expect(result).toEqual({ id: 'm1' });
    });

    it('throws AppError when fetch returns non-ok', async () => {
      const account = makeAccount(
        'openid https://www.googleapis.com/auth/gmail.send',
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('Service Unavailable', { status: 503 }),
        ),
      );
      const svc = new GmailApiService();
      await expect(
        svc.sendMessage(account, {
          to: 'x@example.com',
          subject: 'S',
          body: 'B',
        }),
      ).rejects.toThrow(/Gmail send failed/);
    });
  });

  describe('searchMessages', () => {
    it('throws NeedsScopeUpgradeError when account lacks gmail.readonly', async () => {
      const account = makeAccount('openid email');
      const svc = new GmailApiService();
      await expect(svc.searchMessages(account, 'from:boss')).rejects.toThrow(
        NeedsScopeUpgradeError,
      );
    });

    it('returns search results when gmail.readonly scope is present', async () => {
      const account = makeAccount(
        'openid https://www.googleapis.com/auth/gmail.readonly',
      );
      const mockPayload = { messages: [{ id: 'msg-1', threadId: 't-1' }] };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockPayload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const svc = new GmailApiService();
      const result = await svc.searchMessages(account, 'from:boss');
      expect(result).toEqual(mockPayload);
    });
  });

  describe('readMessage', () => {
    it('throws NeedsScopeUpgradeError when account lacks gmail.readonly', async () => {
      const account = makeAccount('openid email');
      const svc = new GmailApiService();
      await expect(svc.readMessage(account, 'msg-1')).rejects.toThrow(
        NeedsScopeUpgradeError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// GoogleCalendarService — write methods
// ---------------------------------------------------------------------------

describe('GoogleCalendarService — write methods', () => {
  const readonlyAccount = makeAccount(
    'openid https://www.googleapis.com/auth/calendar.readonly',
  );
  const writeAccount = makeAccount(
    'openid https://www.googleapis.com/auth/calendar',
  );

  describe('createEvent', () => {
    it('throws NeedsScopeUpgradeError for a calendar.readonly account', async () => {
      const svc = new GoogleCalendarService();
      await expect(
        svc.createEvent(readonlyAccount, 'primary', {
          summary: 'Team meeting',
        }),
      ).rejects.toThrow(NeedsScopeUpgradeError);
    });

    it('succeeds and returns the created event when full calendar scope is present', async () => {
      const createdEvent = { id: 'evt-1', summary: 'Team meeting' };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(createdEvent), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const svc = new GoogleCalendarService();
      const result = await svc.createEvent(writeAccount, 'primary', {
        summary: 'Team meeting',
      });
      expect(result).toEqual(createdEvent);
    });

    it('throws AppError when fetch returns non-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('Forbidden', { status: 403 }),
        ),
      );
      const svc = new GoogleCalendarService();
      await expect(
        svc.createEvent(writeAccount, 'primary', { summary: 'X' }),
      ).rejects.toThrow(/Calendar create failed/);
    });
  });

  describe('updateEvent', () => {
    it('throws NeedsScopeUpgradeError for a calendar.readonly account', async () => {
      const svc = new GoogleCalendarService();
      await expect(
        svc.updateEvent(readonlyAccount, 'primary', 'evt-1', {
          summary: 'Updated',
        }),
      ).rejects.toThrow(NeedsScopeUpgradeError);
    });

    it('succeeds when full calendar scope is present', async () => {
      const updatedEvent = { id: 'evt-1', summary: 'Updated' };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(updatedEvent), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const svc = new GoogleCalendarService();
      const result = await svc.updateEvent(writeAccount, 'primary', 'evt-1', {
        summary: 'Updated',
      });
      expect(result).toEqual(updatedEvent);
    });
  });

  describe('deleteEvent', () => {
    it('throws NeedsScopeUpgradeError for a calendar.readonly account', async () => {
      const svc = new GoogleCalendarService();
      await expect(
        svc.deleteEvent(readonlyAccount, 'primary', 'evt-1'),
      ).rejects.toThrow(NeedsScopeUpgradeError);
    });

    it('succeeds (no throw) when full calendar scope is present and delete returns 204', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      );
      const svc = new GoogleCalendarService();
      await expect(
        svc.deleteEvent(writeAccount, 'primary', 'evt-1'),
      ).resolves.toBeUndefined();
    });

    it('treats 410 Gone as a success (already deleted)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status: 410 })),
      );
      const svc = new GoogleCalendarService();
      await expect(
        svc.deleteEvent(writeAccount, 'primary', 'evt-1'),
      ).resolves.toBeUndefined();
    });

    it('throws AppError for unexpected non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('Internal Server Error', { status: 500 }),
        ),
      );
      const svc = new GoogleCalendarService();
      await expect(
        svc.deleteEvent(writeAccount, 'primary', 'evt-1'),
      ).rejects.toThrow(/Calendar delete failed/);
    });
  });
});
