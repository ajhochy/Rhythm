/**
 * CONTRACT TESTS — Issue #847 (life-02): research results land as Research
 * Database entries (maintainer intake format, 2026-07-02 — supersedes the
 * provisional `research/` folder default).
 *
 * Real filesystem temp fixture vault recreating the maintainer's
 * `Resources/theological-study/Research Database/Entries/` structure (never
 * the real vault), real in-memory SQLite via the existing memory-index
 * machinery for the #805 reuse proof, and a real Express app for the
 * controller-hook proof. No module mocks of the write path itself.
 *
 * Acceptance criteria proven here (mapping to the issue + maintainer format):
 *   AC1 (issue-847-c1): a completed job produces entry note(s) with the
 *        template frontmatter (type: "entry" first and exact, topic, parent,
 *        page, source, author, citation, scripture_references, themes,
 *        doctrine_tags, status: "inbox", tags, job_id) and the template body
 *        sections (# title, ## Quote / Note, ## Summary, ## Theological
 *        Anchors, ## Questions / Uses — empty sections kept, no Intake
 *        Checklist).
 *   AC2 (issue-847-c2): the write is direct-FS (no network calls) and no
 *        note body/summary/findings text is ever passed to the logger.
 *   AC3 (issue-847-c3): the EXISTING #805 refresh (index rebuild / mirror
 *        sync) — unmodified — indexes the new entry and search finds it.
 *   AC4 (issue-847-c4): folder = Entries/<topical-subfolder>/, filename =
 *        <slugged-title>.md (NOT date-prefixed), best-match subfolder
 *        heuristic with 13-miscellaneous fallback, all sourced from
 *        researchVaultConfig.ts.
 *   AC5 (issue-847-c5): the controller writes entries as a side effect of
 *        PATCH /agent-research/:id/status (status=done) without changing the
 *        response contract, and survives a vault-write failure.
 *   AC6 (issue-847-c6): one entry per distinct source/finding when the
 *        caller supplies structured entries; one entry per job otherwise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
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
  RESEARCH_ENTRIES_ROOT,
  RESEARCH_ENTRY_FALLBACK_SUBFOLDER,
  RESEARCH_ENTRY_FRONTMATTER_KEYS,
  matchEntrySubfolder,
  researchEntryFilename,
} from '../config/researchVaultConfig';
import { logger } from '../utils/logger';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;

/** Recreate the maintainer's Entries/ subfolder structure in the temp vault. */
function seedEntriesStructure(root: string): void {
  const entries = path.join(root, RESEARCH_ENTRIES_ROOT);
  for (const sub of [
    '01-worship-theology-foundations',
    '08-music-arts-in-worship',
    '13-miscellaneous',
    '14-technology-ai-imago',
  ]) {
    mkdirSync(path.join(entries, sub), { recursive: true });
  }
}

/** All `.md` files under the Entries root, vault-root-relative. */
function allEntryFiles(): string[] {
  const out: string[] = [];
  const entriesAbs = path.join(vaultRoot, RESEARCH_ENTRIES_ROOT);
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.endsWith('.md')) out.push(path.relative(vaultRoot, full));
    }
  }
  walk(entriesAbs);
  return out;
}

beforeEach(() => {
  setDb(makeDb());
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'research-entries-test-'));
  seedEntriesStructure(vaultRoot);
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

describe('research database entries (#847)', () => {
  it('issue-847-c1: writes an entry with the exact template frontmatter (type: "entry" first) and template body sections, no Intake Checklist', async () => {
    const result = await writeResearchNoteToVault(
      {
        jobId: 'job-abc-123',
        topic: 'Theology of congregational singing',
        summary: 'Congregational song is formative, not decorative.',
        findings: 'Long-form findings go here with citations [1].',
        sources: ['https://example.com/a', 'https://example.com/b'],
      },
      { vaultPath: vaultRoot },
    );

    expect(result.paths).toHaveLength(1);
    const abs = path.join(vaultRoot, result.paths[0]);
    expect(existsSync(abs)).toBe(true);
    const raw = readFileSync(abs, 'utf8');

    // type: "entry" is CRITICAL (drives the Research Entries base) and FIRST.
    const fmLines = raw.split('\n');
    expect(fmLines[0]).toBe('---');
    expect(fmLines[1]).toBe('type: "entry"');

    // Every locked frontmatter key present, in order.
    const fmBlock = raw.split(/\n---\n/)[0].replace(/^---\n/, '');
    const keys = fmBlock
      .split('\n')
      .filter((l) => /^[a-z_]+:/.test(l)) // top-level keys only (skip "  - tag" lines)
      .map((l) => l.split(':')[0]);
    expect(keys).toEqual([...RESEARCH_ENTRY_FRONTMATTER_KEYS]);

    expect(raw).toContain('topic: "Theology of congregational singing"');
    expect(raw).toContain('status: "inbox"');
    expect(raw).toContain('job_id: job-abc-123');
    // Block-style tags matching the vault template.
    expect(raw).toContain('tags:\n  - theology\n  - worship\n  - research-entry');
    // Sources preserved on the per-job entry's source field.
    expect(raw).toContain('source: "https://example.com/a; https://example.com/b"');

    // Template body sections, in order, no Intake Checklist.
    expect(raw).toContain('# Theology of congregational singing');
    const quoteIdx = raw.indexOf('## Quote / Note');
    const summaryIdx = raw.indexOf('## Summary');
    const anchorsIdx = raw.indexOf('## Theological Anchors');
    const questionsIdx = raw.indexOf('## Questions / Uses');
    expect(quoteIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(quoteIdx);
    expect(anchorsIdx).toBeGreaterThan(summaryIdx);
    expect(questionsIdx).toBeGreaterThan(anchorsIdx);
    expect(raw).not.toContain('## Intake Checklist');

    expect(raw).toContain('Long-form findings go here with citations [1].');
    expect(raw).toContain('Congregational song is formative, not decorative.');
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

    // The entry itself DOES contain the body (that's the point) — but nothing
    // logged anywhere may contain the secret body text.
    const abs = path.join(vaultRoot, result.paths[0]);
    expect(readFileSync(abs, 'utf8')).toContain(SECRET_FINDINGS);

    const allLoggedText = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => call.join(' '))
      .join('\n');
    expect(allLoggedText).not.toContain(SECRET_FINDINGS);
    expect(allLoggedText).not.toContain(SECRET_SUMMARY);
    // The log line is expected to reference the job id and path only.
    expect(allLoggedText).toContain('job-privacy-1');
  });

  it('issue-847-c3: after writing an entry, the existing #805 rebuildIndexFromVault/syncMemoryVault scan (unmodified) indexes it and search finds it', async () => {
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
    expect((hits[0].sourceId ?? '').startsWith(RESEARCH_ENTRIES_ROOT + path.sep)).toBe(true);

    // Also prove the OTHER existing refresh path (mirror-sync, the cron body)
    // picks it up with zero code changes to that service.
    const repo2 = new AgentMemoryRepository();
    const syncSummary = await syncMemoryVault({ vaultPath: vaultRoot });
    expect(syncSummary.scanned).toBeGreaterThanOrEqual(1);
    const hits2 = await repo2.searchAsync(UNIQUE_TOKEN, undefined, 20);
    expect(hits2.length).toBeGreaterThanOrEqual(1);
  });

  it('issue-847-c4: entry lands at Entries/<best-match subfolder>/<slugged-title>.md (not date-prefixed); unmatched topics fall back to 13-miscellaneous', async () => {
    // Topic with clear music keywords → 08-music-arts-in-worship.
    const music = await writeResearchNoteToVault(
      {
        jobId: 'job-music-1',
        topic: 'Hymn singing and music in worship',
        summary: 's',
        findings: 'f',
        sources: [],
      },
      { vaultPath: vaultRoot },
    );
    expect(music.subfolders).toEqual(['08-music-arts-in-worship']);
    expect(music.paths[0]).toBe(
      path.join(
        RESEARCH_ENTRIES_ROOT,
        '08-music-arts-in-worship',
        researchEntryFilename('hymn-singing-and-music-in-worship'),
      ),
    );
    // Filename is the slugged title with NO date prefix.
    expect(path.basename(music.paths[0])).not.toMatch(/^\d{4}-\d{2}-\d{2}-/);

    // Topic matching nothing in the taxonomy → 13-miscellaneous fallback.
    const misc = await writeResearchNoteToVault(
      {
        jobId: 'job-misc-1',
        topic: 'Quarterly parking lot resurfacing quotes',
        summary: 's',
        findings: 'f',
        sources: [],
      },
      { vaultPath: vaultRoot },
    );
    expect(misc.subfolders).toEqual([RESEARCH_ENTRY_FALLBACK_SUBFOLDER]);

    // The heuristic itself is exported from the config module.
    expect(matchEntrySubfolder('AI technology and the imago dei')).toBe('14-technology-ai-imago');
    expect(matchEntrySubfolder('zzz nothing relevant zzz')).toBe(RESEARCH_ENTRY_FALLBACK_SUBFOLDER);
  });

  it('issue-847-c4 (input validation): an empty topic throws ResearchVaultWriteError and writes nothing', async () => {
    await expect(
      writeResearchNoteToVault(
        { jobId: 'job-empty', topic: '   ', summary: '', findings: '', sources: [] },
        { vaultPath: vaultRoot },
      ),
    ).rejects.toBeInstanceOf(ResearchVaultWriteError);
    expect(allEntryFiles()).toHaveLength(0);
  });

  it('issue-847-c6: structured findings produce one entry per source/finding; flat report produces one per job', async () => {
    // Structured: two findings → two entries, each with its own source/author.
    const structured = await writeResearchNoteToVault(
      {
        jobId: 'job-multi-1',
        topic: 'Baptism in the early church',
        summary: 'ignored in structured mode',
        findings: 'ignored in structured mode',
        sources: ['https://example.com/x'],
        entries: [
          {
            title: 'Cyprian on baptismal unity',
            note: 'Quote from Cyprian.',
            source: 'On the Unity of the Church',
            author: 'Cyprian',
            page: '12',
          },
          {
            title: 'Didache baptismal instructions',
            note: 'Running water preferred.',
            source: 'Didache 7',
            author: '',
          },
        ],
      },
      { vaultPath: vaultRoot },
    );
    expect(structured.paths).toHaveLength(2);
    const first = readFileSync(path.join(vaultRoot, structured.paths[0]), 'utf8');
    expect(first).toContain('# Cyprian on baptismal unity');
    expect(first).toContain('source: "On the Unity of the Church"');
    expect(first).toContain('author: "Cyprian"');
    expect(first).toContain('page: "12"');
    expect(first).toContain('job_id: job-multi-1');
    // Both entries share the job's topic and land under the baptism subfolder.
    expect(structured.subfolders[0]).toBe('02-sacraments-baptism-eucharist');

    // Flat: one entry per job (already covered in c1, assert the count here).
    const before = allEntryFiles().length;
    await writeResearchNoteToVault(
      {
        jobId: 'job-flat-1',
        topic: 'Unstructured flat report job',
        summary: 's',
        findings: 'whole report',
        sources: [],
      },
      { vaultPath: vaultRoot },
    );
    expect(allEntryFiles().length).toBe(before + 1);
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

  /** All `.md` entries under the hook vault's Entries root. */
  function hookEntryFiles(): string[] {
    const out: string[] = [];
    const entriesAbs = path.join(hookVaultRoot, RESEARCH_ENTRIES_ROOT);
    function walk(dir: string) {
      if (!existsSync(dir)) return;
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) walk(full);
        else if (d.name.endsWith('.md')) out.push(full);
      }
    }
    walk(entriesAbs);
    return out;
  }

  it('issue-847-c5: AgentResearchController.updateStatus writes a Research Database entry on status=done and still returns the job', async () => {
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

    // The side effect: an entry now exists under the Entries root, with the
    // load-bearing type: "entry" frontmatter.
    const entries = hookEntryFiles();
    expect(entries).toHaveLength(1);
    const raw = readFileSync(entries[0], 'utf8');
    expect(raw).toContain('type: "entry"');
    expect(raw).toContain('job_id: job-1');

    // FALSIFICATION: if the hook fired on every status (not just 'done'), a
    // second job left 'gathering' would ALSO produce an entry. It must not.
    seedJob('job-2', 'Unrelated pending-only job');
    await fetch(`${baseUrl}/agent-research/job-2/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'gathering', sources: ['https://example.com/b'] }),
    });
    expect(hookEntryFiles()).toHaveLength(1); // still just the 'done' job's entry
  });

  it('issue-847-c5 (falsification): a vault-write failure does not fail the status-update response', async () => {
    // Force the vault write to fail by making the entries path unwritable:
    // pre-create a FILE where the write service needs a directory.
    mkdirSync(path.join(hookVaultRoot, 'Resources'), { recursive: true });
    writeFileSync(
      path.join(hookVaultRoot, 'Resources', 'theological-study'),
      'i am a file, not a dir',
      'utf8',
    );

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
