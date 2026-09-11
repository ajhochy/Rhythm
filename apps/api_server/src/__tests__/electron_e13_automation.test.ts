import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AutomationRulesController } from '../controllers/automation_rules_controller';
import { UsersRepository } from '../repositories/users_repository';

let db: Database.Database;
let user: ReturnType<UsersRepository['create']>;
const controller = new AutomationRulesController();
const seed = {
  name: 'E13 disabled', source: 'rhythm', triggerKey: 'rhythm.task_due', enabled: false,
  triggerConfig: { leadDays: 3, teamIds: ['worship'], allDayOnly: false },
  actionType: 'create_task', sourceAccountId: null,
  actionConfig: { titleTemplate: 'Follow {{title}}', messageTemplate: 'Message', templateName: 'Sunday Service Launch', facilityId: 'facility-sanctuary', tag: 'care', notesTemplate: 'Notes {{title}}', targetDay: 2, nested: { keep: true } },
  conditions: [{ field: 'title', operator: 'contains', value: 'Sunday' }],
};
async function call(method: 'create' | 'update' | 'getById', body: unknown, id = '') {
  let result: any;
  let error: unknown;
  const res = { status() { return this; }, json(value: unknown) { result = value; return this; } } as unknown as Response;
  await controller[method]({ body, params: { id }, auth: { user } } as unknown as Request, res, (err) => { error = err; });
  expect(error).toBeUndefined();
  return result;
}
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  user = new UsersRepository().create({ name: 'E13', email: 'e13@example.test' });
});
afterEach(() => db.close());

it('e13-c1: name-only PATCH must not erase omitted configs or enable a disabled rule', async () => {
  const created = await call('create', seed);
  await call('update', { name: 'Renamed' }, created.id);
  const read = await call('getById', {}, created.id);
  expect(read).toEqual({ ...created, name: 'Renamed', updatedAt: read.updatedAt });
});
it('e13-c2: enable-only PATCH preserves exact configs and conditions on readback', async () => {
  const created = await call('create', seed);
  expect(created.enabled).toBe(false);
  await call('update', { enabled: true }, created.id);
  const read = await call('getById', {}, created.id);
  expect(read).toEqual({ ...created, enabled: true, updatedAt: read.updatedAt });
});
it('e13-c3: explicit null clears while omitted fields survive', async () => {
  const created = await call('create', seed);
  expect(created.triggerConfig).toEqual(seed.triggerConfig);
  await call('update', { triggerConfig: null }, created.id);
  const read = await call('getById', {}, created.id);
  expect(read).toEqual({ ...created, triggerConfig: null, updatedAt: read.updatedAt });
  await call('update', { actionConfig: null, conditions: null }, created.id);
  expect(await call('getById', {}, created.id)).toMatchObject({ triggerConfig: null, actionConfig: null, conditions: null, enabled: false });
});
