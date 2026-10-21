import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureCreationTargetAsync } from '../org_evaluation_creation_snapshot';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_sessions(id TEXT PRIMARY KEY, owner_user_id INTEGER, category TEXT, profile_id TEXT);
    CREATE TABLE agent_configs(id TEXT PRIMARY KEY, label TEXT, enabled INTEGER, locked INTEGER, revision INTEGER,
      system_prompt TEXT, allowed_mcps_json TEXT, allowed_skills_json TEXT, core_permissions_json TEXT,
      allowed_delegates_json TEXT, is_manager INTEGER, model_provider TEXT, model_id TEXT);
    CREATE TABLE agent_cookbook(id TEXT PRIMARY KEY, title TEXT, owner_user_id INTEGER, bound_config_id TEXT,
      description TEXT, steps_json TEXT, schema_version INTEGER, definition_json TEXT);
    CREATE TABLE agent_scheduled_tasks(id TEXT PRIMARY KEY, name TEXT, prompt TEXT, agent_config_id TEXT,
      created_by_user_id INTEGER, schedule_type TEXT, cron_expression TEXT, run_at TEXT,
      allowed_mcps_json TEXT, allowed_skills_json TEXT);
    CREATE TABLE agent_webhook_endpoints(id TEXT PRIMARY KEY, name TEXT, created_by_user_id INTEGER);
    CREATE TABLE agent_skills(id TEXT PRIMARY KEY, title TEXT, body TEXT, description TEXT, when_to_use TEXT,
      status TEXT, version INTEGER);
    INSERT INTO agent_configs(id,label,enabled,locked,revision,system_prompt,allowed_mcps_json,allowed_skills_json,
      core_permissions_json,allowed_delegates_json,is_manager,model_provider,model_id)
      VALUES ('baseline','Baseline',1,0,4,'Existing behavior','["pco"]','[]','{}','[]',0,'anthropic','claude-sonnet-4-5');
    INSERT INTO agent_sessions VALUES ('s1',7,'chat','baseline'),('s2',7,'chat','baseline');
  `);
});
afterEach(() => db.close());

const common = { expectedRevision:'absent', ownerUserId:7, evidenceSessionIds:['s1','s2'] };
const deps = () => ({ db, mcpDefinitions: async () => ({ pco: { type:'local', command:['pco'], env:{token:'not-persisted'} } }) });

describe('absent creation control snapshots', () => {
  it('freezes an owner-verified original profile and only a digest of relevant MCP definitions', async () => {
    const snapshot = await captureCreationTargetAsync({ ...common, kind:'create-agent',
      targetRef:'agent_config:new-helper', change:{agentSlug:'new-helper',allowedMcpsJson:'["pco"]'} }, deps());
    expect(snapshot).toMatchObject({ targetRevision:'absent', profiles:[{id:'baseline',revision:4}],
      creationControl:{baselineProfileId:'baseline',targetName:'new-helper',evidenceSessionIds:['s1','s2']} });
    expect(JSON.stringify(snapshot)).not.toContain('not-persisted');
    expect(snapshot!.creationControl!.dependencyFingerprints['mcp:pco']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects name collisions, fabricated revisions, and mixed or cross-owner evidence', async () => {
    const input = { ...common, kind:'create-agent' as const,
      targetRef:'agent_config:new-helper', change:{agentSlug:'new-helper'} };
    await expect(captureCreationTargetAsync({ ...input, expectedRevision:'4' }, deps())).rejects.toThrow(/absent revision/);
    db.prepare('INSERT INTO agent_configs(id,label,enabled,locked,revision) VALUES (?,?,?,?,?)')
      .run('new-helper','Collision',1,0,1);
    await expect(captureCreationTargetAsync(input, deps())).rejects.toThrow(/absent slug/);
    db.prepare('DELETE FROM agent_configs WHERE id=?').run('new-helper');
    db.prepare('INSERT INTO agent_configs(id,label,enabled,locked,revision) VALUES (?,?,?,?,?)')
      .run('different','Different',1,0,1);
    db.prepare('UPDATE agent_sessions SET profile_id=? WHERE id=?').run('different','s2');
    await expect(captureCreationTargetAsync(input, deps())).rejects.toThrow(/one independent baseline/);
    db.prepare('UPDATE agent_sessions SET profile_id=? WHERE id=?').run('baseline','s2');
    db.prepare('UPDATE agent_sessions SET owner_user_id=9 WHERE id=?').run('s2');
    await expect(captureCreationTargetAsync(input, deps())).rejects.toThrow(/owner-scoped/);
  });

  it('recapture changes when the verified baseline or recipe catalog changes', async () => {
    const input = { ...common, kind:'create-recipe' as const, targetRef:'recipe:New recipe',
      change:{title:'New recipe',boundConfigId:'baseline'} };
    const original = await captureCreationTargetAsync(input, deps());
    db.prepare('UPDATE agent_configs SET revision=5 WHERE id=?').run('baseline');
    const changed = await captureCreationTargetAsync(input, deps());
    expect(changed!.creationControl!.catalogFingerprint).not.toBe(original!.creationControl!.catalogFingerprint);
    db.prepare('INSERT INTO agent_cookbook(id,title,owner_user_id,bound_config_id,steps_json) VALUES (?,?,?,?,?)')
      .run('recipe-1','NEW RECIPE',7,'baseline','[]');
    await expect(captureCreationTargetAsync(input, deps())).rejects.toThrow(/title or bound profile changed/);
  });

  it('requires an owned concrete webhook dependency and notices an endpoint collision', async () => {
    db.prepare('INSERT INTO agent_scheduled_tasks(id,name,prompt,agent_config_id,created_by_user_id,schedule_type) VALUES (?,?,?,?,?,?)')
      .run('task-1','Task','Do it','baseline',7,'daily');
    const input = { ...common, kind:'webhook-wiring' as const,targetRef:'Inbound approval',
      change:{triggerSource:'Inbound approval',targetScheduledTaskId:'task-1'} };
    const snapshot = await captureCreationTargetAsync(input, deps());
    expect(snapshot!.schedules).toMatchObject([{id:'task-1',agentConfigId:'baseline'}]);
    db.prepare('INSERT INTO agent_webhook_endpoints VALUES (?,?,?)').run('endpoint-1','inbound approval',7);
    await expect(captureCreationTargetAsync(input, deps())).rejects.toThrow(/absent endpoint/);
  });

  it('binds a tool absence to the evidence profile and package identity', async () => {
    const input = { ...common, kind:'tool-install' as const, targetRef:'agent_config:baseline',
      change:{toolName:'safe-tool',agentConfigId:'baseline',installMethod:'npm install',packageSource:'safe-tool@1.0.0'} };
    const snapshot = await captureCreationTargetAsync(input, { ...deps(),managedToolRoot:'/private/tmp/org-eval-empty-tools' });
    expect(snapshot!.creationControl).toMatchObject({absenceKind:'managed-tool',baselineProfileId:'baseline'});
    expect(snapshot!.creationControl!.dependencyFingerprints['source:safe-tool']).toMatch(/^[a-f0-9]{64}$/);
  });
});
