import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { promptAsyncSpy, sessionMap, streamSessionSpy } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
  streamSessionSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { promptAsync: promptAsyncSpy },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: streamSessionSpy },
}));

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  AgentApprovalsRepository,
  type AgentApproval,
} from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import { AgentApprovalContinuationService } from '../services/agent_approval_continuation_service';
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
  type HumanApprovalTestCredentials,
} from '../__tests__/helpers/human_approval_test_credentials';
import { startTestServer } from '../__tests__/helpers/real_server';

type PendingApproval = AgentApproval & { decisionNonce: string };

describe('issue #1392 approval decision automatically continues its session', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let credentials: HumanApprovalTestCredentials;
  let approval: PendingApproval;
  let sessionId: string;
  let originalAgentLocal: boolean;
  let db: Database.Database;

  beforeEach(async () => {
    originalAgentLocal = env.agentLocal;
    env.agentLocal = true;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const user = new UsersRepository().create({
      name: 'Approval continuation approver',
      email: 'approval-continuation@example.com',
      googleSub: 'google-approval-continuation-1392',
    });
    vi.spyOn(
      MobileCloudIdentityService.prototype,
      'authenticateBearerToken',
    ).mockResolvedValue(user);

    const sessions = new AgentSessionsRepository();
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/issue-1392-continuation',
      name: 'Approval continuation session',
      mcpRole: 'claude-code',
      ownerUserId: user.id,
    });
    sessionId = session.id;
    sessions.setSdkSessionId(session.id, 'sdk-approval-origin');
    sessions.updateStatus(session.id, 'idle');
    sessionMap.set(session.id, 'sdk-approval-origin');

    const created = new AgentApprovalsRepository().create({
      sessionId: session.id,
      agentConfigId: null,
      action: 'Authorize notification.send',
      preview: '{"title":"Approval card test"}',
      consequence: 'Sends one harmless test notification',
      autoApprove: false,
      securityAction: 'notification.send',
      payloadDigest: 'a'.repeat(64),
    });
    if (!created.decisionNonce) {
      throw new Error('pending approval did not receive a decision nonce');
    }
    approval = created as PendingApproval;

    credentials = installHumanApprovalTestCredentials();
    promptAsyncSpy.mockClear();
    streamSessionSpy.mockClear();
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    env.agentLocal = originalAgentLocal;
    sessionMap.clear();
    vi.restoreAllMocks();
  });

  function headers(): Record<string, string> {
    return {
      Authorization: 'Bearer production-cloud-session-continuation-1392',
      ...credentials.capabilityHeader,
      'Content-Type': 'application/json',
    };
  }

  async function decide(status: 'approved' | 'rejected'): Promise<Response> {
    return fetch(`${baseUrl}/agent-approvals/${approval.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        status,
        signature: signHumanApprovalDecision(credentials, approval, status),
      }),
    });
  }

  it('issue-1392-c6: approval resumes the origin once with the exact approval_id and one-retry instruction', async () => {
    // Regression caught: PATCH persists "approved" and removes the card, but
    // the stopped agent receives no turn and waits forever for a user to type
    // "try again". The dispatch count and prompt assertions fail for that bug.
    const response = await decide('approved');

    expect(response.status).toBe(200);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    const [sdkSessionId, continuation] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
    ];
    expect(sdkSessionId).toBe('sdk-approval-origin');
    expect(continuation).toContain(`approval_id: ${approval.id}`);
    expect(continuation).toMatch(/retry[^.\n]*exactly once/i);
    expect(continuation).toMatch(/same|identical|original/i);
  });

  it('issue-1392-c7: rejection resumes the origin once and forbids the protected action', async () => {
    // Regression caught: treating both decisions as approval can cause a
    // rejected external action to execute. The rejection and prohibition
    // assertions fail if the continuation is absent or grants permission.
    const response = await decide('rejected');

    expect(response.status).toBe(200);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    const [sdkSessionId, continuation] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
    ];
    expect(sdkSessionId).toBe('sdk-approval-origin');
    expect(continuation).toContain(approval.id);
    expect(continuation).toMatch(/rejected|denied/i);
    expect(continuation).toMatch(/do not perform|must not perform|do not retry/i);
    expect(continuation).not.toMatch(/approved|proceed with|retry exactly once/i);
  });

  it('issue-1392-c8: a working origin keeps the continuation queued until its idle callback dispatches once', async () => {
    // Regression caught: a human decides while the model is still producing a
    // turn, so an eager wake races that turn or a deferred wake is forgotten.
    // The pre-idle zero-call assertion and post-idle exact-one assertion catch
    // both halves while the repository assertion proves durable queuing.
    const sessions = new AgentSessionsRepository();
    sessions.updateStatus(sessionId, 'working');

    const response = await decide('approved');

    expect(response.status).toBe(200);
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    expect(new AgentApprovalsRepository().getById(approval.id)).toMatchObject({
      status: 'approved',
      continuationState: 'queued',
    });

    sessions.updateStatus(sessionId, 'idle');
    await new AgentApprovalContinuationService().onSessionIdle(sessionId);

    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy.mock.calls[0]?.[0]).toBe('sdk-approval-origin');
    expect(String(promptAsyncSpy.mock.calls[0]?.[1])).toContain(
      `approval_id: ${approval.id}`,
    );
    expect(new AgentApprovalsRepository().getById(approval.id)).toMatchObject({
      continuationState: 'delivered',
    });
  });

  it('issue-1392-c9: restart recovery dispatches an already queued decided approval once', async () => {
    // Regression caught: process restart loses the in-memory decision wake and
    // leaves a durable queued approval stranded forever. Re-running recovery
    // must also stay idempotent rather than submitting a second retry turn.
    const sessions = new AgentSessionsRepository();
    sessions.updateStatus(sessionId, 'working');
    const response = await decide('approved');
    expect(response.status).toBe(200);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    sessions.updateStatus(sessionId, 'idle');
    sessionMap.clear();
    const restartedService = new AgentApprovalContinuationService();
    await restartedService.recoverAfterRestart();
    await restartedService.recoverAfterRestart();

    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy.mock.calls[0]?.[0]).toBe('sdk-approval-origin');
    expect(String(promptAsyncSpy.mock.calls[0]?.[1])).toContain(
      `approval_id: ${approval.id}`,
    );
    expect(new AgentApprovalsRepository().getById(approval.id)).toMatchObject({
      continuationState: 'delivered',
    });
  });
});
