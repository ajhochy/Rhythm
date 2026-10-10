import { loadQualificationFixtureAuthority } from './qualification_fixture_authority';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../database/db';
import { env } from '../config/env';

interface DeliveryActor {ownerUserId:number;projectId:string}
interface FixedScope extends DeliveryActor {version:1;rootSessionId:string;operationKey:string}

function fixedScope(root:string,actor:DeliveryActor):FixedScope {
  // Test controls are structurally unavailable in normal/hosted runtime. No
  // browser-provided grant, evaluator result or global hold switch exists.
  const fixture=loadQualificationFixtureAuthority();
  if(fixture){
    if(env.dbClient!=='sqlite' || env.dbPath!==fixture.dbPath || actor.ownerUserId!==fixture.ownerUserId)throw new Error('foreign qualified delivery owner');
    const row=getDb().prepare(`SELECT a.coding_operation_key,a.coding_delivery_mode,s.owner_user_id,s.project_id,s.cwd,c.coding_grant_json
      FROM agent_async_delegations a JOIN agent_sessions s ON s.id=a.coding_root_session_id
      JOIN coordinator_conversation_commands c ON c.root_session_id=a.coding_root_session_id AND c.command_key=a.coding_operation_key
      WHERE a.coding_root_session_id=? AND a.coding_delivery_mode='coding_root_v1' ORDER BY a.created_at DESC LIMIT 2`).all(root) as Array<Record<string,unknown>>;
    if(row.length!==1 || row[0].owner_user_id!==actor.ownerUserId || row[0].project_id!==actor.projectId ||
      typeof row[0].cwd!=='string' || !row[0].cwd.startsWith(fixture.fixtureRoot+'/') || row[0].cwd!==process.env.RHYTHM_CODING_WORKSPACE_ROOT || !row[0].coding_grant_json)throw new Error('genuine qualified delivery binding unavailable');
    const grant=JSON.parse(String(row[0].coding_grant_json));
    if(!grant.approvalId || !grant.manager || !grant.worker)throw new Error('genuine delivery grant incomplete');
    return {version:1,rootSessionId:root,operationKey:String(row[0].coding_operation_key),...actor};
  }
  const sb=process.env.RHYTHM_SANDBOX_DIR;
  if (process.env.NODE_ENV==='production' || env.dbClient!=='sqlite' || !sb ||
      !sb.startsWith('/private/tmp/rhythm-coordinator-qualification-sandbox') || realpathSync(sb)!==sb ||
      lstatSync(sb).uid!==process.getuid?.() || (lstatSync(sb).mode&0o777)!==0o700 ||
      process.env.PORT!=='4798' || process.env.RHYTHM_OPENCODE_ENGINE_PORT!=='4797' ||
      process.env.RHYTHM_MOBILE_GATEWAY_PORT!=='4799') throw new Error('coding delivery test scope unavailable');
  const path=join(sb,'coding-delivery-test-scope.json'),info=lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid!==process.getuid?.() || (info.mode&0o777)!==0o600 ||
      realpathSync(path)!==path || info.size>4096) throw new Error('unsafe coding delivery test scope');
  const scope=JSON.parse(readFileSync(path,'utf8')) as FixedScope;
  if (Object.keys(scope).sort().join(',')!=='operationKey,ownerUserId,projectId,rootSessionId,version' ||
      scope.version!==1 || scope.rootSessionId!==root || scope.ownerUserId!==actor.ownerUserId ||
      scope.projectId!==actor.projectId || typeof scope.operationKey!=='string' || !scope.operationKey || scope.operationKey.length>256) {
    throw new Error('foreign coding delivery test scope');
  }
  const session=getDb().prepare('SELECT owner_user_id,project_id FROM agent_sessions WHERE id=?').get(root) as {owner_user_id:number;project_id:string}|undefined;
  if (!session || session.owner_user_id!==actor.ownerUserId || session.project_id!==actor.projectId) throw new Error('foreign root');
  return scope;
}

/** Arm only AFTER the actual trusted receipt exists, BEFORE canonical commit. */
export function holdCodingResultIfScoped(id:string,actor:DeliveryActor):void {
  const row=getDb().prepare('SELECT * FROM agent_async_delegations WHERE id=?').get(id) as Record<string,unknown>|undefined;
  if (!row || !row.coding_result_receipt_json || row.result_message_id || row.coding_test_hold_json) return;
  if(loadQualificationFixtureAuthority()){const receipt=JSON.parse(String(row.coding_result_receipt_json));if(row.coding_delivery_mode!=='coding_root_v1' || row.status!=='completed' || receipt.execution!=='completed' || receipt.verification!=='passed')return;}
  let scope:FixedScope;
  try {scope=fixedScope(String(row.coding_root_session_id),actor);} catch{return;}
  if (scope.operationKey!==row.coding_operation_key) return;
  getDb().prepare('UPDATE agent_async_delegations SET coding_test_hold_json=? WHERE id=? AND coding_result_receipt_json IS NOT NULL AND result_message_id IS NULL AND coding_test_hold_json IS NULL')
    .run(JSON.stringify({...scope,held:true,released:false}),id);
}

/** Explicit DELIVERY ONLY: never approval/admission/SDK create/model/verification. */
export function createDeliveryOnlyFixture(root:string,actor:DeliveryActor):string {
  if(loadQualificationFixtureAuthority())throw new Error('qualified startup cannot synthesize terminal receipts');
  const scope=fixedScope(root,actor),db=getDb();
  return db.transaction(()=>{
    const id='delivery-only-'+createHash('sha256').update(JSON.stringify([root,scope.operationKey])).digest('hex');
    const existing=db.prepare('SELECT coding_delivery_mode,coding_root_session_id,coding_operation_key FROM agent_async_delegations WHERE id=?').get(id) as Record<string,unknown>|undefined;
    if (existing) {
      if (existing.coding_delivery_mode!=='delivery_only_v1' || existing.coding_root_session_id!==root || existing.coding_operation_key!==scope.operationKey) throw new Error('delivery fixture collision');
      return id;
    }
    const at=new Date().toISOString();
    const receipt={kind:'delivery_only_v1',execution:'not_exercised',verification:'not_exercised',files:[],checks:[],usage:null,
      limits:['Delivery-only isolated fixture; no coding execution, approval, model result or evaluator verification exercised']};
    db.prepare(`INSERT INTO agent_async_delegations(id,parent_session_id,child_session_id,target_agent_config_id,status,created_at,updated_at,completed_at,
      coding_delivery_mode,coding_root_session_id,coding_operation_key,coding_result_receipt_json)
      VALUES(?,?,?,'DELIVERY_ONLY_INSPECTOR','completed',?,?,?,'delivery_only_v1',?,?,?)`)
      .run(id,root,root,at,at,at,root,scope.operationKey,JSON.stringify(receipt));
    holdCodingResultIfScoped(id,actor);
    return id;
  }).immediate();
}

export function releaseDeliveryHold(root:string,actor:DeliveryActor):void {
  const scope=fixedScope(root,actor),db=getDb();
  const rows=db.prepare("SELECT id,coding_test_hold_json FROM agent_async_delegations WHERE coding_root_session_id=? AND coding_operation_key=? AND coding_delivery_mode IN ('coding_root_v1','delivery_only_v1') LIMIT 2")
    .all(root,scope.operationKey) as Array<{id:string;coding_test_hold_json:string|null}>;
  if(rows.length!==1)throw new Error('root delivery hold ambiguous');const row=rows[0];
  if (!row?.coding_test_hold_json) throw new Error('operation hold unavailable');
  const hold=JSON.parse(row.coding_test_hold_json);
  if (hold.rootSessionId!==scope.rootSessionId || hold.operationKey!==scope.operationKey || hold.ownerUserId!==scope.ownerUserId || hold.projectId!==scope.projectId) throw new Error('hold scope changed');
  if (hold.released) return;
  db.prepare('UPDATE agent_async_delegations SET coding_test_hold_json=? WHERE id=? AND coding_test_hold_json=?')
    .run(JSON.stringify({...hold,held:false,released:true}),row.id,row.coding_test_hold_json);
}

export function readDeliveryTestState(root:string,actor:DeliveryActor) {
  const scope=fixedScope(root,actor),db=getDb();
  const rows=db.prepare("SELECT id,status,coding_test_hold_json,coding_result_receipt_json,result_message_id FROM agent_async_delegations WHERE coding_root_session_id=? AND coding_operation_key=? AND coding_delivery_mode IN ('coding_root_v1','delivery_only_v1') LIMIT 2")
    .all(root,scope.operationKey) as Array<Record<string,unknown>>;
  if(rows.length>1)throw new Error('root delivery receipt ambiguous');const row=rows[0];
  const count=(sql:string)=>Number((db.prepare(sql).get() as {n:number}).n);
  return {scope,operationId:row?.id??null,status:row?.status??null,
    hold:row?.coding_test_hold_json?JSON.parse(String(row.coding_test_hold_json)):null,
    receipt:row?.coding_result_receipt_json?JSON.parse(String(row.coding_result_receipt_json)):null,
    resultMessageId:row?.result_message_id?Number(row.result_message_id):null,
    counters:{sdkSessions:count('SELECT COUNT(*) n FROM agent_sessions WHERE sdk_session_id IS NOT NULL'),
      workerReservations:count("SELECT COUNT(*) n FROM coordinator_conversation_commands WHERE role='worker' AND allocation_intent_at IS NOT NULL"),
      promptDispatches:count('SELECT COUNT(*) n FROM agent_turn_dispatches'),
      modelSteps:count('SELECT COUNT(*) n FROM agent_served_steps')}};
}

/** Honest fixture control metadata only; never cancels/runs real SDK work. */
export function updateDeliveryFixtureControl(root:string,actor:DeliveryActor,action:unknown) {
  const scope=fixedScope(root,actor),db=getDb();
  if (!action || typeof action!=='object' || Array.isArray(action) || Object.keys(action).length!==1 ||
      !((action as {control?:string}).control==='cancelled' || (action as {lateFact?:string}).lateFact==='failed')) throw new Error('invalid fixture control');
  db.transaction(()=>{
    const row=db.prepare(`SELECT id,coding_result_receipt_json FROM agent_async_delegations
      WHERE coding_root_session_id=? AND coding_operation_key=? AND coding_delivery_mode='delivery_only_v1'`)
      .get(root,scope.operationKey) as {id:string;coding_result_receipt_json:string}|undefined;
    if (!row) throw new Error('delivery-only fixture unavailable');
    if ((action as {control?:string}).control==='cancelled') db.prepare("UPDATE agent_async_delegations SET status='cancelled' WHERE id=?").run(row.id);
    else {
      const receipt=JSON.parse(row.coding_result_receipt_json);
      const fact='Delivery-only late failure control fact; NOT model/execution/evaluator output';
      if (!receipt.limits.includes(fact)) receipt.limits.push(fact);
      db.prepare('UPDATE agent_async_delegations SET coding_result_receipt_json=? WHERE id=?').run(JSON.stringify(receipt),row.id);
    }
  }).immediate();
  return readDeliveryTestState(root,actor);
}
