/**
 * Acceptance contract for issue #1226.
 *
 * Regression caught: localhost callers can forge shape-only MCP identity and
 * mutate taint/approval state. These tests drive the real Express routes and
 * assert invalid proofs leave the persisted security tables unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
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

const readContext = {
  sdkSessionId: 'sdk-issue-1226',
  turnId: 'turn-read-1226',
  agentName: 'manager',
  toolCallId: 'call-read-1226',
};

const writeContext = {
  ...readContext,
  turnId: 'turn-write-1226',
  toolCallId: 'call-write-1226',
};

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('issue #1226 signed taint and consume boundaries', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let headers: Record<string, string>;
  let signer: ReturnType<typeof createTrustedMcpTestSigner>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({
      name: 'Issue 1226',
      email: 'issue-1226@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    headers = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };
    const session = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Issue 1226 session',
      mcpRole: 'manager',
      ownerUserId: user.id,
    });
    new AgentSessionsRepository().setSdkSessionId(
      session.id,
      readContext.sdkSessionId,
    );
    signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    clearTrustedMcpVerifier();
    await closeServer();
  });

  function taintBody(trustedCall: unknown): Record<string, unknown> {
    return {
      trustedCall,
      context: readContext,
      source: 'task.list',
      contentDigest: 'a'.repeat(64),
      blocked: false,
      diagnostics: [],
    };
  }

  function consumeBody(
    trustedCall: unknown,
    context: typeof writeContext = writeContext,
    payload: Record<string, unknown> = { title: 'Bound task' },
  ): Record<string, unknown> {
    return {
      trustedCall,
      context,
      action: 'task.create',
      payload,
    };
  }

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function counts(): { events: number; taints: number; consumed: number } {
    const scalar = (sql: string) =>
      (
        getDb().prepare(sql).get() as {
          count: number;
        }
      ).count;
    return {
      events: scalar('SELECT COUNT(*) AS count FROM agent_external_content_events'),
      taints: scalar('SELECT COUNT(*) AS count FROM agent_external_taint_state'),
      consumed: scalar(
        'SELECT COUNT(*) AS count FROM agent_approvals WHERE consumed_at IS NOT NULL',
      ),
    };
  }

  it('issue-1226-c2: taint and consume require a fresh signed call for the expected tool and arguments', async () => {
    const missingTaint = await post(
      '/agent-approvals/external-content/taint',
      taintBody(null),
    );
    const missingConsume = await post(
      '/agent-approvals/consume',
      consumeBody(null),
    );
    expect(missingTaint.status).toBe(403);
    expect(missingConsume.status).toBe(403);

    const validRead = signer.signCall(
      readContext,
      'rhythm_list_tasks',
      { status: 'all' },
    );
    expect(
      (
        await post(
          '/agent-approvals/external-content/taint',
          taintBody(validRead),
        )
      ).status,
    ).toBe(201);

    const cleanContext = {
      ...writeContext,
      sdkSessionId: 'sdk-clean-issue-1226',
    };
    const cleanSession = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Issue 1226 clean session',
      mcpRole: 'manager',
      ownerUserId: 1,
    });
    new AgentSessionsRepository().setSdkSessionId(
      cleanSession.id,
      cleanContext.sdkSessionId,
    );
    const validWrite = signer.signCall(
      cleanContext,
      'rhythm_create_task',
      { title: 'Bound task' },
    );
    expect(
      (
        await post(
          '/agent-approvals/consume',
          consumeBody(validWrite, cleanContext),
        )
      ).status,
    ).toBe(200);
  });

  it('issue-1226-c3: invalid envelopes fail closed without security-state changes', async () => {
    const stale = signer.signCall(
      readContext,
      'rhythm_list_tasks',
      { status: 'all' },
      Date.now() - 61_000,
    );
    const wrongTool = signer.signCall(
      readContext,
      'rhythm_create_task',
      { status: 'all' },
    );
    const altered = signer.signCall(
      readContext,
      'rhythm_list_tasks',
      { status: 'all' },
    );
    altered.arguments.status = 'done';

    for (const invalid of [null, stale, wrongTool, altered]) {
      expect(
        (
          await post(
            '/agent-approvals/external-content/taint',
            taintBody(invalid),
          )
        ).status,
      ).toBe(403);
      expect(counts()).toEqual({ events: 0, taints: 0, consumed: 0 });
    }

    const valid = signer.signCall(
      readContext,
      'rhythm_list_tasks',
      { status: 'all' },
    );
    expect(
      (
        await post(
          '/agent-approvals/external-content/taint',
          taintBody(valid),
        )
      ).status,
    ).toBe(201);
    const afterValid = counts();
    expect(
      (
        await post(
          '/agent-approvals/external-content/taint',
          taintBody(valid),
        )
      ).status,
    ).toBe(403);
    expect(counts()).toEqual(afterValid);

    const wrongConsume = signer.signCall(
      writeContext,
      'rhythm_update_task',
      { title: 'Bound task' },
    );
    const staleConsume = signer.signCall(
      writeContext,
      'rhythm_create_task',
      { title: 'Bound task' },
      Date.now() - 61_000,
    );
    const alteredConsume = signer.signCall(
      writeContext,
      'rhythm_create_task',
      { title: 'Bound task' },
    );
    alteredConsume.arguments.title = 'Altered task';

    for (const invalid of [
      null,
      staleConsume,
      wrongConsume,
      alteredConsume,
    ]) {
      expect(
        (
          await post(
            '/agent-approvals/consume',
            consumeBody(invalid),
          )
        ).status,
      ).toBe(403);
      expect(counts()).toEqual(afterValid);
    }

    const validEnvelopeWithSubstitutedPayload = signer.signCall(
      writeContext,
      'rhythm_create_task',
      { title: 'Bound task' },
    );
    expect(
      (
        await post(
          '/agent-approvals/consume',
          consumeBody(
            validEnvelopeWithSubstitutedPayload,
            writeContext,
            { title: 'Substituted task' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(counts()).toEqual(afterValid);

    const cleanContext = {
      ...writeContext,
      sdkSessionId: 'sdk-clean-replay-issue-1226',
      toolCallId: 'call-clean-replay-1226',
    };
    const cleanSession = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Issue 1226 clean replay session',
      mcpRole: 'manager',
      ownerUserId: 1,
    });
    new AgentSessionsRepository().setSdkSessionId(
      cleanSession.id,
      cleanContext.sdkSessionId,
    );
    const validConsume = signer.signCall(
      cleanContext,
      'rhythm_create_task',
      { title: 'Bound task' },
    );
    expect(
      (
        await post(
          '/agent-approvals/consume',
          consumeBody(validConsume, cleanContext),
        )
      ).status,
    ).toBe(200);
    expect(counts()).toEqual(afterValid);
    expect(
      (
        await post(
          '/agent-approvals/consume',
          consumeBody(validConsume, cleanContext),
        )
      ).status,
    ).toBe(403);
    expect(counts()).toEqual(afterValid);
  });
});
