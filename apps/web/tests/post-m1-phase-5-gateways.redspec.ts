import { expect, test } from '@playwright/test';
import { createLiveGateway } from '../src/gateway';

type MethodMap = Record<string, (...args: never[]) => unknown>;

function liveDomains(): Record<string, unknown> {
  const neverFetch = (async () => { throw new Error('not invoked by method-presence contract'); }) as typeof fetch;
  return createLiveGateway({
    apiBase: 'http://127.0.0.1:4098',
    engineBase: 'http://127.0.0.1:4097',
    productionApiBase: 'https://api.vcrcapps.com',
    taskToken: 'phase-5-contract-token',
  }, neverFetch).domains as Record<string, unknown>;
}

function expectMethods(domain: unknown, name: string, methods: string[]): asserts domain is MethodMap {
  expect(domain, `${name} must be a live gateway domain`).toBeDefined();
  if (!domain) return;
  for (const method of methods) expect(typeof (domain as MethodMap)[method], `${name}.${method} must cross the live boundary`).toBe('function');
}

test('post-m1-p5-c1b: permission gateway owns pending/reply and bounded retry behavior', () => {
  // Regression caught: SessionGateway has no permission methods, so a fixture card can never
  // address local sessionId + permissionID or retry a failed canonical reply.
  expectMethods(liveDomains().permissions, 'permissions', ['pending', 'reply']);
});

test('post-m1-p5-c2a: approval gateway lists pending rows and submits signed decisions', () => {
  // Regression caught: the renderer has no approval domain, so it cannot carry a human-only
  // capability or a signature bound to the canonical approval decision fields.
  expectMethods(liveDomains().approvals, 'approvals', ['listPending', 'decide']);
});

test('post-m1-p5-c2c: delegation gateway preserves scoped parent/child identity and status', () => {
  // Regression caught: React has no delegation/status methods and therefore cannot preserve
  // trusted caller/target identity at the live boundary.
  expectMethods(liveDomains().delegation, 'delegation', ['delegate', 'delegateAsync', 'status', 'cancel']);
});

test('post-m1-p5-c2e: delegation status is a bounded metadata-only live boundary', () => {
  // Regression caught: React has no status/cancel boundary and therefore cannot enforce a
  // metadata-only response or non-disclosing authorization failure in its live journey.
  expectMethods(liveDomains().delegation, 'delegation', ['status', 'cancel']);
});

test('post-m1-p5-c3a: MCP gateway exposes the canonical live catalog', () => {
  // Regression caught: ToolWorkspace substitutes seeded component state for /opencode/mcp.
  expectMethods(liveDomains().mcp, 'mcp', ['list']);
});

test('post-m1-p5-c3b: MCP gateway exposes the complete credential/OAuth/lifecycle surface', () => {
  // Regression caught: no React method can add, authenticate, connect, disconnect, or remove a server.
  expectMethods(liveDomains().mcp, 'mcp', ['add', 'setCredentials', 'startOAuth', 'oauthStatus', 'connect', 'disconnect', 'remove']);
});

test('post-m1-p5-c3c: skill gateway exposes metadata, content, reload, and managed CRUD', () => {
  // Regression caught: seeded skills have no live version metadata and local mutations never reload the engine.
  expectMethods(liveDomains().skills, 'skills', ['list', 'content', 'reload', 'create', 'update', 'remove']);
});

test('post-m1-p5-c3f: session tool surface supports scoped deferred MCP dispatch', () => {
  // Regression caught: React cannot inspect the scoped tool surface or invoke the bounded deferred dispatcher,
  // leaving the backend allowlist capability unreachable from the client journey.
  expectMethods(liveDomains().sessions, 'sessions', ['toolSurface', 'dispatchMcp']);
});
