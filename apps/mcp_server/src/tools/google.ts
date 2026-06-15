import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, toolResult, toolError, RhythmApiError } from '../api_client.js';
import { registerTool } from './_tool.js';

function handleErr(err: unknown) {
  if (err instanceof RhythmApiError && err.status === 409) {
    return toolError(
      new Error(
        'Google tools are not authorized yet. Ask the user to open Rhythm → ' +
        'Settings and click "Enable Google tools for the assistant" to grant access.',
      ),
    );
  }
  return toolError(err);
}

export function registerGoogleTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_calendar_events',
    'List upcoming Google Calendar events for the signed-in user. Returns event id, title, start, end, location.',
    {
      calendar_id: z.string().optional().describe("Calendar id; defaults to 'primary'."),
      max: z.number().optional().describe('Max events to return.'),
    },
    async ({ calendar_id = 'primary', max }: { calendar_id?: string; max?: number }) => {
      try {
        const qs = new URLSearchParams({ calendarId: calendar_id });
        if (max) qs.set('max', String(max));
        const events = await apiGet<unknown>(apiUrl, apiToken, `/integrations/google/calendar/events?${qs.toString()}`);
        return toolResult(JSON.stringify(events, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_create_calendar_event',
    'Create a Google Calendar event. Requires the user to have enabled Google tools (full calendar scope).',
    {
      summary: z.string().describe('Event title.'),
      start: z.string().describe('Start datetime, ISO 8601 (e.g. 2026-06-20T09:00:00-07:00).'),
      end: z.string().describe('End datetime, ISO 8601.'),
      calendar_id: z.string().optional().describe("Calendar id; defaults to 'primary'."),
      location: z.string().optional(),
      description: z.string().optional(),
    },
    async (args: { summary: string; start: string; end: string; calendar_id?: string; location?: string; description?: string }) => {
      try {
        const event = await apiPost<unknown>(apiUrl, apiToken, '/integrations/google/calendar/events', {
          calendarId: args.calendar_id ?? 'primary',
          summary: args.summary,
          start: args.start,
          end: args.end,
          location: args.location,
          description: args.description,
        });
        return toolResult(JSON.stringify(event, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_update_calendar_event',
    'Update an existing Google Calendar event (e.g. time, title, location). Requires Google tools enabled.',
    {
      id: z.string().describe('Event id.'),
      calendar_id: z.string().optional().describe("Calendar id; defaults to 'primary'."),
      summary: z.string().optional(),
      start: z.string().optional().describe('New start ISO 8601.'),
      end: z.string().optional().describe('New end ISO 8601.'),
      location: z.string().optional(),
      description: z.string().optional(),
    },
    async (args: { id: string; calendar_id?: string; summary?: string; start?: string; end?: string; location?: string; description?: string }) => {
      try {
        const patch: Record<string, unknown> = {};
        if (args.calendar_id) patch.calendarId = args.calendar_id;
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.start !== undefined) patch.start = args.start;
        if (args.end !== undefined) patch.end = args.end;
        if (args.location !== undefined) patch.location = args.location;
        if (args.description !== undefined) patch.description = args.description;
        const event = await apiPatch<unknown>(apiUrl, apiToken, `/integrations/google/calendar/events/${args.id}`, patch);
        return toolResult(JSON.stringify(event, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_search_gmail',
    "Search the signed-in user's Gmail. Returns matching message ids/threads. Requires Google tools enabled.",
    { query: z.string().describe('Gmail search query, e.g. "from:boss is:unread".') },
    async ({ query }: { query: string }) => {
      try {
        const res = await apiGet<unknown>(apiUrl, apiToken, `/integrations/google/gmail/search?q=${encodeURIComponent(query)}`);
        return toolResult(JSON.stringify(res, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_read_email',
    'Read a Gmail message by id (full body). Requires Google tools enabled.',
    { id: z.string().describe('Gmail message id.') },
    async ({ id }: { id: string }) => {
      try {
        const res = await apiGet<unknown>(apiUrl, apiToken, `/integrations/google/gmail/messages/${encodeURIComponent(id)}`);
        return toolResult(JSON.stringify(res, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_send_email',
    'Send an email as the signed-in user via Gmail. Requires Google tools enabled.',
    {
      to: z.string().describe('Recipient email address.'),
      subject: z.string().describe('Subject line.'),
      body: z.string().describe('Plain-text body.'),
    },
    async ({ to, subject, body }: { to: string; subject: string; body: string }) => {
      try {
        const res = await apiPost<unknown>(apiUrl, apiToken, '/integrations/google/gmail/send', { to, subject, body });
        return toolResult(JSON.stringify(res, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );
}
