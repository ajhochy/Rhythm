/**
 * Acceptance contract for issue #1226.
 *
 * Regression caught: the MCP boundary strips the engine's proof and forwards
 * only shape-checked identity. The trustedCall assertions fail if context,
 * proof, or the production handler's original arguments are omitted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTaskTools } from '../../tools/tasks.js';
import {
  currentTrustedSecurityCall,
  RHYTHM_SECURITY_CONTEXT_META_KEY,
} from '../../security/security_context.js';
import { registerTool } from '../../tools/_tool.js';

type ToolHandler = (
  args: Record<string, unknown>,
  extra: { _meta?: Record<string, unknown> },
) => Promise<unknown>;

function stubServer(): { server: unknown; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>();
  return {
    server: {
      tool(
        name: string,
        _description: string,
        _shape: Record<string, unknown>,
        handler: ToolHandler,
      ) {
        tools.set(name, handler);
      },
    },
    tools,
  };
}

function extra(toolName: string, nonce: string) {
  return {
    _meta: {
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
        sdkSessionId: `sdk-${nonce}`,
        turnId: `turn-${nonce}`,
        agentName: 'manager',
        toolCallId: `call-${nonce}`,
        proof: {
          version: 1,
          algorithm: 'Ed25519',
          keyId: 'test-key',
          issuedAt: Date.now(),
          nonce,
          toolName,
          argumentsHash: 'test-arguments-hash',
          signature: 'test-signature',
        },
      },
    },
  };
}

describe('issue #1226 MCP trusted-call forwarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issue-1226-c1: MCP boundaries forward context proof and original tool arguments', async () => {
    const forwardedTaint: Record<string, unknown>[] = [];
    const forwardedConsume: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/tasks')) {
          return new Response(JSON.stringify([{ id: 1, title: 'safe task' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/agent-approvals/external-content/taint')) {
          forwardedTaint.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response(JSON.stringify({ taintId: 'taint-1226' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/agent-approvals/consume')) {
          forwardedConsume.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response(
            JSON.stringify({ allowed: true, consumed: false }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const { server, tools } = stubServer();
    registerTaskTools(
      server as never,
      'http://cloud',
      'token',
      'http://agent',
    );
    await tools.get('rhythm_list_tasks')!(
      { status: 'all', overdue: true },
      extra('rhythm_list_tasks', 'nonce-list-tasks'),
    );

    await tools.get('rhythm_create_task')!(
      { title: 'Bound task', approval_id: 'approval-1226' },
      extra('rhythm_create_task', 'nonce-create-task'),
    );

    expect(forwardedTaint).toHaveLength(1);
    expect(forwardedTaint[0].trustedCall).toEqual({
      context: {
        sdkSessionId: 'sdk-nonce-list-tasks',
        turnId: 'turn-nonce-list-tasks',
        agentName: 'manager',
        toolCallId: 'call-nonce-list-tasks',
      },
      proof: expect.objectContaining({
        toolName: 'rhythm_list_tasks',
        nonce: 'nonce-list-tasks',
      }),
      arguments: { status: 'all', overdue: true },
    });
    expect(forwardedConsume).toHaveLength(1);
    expect(forwardedConsume[0].trustedCall).toEqual({
      context: {
        sdkSessionId: 'sdk-nonce-create-task',
        turnId: 'turn-nonce-create-task',
        agentName: 'manager',
        toolCallId: 'call-nonce-create-task',
      },
      proof: expect.objectContaining({
        toolName: 'rhythm_create_task',
        nonce: 'nonce-create-task',
      }),
      arguments: {
        title: 'Bound task',
        approval_id: 'approval-1226',
      },
    });
  });

  it('keeps concurrent tool envelopes isolated and clears them after each handler', async () => {
    const { server, tools } = stubServer();
    const observed = new Map<string, unknown>();
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });

    registerTool(server as never, 'rhythm_test_first', '', {}, async () => {
      firstEntered();
      await firstPaused;
      observed.set('first', currentTrustedSecurityCall());
      return { content: [{ type: 'text' as const, text: 'first' }] };
    });
    registerTool(server as never, 'rhythm_test_second', '', {}, async () => {
      observed.set('second', currentTrustedSecurityCall());
      return { content: [{ type: 'text' as const, text: 'second' }] };
    });

    const first = tools.get('rhythm_test_first')!(
      { value: 1 },
      extra('rhythm_test_first', 'nonce-first'),
    );
    await firstReady;
    await tools.get('rhythm_test_second')!(
      { value: 2 },
      extra('rhythm_test_second', 'nonce-second'),
    );
    releaseFirst();
    await first;

    expect(observed.get('first')).toMatchObject({
      proof: { toolName: 'rhythm_test_first', nonce: 'nonce-first' },
      arguments: { value: 1 },
    });
    expect(observed.get('second')).toMatchObject({
      proof: { toolName: 'rhythm_test_second', nonce: 'nonce-second' },
      arguments: { value: 2 },
    });
    expect(currentTrustedSecurityCall()).toBeNull();
  });
});
