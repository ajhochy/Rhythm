import { createHmac } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';
import { UNTRUSTED_FENCE_OPEN } from '../security/untrusted_fence';
import { startTestServer } from './helpers/real_server';

describe('recipe-target inbound webhook production contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => { await close(); db.close(); });

  it('queues the selected recipe with its bound profile and fenced event only after a valid HMAC', async () => {
    const recipe = await new AgentCookbookRepository().createAsync({
      title: 'Private recipe', description: 'Inspect source', stepsJson: '["Read record","Report result"]',
      boundConfigId: 'private-profile',
    });
    const endpoint = await new AgentWebhookEndpointsRepository().createAsync({
      name: 'Recipe event', targetRecipeId: recipe.id,
    });
    const body = JSON.stringify({ event: 'updated', summary: 'Plan changed' });
    const url = `${baseUrl}/agent-webhooks/${endpoint.id}/receive`;
    const invalid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
      'x-signature-sha256': `sha256=${'0'.repeat(64)}` }, body });
    expect(invalid.status).toBe(401);
    expect(await new ClaudeTriggersRepository().listAllAsync()).toEqual([]);
    const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');
    const valid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
      'x-signature-sha256': `sha256=${signature}` }, body });
    expect(valid.status).toBe(200);
    const [pending] = await new ClaudeTriggersRepository().listAllAsync();
    expect(pending.recipeId).toBe(recipe.id);
    expect(pending.scheduledTaskId).toBeNull();
    expect(pending.profileId).toBe('private-profile');
    expect(pending.prompt).toContain('Goal: Inspect source\n\n1. Read record\n2. Report result');
    expect(pending.prompt).toContain(UNTRUSTED_FENCE_OPEN);
    expect(pending.prompt).toContain('Plan changed');
  });

  it('does not allow an endpoint to mix scheduled-task and recipe targets', async () => {
    await expect(new AgentWebhookEndpointsRepository().createAsync({
      name: 'Ambiguous', targetScheduledTaskId: 'task', targetRecipeId: 'recipe',
    })).rejects.toThrow(/exactly one|mutually exclusive|target/i);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_webhook_endpoints').get()).toEqual({ n: 0 });
  });

  it('does not queue a cross-owner recipe even when an endpoint row was created directly', async () => {
    const owner = Number(db.prepare(`INSERT INTO users (name,email,google_sub) VALUES (?,?,?)`)
      .run('Recipe owner', 'recipe-owner@example.test', 'recipe-owner').lastInsertRowid);
    const other = Number(db.prepare(`INSERT INTO users (name,email,google_sub) VALUES (?,?,?)`)
      .run('Other owner', 'other-owner@example.test', 'other-owner').lastInsertRowid);
    const recipe = await new AgentCookbookRepository().createAsync({ title: 'Private source',
      stepsJson: '["Do work"]', ownerUserId: owner });
    const endpoint = await new AgentWebhookEndpointsRepository().createAsync({ name: 'Cross owner',
      targetRecipeId: recipe.id, createdByUserId: other });
    const body = JSON.stringify({ event: 'updated' });
    const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');
    const response = await fetch(`${baseUrl}/agent-webhooks/${endpoint.id}/receive`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        'x-signature-sha256': `sha256=${signature}` }, body,
    });
    expect(response.status).toBe(409);
    expect(await new ClaudeTriggersRepository().listAllAsync()).toEqual([]);
  });
});

describe('recipe webhook additive SQLite backfill', () => {
  it('adds both nullable recipe references to existing tables without losing rows', () => {
    const old = new Database(':memory:');
    try {
      old.exec(`CREATE TABLE agent_webhook_endpoints (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, event_types_json TEXT NOT NULL,
        secret TEXT NOT NULL, target_scheduled_task_id TEXT, target_prompt TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, last_triggered_at TEXT,
        trigger_count INTEGER NOT NULL DEFAULT 0, created_by_user_id INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO agent_webhook_endpoints (id,name,event_types_json,secret,created_at,updated_at)
        VALUES ('old-endpoint','Old','["*"]','old-secret','2026-01-01','2026-01-01');
        CREATE TABLE pending_claude_triggers (
          id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, triggered_by_user_id INTEGER,
          created_at TEXT NOT NULL, scheduled_task_id TEXT, prompt TEXT,
          allowed_mcps_json TEXT, allowed_skills_json TEXT, model_provider TEXT,
          model_id TEXT, webhook_endpoint_id TEXT);
        INSERT INTO pending_claude_triggers (id,task_id,created_at,webhook_endpoint_id)
        VALUES (7,NULL,'2026-01-01','old-endpoint');`);
      runMigrations(old);
      const endpoint = old.prepare('SELECT id,target_recipe_id FROM agent_webhook_endpoints WHERE id=?')
        .get('old-endpoint');
      const trigger = old.prepare('SELECT id,recipe_id FROM pending_claude_triggers WHERE id=?').get(7);
      expect(endpoint).toEqual({ id: 'old-endpoint', target_recipe_id: null });
      expect(trigger).toEqual({ id: 7, recipe_id: null });
      runMigrations(old);
      expect(old.prepare('SELECT COUNT(*) AS n FROM agent_webhook_endpoints').get()).toEqual({ n: 1 });
      expect(old.prepare('SELECT COUNT(*) AS n FROM pending_claude_triggers').get()).toEqual({ n: 1 });
    } finally { old.close(); }
  });
});
