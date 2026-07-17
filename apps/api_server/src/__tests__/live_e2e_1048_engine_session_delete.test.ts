/**
 * Live E2E for #1048 (OCU-07) — engine session delete on hard delete.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. It drives the REAL running opencode engine's session lifecycle
 * (create → get → DELETE → get) to prove the exact contract the api_server's
 * OpencodeClientService.deleteSession wrapper depends on:
 *
 *   1. DELETE /session/:id actually removes the session engine-side
 *      (subsequent GET → 404). This is #1048's acceptance criterion.
 *   2. DELETE of an already-gone session returns 404 (not 200) — which the
 *      wrapper tolerates so a hard delete still succeeds when the engine record
 *      was cleaned up earlier.
 *
 * Run it against the dev sandbox engine (:4097):
 *   RHYTHM_LIVE_E2E=1 RHYTHM_ENGINE_URL=http://127.0.0.1:4097 \
 *     npx vitest run __tests__/live_e2e_1048_engine_session_delete.test.ts
 *
 * Prerequisites:
 *   - The opencode engine is running and reachable at RHYTHM_ENGINE_URL
 *     (default http://127.0.0.1:4097, the dev sandbox engine port).
 */

import { describe, it, expect } from 'vitest';
import os from 'os';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const ENGINE = process.env.RHYTHM_ENGINE_URL ?? 'http://127.0.0.1:4097';
const DIR = process.env.RHYTHM_LIVE_CWD ?? os.homedir();

(RUN ? describe : describe.skip)('#1048 live — engine session delete', () => {
  it('DELETE /session/:id removes the session (subsequent GET → 404) and re-delete is 404', async () => {
    const q = `?directory=${encodeURIComponent(DIR)}`;

    // Create a real engine session.
    const createRes = await fetch(`${ENGINE}/session${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string };
    expect(created.id).toMatch(/^ses_/);

    // GET before delete → 200 (session exists).
    const getBefore = await fetch(`${ENGINE}/session/${created.id}${q}`);
    expect(getBefore.status).toBe(200);

    // DELETE → 200 true (mirrors OpencodeClientService.deleteSession happy path).
    const del = await fetch(`${ENGINE}/session/${created.id}${q}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    // GET after delete → 404. This is the #1048 acceptance criterion: the
    // engine-side session is genuinely gone, not just the local row.
    const getAfter = await fetch(`${ENGINE}/session/${created.id}${q}`);
    expect(getAfter.status).toBe(404);

    // Re-DELETE an already-gone session → 404. The wrapper treats this envelope
    // error as tolerated (resolves true) so hard delete still succeeds.
    const delAgain = await fetch(`${ENGINE}/session/${created.id}${q}`, { method: 'DELETE' });
    expect(delAgain.status).toBe(404);
  }, 30_000);
});
