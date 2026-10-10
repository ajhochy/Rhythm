import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// UNIT real files/SQLite, no signer/approval/admitted work/model/API engine.
// All newly generated inspector fixtures retained; no deleting teardown.
const files = ['src/selectTasks.ts','tests/selectTasks.test.mjs','package.json','tsconfig.json'];
const working = `export function selectTasks(tasks, status) {
 if (status !== undefined && status !== 'open' && status !== 'done') throw new TypeError('unsupported status');
 return status === undefined ? [...tasks] : tasks.filter(task => task.status === status);
}`;
function fixture(code = working, escaping = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(),'rhythm-coding-verifier-unit-')));
  const root = join(base,'workspace'), artifact = join(base,'server-captures');
  mkdirSync(join(root,'src'),{recursive:true}); mkdirSync(join(root,'tests')); mkdirSync(artifact);
  if (escaping) {
    writeFileSync(join(base,'outside.ts'),code,{flag:'wx'});
    symlinkSync(join(base,'outside.ts'),join(root,files[0]));
  } else writeFileSync(join(root,files[0]),code,{flag:'wx'});
  writeFileSync(join(root,files[1]),'// untracked dirty UNIT input, NOT trusted evaluator\n',{flag:'wx'});
  writeFileSync(join(root,files[2]),'{"type":"module"}',{flag:'wx'});
  writeFileSync(join(root,files[3]),'{}',{flag:'wx'});
  return {base,root,artifact};
}
async function verifier() {
  const name = '../services/coordinator_coding_artifact_verifier';
  return await import(name).catch(() => null);
}

describe('C3 protected capture/evaluation and C4 SQL publication, UNIT only', () => {
  it('captures actual dirty/untracked allowed bytes and modes, next capture read matches digest', async () => {
    const f=fixture(), module=await verifier();
    const capture=module ? await module.captureCodingSnapshot(f.root,files,f.artifact) : null;
    expect(capture?.files.map((v: {path:string})=>v.path)).toEqual(files.slice().sort());
    const test=capture.files.find((v:{path:string})=>v.path===files[1]);
    expect(test.sha256).toBe(createHash('sha256').update(readFileSync(join(f.root,files[1]))).digest('hex'));
    expect(readFileSync(join(capture.directory,files[1]),'utf8')).toContain('untracked dirty');
    expect(module.codingSnapshotCurrent(capture)).toBe(true);
    writeFileSync(join(f.root,files[1]),'// later allowed input change');
    expect(module.codingSnapshotCurrent(capture)).toBe(false);
  });

  it.skipIf(process.env.RHYTHM_CODING_EVALUATOR_PROTECTION_QUALIFIED !== '1')('independent protected seven checks pass actual capture; failed behavior not worker-test exit/hash success', async () => {
    const module=await verifier(), good=fixture(), bad=fixture('export const selectTasks=(tasks,status)=>tasks;');
    const evaluate=async (f:ReturnType<typeof fixture>) => module ? module.verifyCodingSnapshot(
      await module.captureCodingSnapshot(f.root,files,f.artifact), module.codingEvaluatorPins()) : null;
    const pass=await evaluate(good), fail=await evaluate(bad);
    expect(pass?.verdict, pass?.reason).toBe('passed');
    expect(pass.checks.map((c:{id:string})=>c.id)).toEqual(['open','done','omitted','empty_no_match','order','unsupported_status','input_preservation']);
    expect(pass.checks.every((c:{passed:boolean})=>c.passed)).toBe(true);
    expect(fail.verdict).toBe('failed');
    expect(fail.checks.some((c:{passed:boolean})=>!c.passed)).toBe(true);
  });

  it('rejects escape/symlink input and protected pin mismatch; unavailable proof is unverified', async () => {
    const module=await verifier(), f=fixture(), escape=fixture(working,true);
    expect(module).not.toBeNull();
    await expect(module.captureCodingSnapshot(escape.root,files,escape.artifact)).rejects.toThrow();
    const capture=await module.captureCodingSnapshot(f.root,files,f.artifact);
    const receipt=await module.verifyCodingSnapshot(capture,{...module.codingEvaluatorPins(),evaluatorDigest:'0'.repeat(64)});
    expect(receipt.verdict).toBe('unverified');
  });

  it('one root+operation local row/association across repeat, SDK idnull and next canonical read useful', () => {
    const db=new Database(':memory:'); runMigrations(db); setDb(db);
    db.prepare(`INSERT INTO users(id,name,email) VALUES(7,'UNIT identity','unit-result@example.invalid')`).run();
    db.prepare(`INSERT INTO projects(id,name,cwd,created_at) VALUES('unit-result-project','UNIT project','/private/tmp/unit',?)`).run(new Date().toISOString());
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,category,owner_user_id,project_id)
      VALUES('unit-root-result','UNIT no inference','librarian','idle','/private/tmp/unit','chat',7,'unit-result-project')`).run();
    const columns=db.pragma('table_info(agent_async_delegations)') as {name:string}[];
    expect(columns.some(c=>c.name==='coding_result_receipt_json')).toBe(true);
    db.prepare(`INSERT INTO agent_async_delegations(id,parent_session_id,child_session_id,target_agent_config_id,status,
      created_at,updated_at,coding_delivery_mode,coding_root_session_id,coding_operation_key,coding_result_receipt_json)
      VALUES('unit-delivery-only','unit-root-result','unit-root-result','INSPECTOR_ONLY','completed',?,?,'delivery_only_v1',
      'unit-root-result','unit-operation',?)`).run(new Date().toISOString(),new Date().toISOString(),JSON.stringify({
        kind:'delivery_only_v1',execution:'not_exercised',verification:'not_exercised',files:[],checks:[],usage:null,
        limits:['UNIT delivery-only; no coding execution or verification exercised']}));
    const repo=new AgentSessionMessagesRepository() as unknown as {appendCodingResult(id:string,scope:{ownerUserId:number;projectId:string}):{id:number}|null};
    const result=typeof repo.appendCodingResult==='function' ? repo.appendCodingResult('unit-delivery-only',{ownerUserId:7,projectId:'unit-result-project'}) : null;
    expect(typeof result?.id).toBe('number');
    if (!result) throw new Error('canonical result publication absent');
    const again=repo.appendCodingResult('unit-delivery-only',{ownerUserId:7,projectId:'unit-result-project'});
    expect(again?.id).toBe(result.id);
    const rows=db.prepare('SELECT * FROM agent_session_messages WHERE session_id=?').all('unit-root-result') as Record<string,unknown>[];
    expect(rows).toHaveLength(1); expect(rows[0].sdk_message_id).toBeNull();
    expect(rows[0].raw_text).toContain('Server-local'); expect(rows[0].raw_text).toContain('not_exercised');
    expect(rows[0].local_event_key).toBeTruthy();
    expect(new AgentSessionMessagesRepository().listBySessionStructured('unit-root-result',20)[0].rawText).toContain('delivery-only');
    const async=db.prepare('SELECT result_message_id,status FROM agent_async_delegations WHERE id=?').get('unit-delivery-only') as {result_message_id:string;status:string};
    expect(Number(async.result_message_id)).toBe(result.id); expect(async.status).toBe('completed');
    expect(()=>repo.appendCodingResult('unit-delivery-only',{ownerUserId:8,projectId:'unit-result-project'})).toThrow();
    db.close();
  });
});
