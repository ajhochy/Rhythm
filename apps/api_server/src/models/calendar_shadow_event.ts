export interface CalendarShadowEvent {
  id: string;
  ownerId: number | null;
  provider: 'google_calendar';
  externalId: string;
  calendarId: string;
  sourceName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  createdAt: string;
  updatedAt: string;
}
