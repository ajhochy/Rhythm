import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentActivityController } from '../controllers/agent_activity_controller';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { UsersRepository } from '../repositories/users_repository';

const { engineSpies, sessionMap, streamSessionSpy } = vi.hoisted(() => ({
  engineSpies: {
    createSession: vi.fn(),
    promptAsync: vi.fn(),
  },
  sessionMap: new Map<string, string>(),
  streamSessionSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engineSpies,
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: streamSessionSpy,
  },
}));

import { delegateToAgentAsync } from '../services/agent_delegation_service';
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { MobileSseProxy } from '../services/mobile_sse_proxy';

let db: Database.Database;

const permissiveOwnershipRepository = {
  isResourceOwnedBy: () => true,
  claimResource: () => true,
  releaseResource: () => true,
};

function makeDb(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

function seedProfile(input: {
  id: string;
  manager?: boolean;
  selectable?: boolean;
  delegates?: string[];
}): void {
  new AgentConfigsRepository().insert({
    id: input.id,
    label: input.id,
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: input.manager ?? false,
    sessionSelectable: input.selectable ?? true,
    allowedDelegatesJson: input.delegates
      ? JSON.stringify(input.delegates)
      : null,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: input.id,
    corePermissionsJson: JSON.stringify({
      rhythm_delegate_async: 'allow',
    }),
  });
}

function seedSession(input: {
  agentKind: string;
  sdkId: string;
  ownerUserId?: number | null;
}): ReturnType<AgentSessionsRepository['insert']> {
  const ownerUserId = input.ownerUserId ?? 1;
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)',
    )
    .run(
      ownerUserId,
      `Contract User ${ownerUserId}`,
      `security-review-${ownerUserId}@example.com`,
    );
  const sessions = new AgentSessionsRepository();
  const session = sessions.insert({
    agentKind: input.agentKind as never,
    taskId: null,
    taskTitle: null,
    cwd: '/tmp',
    name: input.agentKind,
    mcpRole: input.agentKind,
    ownerUserId,
    category: 'chat',
  });
  sessions.setSdkSessionId(session.id, input.sdkId);
  sessions.updateStatus(session.id, 'idle');
  sessionMap.set(session.id, input.sdkId);
  return sessions.findById(session.id)!;
}

function seedCompletedDelegation(input: {
  parentId: string;
  parentSdkId: string;
  targetId: string;
  childSdkId: string;
  output?: string;
}): string {
  const sessions = new AgentSessionsRepository();
  const child = sessions.upsertChildSession(
    input.childSdkId,
    input.parentSdkId,
    `Async child (@${input.targetId} subagent)`,
    '/tmp',
  )!;
  const delegations = new AgentAsyncDelegationsRepository();
  delegations.create({
    parentSessionId: input.parentId,
    childSessionId: child.id,
    targetAgentConfigId: input.targetId,
  });
  new AgentSessionMessagesRepository().append(
    child.id,
    'output',
    input.output ?? 'specialist result',
    input.output ?? 'specialist result',
  );
  return child.id;
}

async function captureOutcome(
  operation: () => Promise<unknown>,
): Promise<{ resolved: boolean; error?: unknown }> {
  try {
    await operation();
    return { resolved: true };
  } catch (error) {
    return { resolved: false, error };
  }
}

function addColumnIfMissing(table: string, definition: string): void {
  const column = definition.trim().split(/\s+/)[0];
  const columns = (
    db.pragma(`table_info(${table})`) as Array<{ name: string }>
  ).map(({ name }) => name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function decodeBody(body: Uint8Array): unknown {
  return JSON.parse(Buffer.from(body).toString('utf8'));
}

function denied(
  outcome:
    | { response: Awaited<ReturnType<MobileOpenCodeProxy['forward']>> }
    | { error: unknown },
): boolean {
  if ('response' in outcome) {
    return outcome.response.status === 403 || outcome.response.status === 404;
  }
  const candidate = outcome.error as {
    statusCode?: number;
    status?: number;
  };
  return (
    candidate?.statusCode === 403 ||
    candidate?.statusCode === 404 ||
    candidate?.status === 403 ||
    candidate?.status === 404
  );
}

async function proxyOutcome(
  operation: () => ReturnType<MobileOpenCodeProxy['forward']>,
): Promise<
  | { response: Awaited<ReturnType<MobileOpenCodeProxy['forward']>> }
  | { error: unknown }
> {
  try {
    return { response: await operation() };
  } catch (error) {
    return { error };
  }
}

describe('issue #1175 independent security review acceptance contract', () => {
  beforeEach(() => {
    makeDb();
    getDb()
      .prepare("INSERT INTO users (id, name, email) VALUES (1, 'Contract User', 'security-review@example.com')")
      .run();
    sessionMap.clear();
    vi.clearAllMocks();
    engineSpies.createSession.mockResolvedValue({ id: 'sdk-child-contract' });
    engineSpies.promptAsync.mockResolvedValue(true);
    streamSessionSpy.mockResolvedValue(undefined);
  });

  it('issue-1175-c8: async delegation rejects locked participants and never wakes a newly locked parent', async () => {
    // Regression caught: delegateToAgentAsync checks enabled but not the
    // independent security lock, so a stale enabled=1 write can execute an
    // audit-locked profile and completion can prompt a parent locked later.
    seedProfile({
      id: 'locked-caller',
      manager: true,
      delegates: ['normal-target'],
    });
    engineSpies.createSession
      .mockResolvedValueOnce({ id: 'sdk-child-locked-caller' })
      .mockResolvedValueOnce({ id: 'sdk-child-locked-target' });
    seedProfile({ id: 'normal-target' });
    const lockedCallerSession = seedSession({
      agentKind: 'locked-caller',
      sdkId: 'sdk-locked-caller',
    });
    new AgentConfigsRepository().lockForSecurity(
      'locked-caller',
      'caller audit finding',
      'contract-reviewer',
    );

    seedProfile({
      id: 'normal-caller',
      manager: true,
      delegates: ['locked-target'],
    });
    seedProfile({ id: 'locked-target' });
    const normalCallerSession = seedSession({
      agentKind: 'normal-caller',
      sdkId: 'sdk-normal-caller',
    });
    new AgentConfigsRepository().lockForSecurity(
      'locked-target',
      'target audit finding',
      'contract-reviewer',
    );
    db.prepare(
      `UPDATE agent_configs SET enabled = 1 WHERE id = 'locked-target'`,
    ).run();

    const lockedCallerOutcome = await captureOutcome(() =>
      delegateToAgentAsync({
        authenticatedUserId: 1,
        callerSessionId: lockedCallerSession.id,
        targetAgentConfigId: 'normal-target',
        prompt: 'Must not run from a locked caller.',
      }),
    );
    const lockedTargetOutcome = await captureOutcome(() =>
      delegateToAgentAsync({
        authenticatedUserId: 1,
        callerSessionId: normalCallerSession.id,
        targetAgentConfigId: 'locked-target',
        prompt: 'Must not run a stale-enabled locked target.',
      }),
    );

    expect.soft(lockedCallerOutcome.resolved).toBe(false);
    expect.soft(lockedTargetOutcome.resolved).toBe(false);
    expect.soft(engineSpies.createSession).not.toHaveBeenCalled();
    expect.soft(engineSpies.promptAsync).not.toHaveBeenCalled();

    makeDb();
    sessionMap.clear();
    vi.clearAllMocks();
    engineSpies.promptAsync.mockResolvedValue(true);
    seedProfile({
      id: 'parent-manager',
      manager: true,
      delegates: ['specialist'],
    });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({
      agentKind: 'parent-manager',
      sdkId: 'sdk-parent-locked-after-dispatch',
    });
    const childId = seedCompletedDelegation({
      parentId: parent.id,
      parentSdkId: 'sdk-parent-locked-after-dispatch',
      targetId: 'specialist',
      childSdkId: 'sdk-child-before-parent-lock',
    });
    new AgentConfigsRepository().lockForSecurity(
      'parent-manager',
      'parent locked after dispatch',
      'contract-reviewer',
    );

    await new AsyncDelegationCompletionService().onChildIdle(childId);

    expect.soft(engineSpies.promptAsync).not.toHaveBeenCalled();
    expect.soft(
      new AgentAsyncDelegationsRepository()
        .findByChildSessionId(childId)?.status,
    ).toBe('completed');
  });

  it('issue-1175-c9: dispatch and completion failures persist terminal state and stale claims recover exactly once', async () => {
    // Regression caught: streamSession/promptAsync throws after the outbox row
    // is created, or a parent wake throws after claiming it, leaving durable
    // rows stuck as dispatched/waking forever across a process restart.
    seedProfile({
      id: 'manager-stream',
      manager: true,
      delegates: ['specialist-stream'],
    });
    seedProfile({ id: 'specialist-stream' });
    const streamParent = seedSession({
      agentKind: 'manager-stream',
      sdkId: 'sdk-parent-stream',
    });
    streamSessionSpy.mockRejectedValueOnce(
      new Error('contract stream failure'),
    );
    await captureOutcome(() =>
      delegateToAgentAsync({
        authenticatedUserId: 1,
        callerSessionId: streamParent.id,
        targetAgentConfigId: 'specialist-stream',
        prompt: 'Dispatch with a failing subscription.',
      }),
    );
    const streamChild = db.prepare(
      `SELECT id FROM agent_sessions
       WHERE parent_session_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(streamParent.id) as { id: string } | undefined;
    expect.soft(streamChild).toBeDefined();
    expect.soft(
      streamChild
        ? new AgentAsyncDelegationsRepository()
          .findByChildSessionId(streamChild.id)?.status
        : null,
    ).toBe('failed');
    expect.soft(
      streamChild
        ? new AgentSessionsRepository().findById(streamChild.id)?.status
        : null,
    ).toBe('error');

    makeDb();
    sessionMap.clear();
    vi.clearAllMocks();
    streamSessionSpy.mockResolvedValue(undefined);
    engineSpies.createSession.mockResolvedValue({
      id: 'sdk-child-prompt-throws',
    });
    engineSpies.promptAsync.mockRejectedValueOnce(
      new Error('contract prompt failure'),
    );
    seedProfile({
      id: 'manager-prompt',
      manager: true,
      delegates: ['specialist-prompt'],
    });
    seedProfile({ id: 'specialist-prompt' });
    const promptParent = seedSession({
      agentKind: 'manager-prompt',
      sdkId: 'sdk-parent-prompt',
    });
    await captureOutcome(() =>
      delegateToAgentAsync({
        authenticatedUserId: 1,
        callerSessionId: promptParent.id,
        targetAgentConfigId: 'specialist-prompt',
        prompt: 'Dispatch with a failing enqueue.',
      }),
    );
    const promptChild = db.prepare(
      `SELECT id FROM agent_sessions
       WHERE parent_session_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(promptParent.id) as { id: string } | undefined;
    expect.soft(promptChild).toBeDefined();
    expect.soft(
      promptChild
        ? new AgentAsyncDelegationsRepository()
          .findByChildSessionId(promptChild.id)?.status
        : null,
    ).toBe('failed');
    expect.soft(
      promptChild
        ? new AgentSessionsRepository().findById(promptChild.id)?.status
        : null,
    ).toBe('error');

    makeDb();
    sessionMap.clear();
    vi.clearAllMocks();
    seedProfile({
      id: 'manager-claim',
      manager: true,
      delegates: ['specialist-claim'],
    });
    seedProfile({ id: 'specialist-claim' });
    const claimParent = seedSession({
      agentKind: 'manager-claim',
      sdkId: 'sdk-parent-claim',
    });
    const claimChildId = seedCompletedDelegation({
      parentId: claimParent.id,
      parentSdkId: 'sdk-parent-claim',
      targetId: 'specialist-claim',
      childSdkId: 'sdk-child-claim',
    });
    engineSpies.promptAsync
      .mockRejectedValueOnce(new Error('contract wake failure'))
      .mockResolvedValueOnce(true);
    await captureOutcome(() =>
      new AsyncDelegationCompletionService().onChildIdle(claimChildId),
    );
    expect.soft(
      new AgentAsyncDelegationsRepository()
        .findByChildSessionId(claimChildId)?.status,
    ).toBe('completed');
    await new AsyncDelegationCompletionService().onParentIdle(claimParent.id);
    expect.soft(
      new AgentAsyncDelegationsRepository()
        .findByChildSessionId(claimChildId)?.status,
    ).toBe('notified');
    expect.soft(engineSpies.promptAsync).toHaveBeenCalledTimes(2);

    makeDb();
    sessionMap.clear();
    vi.clearAllMocks();
    engineSpies.promptAsync.mockResolvedValue(true);
    seedProfile({
      id: 'manager-restart',
      manager: true,
      delegates: ['specialist-restart'],
    });
    seedProfile({ id: 'specialist-restart' });
    const restartParent = seedSession({
      agentKind: 'manager-restart',
      sdkId: 'sdk-parent-restart',
    });
    const restartChildId = seedCompletedDelegation({
      parentId: restartParent.id,
      parentSdkId: 'sdk-parent-restart',
      targetId: 'specialist-restart',
      childSdkId: 'sdk-child-restart',
    });
    new AgentAsyncDelegationsRepository().markCompleted(
      restartChildId,
      'result retained across restart',
    );
    db.prepare(
      `UPDATE agent_async_delegations
       SET status = 'waking'
       WHERE child_session_id = ?`,
    ).run(restartChildId);

    const restarted = new AsyncDelegationCompletionService();
    await restarted.onParentIdle(restartParent.id);
    await restarted.onParentIdle(restartParent.id);

    expect.soft(engineSpies.promptAsync).toHaveBeenCalledTimes(1);
    expect.soft(
      new AgentAsyncDelegationsRepository()
        .findByChildSessionId(restartChildId)?.status,
    ).toBe('notified');
  });

  it('issue-1175-c10: paired Activity is user-scoped across every source', async () => {
    // Regression caught: the Device-authenticated route calls a global
    // aggregator without req.mobileDevice.userId, exposing another user's
    // session preview, research report, schedule, webhook, recipe, or optimizer
    // result in the iPhone Activity feed.
    const users = new UsersRepository();
    const userA = users.create({
      name: 'Activity A',
      email: 'issue-1175-activity-a@example.com',
    });
    const userB = users.create({
      name: 'Activity B',
      email: 'issue-1175-activity-b@example.com',
    });
    addColumnIfMissing(
      'agent_cookbook',
      'owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    );
    addColumnIfMissing(
      'agent_org_proposals',
      'owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    );
    const now = new Date().toISOString();

    for (const [suffix, owner] of [
      ['A', userA.id],
      ['B', userB.id],
    ] as const) {
      db.prepare(
        `INSERT INTO agent_sessions
          (id, agent_kind, status, status_message, cwd, name, last_preview,
           last_activity_at, created_at, updated_at, mcp_role, is_system,
           owner_user_id, category)
         VALUES (?, 'opencode', 'idle', NULL, '/tmp', ?, ?, ?, ?, ?,
                 'opencode', 0, ?, 'chat')`,
      ).run(
        `activity-human-${suffix}`,
        `ACTIVITY_${suffix}_HUMAN`,
        `ACTIVITY_${suffix}_HUMAN_PREVIEW`,
        now,
        now,
        now,
        owner,
      );
      db.prepare(
        `INSERT INTO agent_research_jobs
          (id, query, status, sources_json, report, requested_by_user_id,
           created_at, updated_at)
         VALUES (?, ?, 'done', '[]', ?, ?, ?, ?)`,
      ).run(
        `activity-research-${suffix}`,
        `ACTIVITY_${suffix}_RESEARCH`,
        `ACTIVITY_${suffix}_RESEARCH_REPORT`,
        owner,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO agent_scheduled_tasks
          (id, name, schedule_type, timezone, prompt, agent_kind, enabled,
           last_run_at, last_run_status, created_by_user_id, created_at,
           updated_at)
         VALUES (?, ?, 'daily', 'America/Los_Angeles', 'contract', 'opencode',
                 1, ?, 'success', ?, ?, ?)`,
      ).run(
        `activity-schedule-${suffix}`,
        `ACTIVITY_${suffix}_SCHEDULE`,
        now,
        owner,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO agent_webhook_endpoints
          (id, name, event_types_json, secret, enabled, last_triggered_at,
           trigger_count, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, '["*"]', 'contract-secret', 1, ?, 1, ?, ?, ?)`,
      ).run(
        `activity-webhook-${suffix}`,
        `ACTIVITY_${suffix}_WEBHOOK`,
        now,
        owner,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO agent_cookbook
          (id, title, description, steps_json, owner_user_id, created_at,
           updated_at)
         VALUES (?, ?, ?, '[]', ?, ?, ?)`,
      ).run(
        `activity-cookbook-${suffix}`,
        `ACTIVITY_${suffix}_COOKBOOK`,
        `ACTIVITY_${suffix}_COOKBOOK_DESCRIPTION`,
        owner,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO agent_sessions
          (id, agent_kind, status, cwd, name, last_preview, last_activity_at,
           created_at, updated_at, mcp_role, is_system, owner_user_id, category)
         VALUES (?, 'opencode', 'idle', '/tmp', ?, ?, ?, ?, ?,
                 'opencode', 0, ?, 'chat')`,
      ).run(
        `activity-cookbook-session-${suffix}`,
        `ACTIVITY_${suffix}_COOKBOOK`,
        `ACTIVITY_${suffix}_COOKBOOK_PREVIEW`,
        now,
        now,
        now,
        owner,
      );
      db.prepare(
        `INSERT INTO agent_sessions
          (id, agent_kind, status, cwd, name, last_preview, last_activity_at,
           created_at, updated_at, mcp_role, is_system, owner_user_id, category)
         VALUES (?, 'org-optimizer', 'idle', '/tmp', ?, ?, ?, ?, ?,
                 'org-optimizer', 1, ?, 'self_improvement')`,
      ).run(
        `activity-optimizer-session-${suffix}`,
        `ACTIVITY_${suffix}_OPTIMIZER_SESSION`,
        `ACTIVITY_${suffix}_OPTIMIZER_PREVIEW`,
        now,
        now,
        now,
        owner,
      );
      db.prepare(
        `INSERT INTO agent_org_proposals
          (id, audit_run_id, kind, risk, status, title, rationale,
           owner_user_id, decided_by_user_id, created_at, updated_at)
         VALUES (?, ?, 'tighten-scope', 'low', 'approved', ?, ?, ?, ?, ?, ?)`,
      ).run(
        `activity-proposal-${suffix}`,
        `ACTIVITY_${suffix}_OPTIMIZER_RUN`,
        `ACTIVITY_${suffix}_OPTIMIZER_PROPOSAL`,
        `ACTIVITY_${suffix}_OPTIMIZER_RATIONALE`,
        owner,
        owner,
        now,
        now,
      );
    }

    let responseBody: unknown;
    let forwardedError: unknown;
    const request = {
      query: {},
      mobileDevice: {
        id: 'device-activity-a',
        userId: userA.id,
        hostId: 'host-activity',
        name: 'Contract iPhone',
        createdAt: now,
        revokedAt: null,
      },
    } as unknown as Request;
    const response = {
      json(value: unknown) {
        responseBody = value;
        return this;
      },
    } as unknown as Response;
    await new AgentActivityController().list(
      request,
      response,
      (error?: unknown) => {
        forwardedError = error;
      },
    );

    expect(forwardedError).toBeUndefined();
    const serialized = JSON.stringify(responseBody);
    for (const marker of [
      'ACTIVITY_A_HUMAN',
      'ACTIVITY_A_RESEARCH',
      'ACTIVITY_A_SCHEDULE',
      'ACTIVITY_A_WEBHOOK',
      'ACTIVITY_A_COOKBOOK',
      'ACTIVITY_A_OPTIMIZER',
    ]) {
      expect.soft(serialized).toContain(marker);
    }
    expect(serialized).not.toMatch(/ACTIVITY_B_/);
  });

  it('issue-1175-c11: paired HTTP and SSE shape or deny sensitive upstream fields recursively', async () => {
    // Regression caught: the generic proxy replaces request roots but returns
    // successful OpenCode JSON and nested SSE properties verbatim, exposing
    // filesystem roots and provider credentials to the paired client.
    const project = {
      id: 'opaque-project-a',
      root: '/Users/contract/private/project-a',
    };
    const secret = 'contract-provider-secret';
    const operationPayloads = new Map<string, unknown>([
      ['/path', {
        home: '/Users/contract',
        state: '/Users/contract/.local/state',
        config: '/Users/contract/.config',
        worktree: project.root,
        directory: project.root,
      }],
      ['/config', {
        model: 'safe/model',
        provider: {
          safeProvider: {
            options: { apiKey: secret, baseURL: 'https://safe.invalid' },
          },
        },
        nested: { directory: project.root },
      }],
      ['/global/config', {
        provider: {
          safeProvider: {
            options: { token: secret, root: project.root },
          },
        },
      }],
      ['/project/current', {
        id: 'engine-project-a',
        name: 'Project A',
        worktree: project.root,
        nested: { cwd: project.root },
      }],
      ['/session', [{
        id: 'session-a',
        title: 'Safe session',
        directory: project.root,
        nested: { token: secret },
      }]],
      ['/pty', [{
        id: 'pty-a',
        title: 'Safe terminal',
        cwd: project.root,
        environment: { PROVIDER_TOKEN: secret },
      }]],
      ['/experimental/resource', [{
        name: 'resource-a',
        root: project.root,
        credential: secret,
      }]],
    ]);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.contract',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: vi.fn(async (input) => {
        const url = new URL(String(input));
        return new Response(JSON.stringify(operationPayloads.get(url.pathname)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    });
    for (const path of operationPayloads.keys()) {
      const httpOutcome = await proxyOutcome(() =>
        proxy.forward({
          method: 'GET',
          path,
          query: new URLSearchParams(),
          project,
          userId: 1,
        }),
      );
      if ('response' in httpOutcome) {
        const serialized = JSON.stringify(
          decodeBody(httpOutcome.response.body),
        );
        expect.soft(serialized, `${path} leaked the selected root`)
          .not.toContain(project.root);
        expect.soft(serialized, `${path} leaked a credential`)
          .not.toContain(secret);
        expect.soft(serialized, `${path} retained a root-bearing field`)
          .not.toMatch(
            /"(?:root|cwd|workingDirectory|worktreeDir|worktree|home|state)"\s*:/i,
          );
      } else {
        expect.soft(denied(httpOutcome), `${path} must safely deny`).toBe(true);
      }
    }

    const encoder = new TextEncoder();
    const upstreamSse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: 'sensitive-event',
              directory: project.root,
              payload: {
                type: 'session.updated',
                properties: {
                  info: {
                    id: 'session-a',
                    directory: project.root,
                    root: project.root,
                  },
                  auth: {
                    token: secret,
                  },
                },
              },
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    const request = new EventEmitter();
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      writableEnded: boolean;
      writableLength: number;
      setHeader: ReturnType<typeof vi.fn>;
      flushHeaders: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    response.statusCode = 0;
    response.writableEnded = false;
    response.writableLength = 0;
    response.setHeader = vi.fn();
    response.flushHeaders = vi.fn();
    let downstream = '';
    response.write = vi.fn((value: string) => {
      downstream += value;
      setImmediate(() => request.emit('close'));
      return true;
    });
    response.end = vi.fn(() => {
      response.writableEnded = true;
    });
    const sse = new MobileSseProxy({
      baseUrl: 'http://opencode.contract',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: vi.fn(async () =>
        new Response(upstreamSse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })),
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      activeCheckIntervalMs: 10_000,
    });
    const fallbackClose = setTimeout(() => request.emit('close'), 25);
    await sse.stream({
      request: request as unknown as Request,
      response: response as unknown as Response,
      project,
      userId: 1,
      isDeviceActive: () => true,
    });
    clearTimeout(fallbackClose);

    expect.soft(downstream).not.toContain(project.root);
    expect.soft(downstream).not.toContain(secret);
    expect.soft(downstream).not.toMatch(
      /"(?:root|cwd|workingDirectory|worktreeDir)"\s*:/i,
    );
  });

  it('issue-1175-c15: selected-project credentials cannot enumerate or operate on another project session', async () => {
    // Regression caught: OpenCode's session status map and ID-addressed
    // endpoints resolve sessions globally, so injecting ?directory= alone
    // neither filters IDs nor authorizes message, part, permission, question,
    // PTY, abort, update, or delete operations.
    const projectA = {
      id: 'opaque-project-a',
      root: '/contract/project-a',
    };
    const projectBRoot = '/contract/project-b';
    const sessionA = 'session-project-a';
    const sessionB = 'session-project-b';
    const forwardedMutations: string[] = [];
    const fetchFn = vi.fn(async (
      input: string | URL | globalThis.Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (url.pathname === '/session' && method === 'GET') {
        return new Response(
          JSON.stringify([
            { id: sessionA, directory: projectA.root, title: 'owned' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.pathname === '/session/status' && method === 'GET') {
        return new Response(
          JSON.stringify({
            [sessionA]: { type: 'idle' },
            [sessionB]: { type: 'busy' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.pathname === '/permission' && method === 'GET') {
        return new Response(
          JSON.stringify([
            { id: 'permission-a', sessionID: sessionA },
            { id: 'permission-b', sessionID: sessionB },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.pathname === '/question' && method === 'GET') {
        return new Response(
          JSON.stringify([
            { id: 'question-a', sessionID: sessionA },
            { id: 'question-b', sessionID: sessionB },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.pathname === '/pty' && method === 'GET') {
        return new Response(
          JSON.stringify([
            { id: 'pty-a', cwd: projectA.root },
            { id: 'pty-b', cwd: projectBRoot },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        url.pathname === `/session/${sessionB}` &&
        method === 'GET'
      ) {
        return new Response(
          JSON.stringify({
            id: sessionB,
            directory: projectBRoot,
            title: 'other project',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        url.pathname === `/session/${sessionB}/message` &&
        method === 'GET'
      ) {
        return new Response(
          JSON.stringify([
            {
              info: { id: 'message-b', sessionID: sessionB },
              parts: [{ type: 'text', text: 'OTHER_PROJECT_SECRET' }],
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        url.pathname === '/pty/pty-b' &&
        method === 'GET'
      ) {
        return new Response(
          JSON.stringify({
            id: 'pty-b',
            cwd: projectBRoot,
            output: 'OTHER_PROJECT_SECRET',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        url.pathname === `/session/${sessionB}` ||
        url.pathname.startsWith(`/session/${sessionB}/`) ||
        url.pathname.startsWith('/permission/permission-b/') ||
        url.pathname.startsWith('/question/question-b/') ||
        url.pathname.startsWith('/pty/pty-b')
      ) {
        forwardedMutations.push(`${method} ${url.pathname}`);
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected upstream' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.contract',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn,
    });
    const forward = (
      method: string,
      path: string,
      body?: unknown,
    ) =>
      proxy.forward({
        method,
        path,
        query: new URLSearchParams(),
        body,
        project: projectA,
        userId: 1,
      });

    const list = await forward('GET', '/session');
    const status = await forward('GET', '/session/status');
    const permissions = await forward('GET', '/permission');
    const questions = await forward('GET', '/question');
    const ptys = await forward('GET', '/pty');
    const deniedOperations = await Promise.all([
      proxyOutcome(() => forward('GET', `/session/${sessionB}/message`)),
      proxyOutcome(() =>
        forward(
          'DELETE',
          `/session/${sessionB}/message/message-b`,
        )),
      proxyOutcome(() =>
        forward(
          'PATCH',
          `/session/${sessionB}/message/message-b/part/part-b`,
          { text: 'tamper' },
        )),
      proxyOutcome(() =>
        forward(
          'DELETE',
          `/session/${sessionB}/message/message-b/part/part-b`,
        )),
      proxyOutcome(() =>
        forward('POST', `/session/${sessionB}/abort`, {})),
      proxyOutcome(() =>
        forward('PATCH', `/session/${sessionB}`, { title: 'tamper' })),
      proxyOutcome(() => forward('DELETE', `/session/${sessionB}`)),
      proxyOutcome(() =>
        forward('POST', '/permission/permission-b/reply', {
          reply: 'once',
        })),
      proxyOutcome(() =>
        forward('POST', '/question/question-b/reply', {
          answers: [['tamper']],
        })),
      proxyOutcome(() =>
        forward('POST', '/question/question-b/reject', {})),
      proxyOutcome(() => forward('GET', '/pty/pty-b')),
      proxyOutcome(() =>
        forward('PUT', '/pty/pty-b', { title: 'tamper' })),
      proxyOutcome(() => forward('DELETE', '/pty/pty-b')),
      proxyOutcome(() =>
        forward('POST', '/pty/pty-b/connect-token', {})),
    ]);

    expect.soft(decodeBody(list.body)).toEqual([
      expect.objectContaining({ id: sessionA }),
    ]);
    expect.soft(Object.keys(decodeBody(status.body) as object)).toEqual([
      sessionA,
    ]);
    expect.soft(decodeBody(permissions.body)).toEqual([
      expect.objectContaining({ id: 'permission-a', sessionID: sessionA }),
    ]);
    expect.soft(decodeBody(questions.body)).toEqual([
      expect.objectContaining({ id: 'question-a', sessionID: sessionA }),
    ]);
    expect.soft(decodeBody(ptys.body)).toEqual([
      expect.objectContaining({ id: 'pty-a' }),
    ]);
    for (const outcome of deniedOperations) {
      expect.soft(denied(outcome)).toBe(true);
    }
    expect.soft(forwardedMutations).toEqual([]);
  });

  it('issue-1175-c16: Activity query columns exist in both SQLite and Postgres bootstrap schemas', () => {
    // Regression caught: SQLite gained status_message/project_id/mcp_role via
    // guarded ALTERs, while the Postgres bootstrap's agent_sessions table did
    // not, making the Activity SELECT fail only in Postgres deployments.
    const postgresSource = readFileSync(
      join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );
    const sqliteColumns = (
      db.pragma('table_info(agent_sessions)') as Array<{ name: string }>
    ).map(({ name }) => name);
    const postgresColumns = new Set<string>();
    const createMatch = postgresSource.match(
      /CREATE TABLE IF NOT EXISTS agent_sessions\s*\(([\s\S]*?)\)\s*;/i,
    );
    expect(createMatch).not.toBeNull();
    for (const rawLine of createMatch?.[1].split('\n') ?? []) {
      const line = rawLine.trim().replace(/,$/, '');
      if (
        !line ||
        line.startsWith('--') ||
        /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)
      ) {
        continue;
      }
      const name = line.split(/\s+/)[0];
      if (/^[a-z_][a-z0-9_]*$/i.test(name)) postgresColumns.add(name);
    }
    const alterPattern =
      /ALTER TABLE agent_sessions ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
    let alterMatch: RegExpExecArray | null;
    while ((alterMatch = alterPattern.exec(postgresSource)) !== null) {
      postgresColumns.add(alterMatch[1]);
    }

    for (const column of ['status_message', 'project_id', 'mcp_role']) {
      expect.soft(sqliteColumns).toContain(column);
      expect.soft([...postgresColumns]).toContain(column);
    }
  });
});
