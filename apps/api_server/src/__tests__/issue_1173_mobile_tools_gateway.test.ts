import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { ResearchProjectOrchestrator } from '../services/research_project_orchestrator';
import {
  isMobileToolOperationAllowed,
} from '../routes/mobile_tools_routes';
import * as AgentRunner from '../services/agent_runner';
import { opencodeClient } from '../services/opencode_engine';
import {
  installHumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

describe('#1173 mobile tools gateway', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let sandboxRoot: string;
  let humanCapabilityHeader: Record<string, string>;

  beforeEach(async () => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'rhythm-1175-tools-'));
    process.env.MEMORY_VAULT_PATH = join(sandboxRoot, 'memory');
    process.env.MEMORY_VAULT_SUBDIR = '';
    process.env.RHYTHM_MANAGED_SKILLS_DIR = join(sandboxRoot, 'skills');
    process.env.RHYTHM_MANAGED_COMMANDS_DIR = join(sandboxRoot, 'commands');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.restoreAllMocks();
    db.close();
    rmSync(sandboxRoot, { recursive: true, force: true });
    delete process.env.MEMORY_VAULT_PATH;
    delete process.env.MEMORY_VAULT_SUBDIR;
    delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    delete process.env.RHYTHM_MANAGED_COMMANDS_DIR;
  });

  async function pair(email: string): Promise<{
    userId: number;
    deviceToken: string;
  }> {
    const user = new UsersRepository().create({
      name: email.split('@')[0],
      email,
    });
    const session = new SessionsRepository().create(user.id);
    const auth = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      ...humanCapabilityHeader,
    };
    const codeResponse = await fetch(
      `${baseUrl}/mobile-gateway/pairing-codes`,
      { method: 'POST', headers: auth, body: '{}' },
    );
    expect(codeResponse.status).toBe(201);
    const { pairingCode, hostId } = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode,
        hostId,
        deviceName: `${email} iPhone`,
      }),
    });
    expect(pairResponse.status).toBe(201);
    const { deviceToken } = (await pairResponse.json()) as {
      deviceToken: string;
    };
    return { userId: user.id, deviceToken };
  }

  it('accepts only the explicit mobile operation matrix', () => {
    expect(isMobileToolOperationAllowed('agent-memory', 'GET', '/')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-memory', 'POST', '/sync')).toBe(false);
    expect(
      isMobileToolOperationAllowed(
        'agent-webhooks',
        'POST',
        '/webhook-id/rotate-secret',
      ),
    ).toBe(true);
    expect(isMobileToolOperationAllowed('agent-webhooks', 'POST', '/hook/receive')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/export')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/profile/security-lock')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-org-proposals', 'POST', '/p/revert')).toBe(false);
    expect(isMobileToolOperationAllowed('agents/run-quality', 'POST', '/tool-events')).toBe(false);
    expect(isMobileToolOperationAllowed('opencode/skills', 'DELETE', '/external')).toBe(true);
    expect(isMobileToolOperationAllowed('opencode/commands', 'PUT', '/managed')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-decisions', 'GET', '/config')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-decisions', 'PUT', '/config')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-decisions', 'POST', '/config/test')).toBe(true);
    expect(isMobileToolOperationAllowed('agent-decisions', 'GET', '/')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-decisions', 'DELETE', '/config')).toBe(false);
    expect(isMobileToolOperationAllowed('unknown', 'GET', '/')).toBe(false);
  });

  it('binds research data to the paired Rhythm user and supports retry/delete', async () => {
    const first = await pair(`first-${randomUUID()}@example.com`);
    const second = await pair(`second-${randomUUID()}@example.com`);
    const firstHeaders = {
      Authorization: `Device ${first.deviceToken}`,
      'Content-Type': 'application/json',
    };
    const secondHeaders = {
      Authorization: `Device ${second.deviceToken}`,
      'Content-Type': 'application/json',
    };

    const createdResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      {
        method: 'POST',
        headers: firstHeaders,
        body: JSON.stringify({ query: 'mobile owned research' }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      requestedByUserId: number;
    };
    expect(created.requestedByUserId).toBe(first.userId);

    const firstList = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      { headers: firstHeaders },
    );
    expect(firstList.status).toBe(200);
    expect(await firstList.json()).toEqual([
      expect.objectContaining({ id: created.id }),
    ]);

    const secondList = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      { headers: secondHeaders },
    );
    expect(secondList.status).toBe(200);
    expect(await secondList.json()).toEqual([]);
    const crossAccountGet = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}`,
      { headers: secondHeaders },
    );
    expect(crossAccountGet.status).toBe(404);

    db.prepare(`
      UPDATE agent_research_jobs
      SET status = 'error', error = 'transient', report = 'stale'
      WHERE id = ?
    `).run(created.id);
    const retry = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}/retry`,
      { method: 'POST', headers: firstHeaders, body: '{}' },
    );
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      id: created.id,
      status: 'pending',
      report: null,
      error: null,
      sourcesJson: '[]',
    });

    const remove = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research/${created.id}`,
      { method: 'DELETE', headers: firstHeaders },
    );
    expect(remove.status).toBe(204);
    expect(
      db.prepare('SELECT id FROM agent_research_jobs WHERE id = ?').get(created.id),
    ).toBeUndefined();
  });

  describe('primary Research project/run extension', () => {
    let previousEnabled: boolean;
    beforeEach(() => {
      previousEnabled = env.researchProjectsEnabled;
      env.researchProjectsEnabled = true;
      // Exercise real routes/repositories without starting model-backed work.
      vi.spyOn(ResearchProjectOrchestrator.prototype, 'start').mockResolvedValue(undefined as never);
      vi.spyOn(opencodeClient, 'abortSession').mockResolvedValue(true);
    });
    afterEach(() => { env.researchProjectsEnabled = previousEnabled; });

    async function primaryFixture() {
      const owner = await pair(`primary-${randomUUID()}@example.com`);
      const mac = new ProjectsRepository().insert({
        name: 'Registered Mac project', cwd: sandboxRoot, icon: null,
        vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
      });
      const headers = {
        Authorization: `Device ${owner.deviceToken}`, 'Content-Type': 'application/json',
        'X-Rhythm-Project-ID': mac.id,
      };
      const repo = new AgentResearchRepository();
      const project = await repo.createProject(owner.userId, {
        name: 'Sources', question: 'What changed?', goals: [], domain: null, profileId: 'research',
        passConfig: [], modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: null,
        budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
      });
      const run = (await repo.createProjectRun(project.id, owner.userId, 'manual'))!;
      const runRow = db.prepare('SELECT * FROM agent_research_project_runs WHERE id=?').get(run.id);
      const prefix = `${baseUrl}/mobile-gateway/tools/agent-research/projects`;
      return { owner, mac, headers, repo, project, run, runRow, prefix };
    }

    it('serves all eleven primary operations through the canonical owner-bound handlers', async () => {
      const f = await primaryFixture();
      const create = await fetch(f.prefix, {
        method: 'POST', headers: f.headers,
        body: JSON.stringify({ name: 'New project', question: 'Why?', ownerUserId: f.owner.userId + 1 }),
      });
      expect(create.status).toBe(201);
      const project = await create.json() as { id: string; ownerUserId: number };
      expect(project.ownerUserId).toBe(f.owner.userId);
      const list = await fetch(f.prefix, { headers: f.headers });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id })]));
      const detail = await fetch(`${f.prefix}/${project.id}`, { headers: f.headers });
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject(project);
      const patch = await fetch(`${f.prefix}/${project.id}`, {
        method: 'PATCH', headers: f.headers, body: JSON.stringify({ name: 'Updated project' }),
      });
      expect(patch.status).toBe(200);
      expect(await patch.json()).toMatchObject({ name: 'Updated project', ownerUserId: f.owner.userId });
      const started = await fetch(`${f.prefix}/${project.id}/runs`, {
        method: 'POST', headers: f.headers, body: '{}',
      });
      expect(started.status).toBe(201);
      const run = await started.json() as { id: string };
      expect(ResearchProjectOrchestrator.prototype.start).toHaveBeenCalledWith(run.id, f.owner.userId);
      const runs = await fetch(`${f.prefix}/${project.id}/runs`, { headers: f.headers });
      expect(runs.status).toBe(200);
      expect(await runs.json()).toEqual([expect.objectContaining({ id: run.id })]);
      const runUrl = `${f.prefix}/${project.id}/runs/${run.id}`;
      const read = await fetch(runUrl, { headers: f.headers });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ id: run.id, ownerUserId: f.owner.userId });
      const cancel = await fetch(`${runUrl}/cancel`, { method: 'POST', headers: f.headers, body: '{}' });
      expect(cancel.status).toBe(200);
      expect(await cancel.json()).toMatchObject({ status: 'cancelled' });
      const resume = await fetch(`${runUrl}/resume`, { method: 'POST', headers: f.headers, body: '{}' });
      expect(resume.status).toBe(202);
      expect(await resume.json()).toMatchObject({ status: 'resumable' });
      // Hydration derives stages from actual pass rows, not progress JSON.
      for (const [ordinal, [role, report]] of [
        ['researcher', 'Completed evidence'],
        ['synthesis', '# Résumé 🌱\n\nLine one\nLine two'],
      ].entries()) {
        const pass = await f.repo.createProjectPassJob({
          projectId: project.id, projectRunId: run.id, ownerUserId: f.owner.userId,
          question: 'Why?', role, ordinal, profileId: 'research', config: {},
        });
        await f.repo.updateProjectPassJob(pass.id, f.owner.userId, { status: 'done', report });
      }
      await f.repo.updateProjectRunState(run.id, f.owner.userId, {
        status: 'done', completedAt: new Date().toISOString(),
      });
      const finish = await fetch(`${runUrl}/finish`, { method: 'POST', headers: f.headers, body: '{}' });
      expect(finish.status).toBe(200);
      expect(await finish.json()).toMatchObject({ id: run.id, status: 'done' });
      const exported = await fetch(`${runUrl}/export?format=markdown`, { headers: f.headers });
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toMatch(/^application\/json/);
      expect(exported.headers.get('content-disposition')).toBeNull();
      expect(exported.headers.get('cache-control')).toBe('private, no-store');
      expect(exported.headers.get('x-content-type-options')).toBe('nosniff');
      const envelope = await exported.json() as { markdown: string };
      expect(envelope.markdown).toContain('# Résumé 🌱\n\nLine one\nLine two');
      // The same canonical controller still exports raw Markdown to desktop.
      const session = new SessionsRepository().create(f.owner.userId);
      const desktop = await fetch(`${baseUrl}/agent-research/projects/${project.id}/runs/${run.id}/export?format=markdown`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(desktop.status).toBe(200);
      expect(desktop.headers.get('content-type')).toMatch(/^text\/markdown/);
      expect(desktop.headers.get('content-disposition')).toContain('attachment');
      expect(await desktop.text()).toBe(envelope.markdown);
    });

    it('refuses foreign owners and same-owner wrong-project run URLs before mutation or abort', async () => {
      const f = await primaryFixture();
      const other = await pair(`foreign-${randomUUID()}@example.com`);
      const wrongProject = await f.repo.createProject(f.owner.userId, { ...f.project, name: 'Other project' });
      const cancel = vi.spyOn(AgentResearchRepository.prototype, 'cancelProjectRun');
      for (const [projectId, headers] of [
        [wrongProject.id, f.headers],
        [f.project.id, { ...f.headers, Authorization: `Device ${other.deviceToken}` }],
      ] as const) {
        for (const [method, suffix] of [
          ['GET', ''], ['POST', '/cancel'], ['POST', '/resume'], ['POST', '/finish'], ['GET', '/export?format=markdown'],
        ]) {
          const response = await fetch(`${f.prefix}/${projectId}/runs/${f.run.id}${suffix}`, {
            method, headers, ...(method === 'POST' ? { body: '{}' } : {}),
          });
          expect(response.status, `${method} ${projectId}${suffix}`).toBe(404);
        }
      }
      expect(cancel).not.toHaveBeenCalled();
      expect(opencodeClient.abortSession).not.toHaveBeenCalled();
      expect(db.prepare('SELECT * FROM agent_research_project_runs WHERE id=?').get(f.run.id)).toEqual(f.runRow);
      const foreignList = await fetch(f.prefix, {
        headers: { ...f.headers, Authorization: `Device ${other.deviceToken}` },
      });
      expect(await foreignList.json()).toEqual([]);
    });

    it('requires current pairing and registered Mac scope for the collection and run extension', async () => {
      const f = await primaryFixture();
      const unavailable = { ...f.headers, 'X-Rhythm-Project-ID': 'not-a-registered-project' };
      for (const [method, path] of [
        ['GET', ''], ['POST', ''], ['GET', `/${f.project.id}`], ['PATCH', `/${f.project.id}`],
        ['GET', `/${f.project.id}/runs`], ['POST', `/${f.project.id}/runs`],
        ['GET', `/${f.project.id}/runs/${f.run.id}`],
        ['POST', `/${f.project.id}/runs/${f.run.id}/cancel`],
        ['POST', `/${f.project.id}/runs/${f.run.id}/resume`],
        ['POST', `/${f.project.id}/runs/${f.run.id}/finish`],
        ['GET', `/${f.project.id}/runs/${f.run.id}/export?format=markdown`],
      ]) {
        const response = await fetch(`${f.prefix}${path}`, {
          method, headers: unavailable, ...(method === 'GET' ? {} : { body: '{}' }),
        });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
      expect((await fetch(f.prefix.replace('/projects', '/PROJECTS'), { headers: unavailable })).status).toBe(404);
      expect((await fetch(f.prefix)).status).toBe(401);
      db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run(new Date().toISOString(), f.mac.id);
      expect((await fetch(f.prefix, { headers: f.headers })).status).toBe(404);
      db.prepare('UPDATE projects SET archived_at=NULL WHERE id=?').run(f.mac.id);
      db.prepare('UPDATE mobile_devices SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), f.owner.userId);
      expect((await fetch(f.prefix, { headers: f.headers })).status).toBe(401);
      expect(db.prepare('SELECT * FROM agent_research_project_runs WHERE id=?').get(f.run.id)).toEqual(f.runRow);
    });

    it('rejects secondary operations and every non-scalar or non-Markdown export format', async () => {
      const f = await primaryFixture();
      const runUrl = `${f.prefix}/${f.project.id}/runs/${f.run.id}`;
      for (const query of ['', '?format=html', '?format=markdown&format=markdown', '?format[]=markdown', '?format[x]=markdown', '?format=markdown&format[]=html']) {
        expect((await fetch(`${runUrl}/export${query}`, { headers: f.headers })).status, query).toBe(404);
      }
      for (const [method, path] of [
        ['POST', `${f.prefix}/${f.project.id}/archive`],
        ['PUT', `${f.prefix}/${f.project.id}/magazine-artifact`],
        ['GET', `${runUrl}/magazine`], ['POST', `${runUrl}/discussions`],
        ['POST', `${runUrl}/passes/pass/cancel`], ['POST', `${runUrl}/passes/pass/retry`],
        ['GET', `${f.prefix}/${f.project.id}/artifacts/artifact`],
      ]) {
        const response = await fetch(path, {
          method, headers: f.headers, ...(method === 'GET' ? {} : { body: '{}' }),
        });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    });

    it('preserves canonical nested conflict errors without a Markdown envelope', async () => {
      const f = await primaryFixture();
      const response = await fetch(`${f.prefix}/${f.project.id}/runs/${f.run.id}/export?format=markdown`, { headers: f.headers });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: 'SYNTHESIS_UNAVAILABLE', message: expect.any(String) } });
      expect(body).not.toHaveProperty('markdown');
    });
  });

  it('enforces the complete owner-scoped operation matrix for two paired users', async () => {
    const owner = await pair(`owner-${randomUUID()}@example.com`);
    const other = await pair(`other-${randomUUID()}@example.com`);
    const ownerHeaders = {
      Authorization: `Device ${owner.deviceToken}`,
      'Content-Type': 'application/json',
    };
    const otherHeaders = {
      Authorization: `Device ${other.deviceToken}`,
      'Content-Type': 'application/json',
    };
    vi.spyOn(AgentRunner, 'run').mockResolvedValue({
      sessionId: 'owner-cookbook-session',
      result: 'ok',
      status: 'done',
    });

    const researchResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-research`,
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          query: 'owner matrix research',
          requestedByUserId: other.userId,
        }),
      },
    );
    expect(researchResponse.status).toBe(201);
    const research = (await researchResponse.json()) as {
      id: string;
      requestedByUserId: number;
    };
    expect(research.requestedByUserId).toBe(owner.userId);

    const scheduleResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-schedules`,
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          name: 'Owned daily briefing',
          scheduleType: 'daily',
          scheduledTime: '09:00',
          prompt: 'Prepare the daily briefing.',
          createdByUserId: other.userId,
        }),
      },
    );
    expect(scheduleResponse.status).toBe(201);
    const schedule = (await scheduleResponse.json()) as {
      id: string;
      createdByUserId: number;
    };
    expect(schedule.createdByUserId).toBe(owner.userId);

    const webhookResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-webhooks`,
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          name: 'Owned webhook',
          targetPrompt: 'Handle the owned webhook.',
          createdByUserId: other.userId,
        }),
      },
    );
    expect(webhookResponse.status).toBe(201);
    const webhook = (await webhookResponse.json()) as {
      id: string;
      createdByUserId: number;
    };
    expect(webhook.createdByUserId).toBe(owner.userId);

    const cookbookResponse = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-cookbook`,
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          title: 'Owned recipe',
          steps: ['Do the owned thing'],
          ownerUserId: other.userId,
        }),
      },
    );
    expect(cookbookResponse.status).toBe(201);
    const cookbook = (await cookbookResponse.json()) as {
      id: string;
      ownerUserId: number;
    };
    expect(cookbook.ownerUserId).toBe(owner.userId);

    const resources = [
      {
        mount: 'agent-research',
        id: research.id,
        crossOperations: [
          { method: 'GET', suffix: '' },
          { method: 'POST', suffix: '/retry', body: '{}' },
          { method: 'DELETE', suffix: '' },
        ],
      },
      {
        mount: 'agent-schedules',
        id: schedule.id,
        crossOperations: [
          { method: 'GET', suffix: '' },
          {
            method: 'PATCH',
            suffix: '',
            body: JSON.stringify({ name: 'Hostile rename' }),
          },
          { method: 'POST', suffix: '/trigger-now', body: '{}' },
          { method: 'DELETE', suffix: '' },
        ],
      },
      {
        mount: 'agent-webhooks',
        id: webhook.id,
        crossOperations: [
          { method: 'GET', suffix: '' },
          { method: 'POST', suffix: '/rotate-secret', body: '{}' },
          { method: 'DELETE', suffix: '' },
        ],
      },
      {
        mount: 'agent-cookbook',
        id: cookbook.id,
        crossOperations: [
          { method: 'GET', suffix: '' },
          {
            method: 'PATCH',
            suffix: '',
            body: JSON.stringify({ title: 'Hostile recipe rename' }),
          },
          { method: 'POST', suffix: '/run', body: '{}' },
          { method: 'DELETE', suffix: '' },
        ],
      },
    ] as const;

    for (const resource of resources) {
      const list = await fetch(
        `${baseUrl}/mobile-gateway/tools/${resource.mount}`,
        { headers: otherHeaders },
      );
      expect(list.status, `${resource.mount} list`).toBe(200);
      expect(JSON.stringify(await list.json())).not.toContain(resource.id);

      for (const operation of resource.crossOperations) {
        const response = await fetch(
          `${baseUrl}/mobile-gateway/tools/${resource.mount}/${resource.id}${operation.suffix}`,
          {
            method: operation.method,
            headers: otherHeaders,
            ...('body' in operation ? { body: operation.body } : {}),
          },
        );
        expect(
          response.status,
          `${operation.method} ${resource.mount}/${resource.id}${operation.suffix}`,
        ).toBe(404);
      }
    }

    const ownerSchedulePatch = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-schedules/${schedule.id}`,
      {
        method: 'PATCH',
        headers: ownerHeaders,
        body: JSON.stringify({ name: 'Owner-renamed briefing' }),
      },
    );
    expect(ownerSchedulePatch.status).toBe(200);
    const ownerScheduleTrigger = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-schedules/${schedule.id}/trigger-now`,
      { method: 'POST', headers: ownerHeaders, body: '{}' },
    );
    expect(ownerScheduleTrigger.status).toBe(200);

    const ownerCookbookPatch = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-cookbook/${cookbook.id}`,
      {
        method: 'PATCH',
        headers: ownerHeaders,
        body: JSON.stringify({ title: 'Owner-renamed recipe' }),
      },
    );
    expect(ownerCookbookPatch.status).toBe(200);
    const ownerCookbookRun = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-cookbook/${cookbook.id}/run`,
      { method: 'POST', headers: ownerHeaders, body: '{}' },
    );
    expect(ownerCookbookRun.status).toBe(202);
    expect(await ownerCookbookRun.json()).toMatchObject({
      sessionId: 'owner-cookbook-session',
    });
    expect(AgentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: owner.userId }),
    );

    const now = new Date().toISOString();
    for (const [id, agentKind, ownerUserId] of [
      ['owner-quality', 'owner-agent', owner.userId],
      ['other-quality', 'other-agent', other.userId],
    ] as const) {
      db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, owner_user_id,
            last_activity_at, created_at, updated_at)
         VALUES (?, ?, 'closed', '/tmp', 'quality seed', ?, ?, ?, ?)`,
      ).run(id, agentKind, ownerUserId, now, now, now);
    }
    const ownerQuality = await fetch(
      `${baseUrl}/mobile-gateway/tools/agents/run-quality`,
      { headers: ownerHeaders },
    );
    const otherQuality = await fetch(
      `${baseUrl}/mobile-gateway/tools/agents/run-quality`,
      { headers: otherHeaders },
    );
    expect(ownerQuality.status).toBe(200);
    expect(otherQuality.status).toBe(200);
    const ownerQualityBody = JSON.stringify(await ownerQuality.json());
    const otherQualityBody = JSON.stringify(await otherQuality.json());
    expect(ownerQualityBody).toContain('owner-agent');
    expect(ownerQualityBody).not.toContain('other-agent');
    expect(otherQualityBody).toContain('other-agent');
    expect(otherQualityBody).not.toContain('owner-agent');

    for (const resource of [
      ['agent-schedules', schedule.id],
      ['agent-webhooks', webhook.id],
      ['agent-cookbook', cookbook.id],
      ['agent-research', research.id],
    ] as const) {
      const remove = await fetch(
        `${baseUrl}/mobile-gateway/tools/${resource[0]}/${resource[1]}`,
        { method: 'DELETE', headers: ownerHeaders },
      );
      expect(remove.status, `owner delete ${resource[0]}`).toBe(204);
    }
  });

  it('allows every Mac-global mutation only for a verified workspace admin', async () => {
    const admin = await pair(`admin-${randomUUID()}@example.com`);
    const staff = await pair(`staff-${randomUUID()}@example.com`);
    const decoyOwner = new UsersRepository().create({
      name: 'decoy-owner',
      email: `decoy-${randomUUID()}@example.com`,
    });
    const workspaceRepo = new WorkspaceRepository();
    const earlierWorkspace = workspaceRepo.create({
      name: 'Earlier staff membership',
      createdBy: decoyOwner.id,
    });
    workspaceRepo.addMemberDirect(earlierWorkspace.id, admin.userId);
    const administeredWorkspace = workspaceRepo.create({
      name: 'Administered workspace',
      createdBy: admin.userId,
    });
    workspaceRepo.joinByCode(administeredWorkspace.joinCode, staff.userId);

    vi.spyOn(opencodeClient, 'listCommands').mockResolvedValue([]);
    vi.spyOn(opencodeClient, 'reloadConfig').mockResolvedValue(true);
    vi.spyOn(opencodeClient, 'reloadSkills').mockResolvedValue([]);

    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'mobile-auth-review',
      risk: 'high',
      title: 'Verify mobile proposal reviewer identity',
      dedupKey: `mobile-auth-review:${randomUUID()}`,
    });
    const suffix = randomUUID().slice(0, 8);
    const mutations = [
      {
        mount: 'agent-memory',
        path: '',
        method: 'POST',
        body: { content: 'Workspace-admin mobile memory mutation' },
        success: 201,
      },
      {
        mount: 'agent-configs',
        path: '',
        method: 'POST',
        body: {
          id: `mobile-admin-${suffix}`,
          label: 'Mobile workspace administrator profile',
        },
        success: 201,
      },
      {
        mount: 'agent-org-proposals',
        path: `/${proposal.id}/reject`,
        method: 'POST',
        body: { decidedByUserId: staff.userId },
        success: 200,
      },
      {
        mount: 'opencode/skills',
        path: '',
        method: 'POST',
        body: {
          name: `mobile-admin-skill-${suffix}`,
          description: 'Workspace-admin policy mutation',
          content: '# Mobile admin skill\n\nPerform the requested task.',
        },
        success: 200,
      },
      {
        mount: 'opencode/commands',
        path: '',
        method: 'POST',
        body: {
          name: `mobile-admin-command-${suffix}`,
          description: 'Workspace-admin policy mutation',
          template: 'Perform the requested task: $ARGUMENTS',
        },
        success: 200,
      },
    ] as const;

    for (const mutation of mutations) {
      const response = await fetch(
        `${baseUrl}/mobile-gateway/tools/${mutation.mount}${mutation.path}`,
        {
          method: mutation.method,
          headers: {
            Authorization: `Device ${staff.deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mutation.body),
        },
      );
      expect(
        response.status,
        `staff ${mutation.method} ${mutation.mount}${mutation.path}`,
      ).toBe(403);
    }

    for (const mutation of mutations) {
      const response = await fetch(
        `${baseUrl}/mobile-gateway/tools/${mutation.mount}${mutation.path}`,
        {
          method: mutation.method,
          headers: {
            Authorization: `Device ${admin.deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mutation.body),
        },
      );
      expect(
        response.status,
        `admin ${mutation.method} ${mutation.mount}${mutation.path}`,
      ).toBe(mutation.success);
    }

    const decided = await new AgentOrgProposalsRepository().findByIdAsync(
      proposal.id,
    );
    expect(decided).toMatchObject({
      status: 'rejected',
      decidedByUserId: admin.userId,
    });
  });

  it('never exposes run-quality backend errors to a paired device', async () => {
    const { deviceToken } = await pair(
      `quality-error-${randomUUID()}@example.com`,
    );
    db.exec('DROP TABLE agent_sessions');
    const response = await fetch(
      `${baseUrl}/mobile-gateway/tools/agents/run-quality`,
      { headers: { Authorization: `Device ${deviceToken}` } },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'run quality rollup unavailable',
    });
  });

  it('requires Device auth and keeps blocked administrative surfaces unreachable', async () => {
    const unauthenticated = await fetch(
      `${baseUrl}/mobile-gateway/tools/agent-memory`,
    );
    expect(unauthenticated.status).toBe(401);
    const { deviceToken } = await pair(`allowlist-${randomUUID()}@example.com`);
    const headers = {
      Authorization: `Device ${deviceToken}`,
      'Content-Type': 'application/json',
    };
    for (const [method, path] of [
      ['POST', '/agent-memory/sync'],
      ['POST', '/agent-webhooks/x/receive'],
      ['GET', '/agent-configs/export'],
      ['POST', '/agent-configs/x/security-lock'],
      ['POST', '/agent-org-proposals/x/revert'],
      ['POST', '/agents/run-quality/tool-events'],
    ]) {
      const response = await fetch(
        `${baseUrl}/mobile-gateway/tools${path}`,
        { method, headers, body: method === 'GET' ? undefined : '{}' },
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });
});
