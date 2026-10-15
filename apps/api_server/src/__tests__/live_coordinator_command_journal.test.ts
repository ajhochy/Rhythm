import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

// Requires a separately approved disposable runtime/root, not the active R1
// repository-test API database. No setup, goal seed, signature, grant or prompt.
// R0/R2 supply the genuine owned root; R3/R4 qualify old coding results/A9.
describe.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('R1 real API/engine journal visibility', () => {
  it('120 deterministic status inputs plus next input remain readable and old replay adds no transcript entry', async () => {
    expect(process.env.RHYTHM_R1_LIVE_WRITE_APPROVED).toBe('1');
    const api = process.env.RHYTHM_LIVE_URL;
    const engine = process.env.RHYTHM_LIVE_ENGINE_URL;
    expect(api).toBe('http://127.0.0.1:4798');
    expect(engine).toBe('http://127.0.0.1:4797');
    const sessionId = process.env.RHYTHM_R1_ROOT_SESSION_ID;
    const projectId = process.env.RHYTHM_R1_PROJECT_ID;
    const sdkId = process.env.RHYTHM_R1_ROOT_SDK_ID;
    const token = process.env.RHYTHM_R1_FIXTURE_TOKEN;
    expect(sessionId && projectId && sdkId && token).toBeTruthy();
    const root = { sessionId, projectId };
    async function post(path: string, body: object): Promise<any> {
      const response = await fetch(`${api}/coordinator-conversations/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      expect(response.status).toBe(200);
      return response.json();
    }
    const health = await fetch(`${engine}/global/health`, { signal: AbortSignal.timeout(5_000) });
    expect(health.ok).toBe(true);
    const actualSession = await fetch(`${engine}/session/${encodeURIComponent(sdkId!)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(actualSession.ok).toBe(true);
    expect((await actualSession.json() as { id: string }).id).toBe(sdkId);
    const current = await post('status', root);
    expect(current.kind).toBe('status');
    const revision = current.conversation.controlRevision;
    const key = `r1-live-${randomUUID()}`;
    // These exact request-shaped inputs use the production zero-inference
    // status classifier, not an invented command or a paid foreground prompt.
    const message = (index: number) => `Hey Rhythm, what is the current status?${' '.repeat(index + 1)}`;
    for (let index = 0; index < 121; index += 1) {
      const result = await post('message', { ...root, expectedControlRevision: revision,
        commandKey: `${key}-${index}`, message: message(index) });
      expect(result.kind).toBe('status');
      expect(result.conversation.controlRevision).toBe(revision);
      expect(result.conversation.commandDedupe.length).toBeLessThanOrEqual(100);
    }
    async function originalInput(): Promise<number> {
      let beforeId: number | undefined;
      let originalId: number | undefined;
      let matches = 0;
      for (let page = 0; page < 10; page += 1) {
        const history = await post('history', { ...root, limit: 20, ...(beforeId ? { beforeId } : {}) });
        expect(history.kind).toBe('history');
        expect(history.messages.length).toBeLessThanOrEqual(20);
        for (const entry of history.messages) {
          if (entry.rawText === message(0)) { matches += 1; originalId = entry.id; }
        }
        if (!history.hasMore) {
          expect(matches).toBe(1);
          expect(originalId).toBeTypeOf('number');
          return originalId!;
        }
        beforeId = Number(history.nextCursor);
        expect(Number.isSafeInteger(beforeId)).toBe(true);
      }
      throw new Error('Owned fixture exceeded declared 200-message history window');
    }
    const original = await originalInput();
    expect((await post('message', { ...root, expectedControlRevision: revision,
      commandKey: `${key}-0`, message: message(0) })).kind).toBe('status');
    expect(await originalInput()).toBe(original);
  }, 120_000);
});
