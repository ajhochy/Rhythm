import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ObservedApi, expectedRevision, localRows,
  reloadJsonFor, assertResponse } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Schedule = { id: string; name: string; scheduleType: string; scheduledDay: number | null;
  scheduledTime: string | null; timezone: string; enabled: boolean; agentKind: string;
  agentConfigId: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null;
  createdByUserId: number | null };
type Profile = { id: string; label: string; enabled: boolean; isAgent: boolean;
  isManager: boolean; schedulable: boolean; sessionSelectable: boolean;
  autoApproveActions: boolean; modelProvider: string | null; modelId: string | null;
  allowedMcpsJson: string | null; allowedSkillsJson: string | null;
  corePermissionsJson: string | null; allowedDelegatesJson: string | null };
const allowedTools = ['rhythm_read_org_review_context', 'rhythm_read_org_review_session',
  'rhythm_read_org_review_catalog', 'rhythm_submit_org_review_proposal'];
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Org Reviewer] private canonical entry shows exact review policy and an available manual trigger';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }, testInfo) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'only the isolated synthetic actor may be inspected').toBeDefined();
  expect(process.env.RHYTHM_FEATURE_MODEL, 'entry test must not spend a model loan').not.toBe('1');
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } });

  await page.goto('rhythm://app/index.html#/tools/tasks');
  await expect(page.getByTestId('schedule-new')).toBeVisible();
  const { response, body } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules');
  await assertResponse(response, 'GET', '/agent-schedules', 200);
  expect(response.request().headers().authorization === `Bearer ${token}`,
    'the rendered catalog must use this fixture actor').toBe(true);
  expect(Array.isArray(body)).toBe(true);
  const seeded = body.filter(row => row.name === 'Org Reviewer' && row.agentConfigId === 'org-reviewer');
  expect(seeded, 'the canonical reviewer must have one schedule').toHaveLength(1);
  const schedule = seeded[0];
  expect(schedule).toMatchObject({ scheduleType: 'weekly', scheduledDay: 1,
    scheduledTime: '08:30', timezone: 'America/Los_Angeles', enabled: true,
    agentKind: 'opencode', agentConfigId: 'org-reviewer' });
  expect(schedule.createdByUserId === null || schedule.createdByUserId === manifest.ownerUserId,
    'canonical task cannot belong to a foreign account').toBe(true);
  expect(JSON.parse(String(schedule.allowedMcpsJson))).toEqual({ rhythm: allowedTools });
  expect(JSON.parse(String(schedule.allowedSkillsJson))).toEqual(['review-agent-org-health']);
  const taskRows = localRows(`SELECT id,name,schedule_type,scheduled_day,scheduled_time,timezone,enabled,
    agent_kind,agent_config_id,allowed_mcps_json,allowed_skills_json,created_by_user_id
    FROM agent_scheduled_tasks WHERE id=?`, schedule.id);
  expect(taskRows).toHaveLength(1);
  expect(taskRows[0]).toMatchObject({ id: schedule.id, name: schedule.name,
    agent_config_id: schedule.agentConfigId, created_by_user_id: schedule.createdByUserId });
  expect(localRows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', schedule.id)).toEqual([]);
  expect(await api.json<unknown[]>(`/agent-schedules/${schedule.id}/runs`)).toEqual([]);

  const profile = await api.json<Profile>('/agent-configs/org-reviewer');
  expect(profile).toMatchObject({ id: 'org-reviewer', label: 'Org Reviewer', enabled: true,
    isAgent: true, isManager: false, schedulable: true, sessionSelectable: false,
    autoApproveActions: false, modelProvider: 'openai', modelId: 'gpt-5.6-sol' });
  expect(JSON.parse(String(profile.allowedMcpsJson))).toEqual({ rhythm: allowedTools });
  expect(JSON.parse(String(profile.allowedSkillsJson))).toEqual(['review-agent-org-health']);
  expect(JSON.parse(String(profile.allowedDelegatesJson))).toEqual([]);
  const permissions = JSON.parse(String(profile.corePermissionsJson)) as Record<string, unknown>;
  expect(permissions['*']).toBe('deny');
  expect(permissions.task).toBe('deny');
  // The real signed-tool Recon proved the deny-all profile needs this
  // transport grant; its four actual MCP grants remain exact above.
  expect(permissions.mcp_dispatch).toBe('allow');
  for (const tool of allowedTools) expect(permissions[`rhythm_${tool}`]).toBe('allow');
  expect(localRows(`SELECT id,label,model_provider,model_id,allowed_mcps_json,
    allowed_skills_json,core_permissions_json,allowed_delegates_json FROM agent_configs WHERE id=?`,
  profile.id)).toMatchObject([{ id: profile.id, label: profile.label,
    model_provider: profile.modelProvider, model_id: profile.modelId,
    allowed_mcps_json: profile.allowedMcpsJson,
    allowed_skills_json: profile.allowedSkillsJson }]);

  const row = page.getByTestId(`schedule-${schedule.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Org Reviewer');
  await row.click();
  const trigger = page.getByTestId('schedule-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText('Trigger now');
  const disabled = await trigger.getAttribute('aria-disabled');
  expect(disabled === null || disabled === 'false').toBe(true);
  expect(localRows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', schedule.id)).toEqual([]);

  const observation = { sourceRevision: expectedRevision, ownerUserId: manifest.ownerUserId,
    canonicalScheduleId: schedule.id, canonicalScheduleOwnerUserId: schedule.createdByUserId,
    canReadActorEvidence: schedule.createdByUserId === manifest.ownerUserId,
    profileId: profile.id, allowedToolCount: allowedTools.length,
    triggerVisible: true, triggerClicked: false, runCount: 0, modelTurns: 0,
    reviewerScanProven: false, approvalProven: false };
  await testInfo.attach('org-reviewer-entry.json', {
    body: Buffer.from(JSON.stringify(observation, null, 2)), contentType: 'application/json' });
});
