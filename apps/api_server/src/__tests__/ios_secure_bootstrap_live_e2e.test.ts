import { describe, expect, it } from 'vitest';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const live = enabled ? describe : describe.skip;

live('iOS secure bootstrap live behavior', () => {
  it('task-ios-secure-bootstrap-c8: real relay discovery and bootstrap grant authenticate through the Device gateway', async () => {
    // Regression caught: unit wiring passes while the deployed relay cannot bootstrap a real Device credential.
    const baseUrl = process.env.RHYTHM_LIVE_API_URL;
    const bearer = process.env.RHYTHM_LIVE_IOS_BOOTSTRAP_BEARER;
    const relayPublicUrl = process.env.RHYTHM_LIVE_RELAY_PUBLIC_URL;
    if (!baseUrl || !bearer || !relayPublicUrl) {
      throw new Error('RHYTHM_LIVE_API_URL, RHYTHM_LIVE_IOS_BOOTSTRAP_BEARER, and RHYTHM_LIVE_RELAY_PUBLIC_URL are required');
    }
    const discovery = await fetch(`${baseUrl}/relay/mobile-environments`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(discovery.status).toBe(200);
    const environments = (await discovery.json()) as {
      environments: Array<{ id: string; status: string }>;
    };
    expect(environments.environments).toHaveLength(1);
    const environment = environments.environments[0];
    const connected = await fetch(
      `${baseUrl}/relay/mobile-environments/${encodeURIComponent(environment.id)}/connect`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: 'Sandbox iOS Bootstrap' }),
      },
    );
    expect(connected.status).toBe(201);
    const grant = (await connected.json()) as { deviceToken: string; gatewayBaseUrl: string };
    expect(grant.gatewayBaseUrl).toBe(relayPublicUrl);
    const health = await fetch(`${grant.gatewayBaseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${grant.deviceToken}` },
    });
    expect(health.status).toBe(200);
    const projects = await fetch(`${grant.gatewayBaseUrl}/mobile-gateway/projects`, {
      headers: { Authorization: `Device ${grant.deviceToken}` },
    });
    expect(projects.status).toBe(200);
    expect(await projects.json()).toEqual({ projects: expect.any(Array) });
  });
});
