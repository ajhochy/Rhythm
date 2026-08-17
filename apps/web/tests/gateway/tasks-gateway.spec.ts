import { expect, test } from '@playwright/test';
import { createLiveTasksGateway, TaskGatewayError } from '../../src/gateway/tasks';

// Disposable canary token: if it ever appears in an error message, redaction is broken. Never sent anywhere real.
const token = 'redaction-canary-9f3a-secret';
const apiBase = 'http://127.0.0.1:4098';

type Failure = { status: number; message: string; call: (gateway: ReturnType<typeof createLiveTasksGateway>) => Promise<unknown> };

// One method per status so distinct handling is proven across the whole surface, not just list().
const failures: Failure[] = [
  { status: 401, message: 'Authentication required', call: (gateway) => gateway.list() },
  { status: 403, message: 'Forbidden', call: (gateway) => gateway.update('task-1', { title: 'x' }) },
  { status: 404, message: 'Task not found', call: (gateway) => gateway.delete('task-1') },
  { status: 500, message: 'Task request failed (500)', call: (gateway) => gateway.create({ title: 'x', notes: '', scheduledDate: undefined, dueDate: undefined, preferredAgent: '' }) },
];

async function capture(status: number, call: Failure['call']): Promise<{ error: unknown; sentAuthorization: string | null }> {
  const original = globalThis.fetch;
  let sentAuthorization: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sentAuthorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ error: 'upstream detail' }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await call(createLiveTasksGateway(apiBase, token));
    throw new Error('expected the task gateway call to reject');
  } catch (error) {
    return { error, sentAuthorization };
  } finally {
    globalThis.fetch = original;
  }
}

test('task-live-lifecycle-c1a: 401, 403, 404, and 5xx map to distinct typed gateway errors', async () => {
  // Regression caught: statuses collapse into one generic failure, so the UI cannot render forbidden/not-found/auth states distinctly.
  const seen: string[] = [];
  for (const failure of failures) {
    const { error } = await capture(failure.status, failure.call);
    expect(error, `status ${failure.status} must throw TaskGatewayError`).toBeInstanceOf(TaskGatewayError);
    const gatewayError = error as TaskGatewayError;
    expect(gatewayError.status).toBe(failure.status);
    expect(gatewayError.message).toBe(failure.message);
    seen.push(gatewayError.message);
  }
  expect(new Set(seen).size, 'each status must produce a distinct message').toBe(failures.length);
});

test('task-live-lifecycle-c1b: Authorization and token data never appear in error text', async () => {
  // Regression caught: an error path starts echoing the bearer token or Authorization header into user-visible error text.
  for (const failure of failures) {
    const { error, sentAuthorization } = await capture(failure.status, failure.call);
    expect(sentAuthorization, 'the request must actually carry the bearer token for this redaction check to mean anything').toBe(`Bearer ${token}`);
    const text = `${(error as Error).message} ${(error as Error).name}`;
    expect(text).not.toContain(token);
    expect(text.toLowerCase()).not.toContain('bearer');
    expect(text.toLowerCase()).not.toContain('authorization');
  }
  // The fail-closed missing-token error must not name header mechanics either.
  const configError = (() => { try { createLiveTasksGateway(apiBase, undefined); return null; } catch (error) { return error as Error; } })();
  expect(configError?.message).toMatch(/explicit task token is required/i);
  expect(configError?.message.toLowerCase()).not.toContain('bearer');
})
