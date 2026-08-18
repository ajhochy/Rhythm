import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  AgentApprovalsRepository,
  type AgentApproval,
} from '../repositories/agent_approvals_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
  type HumanApprovalTestCredentials,
} from '../__tests__/helpers/human_approval_test_credentials';
import { startTestServer } from '../__tests__/helpers/real_server';

type PendingApproval = AgentApproval & { decisionNonce: string };

describe('issue #1392 desktop approval delivery', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let credentials: HumanApprovalTestCredentials;
  let approval: PendingApproval;
  let userId: number;
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
      name: 'Desktop approver',
      email: 'desktop-approver@example.com',
      googleSub: 'google-desktop-1392',
    });
    userId = user.id;
    vi.spyOn(
      MobileCloudIdentityService.prototype,
      'authenticateBearerToken',
    ).mockResolvedValue(user);

    credentials = installHumanApprovalTestCredentials();
    const created = new AgentApprovalsRepository().create({
      sessionId: null,
      agentConfigId: null,
      action: 'Send the harmless test notification',
      preview: 'Issue 1392 approval delivery smoke',
      consequence: 'Sends one harmless test notification',
      autoApprove: false,
      payloadDigest: 'a'.repeat(64),
    });
    if (!created.decisionNonce) {
      throw new Error('pending approval did not receive a decision nonce');
    }
    approval = created as PendingApproval;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    env.agentLocal = originalAgentLocal;
    vi.restoreAllMocks();
  });

  function desktopHeaders(): Record<string, string> {
    return {
      Authorization: 'Bearer production-cloud-session-1392',
      ...credentials.capabilityHeader,
      'Content-Type': 'application/json',
    };
  }

  it('issue-1392-c1: lists a pending approval for a cloud-authenticated desktop', async () => {
    // Regression caught: the local route checked only its SQLite session
    // table, rejected the production cloud token, and left the UI poll empty.
    const response = await fetch(
      `${baseUrl}/agent-approvals?status=pending`,
      { headers: desktopHeaders() },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ id: approval.id, status: 'pending' }),
    ]);
  });

  it('issue-1392-c2: resolves the exact cloud-authenticated desktop approval', async () => {
    // Regression caught: a card can render but remains unusable when PATCH
    // rejects the same production cloud token before signature validation.
    const signature = signHumanApprovalDecision(
      credentials,
      approval,
      'approved',
    );
    const response = await fetch(
      `${baseUrl}/agent-approvals/${approval.id}`,
      {
        method: 'PATCH',
        headers: desktopHeaders(),
        body: JSON.stringify({ status: 'approved', signature }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: approval.id,
      status: 'approved',
      actor: `user:${userId}`,
    });
  });
});
