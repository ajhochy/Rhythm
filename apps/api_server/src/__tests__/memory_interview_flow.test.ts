/**
 * CONTRACT TESTS — Issue #859c: memory-interview flow.
 *
 * A supported way to bootstrap/refresh agent memory by INTERVIEW — a
 * conversational pass that asks the user targeted questions and distills the
 * answers into a clean, deduplicated set of canonical memories (one per
 * theme), NOT raw restatements of every sentence the user said. Mirrors the
 * "Memory Consolidation" scheduled-task seed pattern
 * (`agentMemoryService.seedConsolidationTask`), but the prompt drives an
 * INTERVIEW rather than a passive session scan, and explicitly instructs the
 * agent to search-before-writing and rely on merge-on-capture so repeated or
 * restated answers land on ONE canonical note per theme.
 *
 * Acceptance criteria proven here:
 *   AC1: seedMemoryInterviewTask() seeds exactly one "Memory Interview" task
 *        (idempotent — a second call adds no duplicate).
 *   AC2: the seeded prompt names ONLY existing rhythm_* memory tools (no
 *        dangling tool reference).
 *   AC3: the prompt explicitly instructs (a) asking targeted questions per
 *        theme/kind, (b) searching for an existing memory before writing, and
 *        (c) producing ONE canonical memory per theme rather than one per
 *        raw sentence — i.e. it encodes the "distinct canonical set, not raw
 *        restatements" framing from the issue.
 *   AC4: running a simulated interview (several answers on the SAME theme)
 *        through the real vault-first write path converges on one canonical
 *        note per theme (proves the flow rides on merge-on-capture from
 *        #859a, not a separate ad-hoc dedup).
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
  const root = mkdtempSync(path.join(tmpdir(), 'meminterview-test-'));
  memoryDir = path.join(root, 'memory');
});

afterEach(() => {
  try {
    rmSync(path.dirname(memoryDir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('memory interview task seed (#859c)', () => {
  it('AC1: seeds exactly one "Memory Interview" task, idempotently', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedMemoryInterviewTask();
    await agentMemoryService.seedMemoryInterviewTask();
    const tasks = await repo.listAllAsync();
    const seeded = tasks.filter((t) => t.name === 'Memory Interview');
    expect(seeded).toHaveLength(1);
  });

  it('AC2: the seeded prompt names ONLY MCP tools that exist', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedMemoryInterviewTask();
    const task = (await repo.listAllAsync()).find((t) => t.name === 'Memory Interview')!;
    const mentioned = new Set(task.prompt.match(/rhythm_[a-z_]+/g) ?? []);
    expect(mentioned.size).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(EXISTING_MEMORY_TOOLS).toContain(tool);
    }
  });

  it('AC3: the prompt instructs search-before-write and one-canonical-memory-per-theme', async () => {
    const repo = new AgentScheduledTasksRepository();
    await agentMemoryService.seedMemoryInterviewTask();
    const task = (await repo.listAllAsync()).find((t) => t.name === 'Memory Interview')!;

    expect(task.prompt).toContain('rhythm_search_memory');
    expect(task.prompt).toContain('rhythm_remember_memory');
    expect(task.prompt.toLowerCase()).toContain('one canonical');
    expect(task.prompt.toLowerCase()).toMatch(/theme|topic/);
    // The prompt must instruct AGAINST raw-restatement (the anti-pattern this
    // issue exists to prevent), but must not itself be a transcript dump —
    // i.e. it should read as instructional prose, not a giant verbatim block.
    expect(task.prompt.toLowerCase()).toMatch(/never restate every|not restate every|not.*verbatim|never.*verbatim/);
    expect(task.prompt.length).toBeLessThan(3000);
  });
});

describe('simulated interview answers converge via merge-on-capture (#859c AC4)', () => {
  it('multiple answers on the same theme land on ONE canonical note', async () => {
    const repo = new AgentMemoryRepository();
    const index = new MemoryIndexService(repo);

    // Simulated interview: the user is asked about their dev preferences
    // across a few follow-up questions; each answer restates/extends the
    // same theme rather than introducing a new one.
    const answers = [
      { kind: 'preference' as const, content: 'AJ prefers the Sonnet model for coding agents to save tokens.' },
      { kind: 'preference' as const, content: 'AJ prefers using the Sonnet model for code agents, especially for cost-sensitive tasks.' },
      { kind: 'preference' as const, content: 'AJ wants agents to run autonomously with rollback, never asking for routine confirmations.' },
    ];
    const results = [];
    for (const a of answers) {
      results.push(await rememberToVault(a, { memoryDir, index }));
    }

    // The first two answers (same theme: model choice) converge on one note;
    // the third (a distinct theme: operating mode) stays separate.
    expect(results[1].id).toBe(results[0].id);
    expect(results[2].id).not.toBe(results[0].id);

    const noteFiles: string[] = [];
    function walk(dir: string) {
      if (!existsSync(dir)) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (
          ent.name.endsWith('.md') &&
          !['index.md', 'log.md'].includes(ent.name.toLowerCase())
        ) {
          noteFiles.push(full);
        }
      }
    }
    walk(memoryDir);
    expect(noteFiles).toHaveLength(2);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(2);
  });
});
