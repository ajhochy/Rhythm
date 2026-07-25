import { describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const baseUrl = process.env.RHYTHM_LIVE_BASE_URL ?? 'http://127.0.0.1:4098';

describe.skipIf(!live)('creative platform sandbox fixture', () => {
  it('lists and creates only a pending approval — no download is requested', async () => {
    const list = await fetch(`${baseUrl}/creative-platform`);
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(7);
    const request = await fetch(`${baseUrl}/creative-platform/media-tools/request-or-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'creative-platform-sandbox-fixture' }),
    });
    expect(request.status).toBe(202);
    expect((await request.json() as { status: string }).status).toBe('pending');
  });
});
