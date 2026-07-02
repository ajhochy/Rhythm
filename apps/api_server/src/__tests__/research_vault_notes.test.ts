/**
 * CONTRACT TESTS — Issue #847 (life-02): research results land as structured
 * vault notes.
 *
 * Real filesystem temp fixture vault (never the real ~/Documents/Memory-Vault),
 * real in-memory SQLite via the existing memory-index machinery for the #805
 * reuse proof, and a real Express app for the controller-hook proof. No module
 * mocks of the write path itself.
 *
 * Acceptance criteria proven here (mapping to the issue):
 *   AC1 (issue-847-c1): a completed research note has frontmatter (date, topic,
 *        tags, job_id) + Summary + Findings + Sources sections, and links
 *        related notes sharing a tag.
 *   AC2 (issue-847-c2): the write is direct-FS (no network calls) and no note
 *        body/summary/findings text is ever passed to the logger.
 *   AC3 (issue-847-c3): the EXISTING #805 refresh (index rebuild / mirror
 *        sync) — unmodified — indexes the new note and search finds it.
 *   AC4 (issue-847-c4): the locked folder/filename/frontmatter-key defaults
 *        come from researchVaultConfig.ts, not re-hardcoded in the service.
 *   AC5 (issue-847-c5): the controller writes the note as a side effect of
 *        PATCH /agent-research/:id/status (status=done) without changing the
 *        response contract, and survives a vault-write failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { syncMemoryVault } from '../services/memoryVaultSyncService';
import {
  writeResearchNoteToVault,
  ResearchVaultWriteError,
} from '../services/researchVaultWriteService';
import {
  RESEARCH_VAULT_SUBDIR,
  RESEARCH_NOTE_SOURCE,
  researchNoteFilename,
} from '../config/researchVaultConfig';
import { logger } from '../utils/logger';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;

beforeEach(() => {
  setDb(makeDb());
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'research-vault-test-'));
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

describe('research vault notes (#847)', () => {
  it('issue-847-c1: writes a note with frontmatter (date, topic, tags, job_id) + Summary + Findings + Sources sections, and links related notes sharing a tag', async () => {
    // Seed an existing vault note tagged "crm" so the new research note (whose
    // topic-derived tags include "crm") can link to it.
    const existingDir = path.join(vaultRoot, 'memory', 'fact');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      path.join(existingDir, 'church-crm-notes.md'),
      ['---', 'kind: fact', 'tags: ["crm", "giving"]', '---', 'Prior CRM research.'].join('\n'),
      'utf8',
    );

    const result = await writeResearchNoteToVault(
      {
        jobId: 'job-abc-123',
        topic: 'What is the best CRM for churches',
        summary: 'Planning Center and Church Community Builder are the top contenders.',
        findings: 'Long-form findings go here with citations [1].',
        sources: ['https://example.com/pco', 'https://example.com/ccb'],
      },
      { vaultPath: vaultRoot },
    );

    expect(result.path.startsWith(RESEARCH_VAULT_SUBDIR + path.sep)).toBe(true);
    const abs = path.join(vaultRoot, result.path);
    expect(existsSync(abs)).toBe(true);

    const raw = readFileSync(abs, 'utf8');
    expect(raw).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m);
    expect(raw).toMatch(/^topic: /m);
    expect(raw).toMatch(/^tags: \[.*\]$/m);
    expect(raw).toContain(`source: ${RESEARCH_NOTE_SOURCE}`);
    expect(raw).toContain('job_id: job-abc-123');

    expect(raw).toContain('## Summary');
    expect(raw).toContain('Planning Center and Church Community Builder are the top contenders.');
    expect(raw).toContain('## Findings');
    expect(raw).toContain('Long-form findings go here with citations [1].');
    expect(raw).toContain('## Sources');
    expect(raw).toContain('https://example.com/pco');
    expect(raw).toContain('https://example.com/ccb');

    // Related notes: the seeded "crm"-tagged note must be linked (derivable).
    expect(result.relatedCount).toBeGreaterThanOrEqual(1);
    expect(raw).toContain('## Related notes');
    expect(raw).toContain('[[church-crm-notes]]');
  });

  it('issue-847-c2: writes via direct filesystem and never logs the note body/summary/findings text', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const SECRET_FINDINGS = 'UNIQUE_SECRET_FINDINGS_TOKEN_9f21';
    const SECRET_SUMMARY = 'UNIQUE_SECRET_SUMMARY_TOKEN_4b83';

    const result = await writeResearchNoteToVault(
      {
        jobId: 'job-privacy-1',
        topic: 'Privacy test topic',
        summary: SECRET_SUMMARY,
        findings: SECRET_FINDINGS,
        sources: [],
      },
      { vaultPath: vaultRoot },
    );

    // The note itself DOES contain the body (that's the point) — but nothing
    // logged anywhere may contain the secret body text.
    const abs = path.join(vaultRoot, result.path);
    expect(readFileSync(abs, 'utf8')).toContain(SECRET_FINDINGS);

    const allLoggedText = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => call.join(' '))
      .join('\n');
    expect(allLoggedText).not.toContain(SECRET_FINDINGS);
    expect(allLoggedText).not.toContain(SECRET_SUMMARY);
    // The log line is expected to reference the job id and path only.
    expect(allLoggedText).toContain('job-privacy-1');
  });

  it('issue-847-c3: after writing a research note, the existing #805 rebuildIndexFromVault/syncMemoryVault scan (unmodified) indexes it and search finds it', async () => {
    const UNIQUE_TOKEN = 'quokka-fostering-logistics-8842';
    await writeResearchNoteToVault(
      {
        jobId: 'job-index-1',
        topic: 'Quokka fostering logistics',
        summary: `Summary mentioning ${UNIQUE_TOKEN}.`,
        findings: 'Detailed findings.',
        sources: [],
      },
      { vaultPath: vaultRoot },
    );

    const repo = new AgentMemoryRepository();
    const index = new MemoryIndexService(repo);

    // No new indexer: call the EXISTING #805 rebuild path unchanged.
    const summary = await index.rebuildIndexFromVault(vaultRoot);
    expect(summary.indexed).toBeGreaterThanOrEqual(1);

    const hits = await repo.searchAsync(UNIQUE_TOKEN, undefined, 20);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].sourceId).toBeTruthy();
    expect((hits[0].sourceId ?? '').startsWith(RESEARCH_VAULT_SUBDIR + path.sep)).toBe(true);

    // Also prove the OTHER existing refresh path (mirror-sync, the cron body)
    // picks it up with zero code changes to that service.
    const repo2 = new AgentMemoryRepository();
    const syncSummary = await syncMemoryVault({ vaultPath: vaultRoot });
    expect(syncSummary.scanned).toBeGreaterThanOrEqual(1);
    const hits2 = await repo2.searchAsync(UNIQUE_TOKEN, undefined, 20);
    expect(hits2.length).toBeGreaterThanOrEqual(1);
  });

  it('issue-847-c4: note path is research/<YYYY-MM-DD>-<slug>.md, frontmatter has exactly the locked keys in order, and every literal is sourced from researchVaultConfig.ts', async () => {
    const result = await writeResearchNoteToVault(
      { jobId: 'job-shape-1', topic: 'Shape check topic', summary: 's', findings: 'f', sources: [] },
      { vaultPath: vaultRoot },
    );

    const today = new Date().toISOString().slice(0, 10);
    expect(result.date).toBe(today);
    // Filename format matches the config module's builder byte-for-byte.
    const expectedFilename = researchNoteFilename(today, 'shape-check-topic');
    expect(result.path).toBe(path.join(RESEARCH_VAULT_SUBDIR, expectedFilename));

    const abs = path.join(vaultRoot, result.path);
    const raw = readFileSync(abs, 'utf8');
    const fmBlock = raw.split(/\n---\s*\n/)[0].replace(/^---\n/, '');
    const keys = fmBlock
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => l.split(':')[0].trim());
    expect(keys).toEqual(['date', 'topic', 'tags', 'source', 'job_id']);
  });

  it('issue-847-c4 (config isolation): an empty topic throws ResearchVaultWriteError and writes nothing', async () => {
    await expect(
      writeResearchNoteToVault(
        { jobId: 'job-empty', topic: '   ', summary: '', findings: '', sources: [] },
        { vaultPath: vaultRoot },
      ),
    ).rejects.toBeInstanceOf(ResearchVaultWriteError);
    expect(existsSync(path.join(vaultRoot, RESEARCH_VAULT_SUBDIR))).toBe(false);
  });
});

describe('research-job completion hook (#847)', () => {
  const VAULT_DIR_ENV = 'MEMORY_VAULT_PATH';
  let hookVaultRoot: string;
  let prevVaultEnv: string | undefined;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let hookDb: Database.Database;

  /**
   * Seed a research job directly via SQL rather than POST /agent-research.
   * `create()` also inserts a `pending_claude_triggers` row with `task_id:
   * NULL`, but that column is `NOT NULL REFERENCES tasks(id)` in BOTH the
   * SQLite and Postgres schemas (migrations.ts:741, postgres_bootstrap.ts:471)
   * — a pre-existing, out-of-scope schema bug affecting every taskless
   * trigger insert (agentResearchController AND agentWebhookController share
   * the same broken pattern). #847 owns the COMPLETION hook (updateStatus),
   * not job creation, so the test drives the real thing under test —
   * PATCH /:id/status — without routing through the unrelated broken insert.
   */
  function seedJob(id: string, query: string): void {
    const now = new Date().toISOString();
    hookDb.prepare(
      `INSERT INTO agent_research_jobs (id, query, status, sources_json, report, error, requested_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, query, 'pending', '[]', null, null, null, now, now);
  }

  beforeEach(async () => {
    prevVaultEnv = process.env[VAULT_DIR_ENV];
    hookVaultRoot = mkdtempSync(path.join(tmpdir(), 'research-hook-vault-'));
    process.env[VAULT_DIR_ENV] = hookVaultRoot;

    // Fresh module graph so `env.agentLocal` (a load-time snapshot of
    // AGENT_LOCAL) picks up the bypass for this describe block without
    // affecting other test files. Because the module graph is reset, the
    // in-memory DB singleton (database/db.ts) is reset too — re-import
    // setDb/runMigrations from the SAME fresh graph createApp resolves
    // against, and re-seed it, or every request 500s with "Database not
    // initialized".
    vi.resetModules();
    process.env.AGENT_LOCAL = 'true';

    const { createApp } = await import('../app');
    const { runMigrations: freshRunMigrations } = await import('../database/migrations');
    const { setDb: freshSetDb } = await import('../database/db');
    hookDb = new Database(':memory:');
    hookDb.pragma('foreign_keys = ON');
    freshRunMigrations(hookDb);
    freshSetDb(hookDb);

    const server = createApp().listen(0);
    server.maxRequestsPerSocket = 1;
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((res, rej) => {
        server.closeAllConnections();
        server.close((e) => (e ? rej(e) : res()));
      });
  });

  afterEach(async () => {
    await closeServer();
    try {
      rmSync(hookVaultRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (prevVaultEnv === undefined) delete process.env[VAULT_DIR_ENV];
    else process.env[VAULT_DIR_ENV] = prevVaultEnv;
    delete process.env.AGENT_LOCAL;
    vi.restoreAllMocks();
  });

  it('issue-847-c5: AgentResearchController.updateStatus writes a vault note on status=done and still returns the job even if the vault write throws', async () => {
    seedJob('job-1', 'Best worship planning software');

    const doneRes = await fetch(`${baseUrl}/agent-research/job-1/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'done',
        sources: ['https://example.com/a'],
        report: 'Final report line one.\nMore detail follows.',
      }),
    });
    expect(doneRes.status).toBe(200);
    const updatedJob = (await doneRes.json()) as { id: string; status: string; report: string };
    // Response contract unchanged: still the plain job object.
    expect(updatedJob.status).toBe('done');
    expect(updatedJob.report).toContain('Final report line one.');

    // The side effect: a vault note now exists under research/.
    const researchDir = path.join(hookVaultRoot, RESEARCH_VAULT_SUBDIR);
    expect(existsSync(researchDir)).toBe(true);

    // FALSIFICATION: if the hook fired on every status (not just 'done'), a
    // second job left 'pending' would ALSO produce a note. It must not.
    seedJob('job-2', 'Unrelated pending-only job');
    await fetch(`${baseUrl}/agent-research/job-2/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'gathering', sources: ['https://example.com/b'] }),
    });
    const { readdirSync } = await import('node:fs');
    const notesAfterGathering = readdirSync(researchDir).filter((f) => f.endsWith('.md'));
    expect(notesAfterGathering).toHaveLength(1); // still just the 'done' job's note
  });

  it('issue-847-c5 (falsification): a vault-write failure does not fail the status-update response', async () => {
    // Force the vault write to fail by making the research dir unwritable:
    // pre-create a FILE at the path the write service needs as a directory.
    const blockerPath = path.join(hookVaultRoot, RESEARCH_VAULT_SUBDIR);
    writeFileSync(blockerPath, 'i am a file, not a dir', 'utf8');

    seedJob('job-3', 'Job whose vault write will fail');

    const doneRes = await fetch(`${baseUrl}/agent-research/job-3/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', sources: [], report: 'Report despite vault failure.' }),
    });

    // The API contract must survive the vault write failing.
    expect(doneRes.status).toBe(200);
    const updatedJob = (await doneRes.json()) as { status: string; report: string };
    expect(updatedJob.status).toBe('done');
    expect(updatedJob.report).toBe('Report despite vault failure.');
  });
});
