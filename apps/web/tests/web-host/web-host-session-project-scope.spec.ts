import { test, expect, OwnedRecords, responseFor, assertResponse, selectSessionProfile, type ObservedApi } from './parity-fixture';

type Project = { id: string; name: string; cwd: string; archivedAt: string | null };

test('#6: session project scope: owned project and session survive a collapsed-group reload', async ({ page, parity }) => {
  // Catches project selection being dropped from Advanced create, or an explicit group collapse being lost on reload (#1558).
  const sessions = new OwnedRecords(page, parity, 'sessions', 'project-scope');
  const projectName = sessions.prefix;
  let directory: string | undefined;
  let projectId: string | undefined;
  let projectApi: ObservedApi | undefined;
  let preferencesInitiallyAbsent = false;
  try {
    await sessions.open();
    const storedPreferences = await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'));
    preferencesInitiallyAbsent = storedPreferences === null;
    const preferencesBefore = JSON.parse(storedPreferences ?? '{}');
    projectApi = sessions.api;
    directory = parity.cwd;

    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByTestId('rail-add-project').click();
    await page.getByTestId('project-name').fill(projectName);
    await page.getByTestId('project-cwd').fill(directory);
    const createdProject = responseFor(page, 'POST', '/projects');
    await page.getByTestId('add-project-dialog').getByRole('button', { name: 'Create', exact: true }).click();
    const projectResponse = await createdProject;
    projectApi = projectApi ?? sessions.api;
    const projectBody = projectResponse.request().postDataJSON() as { name: string; cwd: string };
    expect(projectBody).toMatchObject({ name: projectName, cwd: directory });
    const project = await projectResponse.json() as Project;
    if (project.id && project.name === projectName && project.cwd === directory) projectId = project.id;
    await assertResponse(projectResponse, 'POST', '/projects', 201);
    expect(project).toMatchObject({ name: projectName, cwd: directory, archivedAt: null });
    expect((await projectApi!.json<Project[]>('/projects?includeArchived=true')).filter(row => row.id === project.id))
      .toMatchObject([{ id: project.id, name: projectName, cwd: directory }]);
    expect(parity.rows('SELECT id,name,cwd FROM projects WHERE id=?', project.id))
      .toMatchObject([{ id: project.id, name: projectName, cwd: directory }]);
    await expect(page.getByTestId('selected-agent-project')).toContainText(directory);
    expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('rhythm-agents-projects-open') ?? '{}'))).toEqual(preferencesBefore);

    // The new empty project is closed by default; reopen it after reload and select its exact row.
    const group = page.getByTestId(`group-project-${project.id}`);
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click();
    await page.getByRole('button', { name: `Select project ${projectName}`, exact: true }).click();
    await expect(page.getByTestId('selected-agent-project')).toContainText(directory);
    await page.getByTestId('new-session-advanced').click();
    await selectSessionProfile(page);
    await expect(page.getByTestId('advanced-cwd')).toHaveValue(directory);
    await page.getByTestId('advanced-name').fill(`${sessions.prefix} session`);
    await page.getByTestId('advanced-isolate-worktree').uncheck();
    const createdSession = responseFor(page, 'POST', '/agent-sessions');
    await page.getByTestId('advanced-create').click();
    const sessionResponse = await createdSession;
    const sessionBody = sessionResponse.request().postDataJSON() as Record<string, unknown>;
    expect(sessionBody).toMatchObject({ name: `${sessions.prefix} session`, cwd: directory, projectId: project.id, isolateWorktree: false });
    const session = await sessionResponse.json() as { id: string; name: string; cwd: string; projectId: string; profileId: string };
    if (session.id && sessions.owns(session.name)) sessions.remember(session);
    await assertResponse(sessionResponse, 'POST', '/agent-sessions', 201);
    expect(session).toMatchObject({ name: `${sessions.prefix} session`, cwd: directory, projectId: project.id });
    expect(await sessions.read(session.id)).toMatchObject({ id: session.id, name: session.name, cwd: directory, projectId: project.id });
    expect(parity.rows('SELECT id,name,cwd,project_id,category FROM agent_sessions WHERE id=?', session.id))
      .toMatchObject([{ id: session.id, name: session.name, cwd: directory, project_id: project.id, category: 'chat' }]);

    await expect(page.getByTestId(`session-${session.id}`)).toHaveAttribute('aria-current', 'true');
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`session-${session.id}`)).toHaveCount(0);
    const hydrated = responseFor(page, 'GET', `/agent-sessions/${session.id}`);
    await page.reload();
    await assertResponse(await hydrated, 'GET', `/agent-sessions/${session.id}`, 200);
    await expect(page.getByTestId('scope-chats')).toHaveAttribute('aria-selected', 'true');
    // #1558 Repair 3 supersedes the earlier contract: selected group reopens without rewriting stored false.
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(id => JSON.parse(window.localStorage.getItem('rhythm-agents-projects-open') ?? '{}')[id], project.id)).toBe(false);
    await expect(page.getByTestId(`session-${session.id}`)).toContainText(session.name);
    await expect(page.getByTestId(`session-${session.id}`)).toHaveAttribute('aria-current', 'true');
    expect(await sessions.read(session.id)).toMatchObject({ projectId: project.id, cwd: directory });
  } finally {
    const cleanupErrors: unknown[] = [];
    try { await page.goto('/#/tools/agent-tools'); } catch (error) { cleanupErrors.push(error); }
    try { await sessions.cleanup(); } catch (error) { cleanupErrors.push(error); }
    if (projectApi && directory) {
      try {
        // A POST may have committed even if its response was lost; adopt only this test's exact name and cwd.
        const owned = (await projectApi.json<Project[]>('/projects?includeArchived=true'))
          .filter(row => row.name === projectName && row.cwd === directory);
        if (projectId) expect(owned.map(row => row.id)).toContain(projectId);
        for (const row of owned) {
          expect(parity.rows('SELECT id,name,cwd FROM projects WHERE id=?', row.id))
            .toMatchObject([{ id: row.id, name: projectName, cwd: directory }]);
          const removed = await projectApi.fetch(`/projects/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
          expect(removed.status, 'owned project deletion must succeed after owned session cleanup').toBe(204);
          expect(parity.rows('SELECT id FROM projects WHERE id=?', row.id)).toEqual([]);
        }
        expect((await projectApi.json<Project[]>('/projects?includeArchived=true'))
          .filter(row => row.name === projectName && row.cwd === directory)).toEqual([]);
        expect(parity.rows('SELECT id FROM projects WHERE name=? AND cwd=?', projectName, directory)).toEqual([]);
        // Remove only preferences for the exact projects just deleted; preserve every pre-existing project choice.
        await page.evaluate(({ ids, initiallyAbsent }) => {
          const key = 'rhythm-agents-projects-open';
          const values = JSON.parse(window.localStorage.getItem(key) ?? '{}');
          for (const id of ids) delete values[id];
          if (initiallyAbsent && Object.keys(values).length === 0) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(values));
        }, { ids: owned.map(row => row.id), initiallyAbsent: preferencesInitiallyAbsent });
      } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned project/session cleanup failed');
  }
});
