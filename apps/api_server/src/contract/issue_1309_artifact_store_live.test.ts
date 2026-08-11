import { describe, expect, it } from 'vitest';

const describeLive = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const baseUrl = process.env.RHYTHM_LIVE_URL ?? '';

describeLive('issue #1309 live artifact serving', () => {
  it('issue-1309-c4: live authenticated route enforces project scope and byte ranges', async () => {
    if (!baseUrl || /:4001(?:\/|$)/.test(baseUrl)) throw new Error('UNVERIFIED: isolated RHYTHM_LIVE_URL required');
    const response = await fetch(`${baseUrl}/artifacts/${process.env.RHYTHM_LIVE_ARTIFACT_ID}`, {
      headers: {
        Authorization: `Bearer ${process.env.RHYTHM_LIVE_AUTH_TOKEN}`,
        'X-Rhythm-Project': process.env.RHYTHM_LIVE_PROJECT_ID ?? '',
        Range: 'bytes=1-3',
      },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toMatch(/^bytes 1-3\/\d+$/);
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(3);
  });

  it('issue-1309-c8: paired mobile gateway serves the same project-scoped artifact', async () => {
    const id = process.env.RHYTHM_LIVE_ARTIFACT_ID;
    const response = await fetch(`${baseUrl}/mobile-gateway/artifacts/${id}`, {
      headers: {
        Authorization: `Bearer ${process.env.RHYTHM_LIVE_MOBILE_TOKEN}`,
        'X-Rhythm-Project': process.env.RHYTHM_LIVE_PROJECT_ID ?? '',
        Range: 'bytes=0-0',
      },
    });
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(1);
  });
});
