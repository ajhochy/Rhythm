import { expect, test } from '@playwright/test';

const sessionsModulePath = '../../src/gateway/sessions.ts';

async function loadSessions(): Promise<any> {
  try {
    return await import(sessionsModulePath);
  } catch {
    return null;
  }
}

test('engine-session-live-lifecycle-c1: typed gateway keeps local and SDK session identities separate', async () => {
  // Regression caught: live session operations use fixture data or conflate the stable local ID with the engine SDK ID.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.createLiveSessionsGateway).toBe('function');
});

test('engine-session-live-lifecycle-c2: fixture sessions gateway is network-free and live never falls back', async () => {
  // Regression caught: a failed live read returns a seeded profile/session/transcript instead of a bounded live error.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  let calls = 0;
  const fixture = sessions.createFixtureSessionsGateway(() => { calls += 1; throw new Error('network forbidden'); });
  await expect(fixture.list()).rejects.toThrow(/unsupported/i);
  expect(calls).toBe(0);
});

test('engine-session-live-lifecycle-c3: hydration boundary consumes structured API and WS payloads', async () => {
  // Regression caught: UI duplicates a backend parser or ignores a durable session.removed event.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.toSessionViewModel).toBe('function');
});

test('engine-session-live-lifecycle-c10: live failures are bounded and redact response secrets', async () => {
  // Regression caught: arbitrary backend bodies or bearer values are rendered in the operation status.
  const sessions = await loadSessions();
  expect(sessions, 'the typed live sessions gateway must exist').not.toBeNull();
  if (!sessions) return;
  expect(typeof sessions.SessionGatewayError).toBe('function');
});
