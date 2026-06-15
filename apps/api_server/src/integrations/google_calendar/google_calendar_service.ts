import { AppError } from '../../errors/app_error';
import type { IntegrationAccount } from '../../models/integration_account';
import type { GoogleCalendarOption } from '../../models/google_calendar_preferences';
import { assertScope } from '../google_scope_guard';

interface GoogleCalendarEventDateTime {
  date?: string;
  dateTime?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
}

interface GoogleCalendarListItem {
  id?: string;
  summary?: string;
  primary?: boolean;
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[];
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[];
}

interface NormalizedCalendarEvent {
  externalId: string;
  calendarId: string;
  sourceName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
}

export class GoogleCalendarService {
  async listAccessibleCalendars(
    account: IntegrationAccount,
  ): Promise<Array<Omit<GoogleCalendarOption, 'isSelected'>>> {
    if (!account.accessToken) {
      throw AppError.badRequest('Google Calendar is not connected');
    }

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Google Calendar list failed: ${text}`);
    }

    const payload = (await response.json()) as GoogleCalendarListResponse;
    return (payload.items ?? [])
      .filter((item) => item.id != null)
      .map((item) => ({
        id: item.id!,
        name: item.summary?.trim() || item.id!,
        isPrimary: item.primary == true,
      }))
      .sort((left, right) => {
        if (left.isPrimary && !right.isPrimary) return -1;
        if (!left.isPrimary && right.isPrimary) return 1;
        return left.name.localeCompare(right.name);
      });
  }

  async listUpcomingEvents(
    account: IntegrationAccount,
    calendarIds?: string[],
  ): Promise<NormalizedCalendarEvent[]> {
    if (!account.accessToken) {
      throw AppError.badRequest('Google Calendar is not connected');
    }

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setUTCDate(timeMax.getUTCDate() + 30);

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });

    const normalized: NormalizedCalendarEvent[] = [];
    for (const calendarId of calendarIds ?? ['primary']) {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${account.accessToken}` },
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw AppError.badRequest(`Google Calendar sync failed: ${text}`);
      }

      const payload = (await response.json()) as GoogleCalendarEventsResponse;
      const items = payload.items ?? [];
      for (const item of items) {
        const startValue = item.start?.dateTime ?? item.start?.date;
        if (!item.id || !startValue) continue;
        const isAllDay = !!item.start?.date && !item.start?.dateTime;
        normalized.push({
          externalId: `${calendarId}:${item.id}`,
          calendarId,
          sourceName: account.email ?? 'Google Calendar',
          title: item.summary?.trim() || '(Untitled event)',
          description: item.description ?? null,
          location: item.location ?? null,
          startAt: startValue,
          endAt: item.end?.dateTime ?? item.end?.date ?? null,
          isAllDay,
        });
      }
    }

    return normalized;
  }

  async createEvent(
    account: IntegrationAccount,
    calendarId: string,
    event: Record<string, unknown>,
  ): Promise<unknown> {
    assertScope(account, 'https://www.googleapis.com/auth/calendar');
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );
    if (!res.ok) {
      throw AppError.badRequest(`Calendar create failed: ${await res.text()}`);
    }
    return res.json();
  }

  async updateEvent(
    account: IntegrationAccount,
    calendarId: string,
    eventId: string,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    assertScope(account, 'https://www.googleapis.com/auth/calendar');
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      throw AppError.badRequest(`Calendar update failed: ${await res.text()}`);
    }
    return res.json();
  }

  async deleteEvent(
    account: IntegrationAccount,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    assertScope(account, 'https://www.googleapis.com/auth/calendar');
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${account.accessToken}` },
      },
    );
    if (!res.ok && res.status !== 410) {
      throw AppError.badRequest(`Calendar delete failed: ${await res.text()}`);
    }
  }
}
