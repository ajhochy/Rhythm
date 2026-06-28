/**
 * CONTRACT TESTS — model-override (per-task model override) schema + persistence,
 * and scope-inherit (scope inheritance) create-without-allowlist.
 *
 * Real in-memory SQLite + real repository + real Express app. No module mocks.
 * These prove the *storage and transport* half of the two issues:
 *   - the migration adds the model columns (model-c3)
 *   - the repository round-trips them (model-c4)
 *   - REST create accepts them (model-c5)
 *   - REST create does NOT require an allowlist (scope-c5)
 *
 * Each test names the regression it guards in a leading comment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ── model-c3: migration adds model_provider + model_id columns ─────────────────

describe('model-c3: migration adds nullable model columns to agent_scheduled_tasks', () => {
  // Regression: a future migration edit drops/forgets the model columns →
  // scheduled tasks can never carry a per-task model override.
  it('adds model_provider and model_id on a fresh DB', () => {
    const db = makeDb();
    const cols = (db.pragma('table_info(agent_scheduled_tasks)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('model_provider');
    expect(cols).toContain('model_id');
  });

  it('adds the columns to a previously-populated DB without data loss (idempotent ALTER)', () => {
    // Simulate a pre-existing DB that has the table but NOT the new columns,
    // then run migrations again — the columns must be added and the row kept.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db); // first boot
    db.prepare(
      `INSERT INTO agent_scheduled_tasks (id, name, schedule_type, prompt) VALUES (?,?,?,?)`,
    ).run('keep-me', 'Pre-existing', 'daily', 'do the thing');

    runMigrations(db); // second boot must be a no-op for data

    const cols = (db.pragma('table_info(agent_scheduled_tasks)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('model_provider');
    expect(cols).toContain('model_id');
    const row = db.prepare(`SELECT name, model_provider FROM agent_scheduled_tasks WHERE id = ?`).get('keep-me') as
      | { name: string; model_provider: string | null }
      | undefined;
    expect(row?.name).toBe('Pre-existing');
    expect(row?.model_provider ?? null).toBeNull();
  });
});

// ── prod-trigger-c5: pending trigger carries effective model columns ──────────

describe('prod-trigger-c5: migration adds nullable model columns to pending_claude_triggers', () => {
  // Regression: production-trigger rows cannot carry the effective model when
  // migrations forget the columns on pending_claude_triggers.
  it('adds model_provider and model_id on a fresh DB', () => {
    const db = makeDb();
    const cols = (db.pragma('table_info(pending_claude_triggers)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('model_provider');
    expect(cols).toContain('model_id');
  });

  it('adds model_provider and model_id without dropping pre-existing rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare(`INSERT INTO tasks (id, title) VALUES (?, ?)`).run('legacy-task', 'Legacy task');
    db.prepare(
      `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id) VALUES (?, ?)`,
    ).run('legacy-task', null);

    runMigrations(db);

    const cols = (db.pragma('table_info(pending_claude_triggers)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('model_provider');
    expect(cols).toContain('model_id');
    const row = db.prepare(`SELECT task_id, model_provider FROM pending_claude_triggers WHERE task_id = ?`).get('legacy-task') as
      | { task_id: string; model_provider: string | null }
      | undefined;
    expect(row?.task_id).toBe('legacy-task');
    expect(row?.model_provider ?? null).toBeNull();
  });
});

// ── model-c4: repository persists + returns modelProvider/modelId ──────────────

describe('model-c4: repository round-trips modelProvider/modelId', () => {
  beforeEach(() => setDb(makeDb()));

  // Regression: repo INSERT/rowToModel forgets the model columns → a stored
  // override silently disappears on read, so the scheduler never sees it.
  it('persists modelProvider/modelId on create and returns them on read', async () => {
    const repo = new AgentScheduledTasksRepository();
    const created = await repo.createAsync({
      name: 'Monthly report',
      scheduleType: 'monthly',
      prompt: 'Write the monthly report',
      modelProvider: 'anthropic',
      modelId: 'claude-opus-4-1',
    });
    expect(created.modelProvider).toBe('anthropic');
    expect(created.modelId).toBe('claude-opus-4-1');

    const read = await repo.findByIdAsync(created.id);
    expect(read?.modelProvider).toBe('anthropic');
    expect(read?.modelId).toBe('claude-opus-4-1');
  });

  it('defaults modelProvider/modelId to null when omitted', async () => {
    const repo = new AgentScheduledTasksRepository();
    const created = await repo.createAsync({
      name: 'Daily digest',
      scheduleType: 'daily',
      prompt: 'Summarize',
    });
    expect(created.modelProvider).toBeNull();
    expect(created.modelId).toBeNull();
  });
});

// ── REST surface (model-c5 + scope-c5) ───────────────────────────────────────────

describe('model-c5 / scope-c5: REST POST /agent-schedules', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    const { baseUrl: b, close } = await startTestServer(createApp());
    baseUrl = b;
    closeServer = close;
  });

  afterEach(async () => {
    await closeServer();
  });

  // Regression: controller ignores modelProvider/modelId in the body → an
  // operator can never set a per-task model via the API.
  it('model-c5: accepts optional modelProvider/modelId and persists them', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'API model task',
        scheduleType: 'daily',
        scheduledTime: '09:00',
        prompt: 'go',
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-1',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { modelProvider: string | null; modelId: string | null };
    expect(body.modelProvider).toBe('anthropic');
    expect(body.modelId).toBe('claude-opus-4-1');
  });

  // Regression: create starts REQUIRING an allowlist → "inherit from profile"
  // becomes impossible and every task must duplicate the profile's scope.
  it('scope-c5: does NOT require allowedMcps/allowedSkills (omitting = inherit)', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'No allowlist task',
        scheduleType: 'daily',
        scheduledTime: '09:00',
        prompt: 'go',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { allowedMcpsJson: string | null; allowedSkillsJson: string | null };
    expect(body.allowedMcpsJson).toBeNull();
    expect(body.allowedSkillsJson).toBeNull();
  });
});
