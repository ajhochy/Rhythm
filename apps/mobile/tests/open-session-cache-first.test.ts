/**
 * issue-1287 F8: cache-first chat switching.
 *
 * Switching to a recently opened chat must render instantly from the
 * hydrated cache — no confirm/list/load network round trips — while a chat
 * without cached state still takes the full pipeline.
 */
import {
  createOpenProjectSessionController,
  type OpenProjectSessionTransport,
} from '@/providers/open-project-session';

type Payload = Record<string, unknown> & { sessionId: string };

function buildTransport(overrides: Partial<OpenProjectSessionTransport<{ id: string }, Payload>> = {}) {
  const calls: string[] = [];
  const transport: OpenProjectSessionTransport<{ id: string }, Payload> = {
    async confirmProject() {
      calls.push('confirmProject');
      return true;
    },
    async listSessions() {
      calls.push('listSessions');
      return [{ id: 'ses_a' }];
    },
    async loadSessionState(_projectId, sessionId) {
      calls.push('loadSessionState');
      return { sessionId };
    },
    ...overrides,
  };
  return { calls, transport };
}

describe('open-session cache-first fast path', () => {
  it('commits synchronously from cache without any network transport call', async () => {
    const committed: Payload[] = [];
    const { calls, transport } = buildTransport({
      openFromCache(_projectId, sessionId) {
        return { sessionId, fromCache: true };
      },
    });
    const controller = createOpenProjectSessionController<{ id: string }, Payload>({
      commit(payload) {
        committed.push(payload);
      },
      transport,
    });

    const result = await controller.openProjectSession('proj-1', 'ses_a');

    expect(result.kind).toBe('ready');
    expect(committed).toHaveLength(1);
    expect(committed[0].fromCache).toBe(true);
    expect(calls).toEqual([]);
    expect(controller.getState().kind).toBe('ready');
  });

  it('takes the full pipeline when the cache misses', async () => {
    const committed: Payload[] = [];
    const { calls, transport } = buildTransport({
      openFromCache() {
        return undefined;
      },
    });
    const controller = createOpenProjectSessionController<{ id: string }, Payload>({
      commit(payload) {
        committed.push(payload);
      },
      transport,
    });

    const result = await controller.openProjectSession('proj-1', 'ses_a');

    expect(result.kind).toBe('ready');
    expect(committed).toHaveLength(1);
    expect(calls).toEqual(['confirmProject', 'listSessions', 'loadSessionState']);
  });
});
