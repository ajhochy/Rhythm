/** Observable recipe, scheduled-task and inbound-webhook effects in a private worker. */
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type Database from 'better-sqlite3';
import express from 'express';
import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { compileAgentCookbookPrompt } from '../controllers/agentCookbookController';
import { AgentWebhookController } from '../controllers/agentWebhookController';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import { checkDueTasksForOrgEvaluationAsync } from './agentSchedulerService';

export interface OrgEvaluationEffectObservation {
  kind: string;
  source: 'worker-db' | 'engine-session' | 'engine-tool';
  subject: string;
  evidenceHash: string;
}

export interface RealEngineTaskResult {
  sessionId: string;
  output: string;
  toolEvents: Array<{ type: string; name: string; evidenceHash: string }>;
}

export interface RoutedEvaluationEffectResult {
  events: OrgEvaluationEffectObservation[];
  routedOutput: string;
  routedSessionId: string;
  routedToolEvents: RealEngineTaskResult['toolEvents'];
}

export interface RecipeScheduleEffectInput {
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  changeJson: string | null;
  db: Database.Database;
  workspacePath: string;
  runEngineTask: (input: { profileId?: string; prompt: string; scheduledTaskId?: string }) => Promise<RealEngineTaskResult>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function evidence(kind: string, source: OrgEvaluationEffectObservation['source'], subject: string,
  value: string): OrgEvaluationEffectObservation {
  return { kind, source, subject, evidenceHash: digest(value) };
}

function assertPrivateWorker(input: RecipeScheduleEffectInput): void {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1' || process.env.DB_CLIENT !== 'sqlite' ||
      !process.env.DB_PATH?.startsWith('/private/tmp/') ||
      !input.workspacePath.startsWith('/private/tmp/')) {
    throw new Error('Recipe and schedule effects require the private evaluation worker');
  }
}

function requireEngineResult(result: RealEngineTaskResult): void {
  if (!result.sessionId || !result.output.trim()) {
    throw new Error('Private engine did not complete the selected work');
  }
}

async function recipeEffects(input: RecipeScheduleEffectInput): Promise<RoutedEvaluationEffectResult> {
  const recipes = new AgentCookbookRepository();
  const recipe = input.kind === 'create-recipe'
    ? (await recipes.listAllAsync()).find((item) =>
        item.title.trim().toLowerCase() === input.targetRef.slice('recipe:'.length).trim().toLowerCase())
    : await recipes.findByIdAsync(input.targetRef.slice('recipe:'.length));
  if (!recipe || !input.targetRef.startsWith('recipe:')) {
    throw new Error('Evaluated recipe is not selectable');
  }
  if (recipe.format !== 'legacy' || recipe.definitionJson !== null) {
    throw new Error('Workflow-format recipe needs its separate production workflow dispatcher');
  }
  const prompt = compileAgentCookbookPrompt(recipe);
  if (!prompt.trim()) throw new Error('Selected recipe compiles to an empty prompt');
  const result = await input.runEngineTask({ ...(recipe.boundConfigId ? { profileId: recipe.boundConfigId } : {}), prompt });
  requireEngineResult(result);
  return { events: [
    evidence('recipe-persisted', 'worker-db', recipe.id,
      JSON.stringify({ id: recipe.id, stepsJson: recipe.stepsJson, boundConfigId: recipe.boundConfigId })),
    evidence('recipe-selected', 'engine-session', result.sessionId,
      JSON.stringify({ recipeId: recipe.id, promptHash: digest(prompt), outputHash: digest(result.output) })),
  ], routedOutput: result.output, routedSessionId: result.sessionId, routedToolEvents: result.toolEvents };
}

async function scheduledEffects(input: RecipeScheduleEffectInput): Promise<RoutedEvaluationEffectResult> {
  if (!input.targetRef.startsWith('scheduled_task:')) throw new Error('Scheduled target reference is invalid');
  const taskId = input.targetRef.slice('scheduled_task:'.length);
  const tasks = new AgentScheduledTasksRepository();
  const task = await tasks.findByIdAsync(taskId);
  if (!task?.enabled) throw new Error('Evaluated schedule is not executable');
  const original = input.db.prepare('SELECT next_run_at, last_run_status FROM agent_scheduled_tasks WHERE id = ?')
    .get(task.id) as { next_run_at: string | null; last_run_status: string | null } | undefined;
  if (!original) throw new Error('Scheduled target disappeared from the copied database');
  // The copied row is made due immediately; production selection, scope and trigger
  // insertion still run inside checkDueTasks. This never edits the source fixture.
  try {
    input.db.prepare('UPDATE agent_scheduled_tasks SET next_run_at = ?, last_run_status = NULL WHERE id = ?')
      .run(new Date().toISOString(), task.id);
    const previous = input.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM pending_claude_triggers').get() as { id: number };
    const priorPowerGate = process.env.AGENT_SCHEDULER_IGNORE_POWER_STATE;
    process.env.AGENT_SCHEDULER_IGNORE_POWER_STATE = '1';
    try { await checkDueTasksForOrgEvaluationAsync(); }
    finally {
      if (priorPowerGate === undefined) delete process.env.AGENT_SCHEDULER_IGNORE_POWER_STATE;
      else process.env.AGENT_SCHEDULER_IGNORE_POWER_STATE = priorPowerGate;
    }
    const pending = input.db.prepare(`SELECT id, prompt, scheduled_task_id FROM pending_claude_triggers
    WHERE id > ? AND scheduled_task_id = ? ORDER BY id DESC LIMIT 1`).get(previous.id, task.id) as
      { id: number; prompt: string; scheduled_task_id: string } | undefined;
    if (!pending?.prompt) throw new Error('Production scheduler did not fire the evaluated task');
    const result = await input.runEngineTask({ ...(task.agentConfigId ? { profileId: task.agentConfigId } : {}),
      prompt: pending.prompt,
      scheduledTaskId: task.id });
    requireEngineResult(result);
    return { events: [
      evidence('schedule-persisted', 'worker-db', task.id,
        JSON.stringify({ id: task.id, prompt: task.prompt, profileId: task.agentConfigId })),
      evidence('scheduled-task-fired', 'worker-db', task.id,
        JSON.stringify({ triggerId: pending.id, promptHash: digest(pending.prompt), sessionId: result.sessionId })),
      evidence('agent-output', 'engine-session', result.sessionId, result.output),
    ], routedOutput: result.output, routedSessionId: result.sessionId, routedToolEvents: result.toolEvents };
  } finally {
    input.db.prepare('UPDATE agent_scheduled_tasks SET next_run_at = ?, last_run_status = ? WHERE id = ?')
      .run(original.next_run_at, original.last_run_status, task.id);
  }
}

async function webhookEffects(input: RecipeScheduleEffectInput): Promise<RoutedEvaluationEffectResult> {
  const change = input.changeJson ? JSON.parse(input.changeJson) as Record<string, unknown> : {};
  const endpoints = input.db.prepare(`SELECT id, name, secret, target_scheduled_task_id, target_recipe_id, target_prompt,
    event_types_json FROM agent_webhook_endpoints ORDER BY created_at DESC`).all() as Array<{
      id: string; name: string; secret: string; target_scheduled_task_id: string | null; target_recipe_id: string | null;
      target_prompt: string | null; event_types_json: string;
    }>;
  if (endpoints.length !== 1 || !endpoints[0].secret) {
    throw new Error('Evaluated webhook endpoint is not uniquely identified in copied database');
  }
  const endpoint = endpoints[0];
  const targetTask = endpoint.target_scheduled_task_id
    ? await new AgentScheduledTasksRepository().findByIdAsync(endpoint.target_scheduled_task_id) : null;
  const targetRecipe = typeof change.targetRecipeId === 'string'
    ? await new AgentCookbookRepository().findByIdAsync(change.targetRecipeId) : null;
  if (Boolean(targetTask) === Boolean(targetRecipe) ||
      endpoint.target_recipe_id !== (targetRecipe?.id ?? null) ||
      endpoint.target_scheduled_task_id !== (targetTask?.id ?? null)) {
    throw new Error('Evaluated webhook target does not match the production endpoint');
  }
  const profileId = targetTask?.agentConfigId ?? targetRecipe?.boundConfigId;

  const controller = new AgentWebhookController();
  const app = express();
  app.use(express.text({ type: 'application/json', limit: '64kb' }));
  app.post('/agent-webhooks/:id/receive', (req, res, next) => {
    void controller.receive(req, res, next);
  });
  const server = createServer(app);
  const reservedPort = process.env.RHYTHM_EVALUATION_WEBHOOK_PORT
    ? Number(process.env.RHYTHM_EVALUATION_WEBHOOK_PORT) : 0;
  if (!Number.isInteger(reservedPort) || reservedPort < 0 || reservedPort > 65535) {
    throw new Error('Evaluation webhook loopback port is invalid');
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(reservedPort, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Webhook loopback receiver is unavailable');
    const url = `http://127.0.0.1:${address.port}/agent-webhooks/${encodeURIComponent(endpoint.id)}/receive`;
    const event = (JSON.parse(endpoint.event_types_json) as string[]).find((item) => item !== '*') ?? 'evaluation.probe';
    const body = JSON.stringify({ event, probe: 'owned-evaluation' });
    const previous = input.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM pending_claude_triggers').get() as { id: number };
    const bad = await fetch(url, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-signature-sha256': `sha256=${'0'.repeat(64)}`,
    }, body });
    const afterBad = input.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM pending_claude_triggers').get() as { id: number };
    if (bad.status !== 401 || afterBad.id !== previous.id) {
      throw new Error('Invalid webhook signature was not denied without dispatch');
    }
    const signature = `sha256=${createHmac('sha256', endpoint.secret).update(body).digest('hex')}`;
    const good = await fetch(url, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-signature-sha256': signature,
    }, body });
    if (good.status !== 200) throw new Error(`Valid webhook delivery failed: HTTP ${good.status}`);
    const pending = input.db.prepare(`SELECT id, prompt, scheduled_task_id, recipe_id, webhook_endpoint_id
      FROM pending_claude_triggers WHERE id > ? AND webhook_endpoint_id = ? ORDER BY id DESC LIMIT 1`)
      .get(previous.id, endpoint.id) as { id: number; prompt: string; scheduled_task_id: string | null;
        recipe_id: string | null;
        webhook_endpoint_id: string } | undefined;
    if (!pending?.prompt || pending.recipe_id !== (targetRecipe?.id ?? null) ||
        pending.scheduled_task_id !== (targetTask?.id ?? null)) {
      throw new Error('Valid webhook did not queue its exact task or recipe target');
    }
    const result = await input.runEngineTask({ ...(profileId ? { profileId } : {}), prompt: pending.prompt,
      ...(pending.scheduled_task_id ? { scheduledTaskId: pending.scheduled_task_id } : {}) });
    requireEngineResult(result);
    return { events: [
      evidence('webhook-persisted', 'worker-db', endpoint.id,
        JSON.stringify({ id: endpoint.id, name: endpoint.name, targetTaskId: endpoint.target_scheduled_task_id,
          targetRecipeId: endpoint.target_recipe_id })),
      evidence('invalid-webhook-signature-denied', 'worker-db', endpoint.id,
        JSON.stringify({ status: bad.status, before: previous.id, after: afterBad.id })),
      evidence('loopback-webhook-received', 'engine-session', result.sessionId,
        JSON.stringify({ endpointId: endpoint.id, triggerId: pending.id, outputHash: digest(result.output) })),
    ], routedOutput: result.output, routedSessionId: result.sessionId, routedToolEvents: result.toolEvents };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function runRecipeScheduleEffectsAsync(input: RecipeScheduleEffectInput): Promise<RoutedEvaluationEffectResult> {
  assertPrivateWorker(input);
  if (input.kind === 'create-recipe' || input.kind === 'refine-recipe') return recipeEffects(input);
  if (input.kind === 'refine-task') return scheduledEffects(input);
  if (input.kind === 'webhook-wiring') return webhookEffects(input);
  throw new Error(`No recipe or schedule effect adapter for ${input.kind}`);
}

/** Baseline creation cases have no callable target. Check the same production
 * lookup/receiver path, then bind the absence to an unchanged trigger queue. */
export async function proveAbsentRoutedTargetAsync(input: {
  kind: 'create-recipe' | 'webhook-wiring'; targetRef: string;
  db: Database.Database; workspacePath: string;
}): Promise<OrgEvaluationEffectObservation> {
  assertPrivateWorker({ ...input, changeJson: null, runEngineTask: async () => {
    throw new Error('An absent target must never run a model');
  } });
  const before = input.db.prepare('SELECT COUNT(*) AS count FROM pending_claude_triggers').get() as { count: number };
  if (input.kind === 'create-recipe') {
    if (!input.targetRef.startsWith('recipe:')) throw new Error('Recipe absence target is invalid');
    const title = input.targetRef.slice('recipe:'.length).trim().toLowerCase();
    const matches = (await new AgentCookbookRepository().listAllAsync()).filter((recipe) =>
      recipe.title.trim().toLowerCase() === title);
    if (matches.length) throw new Error('Original recipe unexpectedly exists');
  } else {
    const name = input.targetRef.startsWith('webhook:') ? input.targetRef.slice('webhook:'.length) : input.targetRef;
    const matches = (await new AgentWebhookEndpointsRepository().listAsync()).filter((endpoint) =>
      endpoint.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (matches.length) throw new Error('Original webhook unexpectedly exists');
    const app = express();
    app.use(express.text({ type: 'application/json', limit: '64kb' }));
    const controller = new AgentWebhookController();
    app.post('/agent-webhooks/:id/receive', (req, res, next) => { void controller.receive(req, res, next); });
    const server = createServer(app);
    const port = Number(process.env.RHYTHM_EVALUATION_WEBHOOK_PORT ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Evaluation webhook port is invalid');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Webhook absence receiver failed to bind');
      const response = await fetch(`http://127.0.0.1:${address.port}/agent-webhooks/${encodeURIComponent(name)}/receive`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"event":"evaluation.probe"}',
      });
      if (response.status !== 404) throw new Error('Absent webhook was unexpectedly callable');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  const after = input.db.prepare('SELECT COUNT(*) AS count FROM pending_claude_triggers').get() as { count: number };
  if (after.count !== before.count) throw new Error('Absent target still queued a trigger');
  return evidence('target-absent', 'worker-db', input.targetRef,
    JSON.stringify({ kind: input.kind, targetRef: input.targetRef, pendingCount: after.count }));
}
