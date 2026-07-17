/**
 * Live E2E for #1070 (OCU-29) — the consolidated /global/event stream.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — skips in the normal suite. Connects to the
 * REAL engine's /global/event, asserts the envelope shape
 * ({ directory, payload:{type,...} }), and that the synthetic server.heartbeat
 * arrives (the liveness signal the watchdog relies on).
 *
 * Run against the dev sandbox engine (:4097):
 *   RHYTHM_LIVE_E2E=1 RHYTHM_ENGINE_URL=http://127.0.0.1:4097 \
 *     npx vitest run __tests__/live_e2e_1070_global_sse.test.ts
 */
import { describe, it, expect } from 'vitest';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const ENGINE = process.env.RHYTHM_ENGINE_URL ?? 'http://127.0.0.1:4097';

(RUN ? describe : describe.skip)('#1070 live — /global/event', () => {
  it('delivers an envelope frame with a payload and a heartbeat within ~12s', async () => {
    const controller = new AbortController();
    const res = await fetch(`${ENGINE}/global/event`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(res.ok).toBe(true);
    expect(res.body).toBeTruthy();

    const decoder = new TextDecoder();
    let buffer = '';
    let sawPayload = false;
    let sawHeartbeat = false;
    const deadline = Date.now() + 12_000;

    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const env = JSON.parse(dataLine.slice(5).trim()) as { payload?: { type?: string } };
          if (env.payload) sawPayload = true;
          if (env.payload?.type === 'server.heartbeat') sawHeartbeat = true;
        }
        if (sawHeartbeat || Date.now() > deadline) break;
      }
    } finally {
      controller.abort();
    }

    expect(sawPayload).toBe(true);
    expect(sawHeartbeat).toBe(true);
  }, 15_000);
});
