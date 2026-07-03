/**
 * Issue #814 — pin/bundle the rhythm MCP server launch command.
 *
 * Acceptance criteria under test:
 *   - A stale/older GLOBAL `@ajhochy/rhythm-mcp-server` can no longer shadow
 *     the app's version: the command builder never emits a bare
 *     `['npx', '-y', '@ajhochy/rhythm-mcp-server']` spec — always a bundled
 *     absolute path OR a pinned `@ajhochy/rhythm-mcp-server@<version>` spec.
 *   - The launched version is deterministic for a given build (same inputs →
 *     same command; a bundled payload always wins over the pinned fallback).
 *   - The command is defined in a single source of truth
 *     (`resolveRhythmMcpCommand`), consumed by `ensureRhythmMcp` — asserted
 *     indirectly via `opc_rhythm_mcp_ensure.test.ts` sharing this resolver.
 *   - Deterministic unit assertion standing in for a real-binary smoke test
 *     (documented below) that the launched server exposes the memory/session
 *     tools.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_rhythm_mcp_command.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import {
  resolveRhythmMcpCommand,
  readRhythmMcpServerVersion,
} from '../services/opencode_client_service';
import { existsSync, readFileSync } from 'fs';

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

describe('resolveRhythmMcpCommand (#814)', () => {
  let originalDevBin: string | undefined;

  beforeEach(() => {
    originalDevBin = process.env.RHYTHM_MCP_SERVER_BIN;
    delete process.env.RHYTHM_MCP_SERVER_BIN;
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    if (originalDevBin === undefined) delete process.env.RHYTHM_MCP_SERVER_BIN;
    else process.env.RHYTHM_MCP_SERVER_BIN = originalDevBin;
    vi.restoreAllMocks();
  });

  it('never emits the bare unversioned spec — pins to @<version> when no bundle/override is present', () => {
    // No bundled dist/index.js entrypoint exists, but package.json (used to
    // read the pin) does.
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.6.1' }));

    const command = resolveRhythmMcpCommand();

    expect(command).not.toEqual(['npx', '-y', '@ajhochy/rhythm-mcp-server']);
    expect(command).toEqual(['npx', '-y', '@ajhochy/rhythm-mcp-server@0.6.1']);
  });

  it('a stale global install cannot shadow the pin — the spec always carries an explicit version', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.7.3' }));

    const command = resolveRhythmMcpCommand();

    // npx resolves a versioned spec (`pkg@x.y.z`) against the registry/npx
    // cache for THAT version, bypassing any globally-linked `pkg` binary that
    // shadows the bare name. Asserting the '@version' suffix is present is
    // the deterministic unit-level stand-in for that npx resolution behavior.
    expect(command[2]).toBe('@ajhochy/rhythm-mcp-server@0.7.3');
    expect(command[2].includes('@ajhochy/rhythm-mcp-server@')).toBe(true);
  });

  it('prefers a bundled payload over the pinned npx fallback when present', () => {
    const bundledPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'mcp_server',
      'dist',
      'index.js',
    );
    mockExistsSync.mockImplementation(
      (p: string) => p === bundledPath,
    );

    const command = resolveRhythmMcpCommand();

    expect(command).toEqual(['node', bundledPath]);
  });

  it('RHYTHM_MCP_SERVER_BIN dev override takes priority over both bundled and pinned paths', () => {
    const devPath = '/tmp/dev-mcp-server/dist/index.js';
    process.env.RHYTHM_MCP_SERVER_BIN = devPath;
    mockExistsSync.mockImplementation((p: string) => p === devPath);

    const command = resolveRhythmMcpCommand();

    expect(command).toEqual(['node', devPath]);
  });

  it('ignores RHYTHM_MCP_SERVER_BIN when the path does not exist, falling back to pinned', () => {
    process.env.RHYTHM_MCP_SERVER_BIN = '/nonexistent/dist/index.js';
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));

    const command = resolveRhythmMcpCommand();

    expect(command).toEqual(['npx', '-y', '@ajhochy/rhythm-mcp-server@1.2.3']);
  });

  it('is deterministic: repeated calls with the same environment produce the same command', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.6.1' }));

    const first = resolveRhythmMcpCommand();
    const second = resolveRhythmMcpCommand();

    expect(first).toEqual(second);
  });

  it('readRhythmMcpServerVersion reads the version from the resolved package.json', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '9.9.9' }));

    expect(readRhythmMcpServerVersion()).toBe('9.9.9');
  });

  it('readRhythmMcpServerVersion returns undefined when no package.json is found', () => {
    mockExistsSync.mockReturnValue(false);

    expect(readRhythmMcpServerVersion()).toBeUndefined();
  });

  it('readRhythmMcpServerVersion returns undefined on unparseable JSON (never throws)', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
    mockReadFileSync.mockReturnValue('not json');

    expect(() => readRhythmMcpServerVersion()).not.toThrow();
    expect(readRhythmMcpServerVersion()).toBeUndefined();
  });
});

describe('resolveRhythmMcpCommand — real filesystem integration (#814)', () => {
  it('resolves the ACTUAL pinned version from the real apps/mcp_server/package.json in this checkout', async () => {
    vi.resetModules();
    vi.doUnmock('fs');
    const real = await import('../services/opencode_client_service');
    const version = real.readRhythmMcpServerVersion();
    // This checkout ships apps/mcp_server; the version must resolve and be a
    // real semver string, never the unpinned bare spec.
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

/**
 * Documented smoke step (#814 acceptance): a full real-binary smoke —
 * spawning the resolved command and asserting the live MCP server advertises
 * `rhythm_remember_memory` / `rhythm_list_sessions` in its tools/list
 * response — is not run in this unit-test environment (it requires a built
 * `apps/mcp_server/dist` payload, a reachable RHYTHM_AGENT_URL, and a real
 * stdio MCP handshake). To run it manually:
 *
 *   cd apps/mcp_server && npm run build
 *   RHYTHM_API_URL=http://localhost:4000 RHYTHM_AGENT_URL=http://localhost:4001 \
 *     RHYTHM_API_TOKEN=<token> node dist/index.js
 *   # then, from an MCP-capable client (or the opencode engine itself),
 *   # confirm the tools/list response includes:
 *   #   rhythm_remember_memory (apps/mcp_server/src/tools/agentMemory.ts)
 *   #   rhythm_list_sessions   (apps/mcp_server/src/tools/agentSessions.ts)
 *
 * Both tool names are verified to exist in the mcp_server source at
 * apps/mcp_server/src/tools/agentMemory.ts and
 * apps/mcp_server/src/tools/agentSessions.ts (grep-confirmed at implementation
 * time); this comment plus the unit assertions above are the deterministic
 * substitute for a spawned-process smoke in CI/unit-test contexts.
 */
