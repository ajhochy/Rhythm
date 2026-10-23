// Browser UI policy persistence; no model turn or runtime tool-enforcement claim.
import type { Page } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, reloadJsonFor, OwnedRecords, type Row } from './parity-fixture';
import { prepareScriptedModel, scriptedModel } from './scripted-parity-fixture';
type ProfileDto = Row & { label: string; revision?: number };
type SessionDto = Row & { name: string; profileId: string; sdkSessionId: string };
async function profilePolicyOpenGroup(page: Page, name: string) {
  const groups = page.getByTestId('settings-column-groups');
  const option = groups.getByRole('option', { name, exact: true });
  for (let step = 0; step < 4 && !await option.isVisible(); step++) {
    const back = page.locator('.column-browser-back:visible').first();
    if (!await back.count()) break;
    await back.click();
  }
  await option.click();
  await expect(groups.getByRole('option', { name, exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true');
}

async function profilePolicyShowList(page: Page) {
  const list = page.getByTestId('settings-column-list');
  if (!await list.isVisible()) await page.locator('.column-browser-forward:visible').first().click();
  await expect(list).toBeVisible();
}

test('[web-parity-115] [AI profile policy] saved model, permissions, skills and tools survive reload and bind a new session', async ({ page, parity }, testInfo) => {
  test.setTimeout(150_000);
  await prepareScriptedModel(parity);
  const api = parity.api;
  const label = `${parity.prefix} profile policy`;
  const promptMarker = `${parity.prefix} policy instructions`;
  let profileId = '';
  let sessionId = '';
  let sessionSdkId = '';
  // Register before OwnedRecords: LIFO teardown removes sessions before their profile.
  parity.deferCleanup('delete exact profile policy', async () => {
    const rows = (await api.json<ProfileDto[]>('/agent-configs')).filter(row => row.label === label);
    expect(rows.length).toBeLessThanOrEqual(1);
    for (const row of rows) {
      if (profileId) expect(row.id).toBe(profileId);
      expect(parity.rows('SELECT id FROM agent_sessions WHERE profile_id=?', row.id)).toEqual([]);
      expect((await api.fetch(`/agent-configs/${encodeURIComponent(row.id)}`, { method: 'DELETE' })).status).toBe(204);
      expect(parity.rows('SELECT id FROM agent_configs WHERE id=?', row.id)).toEqual([]);
    }
  });
  const sessions = new OwnedRecords(page, parity, 'sessions', 'profile-policy');
  const servers = await api.json<Array<{ name: string; status: string; tools: string[] }>>('/opencode/mcp');
  expect(servers.find(server => server.name === 'rhythm')).toMatchObject({ status: 'connected', tools: expect.arrayContaining(['rhythm_ping']) });
    await page.goto('/#/profiles');
    await expect(page.getByTestId('profile-create')).toBeVisible();
    const { response: listResponse, body: profileCatalog } = await reloadJsonFor<ProfileDto[]>(page, '/agent-configs', parity.origin);
    await assertResponse(listResponse, 'GET', '/agent-configs', 200);
    ObservedApi.from(listResponse, parity);
    expect(Array.isArray(profileCatalog)).toBe(true);


    await page.getByTestId('profile-create').click();
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue('New profile');
    await page.getByTestId('profile-label').fill(label);

    await profilePolicyOpenGroup(page, 'Provider, model & account');
    const provider = page.getByTestId('profile-provider');
    const providerId = scriptedModel.providerID;
    await expect(provider.locator(`option[value="${providerId}"]`)).toBeEnabled();
    await provider.selectOption(providerId);
    const model = page.getByTestId('profile-model');
    const modelId = scriptedModel.modelID;
    await expect(model.locator(`option[value="${modelId}"]`), 'model must be rendered eligible').toBeEnabled();
    await model.selectOption(modelId);

    await profilePolicyOpenGroup(page, 'Permissions');
    await page.getByTestId('permission-bash').selectOption('deny');

    await profilePolicyOpenGroup(page, 'Allowed skills');
    // The new draft has an explicit empty policy, independent of the previous profile.
    await expect(page.getByRole('radio', { name: /No skills/ })).toBeChecked();
    await page.getByRole('radio', { name: /Selected skills/ }).check();
    await profilePolicyShowList(page);
    const skillRows = page.getByTestId('profile-skill-catalog').locator('input[type="checkbox"][data-testid^="skill-"]');
    await expect(skillRows.first(), 'a live skill catalog item is needed to test a selected allowlist').toBeVisible();
    const skillTestId = await skillRows.first().getAttribute('data-testid');
    expect(skillTestId).toBeTruthy();
    await skillRows.first().check();
    const skillName = skillTestId!.slice('skill-'.length);

    await profilePolicyOpenGroup(page, 'MCPs');
    await page.getByTestId('profile-mcp-mode-selected').check();
    await profilePolicyShowList(page);
    // MCP server groups start collapsed. Filtering through the visible list
    // opens the matching group and lets the user select the live ping tool.
    await page.getByTestId('profile-mcp-filter').fill('rhythm_ping');
    const mcpTestId = 'mcp-rhythm-rhythm_ping';
    const mcpChoice = page.getByTestId('profile-capability-catalog').getByTestId(mcpTestId);
    await expect(mcpChoice, 'the registered Rhythm ping tool must be visible in the selected policy').toBeVisible();
    await mcpChoice.check();

    const create = responseFor(page, 'POST', '/agent-configs');
    await page.getByTestId('profile-save').click();
    const createResponse = await create;
    await assertResponse(createResponse, 'POST', '/agent-configs', 201);
    const created = await createResponse.json() as ProfileDto;
    expect(created).toMatchObject({ label, id: expect.any(String) });
    profileId = created.id;
    expect(profileId.startsWith('profile-created-')).toBe(false);
    expect(created).toMatchObject({ modelProvider: providerId, modelId, enabled: true, sessionSelectable: true });
    expect(JSON.parse(String(created.corePermissionsJson))).toMatchObject({ bash: 'deny' });
    const savedSkills = JSON.parse(String(created.allowedSkillsJson)) as string[];
    expect(savedSkills).toEqual([skillName]);
    const savedMcp = JSON.parse(String(created.allowedMcpsJson)) as Record<string, string[]>;
    const savedMcpTools = Object.values(savedMcp).flat();
    expect(savedMcpTools, 'the UI selection must persist exactly one live MCP tool').toEqual(['rhythm_ping']);
    expect(savedMcp).toEqual({ rhythm: ['rhythm_ping'] });

    const dbCreated = parity.rows('SELECT id,label,model_provider,model_id,core_permissions_json,allowed_mcps_json,allowed_skills_json FROM agent_configs WHERE id=?', profileId);
    expect(dbCreated).toHaveLength(1);
    expect(dbCreated[0]).toMatchObject({ id: profileId, label, model_provider: providerId, model_id: modelId });
    expect(JSON.parse(String(dbCreated[0].core_permissions_json))).toMatchObject({ bash: 'deny' });
    expect(JSON.parse(String(dbCreated[0].allowed_skills_json))).toEqual([skillName]);

    // Saving must leave the exact newly-created profile in the renderer before
    // any follow-up edit; never risk patching a fallback/default profile.
    const savedRow = page.getByTestId(`profile-${profileId}`);
    await expect(savedRow, 'saved profile must remain in the visible editor list').toBeVisible();
    await expect(savedRow, 'saved profile must remain selected after Save').toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    // The prior step was in MCPs. The prompt textarea exists only in Identity.
    await profilePolicyOpenGroup(page, 'Identity & instructions');
    await expect(page.getByTestId('profile-system-prompt')).toBeVisible();
    // A one-field follow-up edit proves the changed-field PATCH retains unrelated policy values.
    await page.getByTestId('profile-system-prompt').fill(promptMarker);
    const patch = responseFor(page, 'PATCH', `/agent-configs/${encodeURIComponent(profileId)}`);
    await page.getByTestId('profile-save').click();
    const patchResponse = await patch;
    await assertResponse(patchResponse, 'PATCH', `/agent-configs/${encodeURIComponent(profileId)}`, 200);
    const patchBody = patchResponse.request().postDataJSON() as Record<string, unknown>;
    expect(patchBody).toMatchObject({ systemPrompt: promptMarker });
    for (const unrelated of ['corePermissionsJson', 'allowedMcpsJson', 'allowedSkillsJson', 'modelProvider', 'modelId'])
      expect(patchBody, `unchanged ${unrelated} must not be re-sent by the changed-field editor`).not.toHaveProperty(unrelated);
    const persisted = await api.json<ProfileDto>(`/agent-configs/${encodeURIComponent(profileId)}`);
    expect(persisted).toMatchObject({ id: profileId, label, systemPrompt: promptMarker, modelProvider: providerId, modelId });
    expect(JSON.parse(String(persisted.corePermissionsJson))).toMatchObject({ bash: 'deny' });
    expect(JSON.parse(String(persisted.allowedSkillsJson))).toEqual([skillName]);
    expect(JSON.parse(String(persisted.allowedMcpsJson))).toEqual(savedMcp);
    expect(parity.rows('SELECT core_permissions_json,allowed_mcps_json,allowed_skills_json,model_provider,model_id,system_prompt FROM agent_configs WHERE id=?', profileId)).toMatchObject([{
      model_provider: providerId, model_id: modelId, system_prompt: promptMarker,
      core_permissions_json: persisted.corePermissionsJson,
      allowed_mcps_json: persisted.allowedMcpsJson,
      allowed_skills_json: persisted.allowedSkillsJson,
    }]);

    await page.reload();
    await page.getByTestId(`profile-${profileId}`).click();
    await profilePolicyOpenGroup(page, 'Identity & instructions');
    await expect(page.getByTestId('profile-label')).toHaveValue(label);
    await expect(page.getByTestId('profile-system-prompt')).toHaveValue(promptMarker);
    await profilePolicyOpenGroup(page, 'Provider, model & account');
    await expect(page.getByTestId('profile-provider')).toHaveValue(providerId);
    await expect(page.getByTestId('profile-model')).toHaveValue(modelId);
    await profilePolicyOpenGroup(page, 'Permissions');
    await expect(page.getByTestId('permission-bash')).toHaveValue('deny');
    await profilePolicyOpenGroup(page, 'Allowed skills');
    await expect(page.getByRole('radio', { name: /Selected skills/ })).toBeChecked();
    await profilePolicyShowList(page);
    await expect(page.getByTestId(`skill-${skillName}`)).toBeChecked();
    await profilePolicyOpenGroup(page, 'MCPs');
    await expect(page.getByTestId('profile-mcp-mode-selected')).toBeChecked();
    await profilePolicyShowList(page);
    await page.getByTestId('profile-mcp-filter').fill('rhythm_ping');
    await expect(page.getByTestId('profile-capability-catalog').getByTestId(mcpTestId)).toBeVisible();
    await expect(page.getByTestId(mcpTestId)).toBeChecked();

    // No model call: create a real session through the normal UI and verify its durable profile binding.
    await sessions.open();
    const sessionDirectory = sessions.directory;
    expect(sessionDirectory).toBeTruthy();
    await page.getByTestId('new-session-advanced').click();
    await page.getByTestId('advanced-profile').selectOption(profileId);
    await page.getByTestId('advanced-name').fill(sessions.prefix);
    await page.getByTestId('advanced-cwd').fill('');
    await page.getByTestId('advanced-cwd').fill(sessionDirectory!);
    await page.getByTestId('advanced-isolate-worktree').uncheck();
    await expect(page.getByTestId('advanced-branch')).toHaveValue('');
    const sessionCreate = responseFor(page, 'POST', '/agent-sessions');
    await page.getByTestId('advanced-create').click();
    const sessionResponse = await sessionCreate;
    await assertResponse(sessionResponse, 'POST', '/agent-sessions', 201);
    const session = await sessionResponse.json() as SessionDto;
    expect(session).toMatchObject({ id: expect.any(String), name: sessions.prefix, profileId, cwd: sessionDirectory,
      ownerUserId: 1, sdkSessionId: expect.any(String) });
    sessionId = session.id;
    sessionSdkId = session.sdkSessionId;
    sessions.remember(session);
    const sessionRead = await sessions.read(sessionId);
    expect(sessionRead).toMatchObject({ id: sessionId, profileId, sdkSessionId: sessionSdkId, name: sessions.prefix });
    expect(parity.rows('SELECT id,name,profile_id,sdk_session_id,owner_user_id FROM agent_sessions WHERE id=?', sessionId)).toEqual([{
      id: sessionId, name: sessions.prefix, profile_id: profileId, sdk_session_id: sessionSdkId,
      owner_user_id: 1,
    }]);
    const engineSession = await parity.engineFetch(`/session/${encodeURIComponent(sessionSdkId)}`);
    expect(engineSession.status).toBe(200);
    expect(await engineSession.json()).toMatchObject({ id: sessionSdkId, directory: sessionDirectory, cost: 0 });

    await testInfo.attach('profile-policy-observation.json', {
      body: Buffer.from(JSON.stringify({ profileId, label, revision: persisted.revision ?? null,
        modelProvider: providerId, modelId, corePermission: 'bash=deny', selectedSkill: skillName,
        selectedMcpControl: mcpTestId, sessionId, sessionSdkId, ownerUserId: 1,
        modelTurns: 0, proof: 'scripted_ui_transport_only', catalogAuthorized: true, catalogVisible: true,
        runtimeToolEnforcementClaimed: false }, null, 2)), contentType: 'application/json',
    });
});
