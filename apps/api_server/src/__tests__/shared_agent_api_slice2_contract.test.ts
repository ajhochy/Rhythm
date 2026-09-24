import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentConfigsController } from '../controllers/agent_configs_controller';

// Real controller + SQLite. Only downstream file/engine/event boundaries are
// replaced: these tests neither start servers nor contact the running engine.
const effects = vi.hoisted(() => ({ project: vi.fn(), reload: vi.fn(async () => true), broadcast: vi.fn() }));
vi.mock('../services/agent_profile_projection_service', () => ({ projectAgentProfileAfterWrite: effects.project }));
vi.mock('../services/opencode_engine', () => ({ opencodeClient: { reloadConfig: effects.reload } }));
vi.mock('../services/ws_gateway', () => ({ broadcastAgentConfigsChanged: effects.broadcast }));

const id = 'shared-agent-cas-contract';
const advanced = '{ "bash": {"*":"deny","npm test":"allow"}, "future_tool": {"policyVersion":99} }';
const repo = new AgentConfigsRepository();
const controller = new AgentConfigsController();
let db: Database.Database;

async function patch(body: Record<string, unknown>, target = id) {
  const result: { status: number; body?: any } = { status: 200 };
  const response = { json(value: unknown) { result.body = value; }, status(code: number) { result.status = code; return this; } };
  await controller.patch({ params: { id: target }, body } as unknown as Request, response as unknown as Response,
    (error?: any) => { if (error) { result.status = error.statusCode ?? 500; result.body = error; } });
  return result;
}
function clearEffects() { Object.values(effects).forEach(fn => fn.mockClear()); }
function expectNoEffects() { Object.values(effects).forEach(fn => expect(fn).not.toHaveBeenCalled()); }

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo.insert({ id, icon: 'sparkles', label: 'Shared Specialist', systemPrompt: 'original', allowedMcpsJson: '[]',
    allowedSkillsJson: null, corePermissionsJson: advanced, enabled: true, isAgent: true, sessionSelectable: true });
  clearEffects();
});
afterEach(() => { db.close(); setDb(null as never); });

describe('canonical shared-agent revision contract', () => {
  it('SA2-AC1 concurrent same-revision edits have exactly one winner', async () => {
    // Catches read-check-then-write and unconditional UPDATE: only one writer can win.
    const before = repo.getById(id)!;
    const results = await Promise.all([patch({ expectedRevision: before.revision, systemPrompt: 'first' }),
      patch({ expectedRevision: before.revision, systemPrompt: 'second' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = results.find(r => r.status === 200)!;
    expect(repo.getById(id)?.systemPrompt).toBe(winner.body.systemPrompt);
    expect(repo.getById(id)?.revision).toBe(before.revision! + 1);
    Object.values(effects).forEach(fn => expect(fn).toHaveBeenCalledTimes(1));
  });
  it('SA2-AC2 partial edits preserve raw scopes and unknown advanced values', async () => {
    // Catches serializer flattening, normalization or replacement of omitted settings.
    const before = repo.getById(id)!;
    const result = await patch({ expectedRevision: before.revision, label: 'Renamed' });
    expect(result.status).toBe(200);
    expect(repo.getById(id)).toMatchObject({ label: 'Renamed', allowedSkillsJson: null,
      allowedMcpsJson: '[]', corePermissionsJson: advanced, systemPrompt: 'original', schedulableOverride: null });
    const second = await patch({ expectedRevision: result.body.revision, allowedSkillsJson: '[]', schedulable: false });
    expect(second.status).toBe(200);
    expect(repo.getById(id)).toMatchObject({ allowedSkillsJson: '[]', schedulableOverride: false, corePermissionsJson: advanced });
    const third = await patch({ expectedRevision: second.body.revision, allowedSkillsJson: null, schedulable: null });
    expect(third.status).toBe(200);
    expect(repo.getById(id)).toMatchObject({ allowedSkillsJson: null, schedulableOverride: null, corePermissionsJson: advanced });
  });
  it('SA2-AC3 invalid revisions reject without writes or downstream effects', async () => {
    // Catches accepting coercible strings, null, negatives, fractions, unsafe integers.
    const before = repo.getById(id);
    for (const expectedRevision of [null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
      const result = await patch({ expectedRevision, label: 'must not persist' });
      expect(result.status, JSON.stringify(expectedRevision)).toBe(400);
      expect(repo.getById(id)).toEqual(before);
      expectNoEffects();
    }
  });
  it('SA2-AC4 stale revisions preserve newer state without downstream effects', async () => {
    // Catches a stale editor overwriting a successful independent edit.
    const oldRevision = repo.getById(id)!.revision;
    repo.update(id, { systemPrompt: 'newer' });
    const before = repo.getById(id);
    expect((await patch({ expectedRevision: oldRevision, systemPrompt: 'stale' })).status).toBe(409);
    expect(repo.getById(id)).toEqual(before);
    expectNoEffects();
  });
  it('SA2-AC5 revisioned edits retain preset and security transition constraints', async () => {
    // Catches CAS bypassing the existing preset/locked-agent protection path.
    db.prepare('UPDATE agent_configs SET preset_id = ? WHERE id = ?').run('codex', id);
    const preset = repo.getById(id)!;
    expect((await patch({ expectedRevision: preset.revision, label: 'forbidden' })).status).toBe(400);
    expect(repo.getById(id)).toEqual(preset);
    expectNoEffects();
    db.prepare('UPDATE agent_configs SET preset_id = NULL, locked = 1, enabled = 0 WHERE id = ?').run(id);
    const locked = repo.getById(id)!;
    expect((await patch({ expectedRevision: locked.revision, enabled: true })).status).toBe(409);
    expect((await patch({ expectedRevision: locked.revision, locked: false })).status).toBe(400);
    expect(repo.getById(id)).toEqual(locked);
    expectNoEffects();
  });
  it('SA2-AC6 legacy edits without expectedRevision remain compatible', async () => {
    // Catches requiring new revision metadata from existing clients prematurely.
    const before = repo.getById(id)!;
    expect((await patch({ systemPrompt: 'legacy update' })).status).toBe(200);
    expect(repo.getById(id)).toMatchObject({ systemPrompt: 'legacy update', revision: before.revision! + 1 });
  });
  it('SA2-AC7 revisioned edits reject unknown top-level fields without writes', async () => {
    // Catches accepting arbitrary column names or silently ignoring editor typos.
    const before = repo.getById(id)!;
    expect((await patch({ expectedRevision: before.revision, label: 'bad', unexpectedColumn: 'value' })).status).toBe(400);
    expect(repo.getById(id)).toEqual(before);
    expectNoEffects();
  });
});
