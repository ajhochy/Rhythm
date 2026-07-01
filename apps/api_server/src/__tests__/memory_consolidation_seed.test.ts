/**
 * CONTRACT TESTS — Issue #806 (memory epic #801): the seeded "Memory
 * Consolidation" task must reference only MCP tools that exist, stay
 * idempotent, and the facts it writes must land in the VAULT (via the #803
 * write path) + the derived local index — never prod.
 *
 * Real in-memory SQLite + real repositories + real vault write path + a real FS
 * temp dir. No module mocks. The memory dir is a per-test temp dir — NEVER the
 * real ~/Documents/Memory-Vault.
 *
 * Acceptance criteria proven here:
 *   AC3: seedConsolidationTask() is idempotent (no-ops when a "Memory
 *        Consolidation" task already exists) and its prompt names ONLY existing
 *        MCP tools (rhythm_list_sessions, rhythm_search_memory,
 *        rhythm_remember_memory) — no reference to a non-existent tool.
 *   AC4: a simulated consolidation run that calls remember() produces vault
 *        notes (markdown files) + derived index rows — not prod rows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { agentMemoryService } from '../services/agentMemoryService';

/**
 * The complete set of MCP tools that actually exist for the memory/consolidation
 * flow. The seed prompt must not name any tool outside this set.
 *
 * Tools the consolidation prompt is allowed to reference:
 *   - rhythm_list_sessions   (#806, apps/mcp_server/src/tools/agentSessions.ts)
 *   - rhythm_remember_memory (#804, apps/mcp_server/src/tools/agentMemory.ts)
 *   - rhythm_search_memory   (#804, apps/mcp_server/src/tools/agentMemory.ts)
 *   - rhythm_list_memories   (#804, apps/mcp_server/src/tools/agentMemory.ts)
 *   - rhythm_forget_memory   (#804, apps/mcp_server/src/tools/agentMemory.ts)
 */
const EXISTING_MEMORY_TOOLS = [
  'rhythm_list_sessions',
  'rhythm_remember_memory',
  'rhythm_search_memory',
  'rhythm_list_memories',
  'rhythm_forget_memory',
];

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let memoryDir: string;

beforeEach(() => {
  setDb(makeDb());
  const root = mkdtempSync(path.join(tmpdir(), 'memconsol-test-'));
  memoryDir = path.join(root, 'memory');
});

afterEach(() => {
  try {
    rmSync(path.dirname(memoryDir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('memory consolidation seed (#806)', () => {
  it('AC3: seeds exactly one "Memory Consolidation" task', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedConsolidationTask();
    const tasks = await repo.listAllAsync();
    const seeded = tasks.filter((t) => t.name === 'Memory Consolidation');
    expect(seeded).toHaveLength(1);
    expect(seeded[0].scheduleType).toBe('daily');
  });

  it('AC3: seedConsolidationTask is idempotent — a second call adds no duplicate', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedConsolidationTask();
    await agentMemoryService.seedConsolidationTask();
    await agentMemoryService.seedConsolidationTask();
    const tasks = await repo.listAllAsync();
    expect(tasks.filter((t) => t.name === 'Memory Consolidation')).toHaveLength(1);
  });

  it('AC3: the seeded prompt references rhythm_list_sessions (the #806 tool)', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedConsolidationTask();
    const task = (await repo.listAllAsync()).find((t) => t.name === 'Memory Consolidation')!;
    expect(task.prompt).toContain('rhythm_list_sessions');
    // The fact-writing + dedup tools it also names must be real ones.
    expect(task.prompt).toContain('rhythm_remember_memory');
    expect(task.prompt).toContain('rhythm_search_memory');
  });

  it('AC3: the seeded prompt names ONLY MCP tools that exist (no dangling rhythm_* tool)', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedConsolidationTask();
    const task = (await repo.listAllAsync()).find((t) => t.name === 'Memory Consolidation')!;

    // Every `rhythm_*` identifier mentioned in the prompt must be a real tool.
    // This is the guard against re-introducing a reference to a tool that was
    // never implemented (the #806 bug).
    const mentioned = new Set(task.prompt.match(/rhythm_[a-z_]+/g) ?? []);
    expect(mentioned.size).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(EXISTING_MEMORY_TOOLS).toContain(tool);
    }
  });
});

describe('simulated consolidation run writes to the vault, not prod (#806 AC4)', () => {
  it('AC4: remember() during consolidation creates vault notes + index rows', async () => {
    const repo = new AgentMemoryRepository();
    const index = new MemoryIndexService(repo);

    // Simulate the consolidation agent distilling two durable facts and calling
    // the same write path the rhythm_remember_memory tool drives.
    const distilled = [
      { kind: 'fact' as const, content: 'Sunday service starts at 9am.' },
      { kind: 'preference' as const, content: 'Pastor prefers email over Slack for approvals.' },
    ];
    for (const item of distilled) {
      await rememberToVault(item, { memoryDir, index });
    }

    // Vault notes exist on disk (the source of truth).
    const noteFiles: string[] = [];
    function walk(dir: string) {
      if (!existsSync(dir)) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith('.md')) noteFiles.push(full);
      }
    }
    walk(memoryDir);
    expect(noteFiles).toHaveLength(2);

    // Derived local index rows exist and are searchable (not prod).
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'obsidian-memory')).toBe(true);

    const hits = await repo.searchAsync('service', undefined, 20);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.content.includes('9am'))).toBe(true);
  });
});
