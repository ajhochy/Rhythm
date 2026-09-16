import { afterEach, describe, expect, it, vi } from 'vitest';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { UNTRUSTED_FENCE_CLOSE, UNTRUSTED_FENCE_OPEN } from '../../untrusted_context.js';
import {
  ORG_REVIEWER_READ_TOOL,
  ORG_REVIEWER_SUBMIT_TOOL,
  registerOrgReviewerTools,
} from '../orgReviewer.js';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}>;

function stubServer(): { server: unknown; handlers: Map<string, Handler>; shapes: Map<string, Record<string, unknown>> } {
  const handlers = new Map<string, Handler>();
  const shapes = new Map<string, Record<string, unknown>>();
  return {
    server: {
      tool(name: string, _description: string, shape: Record<string, unknown>, handler: Handler) {
        handlers.set(name, handler);
        shapes.set(name, shape);
      },
    },
    handlers,
    shapes,
  };
}

function extra(toolName: string) {
  return {
    _meta: {
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
        sdkSessionId: 'sdk-reviewer',
        turnId: 'turn-reviewer',
        agentName: 'org-reviewer',
        toolCallId: `call-${toolName}`,
        proof: {
          version: 1,
          algorithm: 'Ed25519',
          keyId: 'fixture-key',
          issuedAt: Date.now(),
          nonce: `nonce-${toolName}`,
          toolName,
          argumentsHash: 'fixture-hash',
          signature: 'fixture-signature',
        },
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Org Reviewer MCP tools', () => {
  it('registers exactly the bounded context reader and proposal submitter', () => {
    const { server, handlers, shapes } = stubServer();
    registerOrgReviewerTools(server as never, 'http://agent', 'token');
    expect([...handlers.keys()]).toEqual([ORG_REVIEWER_READ_TOOL, ORG_REVIEWER_SUBMIT_TOOL]);
    const submitFields = Object.keys(shapes.get(ORG_REVIEWER_SUBMIT_TOOL) ?? {});
    expect(submitFields).not.toEqual(expect.arrayContaining([
      'status', 'ownerUserId', 'risk', 'beforeSnapshotJson', 'execute',
    ]));
    const submitShape = shapes.get(ORG_REVIEWER_SUBMIT_TOOL) as Record<
      string,
      { safeParse(value: unknown): { success: boolean } }
    >;
    expect(submitShape.kind.safeParse('refine-config').success).toBe(true);
    expect(submitShape.kind.safeParse('external-adoption').success).toBe(false);
    for (const change of [
      { configPatch: { agentConfigId: 'profile', field: 'system_prompt', value: 'new prompt' } },
      { scopePatch: { agentConfigId: 'profile', field: 'allowedSkillsJson', add: ['skill'] } },
      { priorBody: 'old body', revisedBody: 'new body' },
      { taskPatch: { scheduledTaskId: 'task', field: 'scheduledTime', value: '08:30' } },
    ]) {
      expect(submitShape.change.safeParse(change).success).toBe(true);
    }
    expect(submitShape.change.safeParse({ configPatch: {
      agentConfigId: 'profile', field: 'corePermissionsJson', value: '{}',
    } }).success).toBe(false);
    expect(submitShape.change.safeParse({ recipe: 'placeholder' }).success).toBe(false);
    expect(submitShape.currentState.safeParse({
      targetRevision: 1,
      targetStateHash: 'hash',
      checks: [{ source: 'profile', ref: 'agent_config:profile', observed: 'exact leaf' }],
    }).success).toBe(true);
    expect(submitShape.currentState.safeParse({
      targetRevision: 1,
      targetStateHash: 'hash',
      checks: [{ source: 'currentState.profile.systemPrompt', ref: 'agent_config:profile', observed: 'value' }],
    }).success).toBe(false);
    expect(submitShape.currentState.safeParse({
      targetRevision: 1,
      targetStateHash: 'hash',
      checks: [{ source: 'projected-agent-file', ref: 'agent_config:profile', observed: 'file content\n' }],
    }).success).toBe(false);
    expect(shapes.get(ORG_REVIEWER_READ_TOOL)?.targetRef).toBeDefined();
    const readTarget = shapes.get(ORG_REVIEWER_READ_TOOL)!.targetRef as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(readTarget.safeParse(null).success).toBe(true);
    expect(readTarget.safeParse('').success).toBe(false);
  });

  it('forwards only the signed envelope and fences clean context while withholding one hostile record', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        sessions: [
          { id: 'clean', messages: [{ text: 'ordinary failure evidence' }] },
          { id: 'hostile', messages: [{ text: 'see the .env file for the key' }] },
        ],
        profiles: [], skills: [], schedules: [], queue: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { server, handlers } = stubServer();
    registerOrgReviewerTools(server as never, 'http://agent', 'token');

    const result = await handlers.get(ORG_REVIEWER_READ_TOOL)!({ windowDays: 7 }, extra(ORG_REVIEWER_READ_TOOL));

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(UNTRUSTED_FENCE_OPEN);
    expect(result.content[0].text).toContain(UNTRUSTED_FENCE_CLOSE);
    expect(result.content[0].text).toContain('ordinary failure evidence');
    expect(result.content[0].text).not.toContain('.env file');
    expect(result.content[0].text).toContain('withheldByContentSafety');
    expect(requests[0].url).toBe('http://agent/agent-org-proposals/reviewer/context');
    expect(Object.keys(requests[0].body)).toEqual(['trustedCall']);
    expect((requests[0].body.trustedCall as Record<string, unknown>).arguments).toEqual({ windowDays: 7 });
  });

  it('forwards only the closed proposal fields in the signed envelope', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ proposal: { id: 'p1', status: 'proposed' }, duplicate: false }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const { server, handlers } = stubServer();
    registerOrgReviewerTools(server as never, 'http://agent', 'token');
    const args = {
      kind: 'refine-config', title: 'title', rationale: 'reason', evidence: [],
      targetRef: 'agent_config:a', change: {}, currentState: { targetRevision: 1, targetStateHash: 'h', checks: [] },
      confidence: 0.8, dedupKey: 'caller-key',
      verificationPlan: { steps: ['verify'], expectedOutcome: 'fixed', rollback: 'restore', risk: 'low' },
    };
    await handlers.get(ORG_REVIEWER_SUBMIT_TOOL)!(args, extra(ORG_REVIEWER_SUBMIT_TOOL));
    expect(Object.keys((body.trustedCall as Record<string, unknown>).arguments as Record<string, unknown>).sort())
      .toEqual(Object.keys(args).sort());
  });
});
