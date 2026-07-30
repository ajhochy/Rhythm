/**
 * Read-only live behavioral check for the R5 picker catalog and transcript
 * windows. The operator supplies an existing sandbox session with messages.
 *
 * RHYTHM_LIVE_E2E=1 \
 * RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * DB_PATH=<sandbox-dir>/rhythm.db \
 * RHYTHM_LIVE_R5_SESSION_ID=<local-session-id> \
 *   npx vitest run src/__tests__/r5_agent_catalog_transcript_live.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION_ID = process.env.RHYTHM_LIVE_R5_SESSION_ID;
const describeLive = LIVE ? describe : describe.skip;

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

describeLive('R5 live picker catalog and transcript windows', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!SESSION_ID) {
      throw new Error('RHYTHM_LIVE_R5_SESSION_ID must name a sandbox session');
    }
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
  });

  it('serves a bounded picker DTO without raw engine permissions', async () => {
    const body = await apiJson<{ agents: Array<Record<string, unknown>> }>(
      '/agent-sessions/agents?view=picker',
    );

    for (const agent of body.agents) {
      expect(Object.keys(agent).sort()).toEqual(
        [
          'builtIn',
          'defaults',
          'display',
          'name',
          'opencodeAgentId',
          'profileAvailability',
          'profileId',
        ].sort(),
      );
    }
    expect(JSON.stringify(body)).not.toContain('"permission"');
    if (body.agents.length <= 39) {
      expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(
        32 * 1024,
      );
    }
  });

  it('opens on the recent detail window and pages backward by exclusive cursor', async () => {
    const detail = await apiJson<{
      messages: Array<{ id: number }>;
      transcriptPage: { nextCursor: string | null; hasMore: boolean };
    }>(`/agent-sessions/${SESSION_ID}?transcriptLimit=50`);
    expect(detail.messages.length).toBeLessThanOrEqual(50);
    expect(detail.messages.map((message) => message.id)).toEqual(
      [...detail.messages].map((message) => message.id).sort((a, b) => a - b),
    );

    if (!detail.transcriptPage.hasMore || !detail.transcriptPage.nextCursor) {
      return;
    }

    const older = await apiJson<{
      messages: Array<{ id: number }>;
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    }>(
      `/agent-sessions/${SESSION_ID}/messages?limit=50&before=${detail.transcriptPage.nextCursor}`,
    );
    const cursor = Number(detail.transcriptPage.nextCursor);
    expect(older.messages.length).toBeLessThanOrEqual(50);
    expect(older.messages.every((message) => message.id < cursor)).toBe(true);
    expect(older.messages.map((message) => message.id)).toEqual(
      [...older.messages].map((message) => message.id).sort((a, b) => a - b),
    );
  });
});
