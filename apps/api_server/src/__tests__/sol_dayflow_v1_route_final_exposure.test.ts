import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHarness, type Harness } from './helpers/dayflow_provider_harness';

describe('SOL actual V1 route final exposure', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });
  it('unchanged signed search preserves useful text and persisted dependency (positive)', async () => {
    const response = await fetch(`${h.baseUrl}/dayflow-agent/activity/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await h.token()}` },
      body: JSON.stringify({ trustedCall: {} }),
    });
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(h.reader.candidates).toHaveLength(1);
    expect(h.manifest()!.candidates).toHaveLength(1);
    expect(body.text).toContain('Synthetic useful handoff detail.');
  });
  it('withholds a useful signed search body revoked at the route own await', async () => {
    const search = h.evidence.search.bind(h.evidence);
    let usefulAtSearch = false;
    vi.spyOn(h.evidence, 'search').mockImplementation(async (...args) => {
      const response = await search(...args);
      usefulAtSearch = response.status === 'available' && response.text.includes('Synthetic useful handoff detail.');
      h.reader.candidates = [];
      return response;
    });
    const response = await fetch(`${h.baseUrl}/dayflow-agent/activity/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await h.token()}` },
      body: JSON.stringify({ trustedCall: {} }),
    });
    const body = await response.json() as Record<string, unknown>;
    expect(usefulAtSearch).toBe(true);
    expect(response.status).toBe(200);
    expect(h.reader.candidates).toHaveLength(0);
    expect(h.manifest()!.candidates).toHaveLength(1);
    expect(body.text).not.toContain('Synthetic useful handoff detail.');
  });
});
