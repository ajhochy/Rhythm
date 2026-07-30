import { describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;

live('MSP-001 live paired session/profile contract', () => {
  it('issue-1-c9: live paired gateway preserves per-session profile state', async () => {
    const baseUrl = process.env.RHYTHM_LIVE_URL;
    const deviceToken = process.env.RHYTHM_LIVE_DEVICE_TOKEN;
    const projectId = process.env.RHYTHM_LIVE_PROJECT_ID;
    if (!baseUrl || !deviceToken || !projectId) {
      throw new Error(
        'MSP-001 live test requires RHYTHM_LIVE_URL, ' +
        'RHYTHM_LIVE_DEVICE_TOKEN, and RHYTHM_LIVE_PROJECT_ID',
      );
    }
    if (!/^http:\/\/127\.0\.0\.1:(?!4001\b)\d+$/.test(baseUrl)) {
      throw new Error('MSP-001 live test requires an isolated loopback URL');
    }

    const headers = {
      Authorization: `Device ${deviceToken}`,
      'Content-Type': 'application/json',
      'X-Rhythm-Project-ID': projectId,
    };
    const catalogResponse = await fetch(
      `${baseUrl}/mobile-gateway/profile-catalog`,
      { headers },
    );
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json() as {
      profiles: Array<{
        profileId: string;
        opencodeAgentId: string;
        defaults: {
          providerId: string | null;
          modelId: string | null;
        };
      }>;
    };
    const profile = catalog.profiles.find((item) =>
      item.defaults.providerId && item.defaults.modelId
    );
    expect(profile, 'live catalog needs one model-backed selectable profile')
      .toBeDefined();

    const createResponse = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'MSP-001 live contract' }),
      },
    );
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as {
      id: string;
      rhythm?: { localSessionId?: string };
    };
    expect(created.id).toBeTruthy();

    const stateResponse = await fetch(
      `${baseUrl}/mobile-gateway/sessions/${encodeURIComponent(created.id)}/state`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          profileId: profile!.profileId,
          opencodeAgentId: profile!.opencodeAgentId,
          providerId: profile!.defaults.providerId,
          modelId: profile!.defaults.modelId,
          thinkingBudget: 8192,
          permissionMode: 'plan',
        }),
      },
    );
    expect(stateResponse.status).toBe(200);
    const pinned = await stateResponse.json() as Record<string, unknown>;
    expect(pinned).toMatchObject({
      profileId: profile!.profileId,
      opencodeAgentId: profile!.opencodeAgentId,
      providerId: profile!.defaults.providerId,
      modelId: profile!.defaults.modelId,
      thinkingBudget: 8192,
      permissionMode: 'plan',
    });

    const listResponse = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session`,
      { headers },
    );
    expect(listResponse.status).toBe(200);
    const sessions = await listResponse.json() as Array<{
      id: string;
      rhythm?: Record<string, unknown>;
    }>;
    expect(sessions.find((session) => session.id === created.id)?.rhythm)
      .toMatchObject(pinned);

    await fetch(
      `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(created.id)}`,
      { method: 'DELETE', headers },
    );
  });
});
