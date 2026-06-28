/**
 * Issue #723 — CONTRACT TEST (must fail before implementation).
 *
 * MCP section: Remove (trash) deletes from config but the row persists until
 * engine restart. Root cause: the running opencode engine's `mcp.status()`
 * keeps reporting a removed server (as `disabled`) from its in-memory state
 * until the process restarts. So `listMcp()` / `GET /opencode/mcp` still
 * includes it and the UI re-renders the stale row.
 *
 * Chosen fix layer (app-layer, lowest risk): OpencodeClientService maintains a
 * "removed pending restart" set. `removeMcp(name)` records the name;
 * `listMcp()` filters those names out of the engine status map (config is the
 * source of truth for presence). A subsequent re-add (`addMcp` and the
 * ensure* persistence paths) clears the name so the server reappears.
 *
 * These tests drive the REAL OpencodeClientService methods against a faked SDK
 * client boundary + faked fs (the only things outside the unit under test).
 * They must NOT mock listMcp/removeMcp/addMcp themselves — that would be a
 * false green (C3).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/issue_723_mcp_remove_reconcile.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fake the fs boundary so removeMcp/addMcp never touch the real
// ~/.config/opencode/opencode.json. We keep an in-memory "file" so addMcp's
// read-modify-write round-trips like the real thing.
const fakeFsState: { content: string | null } = { content: null };

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      // The opencode.json config "exists" only when we've written content.
      if (typeof p === 'string' && p.endsWith('opencode.json')) {
        return fakeFsState.content !== null;
      }
      return false;
    }),
    readFileSync: vi.fn((p: string, ...rest: unknown[]) => {
      if (typeof p === 'string' && p.endsWith('opencode.json')) {
        return fakeFsState.content ?? '{}';
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(
        p,
        ...rest,
      );
    }),
    writeFileSync: vi.fn((p: string, data: string) => {
      if (typeof p === 'string' && p.endsWith('opencode.json')) {
        fakeFsState.content = data;
        return;
      }
    }),
    mkdirSync: vi.fn(() => undefined),
  };
});

import { OpencodeClientService } from '../services/opencode_client_service';

type McpStatus = Record<string, { status: string; error?: string }>;

/**
 * Build a service with a faked SDK client whose `mcp.status()` returns the
 * provided (stale) status map. The engine ALWAYS reports `foo` here — exactly
 * the in-memory staleness the issue describes — so the reconciliation must be
 * what drops it, not a convenient absence from the fake.
 */
function makeService(engineStatus: McpStatus): OpencodeClientService {
  const svc = new OpencodeClientService();
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = {
    mcp: {
      status: vi.fn().mockResolvedValue({ data: engineStatus }),
      add: vi.fn().mockResolvedValue({ data: engineStatus }),
      disconnect: vi.fn().mockResolvedValue({ data: true }),
      connect: vi.fn().mockResolvedValue({ data: true }),
    },
  };
  return svc;
}

describe('issue-723: MCP remove reconciles against stale engine status', () => {
  beforeEach(() => {
    // Start each test with a persisted config that DOES contain `foo`, so
    // removeMcp performs a real (faked) config write removing it.
    fakeFsState.content = JSON.stringify({
      mcp: {
        foo: { type: 'local', command: ['npx', 'foo-mcp'] },
        bar: { type: 'local', command: ['npx', 'bar-mcp'] },
      },
    });
    vi.clearAllMocks();
  });

  // c1 — after removeMcp('foo'), listMcp() must NOT include 'foo' even though
  // the engine status map still reports it (stale in-memory state).
  // Regression caught: reconciliation absent → removed row persists until
  // engine restart (the bug). The `expect(...).not.toContain('foo')` fails.
  it('issue-723-c1: removed server disappears from listMcp without engine restart', async () => {
    // Engine keeps reporting foo (and bar) — simulating the in-memory staleness.
    const svc = makeService({
      foo: { status: 'disabled' },
      bar: { status: 'connected' },
    });

    // Sanity: before removal, foo is present.
    const before = await svc.listMcp();
    expect(Object.keys(before)).toContain('foo');

    await svc.removeMcp('foo');

    const after = await svc.listMcp();
    expect(Object.keys(after)).not.toContain('foo');
    // bar must remain — reconciliation must only drop the removed server.
    expect(Object.keys(after)).toContain('bar');
  });

  // c3 — re-adding a previously-removed server makes it reappear in listMcp().
  // Regression caught: removed-set never cleared on re-add → re-add invisible
  // until restart. The `expect(...).toContain('foo')` fails.
  it('issue-723-c3: re-adding a removed server makes it reappear in listMcp', async () => {
    const svc = makeService({
      foo: { status: 'disabled' },
      bar: { status: 'connected' },
    });

    await svc.removeMcp('foo');
    expect(Object.keys(await svc.listMcp())).not.toContain('foo');

    // Re-add foo (the engine status map still reports it).
    await svc.addMcp('foo', { type: 'local', command: ['npx', 'foo-mcp'] });

    const after = await svc.listMcp();
    expect(Object.keys(after)).toContain('foo');
  });
});
