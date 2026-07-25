import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  MobileOpenCodeProxy,
  type MobileOpenCodeForwardInput,
} from '../services/mobile_opencode_proxy';
import { mobileSseEventBelongsToProject } from '../services/mobile_opencode_security';
import { MobileSseProxy } from '../services/mobile_sse_proxy';

const project = {
  id: 'rhythm-project-a',
  root: '/sandbox/project-a',
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const decode = (body: Uint8Array) =>
  JSON.parse(Buffer.from(body).toString('utf8')) as unknown;

function input(
  method: string,
  path: string,
  overrides: Partial<MobileOpenCodeForwardInput> = {},
): MobileOpenCodeForwardInput {
  return {
    method,
    path,
    query: new URLSearchParams(),
    project,
    ...overrides,
  };
}

describe('issue #1175 paired OpenCode gateway security regressions', () => {
  it('denies external transcript share and unshare before any upstream call', async () => {
    const upstream = vi.fn(async () => json(true));
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: upstream,
    });

    await expect(proxy.forward(input(
      'POST',
      '/session/ses-owned/share',
    ))).rejects.toMatchObject({
      statusCode: 403,
      code: 'OPERATION_NOT_ALLOWED',
    });
    await expect(proxy.forward(input(
      'DELETE',
      '/session/ses-owned/share',
    ))).rejects.toMatchObject({
      statusCode: 403,
      code: 'OPERATION_NOT_ALLOWED',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preflights direct session reads, body/query message refs, and session SSE', async () => {
    const forwarded: string[] = [];
    const upstream = vi.fn(async (
      request: string | URL | globalThis.Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(request));
      const method = init?.method ?? 'GET';
      if (url.pathname === '/session' && method === 'GET') {
        return json([{
          id: 'ses-owned',
          title: 'Owned',
          directory: project.root,
        }]);
      }
      if (
        url.pathname === '/session/ses-owned/message' &&
        method === 'GET'
      ) {
        return json([{
          info: {
            id: 'msg-owned',
            sessionID: 'ses-owned',
          },
          parts: [{
            id: 'prt-owned',
            sessionID: 'ses-owned',
            messageID: 'msg-owned',
            type: 'text',
            text: 'owned',
          }],
        }]);
      }
      forwarded.push(`${method} ${url.pathname}`);
      return json({
        id: 'unexpected',
        directory: '/sandbox/project-b',
      });
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: upstream,
    });

    await expect(proxy.forward(input(
      'GET',
      '/session/ses-other',
    ))).rejects.toMatchObject({
      statusCode: 403,
      code: 'OPERATION_NOT_ALLOWED',
    });
    const attempts = [
      () => proxy.forward(input('GET', '/session/ses-other/message')),
      () => proxy.forward(input('POST', '/session', {
        body: { parentID: 'ses-other', title: 'cross-project child' },
      })),
      () => proxy.forward(input('POST', '/session/ses-owned/fork', {
        body: { messageID: 'msg-other' },
      })),
      () => proxy.forward(input('POST', '/session/ses-owned/revert', {
        body: { messageID: 'msg-owned', partID: 'prt-other' },
      })),
      () => proxy.forward(input('GET', '/session/ses-owned/diff', {
        query: new URLSearchParams({ messageID: 'msg-other' }),
      })),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    expect(forwarded).toEqual([]);

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
    response.write = vi.fn(() => true);
    response.end = vi.fn();
    const sse = new MobileSseProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: upstream,
    });
    await expect(sse.stream({
      request: request as unknown as Request,
      response: response as unknown as Response,
      project,
      sessionId: 'ses-other',
      isDeviceActive: () => true,
    })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(forwarded).toEqual([]);
  });

  it('preserves token counters and project content while shaping secrets and nested path metadata', async () => {
    const payloads = new Map<string, unknown>([
      ['/config', {
        inputTokens: 12,
        outputTokens: 7,
        tokenCount: 19,
        tokens: {
          input: 12,
          output: 7,
          reasoning: 0,
          cache: { read: 2, write: 1 },
        },
        token: 'secret-token',
        key: 'generic-provider-key',
        provider: {
          safe: {
            options: {
              apiKey: 'secret-api-key',
              baseURL: 'https://api.example.test/v1',
            },
          },
        },
        nested: {
          path: '/private/other-project/file.ts',
          uri: 'file:///private/other-project/file.ts',
          message: 'failed at /private/other-project/file.ts:42',
        },
        state: {
          status: 'ready',
          message: 'normal semantic state',
        },
      }],
      ['/file', [{
        name: 'inside.ts',
        path: 'src/inside.ts',
        absolute: `${project.root}/src/inside.ts`,
        type: 'file',
        ignored: false,
      }, {
        name: 'outside.ts',
        path: '/private/other-project/outside.ts',
        absolute: '/private/other-project/outside.ts',
        type: 'file',
        ignored: false,
      }]],
      ['/file/content', {
        type: 'text',
        content:
          `intentional project text mentions ${project.root} with Bearer secret-bearer`,
        diff: `--- ${project.root}/src/inside.ts\n+++ /private/other-project/inside.ts`,
      }],
      ['/find/symbol', [{
        name: 'inside',
        kind: 12,
        location: {
          uri: `file://${project.root}/src/inside.ts`,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 6 },
          },
        },
      }]],
      ['/experimental/resource', {
        docs: {
          name: 'docs',
          client: 'safe',
          uri: 'https://docs.example.test/resource?token=secret-query',
        },
      }],
    ]);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: async (request) => {
        const url = new URL(String(request));
        return json(payloads.get(url.pathname));
      },
    });

    const config = decode(
      (await proxy.forward(input('GET', '/config'))).body,
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      inputTokens: 12,
      outputTokens: 7,
      tokenCount: 19,
      tokens: {
        input: 12,
        output: 7,
        reasoning: 0,
        cache: { read: 2, write: 1 },
      },
      token: '[redacted]',
      key: '[redacted]',
      provider: {
        safe: {
          options: {
            apiKey: '[redacted]',
            baseURL: 'https://api.example.test/v1',
          },
        },
      },
      nested: {
        path: '[redacted-path]',
        uri: '[redacted-path]',
      },
      state: {
        status: 'ready',
        message: 'normal semantic state',
      },
    });
    expect(JSON.stringify(config)).not.toContain('/private/');

    const files = decode((await proxy.forward(input('GET', '/file', {
      query: new URLSearchParams({ path: '.' }),
    }))).body) as Array<Record<string, unknown>>;
    expect(files[0]).toMatchObject({
      path: 'src/inside.ts',
      absolute: 'src/inside.ts',
    });
    expect(files[1]).toMatchObject({
      path: '[redacted-path]',
      absolute: '[redacted-path]',
    });

    const file = decode((await proxy.forward(input(
      'GET',
      '/file/content',
      { query: new URLSearchParams({ path: 'src/inside.ts' }) },
    ))).body) as Record<string, unknown>;
    expect(file.content).toContain('intentional project text mentions');
    expect(file.content).not.toContain(project.root);
    expect(file.content).not.toContain('secret-bearer');
    expect(file.content).toContain('Bearer [redacted]');
    expect(file.diff).not.toContain(project.root);
    expect(file.diff).not.toContain('/private/');

    const symbols = decode((await proxy.forward(input(
      'GET',
      '/find/symbol',
      { query: new URLSearchParams({ query: 'inside' }) },
    ))).body) as Array<Record<string, unknown>>;
    expect(
      (symbols[0].location as Record<string, unknown>).uri,
    ).toBe('rhythm-project://rhythm-project-a/src/inside.ts');

    const resources = decode((await proxy.forward(input(
      'GET',
      '/experimental/resource',
    ))).body) as Record<string, { uri: string }>;
    expect(resources.docs.uri).not.toContain('secret-query');
    expect(resources.docs.uri).toContain('%5Bredacted%5D');
  });

  it('requires selected-project ownership evidence on every SSE resource event', () => {
    expect(mobileSseEventBelongsToProject({
      directory: project.root,
      payload: {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses-owned',
            directory: project.root,
          },
        },
      },
    }, project)).toBe(true);
    expect(mobileSseEventBelongsToProject({
      directory: project.root,
      payload: {
        type: 'session.updated',
        properties: {
          info: {
            id: 'ses-other',
            directory: '/sandbox/project-b',
          },
        },
      },
    }, project)).toBe(false);
    expect(mobileSseEventBelongsToProject({
      directory: project.root,
      payload: {
        type: 'message.updated',
        properties: {
          info: { id: 'msg-unowned' },
        },
      },
    }, project)).toBe(false);
    expect(mobileSseEventBelongsToProject({
      payload: {
        type: 'permission.updated',
        properties: {
          id: 'permission-unscoped',
          sessionID: 'ses-other',
        },
      },
    }, project)).toBe(false);
  });

  it('uses opaque selected-project worktree references and rejects arbitrary paths', async () => {
    const worktree = '/private/opencode/worktrees/feature-a';
    const forwardedBodies: unknown[] = [];
    const upstream = vi.fn(async (
      request: string | URL | globalThis.Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(request));
      const method = init?.method ?? 'GET';
      if (
        url.pathname === '/experimental/worktree' &&
        method === 'GET'
      ) {
        return json([worktree]);
      }
      if (
        url.pathname === '/experimental/worktree/reset' &&
        method === 'POST'
      ) {
        forwardedBodies.push(JSON.parse(String(init?.body)));
        return json(true);
      }
      return json({ error: 'unexpected' }, 404);
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: upstream,
    });

    const listed = decode((await proxy.forward(input(
      'GET',
      '/experimental/worktree',
    ))).body) as string[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(/^rhythm-worktree:\/\/[A-Za-z0-9_-]{24}\//);
    expect(listed[0]).not.toContain('/private/');

    const reset = await proxy.forward(input(
      'POST',
      '/experimental/worktree/reset',
      { body: { directory: listed[0] } },
    ));
    expect(decode(reset.body)).toBe(true);
    expect(forwardedBodies).toEqual([{ directory: worktree }]);

    await expect(proxy.forward(input(
      'POST',
      '/experimental/worktree/reset',
      { body: { directory: worktree } },
    ))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(forwardedBodies).toHaveLength(1);
  });

  it('normalizes raw diffs and rejects every other successful non-JSON payload', async () => {
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      fetchFn: async (request) => {
        const url = new URL(String(request));
        if (url.pathname === '/vcs/diff/raw') {
          return new Response(
            `--- ${project.root}/src/a.ts\n+++ /private/other/a.ts\n@@ safe content`,
            { headers: { 'Content-Type': 'text/x-diff; charset=utf-8' } },
          );
        }
        return new Response(`host diagnostic at ${project.root}/secret`);
      },
    });

    const diff = Buffer.from((await proxy.forward(input(
      'GET',
      '/vcs/diff/raw',
    ))).body).toString('utf8');
    expect(diff).toContain('@@ safe content');
    expect(diff).not.toContain(project.root);
    expect(diff).not.toContain('/private/');

    await expect(proxy.forward(input(
      'GET',
      '/global/health',
    ))).rejects.toMatchObject({
      statusCode: 502,
      code: 'OPENCODE_UNSUPPORTED_RESPONSE',
    });
  });
});
