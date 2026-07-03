/**
 * CONTRACT TESTS — Issue #860: disable the standalone `memory` knowledge-graph
 * MCP from the generated opencode.json path.
 *
 * Rhythm's memory system is now single-source-of-truth: the Obsidian
 * AGENT-MEMORY vault (see docs/ai/decisions/2026-07-02-agent-memory-in-obsidian-vault.md).
 * A second, standalone `memory` MCP server (@modelcontextprotocol/server-memory,
 * writing to ~/Documents/Claude-Memory/memory.jsonl) may already be registered
 * in the user's global ~/.config/opencode/opencode.json (installed independently
 * of Rhythm, e.g. via Claude Desktop/Code config). Agents reading opencode.json
 * with an unscoped MCP allowlist (allowed_mcps_json === null) would otherwise
 * see it as an available server, creating a split-brain memory store.
 *
 * `disableStandaloneMemoryMcp` idempotently sets `mcp.memory.enabled = false`
 * in opencode.json WITHOUT deleting the entry (preserving the user's existing
 * config + any data path they set) — mirrors the read-modify-write shape of
 * `ensureRhythmMcp`.
 *
 * Acceptance criteria proven here:
 *   AC1: an existing `mcp.memory` entry with `enabled` unset/true is rewritten
 *        to `enabled: false`; every other field on the entry is preserved.
 *   AC2: no-op (changed: false) when `mcp.memory.enabled` is already false.
 *   AC3: no-op (changed: false, nothing written) when there is no `mcp.memory`
 *        entry at all — this must never CREATE a memory server entry.
 *   AC4: other mcp servers in the config are left untouched.
 *   AC5: a missing config file is a safe no-op (changed: false), never throws.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { OpencodeClientService } from '../services/opencode_client_service';

describe('disableStandaloneMemoryMcp (#860)', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencode-cfg-memdisable-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('AC1: rewrites an existing enabled memory entry to enabled:false, preserving other fields', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          memory: {
            type: 'local',
            command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
            environment: { MEMORY_FILE_PATH: '/Users/x/Documents/Claude-Memory/memory.jsonl' },
            enabled: true,
          },
        },
      }),
      'utf8',
    );

    const result = await svc.disableStandaloneMemoryMcp({ configPath });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.memory.enabled).toBe(false);
    expect(parsed.mcp.memory.command).toEqual(['npx', '-y', '@modelcontextprotocol/server-memory']);
    expect(parsed.mcp.memory.environment.MEMORY_FILE_PATH).toBe(
      '/Users/x/Documents/Claude-Memory/memory.jsonl',
    );
  });

  it('AC1b: rewrites when `enabled` is unset (defaults to enabled)', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { memory: { type: 'local', command: ['npx', '-y', 'x'] } } }),
      'utf8',
    );
    const result = await svc.disableStandaloneMemoryMcp({ configPath });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.memory.enabled).toBe(false);
  });

  it('AC2: no-op when memory is already disabled', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcp: { memory: { type: 'local', command: ['x'], enabled: false } } }),
      'utf8',
    );
    const result = await svc.disableStandaloneMemoryMcp({ configPath });
    expect(result.changed).toBe(false);
  });

  it('AC3: no-op and writes nothing when there is no memory entry at all', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    const original = JSON.stringify({ mcp: { rhythm: { type: 'local', command: ['x'] } } });
    writeFileSync(configPath, original, 'utf8');

    const result = await svc.disableStandaloneMemoryMcp({ configPath });
    expect(result.changed).toBe(false);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.memory).toBeUndefined();
    expect(parsed.mcp.rhythm).toBeTruthy();
  });

  it('AC4: other mcp servers are left untouched when disabling memory', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          rhythm: { type: 'local', command: ['rhythm-mcp'] },
          memory: { type: 'local', command: ['x'], enabled: true },
        },
      }),
      'utf8',
    );
    await svc.disableStandaloneMemoryMcp({ configPath });
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp.rhythm).toEqual({ type: 'local', command: ['rhythm-mcp'] });
    expect(parsed.mcp.memory.enabled).toBe(false);
  });

  it('AC5: a missing config file is a safe no-op, never throws', async () => {
    expect(existsSync(configPath)).toBe(false);
    const result = await svc.disableStandaloneMemoryMcp({ configPath });
    expect(result.changed).toBe(false);
    // Must not CREATE a config file just to disable a server that was never there.
    expect(existsSync(configPath)).toBe(false);
  });
});
