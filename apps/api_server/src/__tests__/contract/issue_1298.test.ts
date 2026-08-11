import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env';
import { AgentResearchController } from '../../controllers/agentResearchController';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { renderResearchMagazine, renderResearchMarkdownExport, researchMagazineHeaders } from '../../services/research_magazine_renderer';

const input = {
  project: { id: 'p', name: 'Faith & AI <img src=x onerror=alert(1)>', question: 'What remains uncertain?' },
  run: { id: 'r', status: 'degraded', startedAt: '2026-07-27T01:00:00Z', completedAt: '2026-07-27T01:05:00Z', usage: { tokens: 250, costUsd: 0.42 }, progress: { completedJobs: 2, totalJobs: 3 }, diagnostics: { degraded: true }, canonicalArtifact: { vault_path: '../secret.md' } },
  synthesis: '# Finding\n\nEvidence with [citation](https://example.com/source).\n\n## Uncertainty\n\n<script>alert(1)</script>Open question. [bad](javascript:alert(1))',
  critic: '## Disagreement\n\nA credible minority view remains.',
  sources: [{ canonical_url: 'https://example.com/source', capture_status: 'complete' }, { canonical_url: 'javascript:alert(1)', capture_status: 'complete' }],
};

describe('issue #1298 acceptance contract', () => {
  beforeEach(() => {
    (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = true;
  });

  it('issue-1298-c1: renders canonical synthesis and curated provenance', () => {
    const html = renderResearchMagazine(input);
    expect(html).toContain('Finding'); expect(html).toContain('A credible minority view remains.'); expect(html).toContain('https://example.com/source');
    expect(html).toContain('250 tokens'); expect(html).toContain('$0.42');
  });

  it('issue-1298-c2: escapes XSS and filters unsafe provenance', () => {
    const html = renderResearchMagazine(input);
    const markdown = renderResearchMarkdownExport(input);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('href="javascript:');
    expect(markdown).not.toContain('javascript:');
    expect(html).not.toContain('../secret.md'); expect((html.match(/https:\/\/example\.com\/source/g) ?? [])).not.toHaveLength(0);
  });

  it('issue-1298-c2b: conceals magazine runs from another owner', async () => {
    const db = new Database(':memory:'); runMigrations(db); setDb(db);
    const users = new UsersRepository();
    const owner = users.create({ name: 'Owner', email: 'magazine-owner@example.com' });
    const stranger = users.create({ name: 'Stranger', email: 'magazine-stranger@example.com' });
    const repo = new AgentResearchRepository();
    const project = await repo.createProject(owner.id, {
      name: 'Owned', question: 'Private?', goals: [], domain: null, profileId: 'research', passConfig: [], modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: null, budget: {},
    });
    const run = await repo.createProjectRun(project.id, owner.id, 'manual');
    const result: { body?: unknown; error?: unknown } = {};
    const response = { type() { return this; }, set() { return this; }, send(body: unknown) { result.body = body; return this; } } as unknown as Response;
    const request = { auth: { user: { id: stranger.id } }, params: { projectId: project.id, runId: run!.id } } as unknown as Request;
    const next: NextFunction = (error?: unknown) => { result.error = error; };
    await (new AgentResearchController() as any).getProjectMagazine(request, response, next);
    expect(result.body).toBeUndefined();
    expect(result.error).toMatchObject({ statusCode: 404 });
  });

  it('issue-1298-c3: emits print-ready HTML and canonical Markdown', () => {
    const html = renderResearchMagazine(input); const markdown = renderResearchMarkdownExport(input);
    expect(html).toMatch(/@media print/); expect(html).toContain('table-of-contents'); expect(html).toContain('uncertainty-callout');
    expect(markdown).toContain('# Finding'); expect(markdown).toContain('## Disagreement'); expect(markdown).toContain('Status: degraded'); expect(markdown).toContain('https://example.com/source');
  });

  it('issue-1298-c4: export surface is read-only and omits private configuration', () => {
    const source = readFileSync(join(__dirname, '../../services/research_magazine_renderer.ts'), 'utf8');
    expect(source).not.toMatch(/writeFile|rename\(|unlink\(|rmSync|vault_path/);
    const html = renderResearchMagazine({ ...input, run: { ...input.run, configSnapshot: { prompt: 'SECRET', apiKey: 'credential' } } } as any);
    expect(html).not.toContain('SECRET'); expect(html).not.toContain('credential');
  });

  it('issue-1298-c5: output is deterministic with strict CSP', () => {
    expect(renderResearchMagazine(input)).toBe(renderResearchMagazine(input));
    expect(renderResearchMarkdownExport(input)).toBe(renderResearchMarkdownExport(input));
    expect(researchMagazineHeaders()['Content-Security-Policy']).toMatch(/default-src 'none'.*script-src 'none'/);
  });
});
