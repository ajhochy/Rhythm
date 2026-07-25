import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
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
    expect(isMobileToolOperationAllowed('agent-webhooks', 'POST', '/hook/receive')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/export')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-configs', 'POST', '/profile/security-lock')).toBe(false);
    expect(isMobileToolOperationAllowed('agent-org-proposals', 'POST', '/p/revert')).toBe(false);
    expect(isMobileToolOperationAllowed('agents/run-quality', 'POST', '/tool-events')).toBe(false);
    expect(isMobileToolOperationAllowed('opencode/skills', 'DELETE', '/external')).toBe(true);
    expect(isMobileToolOperationAllowed('opencode/commands', 'PUT', '/managed')).toBe(true);
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
    expect(retry.status).toBe(200);
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
