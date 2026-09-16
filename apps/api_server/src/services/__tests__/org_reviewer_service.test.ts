/**
 * Regression coverage for the reviewer trust boundary. The service, proposal
 * validators, migrations and repositories are real. Only the external engine's
 * read-only capability catalog is replaced; live suites cover that transport.
 * Historical timestamps below are sanitized fixtures in a new :memory: DB.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempManagedSkillsRoot } from '../../__tests__/_managed_skills_temp_root';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { asOpenCodeAgentId, asRhythmProfileId, type CreateAgentSessionDto } from '../../models/agent_session';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { AgentSessionMessagesRepository } from '../../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { opencodeClient } from '../opencode_engine';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { resetProposalPluginsForTests } from '../org_proposal_apply_service';
import { OrgReviewerService, type AuthorizedOrgReviewer } from '../org_reviewer_service';
import {
  ORG_REVIEWER_ALLOWED_MCPS_JSON,
  ORG_REVIEWER_ALLOWED_SKILLS_JSON,
  ORG_REVIEWER_CORE_PERMISSIONS_JSON,
  ORG_REVIEWER_PROFILE_ID,
} from '../org_reviewer_seed';

const managedRoot = useTempManagedSkillsRoot('org-reviewer-service');
const originalPrompt = 'Write the weekly report with the heading OLD REPORT.';
const repairedPrompt = 'Write the weekly report with the heading WEEKLY REPORT.';
const failure = 'The requested WEEKLY REPORT heading was replaced with OLD REPORT.';
type Evidence = { sessionId: string; messageId: string; quote: string };

let db: Database.Database;
let configs: AgentConfigsRepository;
let sessions: AgentSessionsRepository;
let messages: AgentSessionMessagesRepository;
let proposals: AgentOrgProposalsRepository;
let schedules: AgentScheduledTasksRepository;
let service: OrgReviewerService;
let reviewer: AuthorizedOrgReviewer;
let targetId: string;
let evidence: Evidence[];

function session(profileId: string, overrides: Partial<CreateAgentSessionDto> = {}) {
  const row = sessions.insert({
    profileId: asRhythmProfileId(profileId),
    opencodeAgentId: asOpenCodeAgentId(profileId),
    agentKind: 'codex', taskId: null, cwd: managedRoot(),
    name: `Reviewer fixture ${randomUUID()}`, permissionMode: 'default',
    ...overrides,
  });
  const sdkSessionId = `ses_fixture_${randomUUID()}`;
  sessions.setSdkSessionId(row.id, sdkSessionId);
  return { row, sdkSessionId };
}

function occurrence(profileId = targetId, text = failure): Evidence {
  const { row } = session(profileId);
  const messageId = `msg_fixture_${randomUUID()}`;
  messages.upsertStructured(row.id, messageId, 'output', JSON.stringify([{ type: 'text', text }]), null, null);
  return { sessionId: row.id, messageId, quote: failure };
}

async function authorize(overrides: Partial<CreateAgentSessionDto> = {}) {
  const { sdkSessionId } = session(ORG_REVIEWER_PROFILE_ID, overrides);
  return service.authorize({ sdkSessionId, agentName: ORG_REVIEWER_PROFILE_ID, turnId: 'turn-fixture', toolCallId: 'call-fixture' });
}

async function payload(targetRef = `agent_config:${targetId}`, observed = originalPrompt) {
  const context = await service.context({ windowDays: 7, sessionLimit: 40, targetRef }, reviewer);
  return {
    kind: 'refine-config', title: 'Use the required weekly report heading',
    rationale: 'Two independent reports repeat the obsolete heading still required by the profile.',
    evidence, targetRef,
    change: { configPatch: { agentConfigId: targetId, field: 'system_prompt', value: repairedPrompt } },
    currentState: {
      targetRevision: context.targetRevision, targetStateHash: context.targetStateHash,
      checks: [{ source: targetRef.startsWith('scheduled_task:') ? 'schedule' : 'profile', ref: targetRef, observed }],
    },
    confidence: 0.92, dedupKey: 'weekly-report-heading',
    verificationPlan: {
      steps: ['Run a fresh weekly report after human approval and inspect its heading.'],
      expectedOutcome: 'The heading is WEEKLY REPORT.',
      rollback: `Restore the prior system prompt: ${originalPrompt}`,
      risk: 'Only the report heading instruction changes; reviewers verify the next report.',
    },
  };
}

async function expectNoWrite(attempt: Promise<unknown>, statusCode = 400) {
  await expect(attempt).rejects.toMatchObject({ statusCode });
  expect(await proposals.listProposedAsync()).toHaveLength(0);
  expect(configs.getById(targetId)?.systemPrompt).toBe(originalPrompt);
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  configs = new AgentConfigsRepository();
  sessions = new AgentSessionsRepository();
  messages = new AgentSessionMessagesRepository();
  proposals = new AgentOrgProposalsRepository();
  schedules = new AgentScheduledTasksRepository();
  vi.spyOn(opencodeClient, 'isReady', 'get').mockReturnValue(true);
  vi.spyOn(opencodeClient, 'listMcp').mockResolvedValue({ rhythm: { status: 'connected' } });
  vi.spyOn(opencodeClient, 'listMcpToolIds').mockResolvedValue([
    'rhythm_rhythm_read_org_review_context', 'rhythm_rhythm_submit_org_review_proposal',
  ]);
  vi.spyOn(opencodeClient, 'listSkills').mockResolvedValue([]);
  resetProposalPluginsForTests();
  registerAllProposalAppliers();
  configs.insert({
    id: ORG_REVIEWER_PROFILE_ID, label: 'Org Reviewer', icon: 'review',
    enabled: true, isAgent: true, isManager: false, sessionSelectable: false, schedulable: true,
    modelProvider: 'openai', modelId: 'gpt-5.6-sol',
    allowedMcpsJson: ORG_REVIEWER_ALLOWED_MCPS_JSON,
    allowedSkillsJson: ORG_REVIEWER_ALLOWED_SKILLS_JSON,
    corePermissionsJson: ORG_REVIEWER_CORE_PERMISSIONS_JSON,
    allowedDelegatesJson: '[]',
  });
  targetId = configs.insert({
    id: `reviewer-fixture-${randomUUID()}`, label: 'Report fixture', icon: 'report',
    enabled: true, isAgent: true, schedulable: true, systemPrompt: originalPrompt,
    modelProvider: 'openai', modelId: 'gpt-5.6-sol', allowedMcpsJson: '{}', allowedSkillsJson: '[]',
  }).id;
  service = new OrgReviewerService();
  reviewer = await authorize();
  evidence = [occurrence(), occurrence()];
});

afterEach(() => {
  resetProposalPluginsForTests();
  vi.restoreAllMocks();
  db?.close();
});

describe('OrgReviewerService proposal boundary', () => {
  it('persists a validated proposal with proof and rollback, leaving the target unchanged', async () => {
    const submitted = await service.submit(await payload(), reviewer);
    expect(submitted.duplicate).toBe(false);
    const rows = await proposals.listProposedAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'proposed', kind: 'refine-config', ownerUserId: null });
    expect(JSON.parse(rows[0].signalRef!)).toEqual(evidence);
    expect(JSON.parse(rows[0].provenanceJson!)).toMatchObject({
      source: 'org-reviewer', humanReviewRequired: true,
      rootCauseKey: 'weekly-report-heading',
      currentState: { targetStateHash: expect.any(String) },
      verificationPlan: { rollback: expect.stringContaining(originalPrompt), steps: expect.any(Array) },
    });
    expect(configs.getById(targetId)?.systemPrompt).toBe(originalPrompt);
  });

  it('treats a null context target selector as an overview request', async () => {
    const omitted = await service.context({}, reviewer);
    const explicitNull = await service.context({ targetRef: null }, reviewer);
    expect(explicitNull).toEqual(omitted);
    expect(explicitNull).not.toHaveProperty('currentState');
    expect(explicitNull).toHaveProperty('liveCapabilityCatalog');
  });

  it('rejects old messages even when the parent session has fresh activity', async () => {
    // The repository has no historical timestamp input. Only this migrated,
    // test-owned in-memory fixture is dated; no live database is accessed.
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    for (const item of evidence) {
      db.prepare('UPDATE agent_session_messages SET created_at = ? WHERE session_id = ? AND sdk_message_id = ?')
        .run(old, item.sessionId, item.messageId);
      sessions.updatePreview(item.sessionId, 'Fresh unrelated activity', new Date().toISOString());
    }
    await expectNoWrite(service.submit(await payload(), reviewer));
  });

  it('keeps ordinary scheduled-task failures eligible for review', async () => {
    const task = await schedules.createAsync({
      name: 'Normal report schedule', scheduleType: 'weekly', scheduledTime: '08:00', scheduledDay: 1,
      prompt: 'Prepare the weekly report.', agentKind: 'opencode', agentConfigId: targetId,
    });
    evidence = [0, 1].map(() => {
      const { row } = session(targetId, { scheduledTaskId: task.id, category: 'scheduled', isSystem: true });
      const messageId = `msg_fixture_${randomUUID()}`;
      messages.upsertStructured(row.id, messageId, 'output', JSON.stringify([{ type: 'text', text: failure }]), null, null);
      return { sessionId: row.id, messageId, quote: failure };
    });
    const context = await service.context({ targetRef: `agent_config:${targetId}` }, reviewer);
    const visible = (context.sessions as Array<{ sessionId: string }>).map((row) => row.sessionId);
    for (const item of evidence) expect(visible).toContain(item.sessionId);
    expect(await service.submit(await payload(), reviewer)).toMatchObject({ duplicate: false, proposal: { status: 'proposed' } });
  });

  it.each(['proposed', 'rejected', 'applied'])('reuses an equivalent legacy-key %s proposal despite different client dedup and JSON order', async (status) => {
    const legacy = await proposals.createAsync({
      kind: 'refine-config', risk: 'high', status, title: 'Legacy heading diagnosis',
      targetRef: `agent_config:${targetId}`, dedupKey: 'legacy-audit:heading:v2', ownerUserId: null,
      changeJson: JSON.stringify({ configPatch: { value: repairedPrompt, field: 'system_prompt', agentConfigId: targetId } }, null, 2),
    });
    const input = await payload();
    input.title = 'New wording for the same root cause';
    input.dedupKey = randomUUID();
    input.evidence = [...evidence].reverse();
    const result = await service.submit(input, reviewer);
    expect(result).toMatchObject({ duplicate: true, proposal: { id: legacy.id, status } });
    expect(await proposals.listByStatusAsync(status)).toHaveLength(1);
    expect(await proposals.listProposedAsync()).toHaveLength(status === 'proposed' ? 1 : 0);
  });

  it('reuses the same verified root cause and current state when repair wording varies', async () => {
    const firstInput = await payload();
    firstInput.dedupKey = 'Weekly-Report-Heading';
    const first = await service.submit(firstInput, reviewer);
    const firstProposal = first.proposal as { id: string };

    const secondInput = await payload();
    secondInput.title = 'Clarify the weekly heading and date';
    secondInput.dedupKey = 'weekly-report-heading';
    secondInput.change.configPatch.value =
      'Write the weekly report with the heading WEEKLY REPORT and include its date.';
    const second = await service.submit(secondInput, reviewer);

    expect(second).toMatchObject({ duplicate: true, proposal: { id: firstProposal.id } });
    expect(await proposals.listProposedAsync()).toHaveLength(1);
    const context = await service.context({}, reviewer);
    expect(context.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstProposal.id, rootCauseKey: 'weekly-report-heading' }),
    ]));
  });

  it.each([
    ['status', 'applied'], ['ownerUserId', 42], ['risk', 'low'], ['beforeSnapshotJson', '{}'],
  ])('rejects a caller-controlled %s repository field', async (field, value) => {
    await expectNoWrite(service.submit({ ...await payload(), [field]: value }, reviewer));
  });

  it.each(['{"general":"allow"}', '["general","general"]', '[false]'])('rejects malformed delegate repair %s', async (value) => {
    const input = await payload();
    input.change.configPatch = { agentConfigId: targetId, field: 'allowedDelegatesJson', value };
    await expectNoWrite(service.submit(input, reviewer));
  });

  it.each([
    ['scheduledTime', '25:90'], ['cronExpression', '99 99 99 99 99'], ['agentConfigId', 'missing-profile'],
  ])('rejects an invalid scheduled task %s repair', async (field, value) => {
    const task = await schedules.createAsync({
      name: 'Report fixture schedule', scheduleType: 'daily', scheduledTime: '08:00',
      prompt: 'Prepare the weekly report.', agentKind: 'opencode', agentConfigId: targetId,
    });
    const input = await payload(`scheduled_task:${task.id}`, task.prompt);
    await expectNoWrite(service.submit({
      ...input, kind: 'refine-task', change: { taskPatch: { scheduledTaskId: task.id, field, value } },
    }, reviewer));
  });

  it('rejects quoted evidence omitted by the bounded transcript view', async () => {
    evidence = [occurrence(targetId, `${'x'.repeat(4100)} ${failure}`), occurrence(targetId, `${'y'.repeat(4100)} ${failure}`)];
    const context = await service.context({ windowDays: 7, sessionLimit: 40, targetRef: `agent_config:${targetId}` }, reviewer);
    const shown = context.sessions as Array<{ messages: Array<{ messageId: string; text: string; truncated: boolean }> }>;
    for (const item of evidence) {
      const message = shown.flatMap((row) => row.messages).find((row) => row.messageId === item.messageId)!;
      expect(message).toMatchObject({ truncated: true });
      expect(message.text).not.toContain(item.quote);
    }
    await expectNoWrite(service.submit(await payload(), reviewer));
  });

  it.each([
    ORG_REVIEWER_PROFILE_ID,
    '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f',
    '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a',
  ])('does not treat diagnostic agent %s output as independent failure evidence', async (profileId) => {
    if (profileId !== ORG_REVIEWER_PROFILE_ID) configs.insert({ id: profileId, label: 'Retired diagnostic fixture', icon: 'audit' });
    evidence = [occurrence(profileId), occurrence(profileId)];
    const input = await payload();
    const context = await service.context({ windowDays: 7, sessionLimit: 40 }, reviewer);
    const visibleIds = (context.sessions as Array<{ sessionId: string }>).map((row) => row.sessionId);
    for (const item of evidence) expect(visibleIds).not.toContain(item.sessionId);
    await expectNoWrite(service.submit(input, reviewer));
  });
});

describe('OrgReviewerService bounded context and identity', () => {
  it('fails closed when complete current skill content cannot fit the context budget', async () => {
    const name = `large-reviewer-fixture-${randomUUID()}`;
    const body = 'A concrete report rule. '.repeat(4000);
    const skill = new AgentSkillsRepository().create({ title: name, body, confidence: 1, status: 'active' });
    mkdirSync(join(managedRoot(), name), { recursive: true });
    writeFileSync(join(managedRoot(), name, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture report rules\n---\n${body}`);
    await expect(service.context({ targetRef: `skill:${skill.id}` }, reviewer)).rejects.toMatchObject({ statusCode: 409 });
    expect(await proposals.listProposedAsync()).toHaveLength(0);
  });

  it('fits the actual fenced pretty-printed MCP output under engine byte and line limits, or fails closed', async () => {
    for (let index = 0; index < 70; index++) occurrence(targetId, 'Repeated bounded fixture.');
    let context: Record<string, unknown>;
    try {
      context = await service.context({ windowDays: 7, sessionLimit: 100 }, reviewer);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409 });
      return;
    }
    const rendered = `<<<UNTRUSTED_EXTERNAL_CONTENT>>>\n${JSON.stringify(context, null, 2)}\n<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>`;
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThan(50 * 1024);
    expect(rendered.split('\n').length).toBeLessThan(2000);
  });

  it.each(['bypassPermissions', 'acceptEdits'] as const)('denies reviewer session permission override %s', async (permissionMode) => {
    await expect(authorize({ permissionMode })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('denies a reviewer session carrying broader MCP grants', async () => {
    await expect(authorize({ mcpAllowedToolsJson: '{"rhythm":["*"]}' })).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    { allowedMcpsJson: '{"rhythm":["rhythm_read_org_review_context","rhythm_submit_org_review_proposal","rhythm_create_task"]}' },
    { allowedSkillsJson: '["review-agent-org-health","unrelated-editor"]' },
  ])('denies widened scheduled reviewer overrides %j', async (overrides) => {
    const task = await schedules.createAsync({
      name: 'Reviewer fixture schedule', scheduleType: 'weekly', scheduledDay: 1, scheduledTime: '08:30',
      prompt: 'Review recent organization failures.', agentKind: 'opencode', agentConfigId: ORG_REVIEWER_PROFILE_ID,
      ...overrides,
    });
    await expect(authorize({ scheduledTaskId: task.id })).rejects.toMatchObject({ statusCode: 403 });
  });
});
