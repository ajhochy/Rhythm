import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
vi.mock('../services/opencode_engine',()=>({opencodeSessionMap:new Map(),opencodeClient:{
  promptAsync:()=>{throw new Error('delivery controls must never prompt a model');},
}}));
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';

// Actual SQL, fixed operator configuration and local reads. Delivery-only,
// execution/verification explicitly NOT exercised; no grant/signer/model.
let db:Database.Database;
let sb:string;
const actor={ownerUserId:7,projectId:'delivery-project'};
beforeEach(()=>{
  db=new Database(':memory:');runMigrations(db);setDb(db);
  db.prepare(`INSERT INTO users(id,name,email) VALUES(7,'UNIT identity','delivery-unit@example.invalid')`).run();
  db.prepare(`INSERT INTO projects(id,name,cwd,created_at) VALUES('delivery-project','UNIT project','/private/tmp/unit',?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,category,owner_user_id,project_id)
    VALUES('delivery-root','UNIT delivery only','librarian','idle','/private/tmp/unit','chat',7,'delivery-project')`).run();
  sb=realpathSync(mkdtempSync('/private/tmp/rhythm-coordinator-qualification-sandbox-delivery-control-'));
  writeFileSync(`${sb}/coding-delivery-test-scope.json`,JSON.stringify({version:1,rootSessionId:'delivery-root',operationKey:'delivery-unit-op',...actor}),{flag:'wx',mode:0o600});
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('RHYTHM_SANDBOX_DIR',sb);
  vi.stubEnv('PORT','4798');vi.stubEnv('RHYTHM_OPENCODE_ENGINE_PORT','4797');vi.stubEnv('RHYTHM_MOBILE_GATEWAY_PORT','4799');
});
afterEach(()=>{db.close();vi.unstubAllEnvs();});
async function moduleUnderTest(){const name='../services/coordinator_coding_delivery_controls';return await import(name).catch(()=>null);}

it('trusted delivery-only receipt is held before canonical commit and survives a fresh read; release yields same association',async()=>{
  // Regression: global/in-memory hold or before-result hold masks the restart
  // exactly-once boundary; repeat releases create duplicate root rows.
  const module=await moduleUnderTest();
  const id=module ? module.createDeliveryOnlyFixture('delivery-root',actor) : null;
  expect(typeof id).toBe('string');
  const before=db.prepare('SELECT * FROM agent_async_delegations WHERE id=?').get(id) as Record<string,unknown>;
  expect(JSON.parse(String(before.coding_result_receipt_json)).execution).toBe('not_exercised');
  expect(JSON.parse(String(before.coding_test_hold_json)).held).toBe(true);
  expect(new AgentSessionMessagesRepository().listBySession('delivery-root',20)).toHaveLength(0);
  const fresh=await moduleUnderTest();
  expect(fresh.readDeliveryTestState('delivery-root',actor).hold.held).toBe(true);
  fresh.releaseDeliveryHold('delivery-root',actor);
  const first=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  expect(typeof first?.id).toBe('number');
  fresh.releaseDeliveryHold('delivery-root',actor);
  const second=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  expect(second?.id).toBe(first?.id);
  const rows=db.prepare('SELECT sdk_message_id,local_event_key,raw_text FROM agent_session_messages WHERE session_id=?').all('delivery-root') as Record<string,unknown>[];
  expect(rows).toHaveLength(1);expect(rows[0].sdk_message_id).toBeNull();
  expect(rows[0].raw_text).toContain('not_exercised');
  expect(db.prepare(`SELECT COUNT(*) n FROM coordinator_conversation_commands WHERE coding_grant_json IS NOT NULL`).get()).toEqual({n:0});
});

it('production ignores test scope; wrong user/project/root/config cannot mutate SQL or issue authority',async()=>{
  const module=await moduleUnderTest();expect(module).not.toBeNull();
  vi.stubEnv('NODE_ENV','production');
  expect(()=>module.createDeliveryOnlyFixture('delivery-root',actor)).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM agent_async_delegations').get()).toEqual({n:0});
  vi.stubEnv('NODE_ENV','test');
  for(const bad of [{...actor,ownerUserId:8},{...actor,projectId:'other'}]) expect(()=>module.createDeliveryOnlyFixture('delivery-root',bad)).toThrow();
  expect(()=>module.createDeliveryOnlyFixture('foreign-root',actor)).toThrow();
  vi.stubEnv('PORT','4001');expect(()=>module.createDeliveryOnlyFixture('delivery-root',actor)).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM agent_async_delegations').get()).toEqual({n:0});
});

it('delivery-only cancellation and late failure remain the one canonical row and do not change execution claims',async()=>{
  // Regression: cancelled/late failure produces a second root result or reports
  // the control fixture as real failed model execution/notified work.
  const module=await moduleUnderTest();
  const id=module.createDeliveryOnlyFixture('delivery-root',actor);
  module.releaseDeliveryHold('delivery-root',actor);
  const first=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  const updated=typeof module.updateDeliveryFixtureControl==='function'
    ? module.updateDeliveryFixtureControl('delivery-root',actor,{control:'cancelled'}) : null;
  expect(updated?.status).toBe('cancelled');
  module.updateDeliveryFixtureControl('delivery-root',actor,{lateFact:'failed'});
  const again=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  expect(again?.id).toBe(first?.id);
  const state=module.readDeliveryTestState('delivery-root',actor);
  expect(state.status).toBe('cancelled');expect(state.receipt.execution).toBe('not_exercised');
  expect(state.receipt.verification).toBe('not_exercised');
  expect(new AgentSessionMessagesRepository().listBySession('delivery-root',20)).toHaveLength(1);
  expect(again?.rawText).toContain('Control: cancelled');
});

it('actual SQL failure before association rolls back the canonical insert, then retry yields one row',async()=>{
  const module=await moduleUnderTest(),id=module.createDeliveryOnlyFixture('delivery-root',actor);
  module.releaseDeliveryHold('delivery-root',actor);
  db.exec(`CREATE TRIGGER unit_result_constraint BEFORE UPDATE OF result_message_id ON agent_async_delegations
    BEGIN SELECT RAISE(ABORT,'UNIT association storage failure'); END`);
  expect(()=>new AgentSessionMessagesRepository().appendCodingResult(id,actor)).toThrow('UNIT association storage failure');
  expect(db.prepare("SELECT COUNT(*) n FROM agent_session_messages WHERE session_id='delivery-root'").get()).toEqual({n:0});
  expect(db.prepare('SELECT result_message_id FROM agent_async_delegations WHERE id=?').get(id)).toEqual({result_message_id:null});
  db.exec('DROP TRIGGER unit_result_constraint'); // in-memory injected constraint only; no production/file destruction
  const first=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  const next=new AgentSessionMessagesRepository().appendCodingResult(id,actor);
  expect(next?.id).toBe(first?.id);
  expect(db.prepare("SELECT COUNT(*) n FROM agent_session_messages WHERE session_id='delivery-root'").get()).toEqual({n:1});
});

it('existing parent serialization publishes released local result when busy clears, without SDK root mapping or model wake',async()=>{
  const module=await moduleUnderTest(),id=module.createDeliveryOnlyFixture('delivery-root',actor);
  module.releaseDeliveryHold('delivery-root',actor);
  db.prepare("UPDATE agent_sessions SET status='working' WHERE id='delivery-root'").run();
  await new AsyncDelegationCompletionService().onParentIdle('delivery-root');
  expect(new AgentSessionMessagesRepository().listBySession('delivery-root',20)).toHaveLength(0);
  db.prepare("UPDATE agent_sessions SET status='idle' WHERE id='delivery-root'").run();
  await new AsyncDelegationCompletionService().onParentIdle('delivery-root');
  const first=module.readDeliveryTestState('delivery-root',actor);
  expect(typeof first.resultMessageId).toBe('number');
  await new AsyncDelegationCompletionService().recoverAfterRestart(1);
  const second=module.readDeliveryTestState('delivery-root',actor);
  expect(second.resultMessageId).toBe(first.resultMessageId);
  expect(new AgentSessionMessagesRepository().listBySessionStructured('delivery-root',20)).toHaveLength(1);
  expect(second.counters).toEqual(first.counters);
  expect(second.status).toBe('completed');
});
