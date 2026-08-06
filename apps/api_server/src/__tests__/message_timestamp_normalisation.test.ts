/**
 * Message timestamps must leave the API as unambiguous UTC instants.
 *
 * Reported live 2026-08-05: "the transcript is showing up, it's just out of order."
 * The api_server was emitting two different formats from the same feature:
 *
 *   GET /agent-sessions            createdAt = '2026-08-05T22:18:21.279Z'   (JS write)
 *   GET /agent-sessions/:id/messages          = '2026-08-05 22:23:01'       (SQLite DEFAULT)
 *
 * A designator-less string is LOCAL time to Dart and to `new Date()`, so every
 * message shifted by the reader's UTC offset — 7 hours on PDT — putting every
 * REST-loaded message after every live-streamed one.
 */
import { describe, expect, it } from 'vitest';
import { toUtcIsoInstant } from '../repositories/agent_session_messages_repository';

describe('toUtcIsoInstant', () => {
  it('adds a zone to the SQLite DEFAULT format', () => {
    expect(toUtcIsoInstant('2026-08-05 22:23:01')).toBe('2026-08-05T22:23:01.000Z');
  });

  it('does not shift the instant while doing so', () => {
    const out = toUtcIsoInstant('2026-08-05 22:23:01');
    expect(new Date(out).getTime()).toBe(Date.UTC(2026, 7, 5, 22, 23, 1));
  });

  it('leaves an already-zoned value untouched', () => {
    const iso = '2026-08-05T22:18:21.279Z';
    expect(toUtcIsoInstant(iso)).toBe(iso);
  });

  it('respects an explicit offset instead of double-shifting it', () => {
    // 22:18:21-07:00 is 05:18:21Z the next day.
    expect(toUtcIsoInstant('2026-08-05T22:18:21-07:00')).toBe('2026-08-05T22:18:21-07:00');
  });

  it("does not mistake the date's hyphens for a negative offset", () => {
    expect(toUtcIsoInstant('2026-08-05 00:00:00')).toBe('2026-08-05T00:00:00.000Z');
  });

  it('passes through empty and unparseable values rather than inventing a time', () => {
    expect(toUtcIsoInstant('')).toBe('');
    expect(toUtcIsoInstant('not-a-date')).toBe('not-a-date');
  });

  it('a normalised message sorts BEFORE a later live instant', () => {
    // The exact failure mode.
    const rest = new Date(toUtcIsoInstant('2026-08-05 22:18:21')).getTime();
    const streamed = Date.UTC(2026, 7, 5, 22, 20, 0);
    expect(rest).toBeLessThan(streamed);
  });
});
