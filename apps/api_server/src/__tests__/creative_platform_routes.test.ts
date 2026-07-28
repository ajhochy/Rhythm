import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';
import { createTrustedMcpTestSigner } from './helpers/trusted_mcp_test_proof';

async function app() {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', 'true');
  const { runMigrations } = await import('../database/migrations');
  const { setDb } = await import('../database/db');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  return {
    ...(await startTestServer((await import('../app')).createApp())),
    db,
  };
}

describe('/creative-platform', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('lists/statuses locally and creates a pending approval instead of downloading', async () => {
    const server = await app();
    close = server.close;
    const signer = createTrustedMcpTestSigner();
    const { pinTrustedMcpPublicKey } = await import(
      '../security/trusted_mcp_call'
    );
    pinTrustedMcpPublicKey(signer.publicDocument);
    const now = new Date().toISOString();
    server.db
      .prepare(
        `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, created_at, updated_at,
          permission_mode, fast_mode, is_system, delegation_depth,
          category, sdk_session_id)
       VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
      )
      .run(
        'creative-test',
        'creative-media',
        '/tmp/creative-test',
        'Creative test',
        now,
        now,
        'sdk-creative-test',
      );
    const list = await fetch(`${server.baseUrl}/creative-platform`);
    expect(list.status).toBe(200);
    const capabilities = (await list.json()) as Array<{
      id: string;
      setup: { planDigest: string };
    }>;
    expect(capabilities).toHaveLength(7);
    const planDigest = capabilities.find(
      ({ id }) => id === 'openmontage',
    )!.setup.planDigest;
    const missingContext = await fetch(
      `${server.baseUrl}/creative-platform/openmontage/request-or-start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(missingContext.status).toBe(403);
    const forgedTrustedContext = await fetch(
      `${server.baseUrl}/creative-platform/openmontage/request-or-start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trustedCall: {
            sdkSessionId: 'sdk-creative-test',
            turnId: 'turn-forged',
            agentName: 'creative-media',
            toolCallId: 'call-forged',
          },
        }),
      },
    );
    expect(forgedTrustedContext.status).toBe(403);
    const context = {
      sdkSessionId: 'sdk-creative-test',
      turnId: 'turn-creative-test',
      agentName: 'creative-media',
      toolCallId: 'call-creative-test',
    };
    const stalePlan = await fetch(
      `${server.baseUrl}/creative-platform/openmontage/request-or-start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trustedCall: signer.signCall(
            { ...context, toolCallId: 'call-stale-plan' },
            'rhythm_install_creative_capability',
            {
              id: 'openmontage',
              operation: 'install',
              planDigest: '0'.repeat(64),
            },
          ),
        }),
      },
    );
    expect(stalePlan.status).toBe(409);
    expect(
      (
        server.db
          .prepare('SELECT COUNT(*) AS count FROM agent_approvals')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    const pending = await fetch(
      `${server.baseUrl}/creative-platform/openmontage/request-or-start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trustedCall: signer.signCall(
            context,
            'rhythm_install_creative_capability',
            { id: 'openmontage', operation: 'install', planDigest },
          ),
        }),
      },
    );
    expect(pending.status).toBe(202);
    expect(
      (await pending.json()) as {
        status: string;
        approval: {
          sessionId: string;
          agentConfigId: string;
          payloadDigest: string;
        };
      },
    ).toMatchObject({
      status: 'pending',
      approval: {
        sessionId: 'creative-test',
        agentConfigId: 'creative-media',
        payloadDigest: planDigest,
      },
    });
    const swappedCapability = await fetch(
      `${server.baseUrl}/creative-platform/openmontage/request-or-start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trustedCall: signer.signCall(
            { ...context, toolCallId: 'call-swapped-capability' },
            'rhythm_install_creative_capability',
            { id: 'media-tools', operation: 'install', planDigest },
          ),
        }),
      },
    );
    expect(swappedCapability.status).toBe(403);
    const verify = await fetch(`${server.baseUrl}/creative-platform/openmontage/verify`, {
      method: 'POST',
    });
    expect(((await verify.json()) as { id: string }).id).toBe('openmontage');
  });
});
