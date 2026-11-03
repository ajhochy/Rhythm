import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { AgentWebhookEndpointsRepository } from '../../repositories/agent_webhook_endpoints_repository';
import { proveAbsentRoutedTargetAsync, runRecipeScheduleEffectsAsync } from '../org_evaluation_recipe_schedule_effects';

let root: string;
let db: Database.Database;
let previous: Database.Database | null;
let priorWorker: string | undefined;
let priorDbPath: string | undefined;
let priorClient: string | undefined;
beforeEach(() => {
  root = mkdtempSync('/private/tmp/rhythm-eval-effects-');
  const path = join(root, 'rhythm.db');
  db = new Database(path);
  runMigrations(db);
  previous = setDb(db);
  priorWorker = process.env.RHYTHM_EVALUATION_WORKER;
  priorDbPath = process.env.DB_PATH;
  priorClient = process.env.DB_CLIENT;
  process.env.RHYTHM_EVALUATION_WORKER = '1';
  process.env.DB_PATH = path;
  process.env.DB_CLIENT = 'sqlite';
});
afterEach(() => {
  setDb(previous);
  db.close();
  rmSync(root, { recursive: true, force: true });
  if (priorWorker === undefined) delete process.env.RHYTHM_EVALUATION_WORKER;
  else process.env.RHYTHM_EVALUATION_WORKER = priorWorker;
  if (priorDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = priorDbPath;
  if (priorClient === undefined) delete process.env.DB_CLIENT;
  else process.env.DB_CLIENT = priorClient;
});

describe('private recipe, schedule and webhook effect adapter (source contract; engine callback injected)', () => {
  it('selects a persisted legacy recipe and gives its production-compiled prompt to the engine callback', async () => {
    const recipe = await new AgentCookbookRepository().createAsync({
      title: 'Owned recipe', description: 'Prepare report', stepsJson: '["Open source","Summarize"]',
      boundConfigId: 'owned-profile',
    });
    const received: string[] = [];
    const effects = await runRecipeScheduleEffectsAsync({ kind: 'refine-recipe',
      targetRef: `recipe:${recipe.id}`, changeJson: null, db, workspacePath: root,
      runEngineTask: async (request) => {
        received.push(request.profileId ?? '', request.prompt);
        return { sessionId: 'private-engine-session', output: 'Report complete', toolEvents: [] };
      },
    });
    expect(received).toEqual(['owned-profile', 'Goal: Prepare report\n\n1. Open source\n2. Summarize']);
    expect(effects.events.map((item) => item.kind)).toEqual(['recipe-persisted', 'recipe-selected']);
    expect(effects.events[1].subject).toBe('private-engine-session');
    expect(effects).toMatchObject({ routedOutput: 'Report complete', routedSessionId: 'private-engine-session' });
  });

  it('runs an unbound legacy recipe with the production default engine agent', async () => {
    const recipe = await new AgentCookbookRepository().createAsync({
      title: 'Default-agent recipe', stepsJson: '["Summarize"]',
    });
    let selectedProfile: string | undefined = 'unexpected';
    const effects = await runRecipeScheduleEffectsAsync({ kind: 'refine-recipe',
      targetRef: `recipe:${recipe.id}`, changeJson: null, db, workspacePath: root,
      runEngineTask: async (request) => {
        selectedProfile = request.profileId;
        return { sessionId: 'private-default-session', output: 'Summary', toolEvents: [] };
      },
    });
    expect(selectedProfile).toBeUndefined();
    expect(effects.events.map((item) => item.kind)).toEqual(['recipe-persisted', 'recipe-selected']);
  });

  it('uses the production webhook receiver: invalid HMAC is 401 with no trigger; valid HMAC dispatches queued prompt', async () => {
    const task = await new AgentScheduledTasksRepository().createAsync({ name: 'Owned task',
      scheduleType: 'weekly', prompt: 'Handle the event', agentConfigId: 'owned-profile' });
    await new AgentWebhookEndpointsRepository().createAsync({ name: 'Owned endpoint',
      eventTypesJson: '["evaluation.probe"]', targetScheduledTaskId: task.id });
    const received: string[] = [];
    const effects = await runRecipeScheduleEffectsAsync({ kind: 'webhook-wiring',
      targetRef: 'webhook:Owned endpoint', changeJson: JSON.stringify({ targetScheduledTaskId: task.id }),
      db, workspacePath: root, runEngineTask: async (request) => {
        received.push(request.profileId ?? '', request.prompt, request.scheduledTaskId ?? '');
        return { sessionId: 'private-engine-session', output: 'Event handled', toolEvents: [] };
      },
    });
    expect(effects.events.map((item) => item.kind)).toEqual([
      'webhook-persisted', 'invalid-webhook-signature-denied', 'loopback-webhook-received',
    ]);
    expect(received[0]).toBe('owned-profile');
    expect(received[1]).toContain('Handle the event');
    expect(received[2]).toBe(task.id);
    expect(effects.routedOutput).toBe('Event handled');
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_claude_triggers').get()).toEqual({ n: 1 });
  });

  it('fires the copied due task through production scheduler selection, then dispatches its trigger', async () => {
    new AgentConfigsRepository().insert({ id: 'owned-profile', label: 'Owned profile', icon: 'fixture',
      modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5', allowedMcpsJson: '[]', allowedSkillsJson: '[]' });
    const task = await new AgentScheduledTasksRepository().createAsync({ name: 'Owned task',
      scheduleType: 'once', runAt: new Date(Date.now() + 60_000).toISOString(),
      prompt: 'Produce schedule receipt', agentConfigId: 'owned-profile' });
    const received: string[] = [];
    const effects = await runRecipeScheduleEffectsAsync({ kind: 'refine-task',
      targetRef: `scheduled_task:${task.id}`, changeJson: null, db, workspacePath: root,
      runEngineTask: async (request) => {
        received.push(request.profileId ?? '', request.prompt, request.scheduledTaskId ?? '');
        return { sessionId: 'private-scheduled-session', output: 'Schedule receipt', toolEvents: [] };
      },
    });
    expect(received).toEqual(['owned-profile', 'Produce schedule receipt', task.id]);
    expect(effects.events.map((item) => item.kind)).toEqual([
      'schedule-persisted', 'scheduled-task-fired', 'agent-output',
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_claude_triggers WHERE scheduled_task_id = ?')
      .get(task.id)).toEqual({ n: 1 });
    expect(effects.routedSessionId).toBe('private-scheduled-session');
  });

  it('delivers a recipe-target webhook through the production receiver and selects that exact recipe', async () => {
    const recipe = await new AgentCookbookRepository().createAsync({ title: 'Recipe target',
      stepsJson: '["Do work"]', boundConfigId: 'owned-profile' });
    await new AgentWebhookEndpointsRepository().createAsync({ name: 'Recipe endpoint', targetRecipeId: recipe.id });
    let selectedPrompt = '';
    const effects = await runRecipeScheduleEffectsAsync({ kind: 'webhook-wiring',
      targetRef: 'webhook:Recipe endpoint', changeJson: JSON.stringify({ targetRecipeId: recipe.id }),
      db, workspacePath: root, runEngineTask: async (request) => {
        expect(request.profileId).toBe('owned-profile');
        selectedPrompt = request.prompt;
        return { sessionId: 'private-recipe-webhook-session', output: 'Recipe completed', toolEvents: [] };
      },
    });
    expect(effects.events.map((item) => item.kind)).toEqual([
      'webhook-persisted', 'invalid-webhook-signature-denied', 'loopback-webhook-received',
    ]);
    expect(selectedPrompt).toContain('1. Do work');
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_claude_triggers WHERE recipe_id = ?')
      .get(recipe.id)).toEqual({ n: 1 });
    expect(effects.routedOutput).toBe('Recipe completed');
  });

  it('proves original creation targets are absent through production lookups and queues no work', async () => {
    const recipe = await proveAbsentRoutedTargetAsync({ kind: 'create-recipe', targetRef: 'recipe:Absent recipe',
      db, workspacePath: root });
    const webhook = await proveAbsentRoutedTargetAsync({ kind: 'webhook-wiring', targetRef: 'webhook:Absent endpoint',
      db, workspacePath: root });
    expect([recipe.kind, webhook.kind]).toEqual(['target-absent', 'target-absent']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_claude_triggers').get()).toEqual({ n: 0 });
  });

  it('refuses use outside a private worker before touching the copied database', async () => {
    delete process.env.RHYTHM_EVALUATION_WORKER;
    await expect(runRecipeScheduleEffectsAsync({ kind: 'refine-task', targetRef: 'scheduled_task:missing',
      changeJson: null, db, workspacePath: root, runEngineTask: async () => {
        throw new Error('must not dispatch');
      },
    })).rejects.toThrow(/private evaluation worker/);
  });
});
