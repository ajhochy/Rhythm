import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  clearTrustedMcpVerifier,
  pinTrustedMcpPublicKey,
} from '../security/trusted_mcp_call';
import { createTrustedMcpTestSigner } from '../__tests__/helpers/trusted_mcp_test_proof';
import { startTestServer } from '../__tests__/helpers/real_server';

const delegationPayload = {
  targetAgentConfigId: 'failure-triage',
  prompt: 'Re-run the focused verification in the background.',
  context: 'Continue the already-approved debugging workflow.',
};

function context(sdkSessionId: string, phase: 'read' | 'write') {
  return {
    sdkSessionId,
    turnId: `turn-${phase}-${sdkSessionId}`,
    agentName: 'manager',
    toolCallId: `call-${phase}-${sdkSessionId}`,
  };
}

describe('issue #1392 interactive bypassPermissions approval policy', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let db: Database.Database;
  let originalAgentLocal: boolean;
  let signer: ReturnType<typeof createTrustedMcpTestSigner>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    originalAgentLocal = env.agentLocal;
    env.agentLocal = true;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const user = new UsersRepository().create({
      name: 'Bypass approval contract',
      email: 'bypass-approval@example.com',
    });
    const auth = await new SessionsRepository().createAsync(user.id);
    headers = {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    };

    const sessions = new AgentSessionsRepository();
    const bypass = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/bypass-interactive',
      name: 'Interactive bypass session',
      mcpRole: 'manager',
      permissionMode: 'bypassPermissions',
      // Production's interactive controller owns this stamp. The contract
      // sets it explicitly because it creates fixture rows below that surface.
      approvalBypassExplicit: true,
    });
    sessions.setSdkSessionId(bypass.id, 'sdk-interactive-bypass');

    const normal = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/default-interactive',
      name: 'Interactive default session',
      mcpRole: 'manager',
      permissionMode: 'default',
    });
    sessions.setSdkSessionId(normal.id, 'sdk-interactive-default');

    signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    clearTrustedMcpVerifier();
    await closeServer();
    db.close();
    env.agentLocal = originalAgentLocal;
  });

  async function taint(sdkSessionId: string): Promise<Response> {
    const ctx = context(sdkSessionId, 'read');
    return fetch(`${baseUrl}/agent-approvals/external-content/taint`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trustedCall: signer.signCall(ctx, 'rhythm_search_gmail', {
          query: 'external',
        }),
        context: ctx,
        source: 'gmail.search',
        contentDigest: 'a'.repeat(64),
        blocked: false,
        diagnostics: [],
      }),
    });
  }

  async function requestApproval(sdkSessionId: string): Promise<Response> {
    return fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'Delegate verification to failure triage',
        consequence: 'Starts one background agent session.',
        security: {
          context: context(sdkSessionId, 'write'),
          action: 'delegation.start-async',
          payload: delegationPayload,
        },
      }),
    });
  }

  async function consume(
    sdkSessionId: string,
    approvalId?: string,
  ): Promise<Response> {
    const ctx = context(sdkSessionId, 'write');
    return fetch(`${baseUrl}/agent-approvals/consume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trustedCall: signer.signCall(
          ctx,
          'rhythm_delegate_async',
          delegationPayload,
        ),
        context: ctx,
        approvalId,
        action: 'delegation.start-async',
        payload: delegationPayload,
      }),
    });
  }

  function ensureContractMarkerColumn(): void {
    const columns = db.prepare('PRAGMA table_info(agent_sessions)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'approval_bypass_explicit')) {
      // Lets the provenance behavior contracts reach the policy assertion
      // before the production migration exists. c13 separately requires the
      // canonical schema/model to own this column; this test-only compatibility
      // column is not a substitute for that criterion.
      db.exec(
        'ALTER TABLE agent_sessions ADD COLUMN approval_bypass_explicit INTEGER NOT NULL DEFAULT 0',
      );
    }
  }

  function createRoot(input: {
    sdkSessionId: string;
    permissionMode: 'default' | 'bypassPermissions';
    isSystem?: boolean;
  }) {
    const sessions = new AgentSessionsRepository();
    const root = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: `/tmp/${input.sdkSessionId}`,
      name: input.sdkSessionId,
      mcpRole: 'manager',
      permissionMode: input.permissionMode,
      isSystem: input.isSystem,
    });
    sessions.setSdkSessionId(root.id, input.sdkSessionId);
    return root;
  }

  it('issue-1392-c13: session schema and model expose a dedicated server-owned explicit approval-bypass marker', () => {
    // Regression caught: trusting permission_mode alone cannot distinguish a
    // human-selected bypass root from AgentRunner or a forced-bypass child.
    // The schema and rehydrated model assertions require durable provenance.
    const columns = db.prepare('PRAGMA table_info(agent_sessions)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain(
      'approval_bypass_explicit',
    );

    const session = createRoot({
      sdkSessionId: 'sdk-marker-contract',
      permissionMode: 'bypassPermissions',
    });
    db.prepare(
      'UPDATE agent_sessions SET approval_bypass_explicit = 1 WHERE id = ?',
    ).run(session.id);
    const hydrated = new AgentSessionsRepository().findById(session.id) as
      | (typeof session & { approvalBypassExplicit?: boolean })
      | null;
    expect(hydrated?.approvalBypassExplicit).toBe(true);
  });

  it('issue-1392-c10: tainted interactive bypass mode needs no per-action delegation approval', async () => {
    // Regression caught: the external-content gate ignores the durable
    // controller-owned bypass marker and creates a pending card / 403 even
    // though the human selected bypass for this interactive chat.
    expect((await taint('sdk-interactive-bypass')).status).toBe(201);

    const requested = await requestApproval('sdk-interactive-bypass');
    expect(requested.status).toBe(200);
    expect(await requested.json()).toMatchObject({ status: 'not_required' });

    const consumed = await consume('sdk-interactive-bypass');
    expect(consumed.status).toBe(200);
    expect(await consumed.json()).toEqual({ allowed: true, consumed: false });
  });

  it('issue-1392-c11: the same tainted delegation remains gated in default mode', async () => {
    // Regression caught: exempting all interactive sessions instead of only
    // explicit bypass mode silently disables the human gate for normal chats.
    expect((await taint('sdk-interactive-default')).status).toBe(201);

    const requested = await requestApproval('sdk-interactive-default');
    expect(requested.status).toBe(201);
    expect(await requested.json()).toMatchObject({ status: 'pending' });

    const consumed = await consume('sdk-interactive-default');
    expect(consumed.status).toBe(403);
    expect(await consumed.text()).toContain(
      'human approval is required after external content was consumed',
    );
  });

  it('issue-1392-c14: a forced-bypass child under a default root remains gated', async () => {
    // Regression caught: checking only the child's permission_mode lets a
    // delegated engine child silently acquire approval bypass its human never
    // selected on the root chat.
    ensureContractMarkerColumn();
    const sessions = new AgentSessionsRepository();
    const root = createRoot({
      sdkSessionId: 'sdk-default-root',
      permissionMode: 'default',
    });
    const child = sessions.upsertChildSession(
      'sdk-forced-bypass-child',
      'sdk-default-root',
      'Forced child (@failure-triage subagent)',
      '/tmp/forced-bypass-child',
    );
    expect(child).not.toBeNull();
    sessions.updatePermissionMode(child!.id, 'bypassPermissions');
    expect(root.permissionMode).toBe('default');

    expect((await taint('sdk-forced-bypass-child')).status).toBe(201);
    expect((await requestApproval('sdk-forced-bypass-child')).status).toBe(201);
    expect((await consume('sdk-forced-bypass-child')).status).toBe(
      403,
    );
  });

  it('issue-1392-c15: a child under an explicit human-selected bypass root is allowed', async () => {
    // Regression caught: policy checks only the child row instead of resolving
    // the explicitly bypassed interactive root, so the child deadlocks again.
    ensureContractMarkerColumn();
    const sessions = new AgentSessionsRepository();
    const root = createRoot({
      sdkSessionId: 'sdk-explicit-bypass-root',
      permissionMode: 'bypassPermissions',
    });
    db.prepare(
      'UPDATE agent_sessions SET approval_bypass_explicit = 1 WHERE id = ?',
    ).run(root.id);
    const child = sessions.upsertChildSession(
      'sdk-explicit-bypass-child',
      'sdk-explicit-bypass-root',
      'Explicit child (@failure-triage subagent)',
      '/tmp/explicit-bypass-child',
    );
    expect(child).not.toBeNull();
    sessions.updatePermissionMode(child!.id, 'bypassPermissions');

    const childRow = db
      .prepare(
        'SELECT approval_bypass_explicit FROM agent_sessions WHERE id = ?',
      )
      .get(child!.id) as { approval_bypass_explicit: number };
    // The marker itself is never copied: operational child mode is not proof
    // of a human choice. Authorization is resolved from the bounded ancestry.
    expect(childRow.approval_bypass_explicit).toBe(0);

    expect((await taint('sdk-explicit-bypass-child')).status).toBe(201);
    const requested = await requestApproval('sdk-explicit-bypass-child');
    expect(requested.status).toBe(200);
    expect(await requested.json()).toMatchObject({ status: 'not_required' });
    expect((await consume('sdk-explicit-bypass-child')).status).toBe(
      200,
    );
  });

  it('issue-1392-c16: a headless bypass root without explicit human provenance remains gated', async () => {
    // Regression caught: AgentRunner commonly stamps bypassPermissions for
    // engine tool prompts; treating that operational mode as human approval
    // would exempt headless work that no person explicitly authorized.
    ensureContractMarkerColumn();
    createRoot({
      sdkSessionId: 'sdk-headless-bypass-root',
      permissionMode: 'bypassPermissions',
      isSystem: true,
    });

    expect((await taint('sdk-headless-bypass-root')).status).toBe(201);
    expect((await requestApproval('sdk-headless-bypass-root')).status).toBe(201);
    expect((await consume('sdk-headless-bypass-root')).status).toBe(
      403,
    );
  });

  it('issue-1392-c10: bypass mode never ignores a supplied approval token', async () => {
    // Regression caught: an early bypass return treats an attacker-supplied or
    // stale bearer ID as valid instead of preserving exact-token validation.
    expect((await taint('sdk-interactive-bypass')).status).toBe(201);
    const consumed = await consume(
      'sdk-interactive-bypass',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(consumed.status).toBe(403);
    expect(await consumed.text()).toContain('approval token was not found');
  });
});
