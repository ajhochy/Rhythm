import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe('Phase 8 collaboration APIs', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let workspaceRepo: WorkspaceRepository;
  let projectTemplatesRepo: ProjectTemplatesRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    workspaceRepo = new WorkspaceRepository();
    projectTemplatesRepo = new ProjectTemplatesRepository();

    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
  });

  async function authHeaderFor(userId: number) {
    const session = await sessionsRepo.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  it('adds and removes rhythm collaborators with collaborator-scoped visibility', async () => {
    const owner = usersRepo.create({ name: 'Alice Owner', email: 'alice@example.com' });
    const collaborator = usersRepo.create({ name: 'Bob Collaborator', email: 'bob@example.com' });

    const ownerHeaders = await authHeaderFor(owner.id);
    const collaboratorHeaders = await authHeaderFor(collaborator.id);

    const createResponse = await fetch(`${baseUrl}/recurring-rules`, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Sunday Prep',
        frequency: 'weekly',
        dayOfWeek: 0,
        steps: [{ title: 'Prep charts' }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdRule = await readJson(createResponse);

    const addResponse = await fetch(`${baseUrl}/recurring-rules/${createdRule.id}/collaborators`, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: collaborator.id }),
    });
    expect(addResponse.status).toBe(200);

    const collaboratorListResponse = await fetch(`${baseUrl}/recurring-rules`, {
      headers: collaboratorHeaders,
    });
    expect(collaboratorListResponse.status).toBe(200);
    const collaboratorRules = await readJson(collaboratorListResponse) as Array<Record<string, unknown>>;
    expect(collaboratorRules).toHaveLength(1);
    expect(collaboratorRules[0].title).toBe('Sunday Prep');

    const detailResponse = await fetch(`${baseUrl}/recurring-rules/${createdRule.id}`, {
      headers: ownerHeaders,
    });
    expect(detailResponse.status).toBe(200);
    const detailedRule = await readJson(detailResponse) as { collaborators: Array<{ name: string; userId: number }> };
    expect(detailedRule.collaborators).toEqual([
      expect.objectContaining({
        userId: collaborator.id,
        name: 'Bob Collaborator',
      }),
    ]);

    const removeResponse = await fetch(
      `${baseUrl}/recurring-rules/${createdRule.id}/collaborators/${collaborator.id}`,
      {
        method: 'DELETE',
        headers: ownerHeaders,
      },
    );
    expect(removeResponse.status).toBe(204);

    const afterRemovalResponse = await fetch(`${baseUrl}/recurring-rules`, {
      headers: collaboratorHeaders,
    });
    const afterRemovalRules = await readJson(afterRemovalResponse) as Array<Record<string, unknown>>;
    expect(afterRemovalRules).toHaveLength(0);
  });

  it('supports project template and instance step assignees', async () => {
    const owner = usersRepo.create({ name: 'Alice Owner', email: 'alice2@example.com' });
    const firstAssignee = usersRepo.create({ name: 'Bob Assignee', email: 'bob2@example.com' });
    const secondAssignee = usersRepo.create({ name: 'Carol Reassigned', email: 'carol@example.com' });

    const headers = await authHeaderFor(owner.id);

    const createTemplateResponse = await fetch(`${baseUrl}/project-templates`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Service Template' }),
    });
    expect(createTemplateResponse.status).toBe(201);
    const template = await readJson(createTemplateResponse) as { id: string };

    const addStepResponse = await fetch(`${baseUrl}/project-templates/${template.id}/steps`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Lead rehearsal',
        offsetDays: 2,
        assigneeId: firstAssignee.id,
      }),
    });
    expect(addStepResponse.status).toBe(201);
    const createdStep = await readJson(addStepResponse) as {
      id: string;
      assigneeId: number | null;
      assigneeName: string | null;
    };
    expect(createdStep.assigneeId).toBe(firstAssignee.id);
    expect(createdStep.assigneeName).toBe('Bob Assignee');

    const templateDetailResponse = await fetch(`${baseUrl}/project-templates/${template.id}`, {
      headers,
    });
    const templateDetail = await readJson(templateDetailResponse) as {
      steps: Array<{ assigneeId: number | null; assigneeName: string | null }>;
    };
    expect(templateDetail.steps[0].assigneeId).toBe(firstAssignee.id);
    expect(templateDetail.steps[0].assigneeName).toBe('Bob Assignee');

    const generateResponse = await fetch(`${baseUrl}/project-templates/${template.id}/generate`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ anchorDate: '2026-04-14' }),
    });
    expect(generateResponse.status).toBe(201);
    const instance = await readJson(generateResponse) as {
      steps: Array<{ id: string; assigneeId: number | null; assigneeName: string | null }>;
    };
    expect(instance.steps[0].assigneeId).toBe(firstAssignee.id);
    expect(instance.steps[0].assigneeName).toBe('Bob Assignee');

    const updateInstanceStepResponse = await fetch(
      `${baseUrl}/project-instances/steps/${instance.steps[0].id}`,
      {
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assigneeId: secondAssignee.id }),
      },
    );
    expect(updateInstanceStepResponse.status).toBe(200);
    const updatedStep = await readJson(updateInstanceStepResponse) as {
      assigneeId: number | null;
      assigneeName: string | null;
    };
    expect(updatedStep.assigneeId).toBe(secondAssignee.id);
    expect(updatedStep.assigneeName).toBe('Carol Reassigned');
  });

  it('lets workspace admins directly add existing users as members', async () => {
    const admin = usersRepo.create({ name: 'Admin', email: 'admin@example.com' });
    const staff = usersRepo.create({ name: 'Staff', email: 'staff@example.com' });
    const added = usersRepo.create({ name: 'Added User', email: 'added@example.com' });
    const workspace = workspaceRepo.create({ name: 'Grace Church', createdBy: admin.id });
    workspaceRepo.joinByCode(workspace.joinCode, staff.id);

    const adminHeaders = await authHeaderFor(admin.id);
    const staffHeaders = await authHeaderFor(staff.id);

    const adminAddResponse = await fetch(`${baseUrl}/workspaces/me/members/add`, {
      method: 'POST',
      headers: {
        ...adminHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: added.id }),
    });
    expect(adminAddResponse.status).toBe(200);
    const members = await readJson(adminAddResponse) as Array<{ userId: number }>;
    expect(members.map((member) => member.userId)).toEqual(
      expect.arrayContaining([admin.id, staff.id, added.id]),
    );

    const repeatAddResponse = await fetch(`${baseUrl}/workspaces/me/members/add`, {
      method: 'POST',
      headers: {
        ...adminHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: added.id }),
    });
    expect(repeatAddResponse.status).toBe(200);
    const repeatedMembers = await readJson(repeatAddResponse) as Array<{ userId: number }>;
    expect(repeatedMembers.filter((member) => member.userId === added.id)).toHaveLength(1);

    const nonAdminResponse = await fetch(`${baseUrl}/workspaces/me/members/add`, {
      method: 'POST',
      headers: {
        ...staffHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: added.id }),
    });
    expect(nonAdminResponse.status).toBe(403);
  });
});
