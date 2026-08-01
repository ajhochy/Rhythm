import { readFileSync } from 'node:fs';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { logger } from '../utils/logger';
import {
  installHumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

type ManifestEntry = {
  operationId: string;
  method: string;
  path: string;
  allowed: boolean;
  reason?: string;
};

type ProxyModule = {
  MOBILE_OPENCODE_OPERATION_MANIFEST: readonly ManifestEntry[];
  MobileOpenCodeProxy: new (options: Record<string, unknown>) => {
    forward(input: Record<string, unknown>): Promise<{
      status: number;
      contentType?: string;
      body: Uint8Array;
    }>;
  };
  matchMobileOpenCodeOperation(
    method: string,
    path: string,
  ): ManifestEntry | null;
};

async function loadProxyModule(): Promise<ProxyModule | null> {
  return vi
    .importActual<ProxyModule>('../services/mobile_opencode_proxy')
    .catch(() => null);
}

function openApiOperations(): Array<{
  operationId: string;
  method: string;
  path: string;
}> {
  const specPath = resolve(
    __dirname,
    '../../../opencode_fork/packages/sdk/openapi.json',
  );
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const operations: Array<{
    operationId: string;
    method: string;
    path: string;
  }> = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem[method];
      if (operation?.operationId) {
        operations.push({
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path,
        });
      }
    }
  }
  return operations.sort((left, right) =>
    left.operationId.localeCompare(right.operationId));
}

function materialize(path: string): string {
  return path.replace(/\{[^}]+\}/g, 'safe-segment');
}

function decodeBody(body: Uint8Array): unknown {
  return JSON.parse(Buffer.from(body).toString('utf8'));
}

const permissiveOwnershipRepository = {
  isResourceOwnedBy: () => true,
  claimResource: () => true,
  releaseResource: () => true,
};

describe('issue #1169 mobile OpenCode proxy contract', () => {
  it('issue-1169-c1: the generated manifest classifies every bundled OpenCode operation', async () => {
    const proxy = await loadProxyModule();
    expect(proxy, 'mobile_opencode_proxy.ts must exist').not.toBeNull();

    const actual = [...(proxy?.MOBILE_OPENCODE_OPERATION_MANIFEST ?? [])]
      .map(({ operationId, method, path }) => ({ operationId, method, path }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
    const expected = openApiOperations();

    // Regression caught: a new OpenCode endpoint can never become reachable
    // without being visibly regenerated and assigned an allow/deny decision.
    expect(actual).toEqual(expected);
    expect(new Set(actual.map((entry) => entry.operationId)).size)
      .toBe(actual.length);
    expect(
      (proxy?.MOBILE_OPENCODE_OPERATION_MANIFEST ?? [])
        .filter((entry) => entry.allowed).length,
    ).toBeGreaterThan(60);
  });

  it('issue-1174-c3: alternate-only SDK operations stay out of the generic gateway', async () => {
    const proxy = await loadProxyModule();
    expect(proxy).not.toBeNull();
    const manifest = proxy?.MOBILE_OPENCODE_OPERATION_MANIFEST ?? [];
    const alternateOnly = new Set([
      'config.providers',
      'mcp.auth.authenticate',
      'permission.respond',
      'session.get',
      'session.message',
      'session.prompt',
    ]);

    expect(
      manifest
        .filter((entry) => alternateOnly.has(entry.operationId))
        .map((entry) => ({
          operationId: entry.operationId,
          allowed: entry.allowed,
        }))
        .sort((left, right) => left.operationId.localeCompare(right.operationId)),
    ).toEqual(
      [...alternateOnly]
        .sort()
        .map((operationId) => ({
          operationId,
          allowed: false,
        })),
    );
  });

  it('issue-1169-c2: forwarding injects only the repository-owned directory and strips nested caller roots', async () => {
    const proxyModule = await loadProxyModule();
    expect(proxyModule, 'mobile_opencode_proxy.ts must exist').not.toBeNull();
    if (!proxyModule) return;

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const proxy = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify({ id: 'session-1169' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const projectRoot = '/sandbox/registered-project';

    const result = await proxy.forward({
      method: 'POST',
      path: '/session',
      query: new URLSearchParams({
        directory: '/attacker/query-root',
        root: '/attacker/root',
        keep: 'yes',
      }),
      body: {
        title: 'Issue 1169',
        cwd: '/attacker/body-root',
        nested: {
          workingDirectory: '/attacker/nested-root',
          workspaceID: 'attacker-workspace',
          keep: 'value',
        },
      },
      project: { id: 'project-1169', root: projectRoot },
      userId: 1,
    });

    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    const forwardedUrl = new URL(calls[0].url);
    expect(forwardedUrl.origin).toBe('http://127.0.0.1:4897');
    expect(forwardedUrl.pathname).toBe('/session');
    expect(forwardedUrl.searchParams.get('directory')).toBe(projectRoot);
    expect(forwardedUrl.searchParams.get('root')).toBeNull();
    expect(forwardedUrl.searchParams.get('keep')).toBe('yes');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      title: 'Issue 1169',
      nested: { keep: 'value' },
    });

    const boundary = mkdtempSync(join(tmpdir(), 'issue-1169-path-scope-'));
    const registeredRoot = join(boundary, 'registered');
    const outsideRoot = join(boundary, 'outside');
    mkdirSync(registeredRoot);
    mkdirSync(outsideRoot);
    writeFileSync(join(registeredRoot, 'inside.txt'), 'inside');
    writeFileSync(join(outsideRoot, 'secret.txt'), 'outside');
    symlinkSync(outsideRoot, join(registeredRoot, 'escape'));
    const fileCalls: string[] = [];
    const fileRequestBodies: Array<RequestInit['body']> = [];
    try {
      const fileProxy = new proxyModule.MobileOpenCodeProxy({
        baseUrl: 'http://127.0.0.1:4897',
        ownershipRepository: permissiveOwnershipRepository,
        fetchFn: async (
          input: string | URL | Request,
          init?: RequestInit,
        ) => {
          fileCalls.push(String(input));
          fileRequestBodies.push(init?.body);
          return new Response(JSON.stringify({ content: 'inside' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      await fileProxy.forward({
        method: 'GET',
        path: '/file/content',
        query: new URLSearchParams({ path: 'inside.txt' }),
        // Express initializes req.body to {} even for body-less GET requests.
        // Node fetch rejects a GET body, so the proxy must discard it.
        body: {},
        project: { id: 'project-1169', root: registeredRoot },
        userId: 1,
      });
      expect(new URL(fileCalls[0]).searchParams.get('path'))
        .toBe('inside.txt');
      expect(fileRequestBodies).toEqual([undefined]);
      await expect(fileProxy.forward({
        method: 'GET',
        path: '/file/content',
        query: new URLSearchParams({ path: '../outside/secret.txt' }),
        project: { id: 'project-1169', root: registeredRoot },
        userId: 1,
      })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      await expect(fileProxy.forward({
        method: 'GET',
        path: '/file/content',
        query: new URLSearchParams({ path: 'escape/secret.txt' }),
        project: { id: 'project-1169', root: registeredRoot },
        userId: 1,
      })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(fileCalls).toHaveLength(1);
    } finally {
      rmSync(boundary, { recursive: true, force: true });
    }
  });

  it('issue-1169-c3: bounded forwarding rejects oversized bodies and normalizes upstream errors', async () => {
    const proxyModule = await loadProxyModule();
    expect(proxyModule, 'mobile_opencode_proxy.ts must exist').not.toBeNull();
    if (!proxyModule) return;

    const requests: string[] = [];
    const requestBounded = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      requestBodyLimitBytes: 32,
      fetchFn: async (input: string | URL | Request) => {
        requests.push(String(input));
        return new Response('{}');
      },
    });
    await expect(requestBounded.forward({
      method: 'POST',
      path: '/session',
      query: new URLSearchParams(),
      body: { value: 'x'.repeat(128) },
      project: { id: 'project-1169', root: '/sandbox/project' },
      userId: 1,
    })).rejects.toMatchObject({
      statusCode: 413,
      code: 'REQUEST_TOO_LARGE',
    });
    expect(requests).toEqual([]);

    // Measure the caller's complete payload before sanitizing root overrides.
    // Otherwise a large stripped field could bypass the gateway's resource cap.
    await expect(requestBounded.forward({
      method: 'POST',
      path: '/session',
      query: new URLSearchParams(),
      body: { cwd: `/attacker/${'x'.repeat(128)}` },
      project: { id: 'project-1169', root: '/sandbox/project' },
      userId: 1,
    })).rejects.toMatchObject({
      statusCode: 413,
      code: 'REQUEST_TOO_LARGE',
    });
    expect(requests).toEqual([]);

    const responseBounded = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      responseBodyLimitBytes: 16,
      fetchFn: async () => new Response('x'.repeat(128), { status: 200 }),
    });
    await expect(responseBounded.forward({
      method: 'GET',
      path: '/global/health',
      query: new URLSearchParams(),
      project: { id: 'project-1169', root: '/sandbox/project' },
      userId: 1,
    })).rejects.toMatchObject({
      statusCode: 502,
      code: 'UPSTREAM_RESPONSE_TOO_LARGE',
    });

    const normalized = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: async () => new Response(
        JSON.stringify({
          error: 'raw engine failure',
          path: '/private/sandbox/project',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    const errorResult = await normalized.forward({
      method: 'GET',
      path: '/global/health',
      query: new URLSearchParams(),
      project: { id: 'project-1169', root: '/sandbox/project' },
      userId: 1,
    });
    expect(errorResult.status).toBe(502);
    expect(decodeBody(errorResult.body)).toEqual({
      error: {
        code: 'OPENCODE_UPSTREAM_ERROR',
        message: 'OpenCode request failed',
        upstreamStatus: 500,
      },
    });
    expect(Buffer.from(errorResult.body).toString('utf8'))
      .not.toContain('/private/sandbox/project');

    const responseTimed = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      timeoutMs: 25,
      fetchFn: async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'));
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const timeoutOutcome = await Promise.race([
      responseTimed.forward({
        method: 'GET',
        path: '/global/health',
        query: new URLSearchParams(),
        project: { id: 'project-1169', root: '/sandbox/project' },
        userId: 1,
      }).then(
        () => ({ state: 'resolved' as const }),
        (error: unknown) => ({ state: 'rejected' as const, error }),
      ),
      new Promise<{ state: 'hung' }>((resolve) => {
        setTimeout(() => resolve({ state: 'hung' }), 150);
      }),
    ]);
    expect(timeoutOutcome).toMatchObject({
      state: 'rejected',
      error: {
        statusCode: 502,
        code: 'OPENCODE_UNAVAILABLE',
      },
    });
  });

  it('bounds transcript pages before forwarding to protect the response budget', async () => {
    const proxyModule = await loadProxyModule();
    expect(proxyModule).not.toBeNull();
    if (!proxyModule) return;

    const requests: string[] = [];
    const proxy = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: async (input: string | URL | Request) => {
        requests.push(String(input));
        const url = new URL(String(input));
        return new Response(JSON.stringify(
          url.pathname === '/session'
            ? [{ id: 'ses-large', directory: '/sandbox/project' }]
            : [],
        ), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await proxy.forward({
      method: 'GET',
      path: '/session/ses-large/message',
      query: new URLSearchParams({ limit: '1000' }),
      project: { id: 'project-1169', root: '/sandbox/project' },
      userId: 1,
    });

    expect(requests).toHaveLength(2);
    const forwarded = new URL(requests[1]);
    expect(forwarded.searchParams.get('limit')).toBe('20');
    expect(forwarded.searchParams.get('directory')).toBe('/sandbox/project');
  });

  it('issue-1169-c5: every forbidden API family is explicitly classified as denied', async () => {
    const proxy = await loadProxyModule();
    expect(proxy, 'mobile_opencode_proxy.ts must exist').not.toBeNull();
    if (!proxy) return;

    const denied = [
      ['POST', '/global/upgrade', 'global.upgrade'],
      ['POST', '/global/dispose', 'global.dispose'],
      ['POST', '/instance/dispose', 'instance.dispose'],
      ['POST', '/tui/submit-prompt', 'tui.submitPrompt'],
      ['GET', '/api/session', 'v2.session.list'],
      ['POST', '/sync/start', 'sync.start'],
      ['GET', '/experimental/workspace', 'experimental.workspace.list'],
      ['GET', '/experimental/console', 'experimental.console.get'],
    ] as const;

    for (const [method, path, operationId] of denied) {
      const decision = proxy.matchMobileOpenCodeOperation(method, path);
      expect(decision, operationId).toMatchObject({
        operationId,
        allowed: false,
      });
      expect(decision?.reason, operationId).toBeTruthy();
    }
  });

  it('issue-1169-c6: every exposed manifest path and method round-trips through the matcher', async () => {
    const proxy = await loadProxyModule();
    expect(proxy, 'mobile_opencode_proxy.ts must exist').not.toBeNull();
    if (!proxy) return;

    for (const operation of proxy.MOBILE_OPENCODE_OPERATION_MANIFEST) {
      const matched = proxy.matchMobileOpenCodeOperation(
        operation.method,
        materialize(operation.path),
      );
      expect(matched?.operationId, `${operation.method} ${operation.path}`)
        .toBe(operation.operationId);
      expect(
        proxy.matchMobileOpenCodeOperation(
          operation.method === 'GET' ? 'POST' : 'GET',
          materialize(operation.path),
        )?.operationId,
        `wrong method for ${operation.operationId}`,
      ).not.toBe(operation.operationId);
    }

    for (const unsafePath of [
      '/session/%2e%2e',
      '/session/%2Fglobal%2Fhealth',
      '/session/safe%5Cunsafe',
      '/session/%00',
      `/session/${'x'.repeat(2_048)}`,
    ]) {
      expect(
        proxy.matchMobileOpenCodeOperation('GET', unsafePath),
        unsafePath,
      ).toBeNull();
    }
  });

  it('issue-1137-c9: prompt file parts are canonicalized or rejected before forwarding', async () => {
    const proxyModule = await loadProxyModule();
    expect(proxyModule, 'mobile_opencode_proxy.ts must exist').not.toBeNull();
    if (!proxyModule) return;

    const boundary = mkdtempSync(join(tmpdir(), 'issue-1137-mobile-files-'));
    const projectRoot = join(boundary, 'project');
    const outsideRoot = join(boundary, 'outside');
    mkdirSync(projectRoot);
    mkdirSync(outsideRoot);
    const inside = join(projectRoot, 'inside.txt');
    const outside = join(outsideRoot, 'secret.txt');
    writeFileSync(inside, 'inside');
    writeFileSync(outside, 'outside');
    symlinkSync(outsideRoot, join(projectRoot, 'escape'));
    const calls: Array<{ url: string; body: unknown }> = [];
    const proxy = new proxyModule.MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      preparePromptStream: async () => undefined,
      fetchFn: async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/session' && init?.method === 'GET') {
          return new Response(JSON.stringify([{
            id: 'safe',
            directory: projectRoot,
          }]), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const project = { id: 'project-1137', root: projectRoot };
    const forwardFile = (fileUrl: string) => proxy.forward({
      method: 'POST',
      path: '/session/safe/prompt_async',
      query: new URLSearchParams(),
      body: {
        parts: [
          { type: 'text', text: 'inspect this attachment' },
          {
            type: 'file',
            mime: 'application/octet-stream',
            filename: 'fixture.bin',
            url: fileUrl,
          },
        ],
      },
      project,
      userId: 1,
    });

    try {
      for (const rejectedUrl of [
        pathToFileURL('/etc/passwd').href,
        pathToFileURL(outside).href,
        pathToFileURL(join(projectRoot, 'escape', 'secret.txt')).href,
        'file://remote-host/etc/passwd',
        'http://127.0.0.1/private/local-file',
        'data:text/plain;base64,%%%%',
        'data:text/plain,%FF',
        'not-a-url',
      ]) {
        await expect(forwardFile(rejectedUrl))
          .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      }
      expect(calls).toEqual([]);

      await forwardFile(pathToFileURL(inside).href);
      await forwardFile('data:application/octet-stream;base64,AP9SSFlUSE0=');

      expect(calls).toHaveLength(2);
      expect(calls[0].body).toMatchObject({
        parts: [
          { type: 'text' },
          { type: 'file', url: pathToFileURL(realpathSync(inside)).href },
        ],
      });
      expect(calls[1].body).toMatchObject({
        parts: [
          { type: 'text' },
          {
            type: 'file',
            url: 'data:application/octet-stream;base64,AP9SSFlUSE0=',
          },
        ],
      });
    } finally {
      rmSync(boundary, { recursive: true, force: true });
    }
  });
});

describe('issue #1169 mobile OpenCode proxy HTTP boundary', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let boundary: string;
  let projectRoot: string;
  let projectId: string;
  let userToken: string;
  let deviceToken: string;
  let humanCapabilityHeader: Record<string, string>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    boundary = mkdtempSync(join(tmpdir(), 'issue-1169-http-'));
    projectRoot = join(boundary, 'project');
    mkdirSync(projectRoot);
    projectId = new ProjectsRepository().insert({
      name: 'Issue 1169',
      cwd: projectRoot,
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
    const user = new UsersRepository().create({
      name: 'Issue 1169',
      email: 'issue-1169@example.com',
    });
    userToken = new SessionsRepository().create(user.id).token;
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));

    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
        ...humanCapabilityHeader,
      },
      body: '{}',
    });
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        hostId: code.hostId,
        deviceName: 'Issue 1169 iPhone',
      }),
    });
    deviceToken = ((await pairResponse.json()) as { deviceToken: string })
      .deviceToken;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeServer();
    db.close();
    rmSync(boundary, { recursive: true, force: true });
  });

  function proxyHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Device ${deviceToken}`,
      'Content-Type': 'application/json',
      'X-Rhythm-Project-ID': projectId,
      ...extra,
    };
  }

  it('issue-1169-c4: compatibility reports versions fingerprint feature IDs and the minimum mobile version', async () => {
    const response = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${deviceToken}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      gatewayVersion: expect.stringMatching(/^\d+$/),
      rhythmVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      opencodeVersion: '1.14.49',
      contractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      features: expect.arrayContaining([
        'pairing',
        'device-revocation',
        'project-scope',
        'opencode-http-proxy',
      ]),
      minimumMobileVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
  });

  it('issue-1169-c7: HTTP rejects forbidden operations and caller root overrides before forwarding', async () => {
    const unauthenticated = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/health?directory=%2Fattacker`,
      {
        headers: {
          'X-Rhythm-Project-ID': 'unknown-project',
        },
      },
    );
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });

    const upgrade = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/upgrade`,
      {
        method: 'POST',
        headers: proxyHeaders(),
        body: JSON.stringify({ path: '/operation-owned-path' }),
      },
    );
    expect(upgrade.status).toBe(403);
    expect(await upgrade.json()).toEqual({
      error: {
        code: 'OPERATION_NOT_ALLOWED',
        message: 'OpenCode operation is not allowed for mobile',
      },
    });

    const queryOverride = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/health?directory=%2Fattacker`,
      { headers: proxyHeaders() },
    );
    const workspaceOverride = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/health?workspace=%2Fattacker`,
      { headers: proxyHeaders() },
    );
    const headerOverride = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/health`,
      { headers: proxyHeaders({ 'X-Rhythm-Root': '/attacker' }) },
    );
    expect([
      queryOverride.status,
      workspaceOverride.status,
      headerOverride.status,
    ]).toEqual([403, 403, 403]);
  });

  it('issue-1137-c8: mobile gateway cannot route desktop-local file content or expose resolvedPath', async () => {
    const response = await fetch(
      `${baseUrl}/mobile-gateway/agent-sessions/private/files/content?path=secret.txt`,
      { headers: proxyHeaders() },
    );
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain('resolvedPath');
    expect(body).not.toContain(boundary);
  });

  it('issue-1137-c9: HTTP rejects an outside prompt file before the engine boundary', async () => {
    const outside = join(boundary, 'outside.txt');
    writeFileSync(outside, 'outside');
    expect(outside.startsWith(projectRoot)).toBe(false);

    const response = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session/issue-1137/prompt_async`,
      {
        method: 'POST',
        headers: proxyHeaders(),
        body: JSON.stringify({
          parts: [
            { type: 'text', text: 'inspect this attachment' },
            {
              type: 'file',
              mime: 'text/plain',
              filename: 'outside.txt',
              url: pathToFileURL(outside).href,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Project path is outside the selected project',
      },
    });
  });

  it('issue-1169-c9: rejected proxy requests never log device tokens query values or bodies', async () => {
    const errorSpy = vi.spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn')
      .mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'info')
      .mockImplementation(() => undefined);
    const sensitiveQuery = 'DO_NOT_LOG_QUERY_1169';
    const sensitiveBody = 'DO_NOT_LOG_BODY_1169';
    const response = await fetch(
      `${baseUrl}/mobile-gateway/opencode/global/upgrade?root=${sensitiveQuery}`,
      {
        method: 'POST',
        headers: proxyHeaders(),
        body: JSON.stringify({ prompt: sensitiveBody }),
      },
    );
    expect(response.status).toBe(403);

    const malformedQuery = 'DO_NOT_LOG_MALFORMED_QUERY_1169';
    const malformedBody = 'DO_NOT_LOG_MALFORMED_BODY_1169';
    const malformed = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session?search=${malformedQuery}`,
      {
        method: 'POST',
        headers: proxyHeaders(),
        body: `{"prompt":"${malformedBody}`,
      },
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON request body',
      },
    });

    const oversizedMarker = 'DO_NOT_LOG_OVERSIZED_BODY_1169';
    const oversized = await fetch(
      `${baseUrl}/mobile-gateway/opencode/session`,
      {
        method: 'POST',
        headers: proxyHeaders(),
        body: JSON.stringify({
          prompt: `${oversizedMarker}${'x'.repeat(1024 * 1024)}`,
        }),
      },
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'Request body is too large',
      },
    });

    const logged = JSON.stringify([
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]);
    expect(logged).not.toContain(deviceToken);
    expect(logged).not.toContain(sensitiveQuery);
    expect(logged).not.toContain(sensitiveBody);
    expect(logged).not.toContain(malformedQuery);
    expect(logged).not.toContain(malformedBody);
    expect(logged).not.toContain(oversizedMarker);
  });
});
