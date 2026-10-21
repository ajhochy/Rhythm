import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { useTempManagedSkillsRoot } from '../../__tests__/_managed_skills_temp_root';
import { captureOrgEvaluationTargetAsync, prepareOrgEvaluationFixture, type OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';

useTempManagedSkillsRoot('rhythm-evaluation-fixture');

describe('org evaluation fixture', () => {
  it('recreates an MRU fallback with model metadata only in the private database', () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-model-fixture-');
    const snapshot: OrgEvaluationTargetSnapshot = {
      schemaVersion: 1, effectiveModel: { providerID: 'openai', modelID: 'gpt-6.1-sol', source: 'mru' },
      kind: 'create-agent', targetRef: 'agent_config:new-helper', targetRevision: 'absent',
      profiles: [], skills: [], schedules: [], recipes: [], managedSkillFiles: [],
    };
    try {
      const fixture = prepareOrgEvaluationFixture(snapshot, {
        fixtureRoot: join(root, 'owned-fixture'),
        safeMcpCommand: [process.execPath, join(__dirname, '..', 'org_evaluation_mcp_fixture.ts')],
        providerRelayUrl: 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/lease_1/v1',
        relayToken: 'fixture-only-token',
      });
      const db = new Database(fixture.fixtureDb, { readonly: true });
      try {
        expect(db.prepare(`SELECT provider_id,model_id,name,last_preview,session_token,profile_id
          FROM agent_sessions`).all()).toEqual([{
          provider_id: 'openai', model_id: 'gpt-6.1-sol', name: 'Evaluation model metadata',
          last_preview: null, session_token: null, profile_id: null,
        }]);
      } finally { db.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('materializes only a frozen profile and safe local MCP into a read-only disposable DB', () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-fixture-test-');
    const snapshot: OrgEvaluationTargetSnapshot = {
      schemaVersion: 1,
      effectiveModel: { providerID: 'openai', modelID: 'fixture-model', source: 'profile' },
      kind: 'refine-config',
      targetRef: 'agent_config:fixture-agent',
      targetRevision: '3',
      profiles: [{
        id: 'fixture-agent', label: 'Fixture agent', systemPrompt: 'Prior instruction.',
        revision: 3, allowedMcpsJson: '["safe"]', allowedSkillsJson: '[]',
        corePermissionsJson: '{"bash":"deny"}', allowedDelegatesJson: '[]',
        isManager: false, modelProvider: 'openai', modelId: 'fixture-model',
      }],
      skills: [{ id: 'frozen-draft', title: 'Frozen draft', body: null, description: null,
        whenToUse: 'Only for fixture input', version: 2, status: 'draft', confidence: 0.4,
        stepsJson: '["Preserve extracted steps"]', tagsJson: '["fixture"]' }],
      schedules: [], recipes: [], managedSkillFiles: [],
    };
    try {
      const fixture = prepareOrgEvaluationFixture(snapshot, {
        fixtureRoot: join(root, 'owned-fixture'),
        safeMcpCommand: [process.execPath, join(__dirname, '..', 'org_evaluation_mcp_fixture.ts')],
        providerRelayUrl: 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/lease_1/v1',
        relayToken: 'fixture-only-token',
      });
      const db = new Database(fixture.fixtureDb, { readonly: true });
      const row = db.prepare('SELECT id,system_prompt,revision,default_anthropic_account_id FROM agent_configs WHERE id=?')
        .get('fixture-agent') as Record<string, unknown>;
      expect(row).toMatchObject({ id: 'fixture-agent', system_prompt: 'Prior instruction.', revision: 3, default_anthropic_account_id: null });
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT status,confidence,steps_json,tags_json FROM agent_skills WHERE id=?')
        .get('frozen-draft')).toEqual({ status: 'draft', confidence: 0.4,
        steps_json: '["Preserve extracted steps"]', tags_json: '["fixture"]' });
      db.close();
      const providerConfig = JSON.parse(readFileSync(join(fixture.fixtureConfig, 'opencode.json'), 'utf8')) as {
        provider: Record<string, unknown>;
      };
      expect(providerConfig.provider).toHaveProperty('openai');
      expect(providerConfig.provider).not.toHaveProperty('anthropic');
      expect(JSON.stringify(providerConfig)).toContain('127.0.0.1:4796');
      expect(fixture.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('captures a profile without its live account binding or session history', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const old = setDb(db);
    try {
      db.prepare(`INSERT INTO agent_configs
        (id,label,icon,command,system_prompt,revision,allowed_skills_json,default_anthropic_account_id)
        VALUES (?,?,?,?,?,?,?,?)`).run('fixture-agent', 'Fixture agent', 'fixture', 'opencode',
        'Prior instruction.', 3, '[]', 'private-account-id');
      const snapshot = await captureOrgEvaluationTargetAsync({
        kind: 'refine-config', targetRef: 'agent_config:fixture-agent',
        expectedRevision: '3', ownerUserId: null,
      });
      expect(snapshot.profiles).toHaveLength(1);
      expect(JSON.stringify(snapshot)).not.toContain('private-account-id');
      expect(snapshot.profiles[0].systemPrompt).toBe('Prior instruction.');
    } finally {
      setDb(old);
      db.close();
    }
  });

  it('uses the verified agent for a skill and freezes its other skill dependencies', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const old = setDb(db);
    try {
      db.exec("INSERT INTO users(id,name,email) VALUES (7,'Fixture owner','fixture-owner@example.invalid'),(9,'Other fixture','fixture-other@example.invalid')");
      const skills = new AgentSkillsRepository();
      const reviewed = skills.create({ title: 'reviewed-fixture-skill', body: 'Original procedure.', status: 'active' });
      const dependency = skills.create({ title: 'dependency-fixture-skill', body: 'Preserve this procedure.', status: 'active' });
      db.prepare(`INSERT INTO agent_configs(id,label,icon,command,system_prompt,revision,allowed_skills_json)
        VALUES (?,?,?,?,?,?,?)`).run('evidence-agent', 'Evidence agent', 'fixture', 'opencode',
        'Use the actual procedures.', 4, JSON.stringify([reviewed.title, dependency.title]));
      db.prepare(`INSERT INTO agent_sessions(id,agent_kind,profile_id,owner_user_id,category,cwd,name)
        VALUES (?,?,?,?,?,?,?)`).run('evidence-one', 'codex', 'evidence-agent', 7, 'chat', '/private/tmp', 'Fixture one');
      db.prepare(`INSERT INTO agent_sessions(id,agent_kind,profile_id,owner_user_id,category,cwd,name)
        VALUES (?,?,?,?,?,?,?)`).run('evidence-two', 'codex', 'evidence-agent', 7, 'chat', '/private/tmp', 'Fixture two');
      const input = { kind: 'refine-skill' as const, targetRef: `skill:${reviewed.id}`,
        expectedRevision: String(reviewed.version), ownerUserId: 7,
        evidenceSessionIds: ['evidence-one', 'evidence-two'] };
      const snapshot = await captureOrgEvaluationTargetAsync(input);
      expect(snapshot.profiles).toMatchObject([{ id: 'evidence-agent', revision: 4 }]);
      expect(snapshot.skills.map((skill) => skill.id)).toEqual([reviewed.id, dependency.id]);
      db.prepare(`INSERT INTO agent_configs(id,label,icon,command,revision,allowed_skills_json)
        VALUES (?,?,?,?,?,?)`).run('unrelated-agent', 'Unrelated agent', 'fixture', 'opencode', 1, '[]');
      await expect(captureOrgEvaluationTargetAsync({ ...input, kind: 'refine-config',
        targetRef: 'agent_config:unrelated-agent', expectedRevision: '1' }))
        .rejects.toThrow(/Cited sessions do not belong/);
      db.prepare('UPDATE agent_configs SET revision=5 WHERE id=?').run('evidence-agent');
      expect((await captureOrgEvaluationTargetAsync(input)).profiles[0].revision).toBe(5);
      db.prepare('UPDATE agent_sessions SET owner_user_id=9 WHERE id=?').run('evidence-two');
      await expect(captureOrgEvaluationTargetAsync(input)).rejects.toThrow(/owner-scoped/);
    } finally { setDb(old); db.close(); }
  });

  it('rejects a skill that the cited agent cannot load and an unbound recipe without owned evidence', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const old = setDb(db);
    try {
      db.exec("INSERT INTO users(id,name,email) VALUES (7,'Fixture owner','fixture-owner@example.invalid')");
      const skill = new AgentSkillsRepository().create({ title: 'ungranted-fixture-skill', body: 'Procedure.', status: 'active' });
      db.prepare(`INSERT INTO agent_configs(id,label,icon,command,revision,allowed_skills_json)
        VALUES (?,?,?,?,?,?)`).run('evidence-agent', 'Evidence agent', 'fixture', 'opencode', 1, '[]');
      for (const id of ['evidence-one', 'evidence-two']) {
        db.prepare(`INSERT INTO agent_sessions(id,agent_kind,profile_id,owner_user_id,category,cwd,name)
          VALUES (?,?,?,?,?,?,?)`).run(id, 'codex', 'evidence-agent', 7, 'chat', '/private/tmp', 'Fixture conversation');
      }
      const evidence = { ownerUserId: 7, evidenceSessionIds: ['evidence-one', 'evidence-two'] };
      await expect(captureOrgEvaluationTargetAsync({ ...evidence, kind: 'refine-skill',
        targetRef: `skill:${skill.id}`, expectedRevision: String(skill.version) })).rejects.toThrow(/cannot load/);
      const recipe = await new AgentCookbookRepository().createAsync({ title: 'Unbound fixture', stepsJson: '[]', ownerUserId: 7 });
      const input = { kind: 'refine-recipe' as const, targetRef: `recipe:${recipe.id}`,
        expectedRevision: recipe.updatedAt, ownerUserId: 7 };
      await expect(captureOrgEvaluationTargetAsync({ ...input, ...evidence, ownerUserId: null }))
        .rejects.toThrow(/authorized owner scope/);
      await expect(captureOrgEvaluationTargetAsync(input)).rejects.toThrow(/two verified owned sessions/);
      expect((await captureOrgEvaluationTargetAsync({ ...input, ...evidence })).profiles[0].id).toBe('evidence-agent');
    } finally { setDb(old); db.close(); }
  });

  it('preserves the schedule timing, enabled state and model override in the private copy', async () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-schedule-test-');
    const db = new Database(':memory:');
    runMigrations(db);
    const old = setDb(db);
    try {
      db.prepare(`INSERT INTO agent_configs(id,label,icon,command,revision,allowed_skills_json)
        VALUES (?,?,?,?,?,?)`).run('schedule-agent', 'Schedule agent', 'fixture', 'opencode', 1, '[]');
      const task = await new AgentScheduledTasksRepository().createAsync({ name: 'Frozen schedule',
        description: 'Preserve schedule behavior', prompt: 'Report actions.', scheduleType: 'weekly',
        scheduledTime: '09:37', scheduledDay: 2, timezone: 'UTC', enabled: false,
        modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5', agentKind: 'opencode',
        agentConfigId: 'schedule-agent' });
      const snapshot = await captureOrgEvaluationTargetAsync({ kind: 'refine-task',
        targetRef: `scheduled_task:${task.id}`, expectedRevision: task.updatedAt, ownerUserId: null });
      expect(snapshot.schedules[0]).toMatchObject({ scheduledTime: '09:37', scheduledDay: 2,
        timezone: 'UTC', enabled: false, description: 'Preserve schedule behavior',
        modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5' });
      const fixture = prepareOrgEvaluationFixture(snapshot, {
        fixtureRoot: join(root, 'fixture'),
        safeMcpCommand: [process.execPath, join(__dirname, '..', 'org_evaluation_mcp_fixture.ts')],
        providerRelayUrl: 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/lease_schedule/v1',
        relayToken: 'fixture-only-token',
      });
      const copy = new Database(fixture.fixtureDb, { readonly: true });
      try {
        expect(copy.prepare(`SELECT description,scheduled_time,scheduled_day,timezone,enabled,model_provider,model_id
          FROM agent_scheduled_tasks WHERE id=?`).get(task.id)).toEqual({
          description: 'Preserve schedule behavior', scheduled_time: '09:37', scheduled_day: 2,
          timezone: 'UTC', enabled: 0, model_provider: 'anthropic', model_id: 'claude-sonnet-4-5',
        });
      } finally { copy.close(); }
    } finally { setDb(old); db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
