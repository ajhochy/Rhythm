import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { indexResearchSession } from '../../services/specialist_research_indexer';

type CompletionArtifact = {
  role: 'canonical' | 'supporting';
  kind: 'structured' | 'full-text';
  vault_path: string;
  sha256?: string;
};

type CompletionSource = {
  url: string;
  canonical_url: string;
  capture_status: 'complete' | 'partial' | 'failed';
  structured_vault_path?: string;
  full_text_vault_path?: string;
  structured_sha256?: string;
  full_text_sha256?: string;
  failure?: { code: string; message: string };
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
  );
}

function rows(db: Database.Database, table: string): Record<string, unknown>[] {
  // #1288 is the declared dependency. Returning an empty observable result
  // while its table is not present keeps this #1289 contract red for missing
  // provenance behavior instead of aborting with a SQL/setup exception.
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

describe('issue #1289 acceptance contract', () => {
  let db: Database.Database;
  let vaultRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    vaultRoot = mkdtempSync(path.join(tmpdir(), 'rhythm-1289-vault-'));
    process.env.MEMORY_VAULT_PATH = vaultRoot;
  });

  function session(
    id: string,
    options: {
      profile?: string;
      scheduled?: boolean;
      status?: string;
      ownerUserId?: number | null;
    } = {},
  ): void {
    const profile = options.profile ?? 'AI-Trend-Researcher';
    const now = '2026-08-11T00:00:00.000Z';
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, '.', ?, ?, ?, ?)`,
    ).run(
      id,
      profile,
      options.status ?? 'idle',
      `${profile} contract fixture`,
      options.ownerUserId ?? null,
      now,
      now,
    );
    if (options.scheduled) {
      db.prepare("UPDATE agent_sessions SET category = 'scheduled' WHERE id = ?").run(id);
    }
  }

  function output(id: string, rawText: string, parts: unknown[] | null): void {
    db.prepare(
      `INSERT INTO agent_session_messages
         (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
       VALUES (?, 'output', ?, ?, ?, ?)`,
    ).run(
      id,
      rawText,
      rawText,
      `${id}-${randomUUID()}`,
      parts === null ? null : JSON.stringify(parts),
    );
  }

  function writeVault(relativePath: string, contents: string): CompletionArtifact {
    const absolute = path.join(vaultRoot, relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
    return {
      role: 'supporting',
      kind: 'structured',
      vault_path: relativePath,
      sha256: sha256(contents),
    };
  }

  function completionPart(input: {
    jobId: string;
    runId?: string;
    passId?: string;
    artifacts?: CompletionArtifact[];
    sources?: CompletionSource[];
  }): Record<string, unknown> {
    return {
      id: `completion-${input.passId ?? 'pass-1'}`,
      type: 'tool',
      tool: 'rhythm_complete_research_pass',
      state: {
        status: 'completed',
        input: {
          version: 1,
          job_id: input.jobId,
          run_id: input.runId ?? 'run-1',
          pass_id: input.passId ?? 'pass-1',
          artifacts: input.artifacts ?? [],
          sources: input.sources ?? [],
        },
        output: JSON.stringify({ accepted: true }),
      },
    };
  }

  function indexedJob(sessionId: string): Record<string, unknown> | undefined {
    return db
      .prepare('SELECT * FROM agent_research_jobs WHERE agent_session_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
  }

  it('issue-1289-c1: arbitrary search/navigation/image/tool URLs are not indexed as sources', async () => {
    // Regression caught: the recursive URL scraper treats URLs observed while
    // browsing as curated evidence. The exact source list fails if any URL not
    // declared by the completion contract leaks into provenance.
    session('curated-only', { scheduled: true });
    const artifact = writeVault('Areas/Research/AI/brief.md', '# Brief');
    output('curated-only', 'Research completed', [
      { type: 'tool', tool: 'web_search', state: { input: { query: 'topic' }, output: 'https://search.invalid/result' } },
      { type: 'tool', tool: 'playwright_navigate', state: { input: { url: 'https://navigation.invalid/page' } } },
      { type: 'image', url: 'https://images.invalid/preview.png' },
      completionPart({
        jobId: 'curated-only-job',
        artifacts: [{ ...artifact, role: 'canonical' }],
        sources: [
          {
            url: 'HTTPS://Example.com:443/article?utm_source=test&b=2&a=1#section',
            canonical_url: 'https://example.com/article?a=1&b=2',
            capture_status: 'complete',
            structured_vault_path: artifact.vault_path,
            structured_sha256: artifact.sha256,
          },
        ],
      }),
    ]);

    await indexResearchSession('curated-only');

    expect(JSON.parse(String(indexedJob('curated-only')?.sources_json))).toEqual([
      'https://example.com/article?a=1&b=2',
    ]);
  });

  it('issue-1289-c2: structured and full-text companions are independently recorded, including honest partial captures', async () => {
    // Regression caught: a partial archive is promoted to complete, or the
    // structured/full-text companions collapse into one row. Separate artifact
    // paths plus the partial failure marker catch both errors.
    session('companions', { scheduled: true });
    const structured = writeVault('Areas/Research/Sources/source-a.md', 'structured A');
    const fullText = writeVault('Areas/Research/Sources/source-a.full.md', 'full text A');
    fullText.kind = 'full-text';
    const partial = writeVault('Areas/Research/Sources/source-b.md', 'structured B');
    output('companions', 'Canonical preview only', [
      completionPart({
        jobId: 'companions-job',
        artifacts: [structured, fullText, partial],
        sources: [
          {
            url: 'https://example.test/a',
            canonical_url: 'https://example.test/a',
            capture_status: 'complete',
            structured_vault_path: structured.vault_path,
            full_text_vault_path: fullText.vault_path,
            structured_sha256: structured.sha256,
            full_text_sha256: fullText.sha256,
          },
          {
            url: 'https://example.test/b',
            canonical_url: 'https://example.test/b',
            capture_status: 'partial',
            structured_vault_path: partial.vault_path,
            structured_sha256: partial.sha256,
            failure: { code: 'full_text_unavailable', message: 'publisher denied capture' },
          },
        ],
      }),
    ]);

    await indexResearchSession('companions');

    const artifactJson = JSON.stringify(rows(db, 'agent_research_artifacts'));
    const sourceJson = JSON.stringify(rows(db, 'agent_research_curated_sources'));
    expect(artifactJson).toContain(structured.vault_path);
    expect(artifactJson).toContain(fullText.vault_path);
    expect(sourceJson).toContain('complete');
    expect(sourceJson).toContain('partial');
    expect(sourceJson).toContain('full_text_unavailable');
  });

  it('issue-1289-c3: unrelated chats under research profiles are excluded', async () => {
    // Regression caught: merely selecting a specialist profile creates a
    // research job for an ordinary interactive chat. Absence of the job is the
    // observable classification boundary.
    session('ordinary-chat');
    output('ordinary-chat', 'Here is a quick answer.', [
      { type: 'text', text: 'Here is a quick answer with https://example.test/chat.' },
    ]);

    await indexResearchSession('ordinary-chat');

    expect(indexedJob('ordinary-chat')).toBeUndefined();
  });

  it('issue-1289-c4: artifact/source completion is idempotent and traversal-safe', async () => {
    // Regression caught: replay creates duplicate provenance, or lexical path
    // checks accept ../ and an in-vault symlink that resolves outside the vault.
    const valid = writeVault('Areas/Research/AI/canonical.md', '# Canonical');
    valid.role = 'canonical';
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'rhythm-1289-outside-'));
    const outsideFile = path.join(outsideRoot, 'escaped.md');
    writeFileSync(outsideFile, 'outside vault', 'utf8');
    mkdirSync(path.join(vaultRoot, 'Areas/Research/AI'), { recursive: true });
    symlinkSync(outsideFile, path.join(vaultRoot, 'Areas/Research/AI/link.md'));

    session('safe-replay', { scheduled: true });
    const completion = completionPart({
      jobId: 'safe-replay-job',
      artifacts: [
        valid,
        { role: 'supporting', kind: 'structured', vault_path: '../escaped.md' },
        { role: 'supporting', kind: 'structured', vault_path: 'Areas/Research/AI/link.md' },
      ],
      sources: [
        {
          url: 'https://EXAMPLE.test:443/source?utm_campaign=x',
          canonical_url: 'https://example.test/source',
          capture_status: 'complete',
          structured_vault_path: valid.vault_path,
          structured_sha256: valid.sha256,
        },
      ],
    });
    output('safe-replay', 'Done', [completion, completion]);

    await indexResearchSession('safe-replay');
    await indexResearchSession('safe-replay');

    const artifactJson = JSON.stringify(rows(db, 'agent_research_artifacts'));
    const sourceJson = JSON.stringify(rows(db, 'agent_research_curated_sources'));
    expect(artifactJson.match(/canonical\.md/g) ?? []).toHaveLength(1);
    expect(artifactJson).not.toContain('escaped.md');
    expect(artifactJson).not.toContain('link.md');
    expect(sourceJson.match(/https:\/\/example\.test\/source/g) ?? []).toHaveLength(1);
  });

  it('issue-1289-c5: malformed payloads, duplicate completion, traversal, symlink escape, missing files, and legacy sessions are covered', async () => {
    // Regression caught: invalid modern evidence is silently treated as legacy,
    // while genuinely old sessions are dropped. The classification markers and
    // absence of invalid artifact paths distinguish every required case.
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'rhythm-1289-matrix-'));
    const outsideFile = path.join(outsideRoot, 'outside.md');
    writeFileSync(outsideFile, 'outside', 'utf8');
    mkdirSync(path.join(vaultRoot, 'Areas/Research/Matrix'), { recursive: true });
    symlinkSync(outsideFile, path.join(vaultRoot, 'Areas/Research/Matrix/link.md'));

    const fixtures: Array<[string, unknown[] | null]> = [
      ['malformed', [{ type: 'tool', tool: 'rhythm_complete_research_pass', state: { status: 'completed', input: { version: 999 } } }]],
      ['duplicate', [completionPart({ jobId: 'duplicate-job' }), completionPart({ jobId: 'duplicate-job' })]],
      ['traversal', [completionPart({ jobId: 'traversal-job', artifacts: [{ role: 'canonical', kind: 'structured', vault_path: '../escape.md' }] })]],
      ['symlink', [completionPart({ jobId: 'symlink-job', artifacts: [{ role: 'canonical', kind: 'structured', vault_path: 'Areas/Research/Matrix/link.md' }] })]],
      ['missing', [completionPart({ jobId: 'missing-job', artifacts: [{ role: 'canonical', kind: 'structured', vault_path: 'Areas/Research/Matrix/missing.md' }] })]],
      ['legacy', null],
    ];

    for (const [id, parts] of fixtures) {
      session(id, { scheduled: true });
      output(id, `${id} result`, parts);
      await indexResearchSession(id);
    }

    const classifications = Object.fromEntries(
      fixtures.map(([id]) => [id, String(indexedJob(id)?.classification_json ?? '')]),
    );
    expect(classifications.malformed).toMatch(/malformed|invalid/i);
    expect(classifications.duplicate).toMatch(/completed|verified/i);
    expect(classifications.traversal).toMatch(/traversal|invalid/i);
    expect(classifications.symlink).toMatch(/symlink|escape|invalid/i);
    expect(classifications.missing).toMatch(/missing|not.?found|invalid/i);
    expect(classifications.legacy).toMatch(/legacy-unverified/i);
    expect(JSON.stringify(rows(db, 'agent_research_artifacts'))).not.toMatch(
      /escape\.md|link\.md|missing\.md/,
    );
  });

  it('issue-1289-c6: the research-project feature flag defaults off and preserves legacy indexing', async () => {
    // Regression caught: #1289 activates its stricter completion contract for
    // existing users when the flag is unset. The default and legacy URL/path
    // projection assertions fail if rollout ceases to be inert.
    expect(
      (env as typeof env & { researchProjectsEnabled?: boolean })
        .researchProjectsEnabled,
    ).toBe(false);

    session('flag-off-legacy', { scheduled: true });
    output('flag-off-legacy', 'Legacy preview', [
      {
        type: 'tool',
        output: {
          path: 'Areas/Research/Legacy/report.md',
          url: 'https://legacy.example.test/source',
        },
      },
    ]);
    await indexResearchSession('flag-off-legacy');

    expect(indexedJob('flag-off-legacy')).toMatchObject({
      sources_json: '["https://legacy.example.test/source"]',
      vault_path: 'Areas/Research/Legacy/report.md',
      report: 'Legacy preview',
    });
  });
});
