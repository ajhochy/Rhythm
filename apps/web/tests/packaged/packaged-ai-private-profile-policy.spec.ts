import { test as unverified, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { test, expect, API, ENGINE, ObservedApi, assertResponse, responseFor, reloadJsonFor,
  localRows, expectedRevision, OwnedRecords } from './feature-test';

type ProfileDto = Record<string, any> & { id: string; label: string; revision?: number };
type SessionDto = Record<string, any> & { id: string; name: string; profileId: string; sdkSessionId: string };
type ApiClient = InstanceType<typeof ObservedApi>;
const title = '[AI profile policy] saved model, permissions, skills and tools survive reload and bind a new session';
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const explicitlyBound = Boolean(manifestPath && process.env.RHYTHM_FEATURE_MODEL === '1');

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

if (!explicitlyBound) {
  // Register a raw test without the packaged fixtures so a default discovery run cannot open an app.
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable actor manifest and bounded model loan are required'); });
} else test(title, async ({ page }, testInfo) => {
  const { manifest } = readQualificationFixture(manifestPath!, expectedRevision);
  expect(manifest.syntheticActor, 'profile writes require the disposable synthetic actor').toBeDefined();
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: selected-default private loan required').toBe('1');
  const loan = manifest.syntheticActor?.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  const now = Date.now();
  expect(loan && Number.isSafeInteger(loan.issuedAt) && Number.isSafeInteger(loan.stopAt)
    && Number.isSafeInteger(loan.expires) && loan.issuedAt <= now && loan.stopAt > now + 120_000
    && loan.stopAt <= loan.expires - 1_200_000 && loan.stopAt - loan.issuedAt <= 600_000,
    'UNVERIFIED: bounded model loan must be current even though this case sends no prompt').toBe(true);
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
    user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
  });

  const nonce = randomUUID().slice(0, 12);
  const label = `[smoke] profile policy ${nonce}`;
  const promptMarker = `Policy recon ${nonce}`;
  let profileId = '';
  let profileApi: ApiClient | undefined;
  const sessions = new OwnedRecords(page, 'sessions', `profile-policy-${nonce}`);
  let sessionId = '';
  let sessionSdkId = '';

  try {
    // First boot can show a configured-but-empty MCP catalog until the normal
    // renderer auth restoration registers Rhythm. Observe that boundary.
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    const ensurePending = responseFor(page, 'POST', '/opencode/mcp/rhythm/ensure');
    await page.reload();
    const ensure = await ensurePending;
    await assertResponse(ensure, 'POST', '/opencode/mcp/rhythm/ensure', 200);
    expect(ensure.request().headers().authorization === `Bearer ${token}`).toBe(true);
    expect(await ensure.json()).toMatchObject({ registered: true });
    const servers = await api.json<Array<{ name: string; status: string; tools: string[] }>>('/opencode/mcp');
    expect(servers.find(server => server.name === 'rhythm')).toMatchObject({
      status: 'connected', tools: expect.arrayContaining(['rhythm_ping']),
    });

    // Explicitly select a currently authorized model and make only that
    // synthetic actor's catalog row visible before the renderer picker opens.
    const catalog = await api.json<Array<{ provider: string; modelId: string; visible: boolean; authorized: boolean }>>('/agents/models/catalog/full');
    const eligible = catalog.filter(row => row.provider === 'openai' && row.authorized && /^gpt-/.test(row.modelId));
    const chosen = eligible.find(row => row.modelId === 'gpt-6-luna') ?? eligible[0];
    expect(chosen, 'UNVERIFIED: loan-backed OpenAI model catalog is unavailable').toBeDefined();
    if (!chosen!.visible) {
      const visibility = await api.fetch('/agent-models/visibility', { method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: [{ provider: chosen!.provider, modelId: chosen!.modelId, visible: true }] }) });
      expect(visibility.status).toBe(200);
    }
    expect((await api.json<typeof catalog>('/agents/models/catalog/full'))
      .find(row => row.provider === chosen!.provider && row.modelId === chosen!.modelId))
      .toMatchObject({ visible: true, authorized: true });

    await page.goto('rhythm://app/index.html#/profiles');
    await expect(page.getByTestId('profile-create')).toBeVisible();
    const { response: listResponse, body: profileCatalog } = await reloadJsonFor<ProfileDto[]>(page, '/agent-configs');
    await assertResponse(listResponse, 'GET', '/agent-configs', 200);
    expect(listResponse.request().headers().authorization === `Bearer ${token}`).toBe(true);
    expect(Array.isArray(profileCatalog)).toBe(true);
    profileApi = api;

    await page.getByTestId('profile-create').click();
    await page.getByTestId('profile-label').fill(label);

    await profilePolicyOpenGroup(page, 'Provider, model & account');
    const provider = page.getByTestId('profile-provider');
    const providerId = chosen!.provider;
    await expect(provider.locator(`option[value="${providerId}"]`)).toBeEnabled();
    await provider.selectOption(providerId);
    const model = page.getByTestId('profile-model');
    const modelId = chosen!.modelId;
    await expect(model.locator(`option[value="${modelId}"]`), 'model must be rendered eligible').toBeEnabled();
    await model.selectOption(modelId);

    await profilePolicyOpenGroup(page, 'Permissions');
    await page.getByTestId('permission-bash').selectOption('deny');

    await profilePolicyOpenGroup(page, 'Allowed skills');
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
    expect(savedMcpTools, 'the UI selection must persist exactly one live MCP tool').toHaveLength(1);

    const dbCreated = localRows('SELECT id,label,model_provider,model_id,core_permissions_json,allowed_mcps_json,allowed_skills_json FROM agent_configs WHERE id=?', profileId);
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
    const persisted = await profileApi.json<ProfileDto>(`/agent-configs/${encodeURIComponent(profileId)}`);
    expect(persisted).toMatchObject({ id: profileId, label, systemPrompt: promptMarker, modelProvider: providerId, modelId });
    expect(JSON.parse(String(persisted.corePermissionsJson))).toMatchObject({ bash: 'deny' });
    expect(JSON.parse(String(persisted.allowedSkillsJson))).toEqual([skillName]);
    expect(JSON.parse(String(persisted.allowedMcpsJson))).toEqual(savedMcp);
    expect(localRows('SELECT core_permissions_json,allowed_mcps_json,allowed_skills_json,model_provider,model_id,system_prompt FROM agent_configs WHERE id=?', profileId)).toMatchObject([{
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
    sessions.directory = mkdtempSync(`/private/tmp/${sessions.prefix.replace(/[^a-zA-Z0-9-]/g, '-')}-`);
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
      ownerUserId: manifest.ownerUserId, sdkSessionId: expect.any(String) });
    sessionId = session.id;
    sessionSdkId = session.sdkSessionId;
    sessions.remember(session);
    const sessionRead = await sessions.read(sessionId);
    expect(sessionRead).toMatchObject({ id: sessionId, profileId, sdkSessionId: sessionSdkId, name: sessions.prefix });
    expect(localRows('SELECT id,name,profile_id,sdk_session_id,owner_user_id FROM agent_sessions WHERE id=?', sessionId)).toEqual([{
      id: sessionId, name: sessions.prefix, profile_id: profileId, sdk_session_id: sessionSdkId,
      owner_user_id: manifest.ownerUserId,
    }]);
    const engineSession = await fetch(`${ENGINE}/session/${encodeURIComponent(sessionSdkId)}?directory=${encodeURIComponent(sessionDirectory!)}`, { signal: AbortSignal.timeout(15_000) });
    expect(engineSession.status).toBe(200);
    expect(await engineSession.json()).toMatchObject({ id: sessionSdkId, directory: sessionDirectory, cost: 0 });

    await testInfo.attach('profile-policy-observation.json', {
      body: Buffer.from(JSON.stringify({ profileId, label, revision: persisted.revision ?? null,
        modelProvider: providerId, modelId, corePermission: 'bash=deny', selectedSkill: skillName,
        selectedMcpControl: mcpTestId, sessionId, sessionSdkId, ownerUserId: manifest.ownerUserId,
        modelTurns: 0, loanBound: true, catalogAuthorized: true, catalogVisible: true,
        runtimeToolEnforcementClaimed: false }, null, 2)), contentType: 'application/json',
    });
  } finally {
    try { await sessions.cleanup(); }
    finally {
      if (profileId && profileApi) {
        const detail = await profileApi.fetch(`/agent-configs/${encodeURIComponent(profileId)}`);
        if (detail.status === 200) {
          const row = await detail.json() as ProfileDto;
          expect(row.label, 'refuse cleanup unless the exact nonce-owned profile is still present').toBe(label);
          expect((await profileApi.fetch(`/agent-configs/${encodeURIComponent(profileId)}`, { method: 'DELETE' })).status).toBe(204);
        } else expect(detail.status).toBe(404);
        expect(localRows('SELECT id FROM agent_configs WHERE id=?', profileId)).toEqual([]);
      }
      if (sessionId) expect(localRows('SELECT id FROM agent_sessions WHERE id=?', sessionId)).toEqual([]);
    }
  }
});
