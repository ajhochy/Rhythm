/**
 * ROUTE-LEVEL tests for the Google broker (F3) — driven through the REAL Express
 * router, controller, and error handler. The service layer
 * (IntegrationsService / GoogleCalendarService / GmailApiService) is mocked, but
 * the REAL NeedsScopeUpgradeError is preserved via importActual so the
 * controller's `instanceof` check matches and produces a structured 409.
 *
 *   fetch -> express(googleBrokerRouter) -> GoogleBrokerController (REAL)
 *         -> mocked services
 *
 * Transport: a real `http` server on an ephemeral port + global fetch (Node 22).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/google_broker_routes.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';

// requireAuth is NOT bypassed on /integrations — mock the auth service so any
// Bearer token resolves to a user.
vi.mock('../services/auth_service', () => ({
  AuthService: class {
    async getUserForSessionToken() {
      return { id: 42, email: 'test@example.com', name: 'Test User' };
    }
  },
}));

// Mock the service layer. ensureFreshGoogleAccount returns a fake account; the
// calendar/gmail helpers are spies the individual tests configure. vi.hoisted
// lets the spies exist before the hoisted vi.mock factories reference them.
const {
  ensureFreshGoogleAccount,
  listUpcomingEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  searchMessages,
  readMessage,
  sendMessage,
} = vi.hoisted(() => ({
  ensureFreshGoogleAccount: vi.fn(),
  listUpcomingEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  searchMessages: vi.fn(),
  readMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../services/integrations_service', () => ({
  IntegrationsService: class {
    ensureFreshGoogleAccount = ensureFreshGoogleAccount;
  },
}));

vi.mock('../integrations/google_calendar/google_calendar_service', () => ({
  GoogleCalendarService: class {
    listUpcomingEvents = listUpcomingEvents;
    createEvent = createEvent;
    updateEvent = updateEvent;
    deleteEvent = deleteEvent;
  },
}));

vi.mock('../integrations/gmail/gmail_api_service', () => ({
  GmailApiService: class {
    searchMessages = searchMessages;
    readMessage = readMessage;
    sendMessage = sendMessage;
  },
}));

// Preserve the REAL NeedsScopeUpgradeError so `instanceof` in the controller matches.
vi.mock('../integrations/google_scope_guard', async () => {
  const actual = await vi.importActual<
    typeof import('../integrations/google_scope_guard')
  >('../integrations/google_scope_guard');
  return actual;
});

import express from 'express';
import { googleBrokerRouter } from '../routes/google_broker_routes';
import { errorHandler } from '../middleware/error_handler';
import { NeedsScopeUpgradeError } from '../integrations/google_scope_guard';

const FAKE_ACCOUNT = { id: 1, accessToken: 'tok', scope: '' };

let server: http.Server;
let base: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer test-token',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/integrations/google', googleBrokerRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  ensureFreshGoogleAccount.mockResolvedValue(FAKE_ACCOUNT);
});

describe('GET /integrations/google/calendar/events', () => {
  it('returns 200 with the stubbed upcoming events', async () => {
    const events = [{ externalId: 'primary:abc', title: 'Standup' }];
    listUpcomingEvents.mockResolvedValue(events);

    const { status, body } = await req('GET', '/integrations/google/calendar/events');

    expect(status).toBe(200);
    expect(body).toEqual(events);
    expect(ensureFreshGoogleAccount).toHaveBeenCalledWith(42);
    expect(listUpcomingEvents).toHaveBeenCalledWith(FAKE_ACCOUNT, ['primary']);
  });
});

describe('POST /integrations/google/gmail/send', () => {
  it('maps NeedsScopeUpgradeError to a 409 with structured body (NOT 500)', async () => {
    sendMessage.mockRejectedValue(
      new NeedsScopeUpgradeError('https://www.googleapis.com/auth/gmail.send'),
    );

    const { status, body } = await req('POST', '/integrations/google/gmail/send', {
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });

    expect(status).toBe(409);
    expect(body).toEqual({
      code: 'needs_scope_upgrade',
      requiredScope: 'https://www.googleapis.com/auth/gmail.send',
    });
  });

  it('returns the send result on success', async () => {
    sendMessage.mockResolvedValue({ id: 'sent-1' });

    const { status, body } = await req('POST', '/integrations/google/gmail/send', {
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ id: 'sent-1' });
    expect(sendMessage).toHaveBeenCalledWith(FAKE_ACCOUNT, {
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });
  });
});
