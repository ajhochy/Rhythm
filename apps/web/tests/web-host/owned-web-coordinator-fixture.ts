import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Page, Request } from '@playwright/test';
import { expect, responseFor, assertResponse, type ParitySandbox, type Row } from './parity-fixture';

export type PrimaryRoot = Row & { id: string; project_id: string; owner_user_id: number;
  cwd: string; profile_id: string; coordinator_conversation_json: string };

/** UI setup-command ownership supplements the canonical synthetic sandbox guard. */
export class OwnedWebCoordinator {
  readonly keys = new Set<string>();
  readonly projectsBefore: Row[];
  private readonly observe: (request: Request) => void;

  constructor(readonly page: Page, readonly parity: ParitySandbox) {
    expect(this.roots(), 'Each Coordinator case requires a fresh synthetic owner with no root').toEqual([]);
    this.projectsBefore = this.projects();
    this.observe = request => {
      if (request.method() !== 'POST' || request.url() !== `${parity.origin}/coordinator-conversations/setup`) return;
      expect(request.headers().authorization).toBeUndefined();
      const body = request.postDataJSON();
      if (typeof body?.commandKey === 'string' && body.commandKey.length > 0) this.keys.add(body.commandKey);
    };
    page.on('request', this.observe);
    parity.deferCleanup('Coordinator roots, setup projects and exact owned workspaces', () => this.cleanup());
  }

  roots(): PrimaryRoot[] {
    return this.parity.rows(`SELECT id,name,project_id,owner_user_id,profile_id,sdk_session_id,cwd,
      parent_session_id,is_system,category,archived_at,coordinator_conversation_json
      FROM agent_sessions WHERE owner_user_id=1 AND coordinator_conversation_json IS NOT NULL ORDER BY id`) as PrimaryRoot[];
  }

  projects() { return this.parity.rows('SELECT id FROM projects WHERE coordinator_owner_user_id=1 ORDER BY id'); }

  existing(): PrimaryRoot {
    const roots = this.roots();
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root).toMatchObject({ owner_user_id: 1, parent_session_id: null, is_system: 0,
      category: 'chat', archived_at: null, profile_id: 'local-lean', sdk_session_id: null });
    expect(JSON.parse(root.coordinator_conversation_json)).toMatchObject({ schemaVersion: 4,
      sessionId: root.id, projectId: root.project_id, ownerUserId: 1, primaryOwnerRoot: true, goals: [] });
    const projects = this.parity.rows('SELECT * FROM projects WHERE id=?', root.project_id);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ coordinator_owner_user_id: 1, archived_at: null, cwd: root.cwd,
      coordinator_setup_provenance: 'c2_fresh_owned_workspace_v1', coordinator_profile_id: 'local-lean' });
    expect(this.keys.has(projects[0].coordinator_setup_key), 'Root must belong to this test setup command').toBe(true);
    this.workspace(root.cwd);
    return root;
  }

  workspace(cwd: string) {
    const parent = fs.realpathSync(path.join(this.parity.sandbox, 'live-artifacts/coordinator-workspaces'));
    const relative = path.relative(parent, cwd);
    assert(path.isAbsolute(cwd) && path.resolve(cwd) === cwd && fs.realpathSync(cwd) === cwd);
    assert(relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    const stat = fs.lstatSync(cwd);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0);
    return { parent, stat };
  }

  async choose() {
    const resolved = responseFor(this.page, 'POST', '/coordinator-conversations/resolve');
    const choice = responseFor(this.page, 'POST', '/coordinator-conversations/setup');
    await this.page.getByTestId('rhythm-primary-entry').click();
    const resolve = await resolved;
    await assertResponse(resolve, 'POST', '/coordinator-conversations/resolve', 503);
    expect(await resolve.json()).toEqual({ kind: 'setup_unavailable' });
    const response = await choice;
    await assertResponse(response, 'POST', '/coordinator-conversations/setup', 200);
    expect(await response.json()).toMatchObject({ kind: 'setup_profile_choice_required',
      profileChoices: expect.arrayContaining([{ id: 'local-lean', label: expect.any(String) }]) });
    await expect(this.page.getByTestId('rhythm-setup-dialog')).toBeVisible();
    await expect(this.page.getByTestId('rhythm-setup-profile-local-lean')).toBeVisible();
    await expect(this.page.getByTestId('rhythm-primary-status')).toHaveText('Choose a Rhythm profile to finish setup.');
    expect(this.roots()).toEqual([]);
    expect(this.projects()).toEqual(this.projectsBefore);
  }

  async createFromChoice() {
    const created = responseFor(this.page, 'POST', '/coordinator-conversations/setup');
    const opened = responseFor(this.page, 'POST', '/coordinator-conversations/open');
    const history = responseFor(this.page, 'POST', '/coordinator-conversations/history');
    await this.page.getByTestId('rhythm-setup-profile-local-lean').click();
    const response = await created;
    await assertResponse(response, 'POST', '/coordinator-conversations/setup', 201);
    const body = await response.json();
    expect(body).toMatchObject({ kind: 'setup_created', sessionId: expect.any(String), projectId: expect.any(String),
      profileId: 'local-lean', conversation: { schemaVersion: 4, sessionId: body.sessionId,
        projectId: body.projectId, ownerUserId: 1, primaryOwnerRoot: true, goals: [] } });
    const openResponse = await opened;
    await assertResponse(openResponse, 'POST', '/coordinator-conversations/open', 200);
    expect(await openResponse.json()).toMatchObject({ kind: 'replay', conversation: {
      sessionId: body.sessionId, projectId: body.projectId, ownerUserId: 1, primaryOwnerRoot: true } });
    const historyResponse = await history;
    await assertResponse(historyResponse, 'POST', '/coordinator-conversations/history', 200);
    expect(await historyResponse.json()).toMatchObject({ kind: 'history', conversation: {
      sessionId: body.sessionId, projectId: body.projectId, ownerUserId: 1, primaryOwnerRoot: true }, messages: [], hasMore: false });
    await expect(this.page.getByTestId('rhythm-setup-dialog')).toBeHidden();
    await expect(this.page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
    await expect(this.page.getByTestId(`session-${body.sessionId}`)).toHaveAttribute('aria-current', 'true');
    const root = this.existing();
    expect(root).toMatchObject({ id: body.sessionId, project_id: body.projectId });
    return root;
  }

  async create() { await this.choose(); return this.createFromChoice(); }

  async reopen() {
    const root = this.existing();
    await this.page.route('**/coordinator-conversations/setup', route => route.abort('blockedbyclient'));
    const resolved = responseFor(this.page, 'POST', '/coordinator-conversations/resolve');
    await this.page.getByTestId('rhythm-primary-entry').click();
    const response = await resolved;
    await assertResponse(response, 'POST', '/coordinator-conversations/resolve', 200);
    expect(await response.json()).toMatchObject({ kind: 'resolved', created: false, sessionId: root.id,
      projectId: root.project_id, conversation: { ownerUserId: 1, primaryOwnerRoot: true } });
    await expect(this.page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
    await expect(this.page.getByTestId('composer-input')).toBeEnabled();
    return root;
  }

  counts(root: PrimaryRoot) {
    const count = (sql: string, value?: string) => this.parity.rows(sql, ...(value === undefined ? [] : [value]))[0].n;
    return {
      projectSessions: count('SELECT count(*) n FROM agent_sessions WHERE project_id=?', root.project_id),
      rootChildren: count('SELECT count(*) n FROM agent_sessions WHERE parent_session_id=?', root.id),
      journalCommands: count('SELECT count(*) n FROM coordinator_conversation_commands WHERE root_session_id=?', root.id),
      mirroredMessages: count('SELECT count(*) n FROM agent_session_messages WHERE session_id=?', root.id),
      asyncDelegations: count('SELECT count(*) n FROM agent_async_delegations WHERE parent_session_id=?', root.id),
      workstreams: count('SELECT count(*) n FROM agent_workstreams WHERE project_id=?', root.project_id),
      pendingChildren: count('SELECT count(*) n FROM agent_pending_child_sessions'),
    };
  }

  async expectIdle(cwd: string) {
    this.workspace(cwd);
    const read = async (route: string) => {
      const response = await fetch(`http://127.0.0.1:${this.parity.enginePort}${route}?directory=${encodeURIComponent(cwd)}`,
        { signal: AbortSignal.timeout(20_000) });
      expect(response.status).toBe(200);
      return response.json();
    };
    const sessions = await read('/session');
    expect(Array.isArray(sessions)).toBe(true);
    for (const session of sessions) { expect(typeof session.id).toBe('string'); expect(typeof session.directory).toBe('string'); }
    expect(sessions.filter((session: { directory: string }) => session.directory === cwd)).toEqual([]);
    const status = await read('/session/status');
    expect(status !== null && typeof status === 'object' && !Array.isArray(status)).toBe(true);
  }

  async cleanup() {
    this.page.off('request', this.observe);
    for (const key of this.keys) {
      const projects = this.parity.rows(`SELECT id,cwd,coordinator_owner_user_id,coordinator_setup_key,
        coordinator_setup_provenance FROM projects WHERE coordinator_owner_user_id=1 AND coordinator_setup_key=?`, key);
      for (const project of projects) {
        expect(this.projectsBefore.some(before => before.id === project.id)).toBe(false);
        expect(project.coordinator_setup_provenance).toBe('c2_fresh_owned_workspace_v1');
        this.workspace(project.cwd);
        const rows = this.parity.rows('SELECT id,owner_user_id,sdk_session_id,coordinator_conversation_json FROM agent_sessions WHERE project_id=?', project.id);
        expect(rows.length).toBeLessThanOrEqual(1);
        for (const row of rows) {
          expect(row).toMatchObject({ owner_user_id: 1, sdk_session_id: null });
          expect(JSON.parse(row.coordinator_conversation_json)).toMatchObject({ sessionId: row.id,
            projectId: project.id, ownerUserId: 1, primaryOwnerRoot: true, goals: [] });
          expect((await this.parity.api.fetch(`/agent-sessions/${row.id}/hard`, { method: 'DELETE' })).status).toBe(204);
          expect((await this.parity.api.fetch(`/agent-sessions/${row.id}`)).status).toBe(404);
          expect(this.parity.rows('SELECT id FROM agent_sessions WHERE id=?', row.id)).toEqual([]);
          expect(this.parity.rows('SELECT id FROM agent_session_messages WHERE session_id=?', row.id)).toEqual([]);
        }
        expect((await this.parity.api.fetch(`/projects/${project.id}`, { method: 'DELETE' })).status).toBe(204);
        expect((await this.parity.api.fetch(`/projects/${project.id}`)).status).toBe(404);
        expect(this.parity.rows('SELECT id FROM projects WHERE id=?', project.id)).toEqual([]);
        expect(fs.readdirSync(project.cwd), 'Metadata-only primary workspace must remain empty').toEqual([]);
        fs.rmdirSync(project.cwd);
        expect(fs.existsSync(project.cwd)).toBe(false);
      }
    }
    expect(this.roots()).toEqual([]);
    expect(this.projects()).toEqual(this.projectsBefore);
  }
}

export async function openRuns(page: Page) {
  const details = page.getByTestId('session-details');
  if (await details.getAttribute('aria-expanded') === 'false') await details.click();
  const collapsed = page.getByTestId('inspector-collapsed-runs');
  if (await collapsed.isVisible()) await collapsed.click(); else await page.getByTestId('inspector-runs').click();
  await expect(page.getByTestId('coordinator-conversation-card')).toContainText('Coding runs');
}
