import { expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateSandboxEngineOwnership } from '../services/sandbox_engine_attachment';

// EXTERNAL ONLY, actual API/native engine; delivery-only never A1-A3/fullA6.
// Two phases bracket externally reviewed stock API restart/PID archival. This
// harness never starts/kills API/engine, signs grants or runs candidate/model.
const live=process.env.RHYTHM_LIVE_E2E==='1' && process.env.RHYTHM_LIVE_CODING_DELIVERY==='1';
const phase=process.env.RHYTHM_LIVE_DELIVERY_PHASE;
function inputs(){
  const sb=process.env.RHYTHM_SANDBOX_DIR!;
  expect(sb.startsWith('/private/tmp/rhythm-coordinator-qualification-sandbox')).toBe(true);
  expect(process.env.RHYTHM_SANDBOX_API_PORT).toBe('4798');
  expect(process.env.RHYTHM_SANDBOX_ENGINE_PORT).toBe('4797');
  expect(process.env.RHYTHM_SANDBOX_GATEWAY_PORT).toBe('4799');
  const scope=JSON.parse(readFileSync(join(sb,'coding-delivery-test-scope.json'),'utf8'));
  const token=process.env.RHYTHM_LIVE_BEARER;
  expect(token).toBeTruthy(); // operator-provided legitimate fixture auth, not approval/model authority
  return {sb,scope,token:token!,base:'http://127.0.0.1:4798'};
}
async function api(path:string,body?:unknown):Promise<Record<string,any>>{
  const {base,token}=inputs();
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'error',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  expect(response.status).toBe(200);
  const value=await response.json();expect(value && typeof value==='object' && !Array.isArray(value)).toBe(true);
  return value as Record<string,any>;
}
function native(){
  const {sb}=inputs();validateSandboxEngineOwnership(sb,4797);
  const record=JSON.parse(readFileSync(join(sb,'opencode_engine.ownership.json'),'utf8'));
  return {pid:record.state.pid,start:record.state.start,binary:record.state.binary,store:record.state.store,config:record.state.config};
}
function apiIdentity(){
  const {sb}=inputs(),pid=Number(readFileSync(join(sb,'api_server.pid'),'utf8'));
  const helper=join(process.cwd(),'../../tools/dev/sandbox_api_recovery.py');
  const start=execFileSync('/usr/bin/python3',['-I','-B',helper,'inspect-start',String(pid)],{encoding:'utf8'}).trim();
  return {pid,start};
}

it.skipIf(!live || phase!=='before')('C6 before: trusted delivery-only receipt held before canonical commit, exact native/counter baseline retained',async()=>{
  const {sb,scope}=inputs(),path=`/agent-sessions/${scope.rootSessionId}/_coding-delivery`;
  const initial=await api(path+'/state');
  const anonymous=await fetch('http://127.0.0.1:4798'+path+'/state',{redirect:'error'});
  expect(anonymous.status).toBe(401);
  const malicious=await fetch('http://127.0.0.1:4798'+path+'/fixture',{method:'POST',redirect:'error',
    headers:{authorization:`Bearer ${inputs().token}`,'content-type':'application/json'},body:JSON.stringify({approved:true,receipt:'fake'})});
  expect(malicious.status).toBe(400);
  const nativeBefore=native(),apiBefore=apiIdentity();
  const held=await api(path+'/fixture',{});
  expect(held.hold.held).toBe(true);expect(held.resultMessageId).toBeNull();
  expect(held.receipt.kind).toBe('delivery_only_v1');
  expect(held.receipt.execution).toBe('not_exercised');expect(held.receipt.verification).toBe('not_exercised');
  expect(held.counters).toEqual(initial.counters);
  expect(native()).toEqual(nativeBefore);
  const transcript=await api(`/agent-sessions/${scope.rootSessionId}?transcriptLimit=200`);
  expect(transcript.messages.filter((m:{parts?:Array<{type:string;operationKey?:string}>})=>
    m.parts?.some(p=>p.type==='work_result' && p.operationKey===scope.operationKey))).toHaveLength(0);
  const file=join(sb,'coding-delivery-live-before.json');expect(existsSync(file)).toBe(false);
  writeFileSync(file,JSON.stringify({scope,native:nativeBefore,api:apiBefore,operationId:held.operationId,counters:held.counters}),{flag:'wx',mode:0o600});
});

it.skipIf(!live || phase!=='after')('C6 after actual stock restart: same canonical row/key/association over duplicate recovery/reopen, zero SDK/inference deltas',async()=>{
  const {sb,scope}=inputs(),before=JSON.parse(readFileSync(join(sb,'coding-delivery-live-before.json'),'utf8'));
  expect(before.scope).toEqual(scope);expect(native()).toEqual(before.native);
  expect(apiIdentity().pid).not.toBe(before.api.pid);
  const path=`/agent-sessions/${scope.rootSessionId}/_coding-delivery`;
  const held=await api(path+'/state');expect(held.operationId).toBe(before.operationId);expect(held.hold.held).toBe(true);
  expect(held.resultMessageId).toBeNull();expect(held.counters).toEqual(before.counters);
  const first=await api(path+'/release',{});expect(typeof first.resultMessageId).toBe('number');
  const duplicate=await api(path+'/recover',{});const reopened=await api(path+'/state');
  expect(duplicate.resultMessageId).toBe(first.resultMessageId);expect(reopened.resultMessageId).toBe(first.resultMessageId);
  const page=await api(`/agent-sessions/${scope.rootSessionId}?transcriptLimit=200`);
  const rows=page.messages.filter((m:{parts?:Array<{type:string;operationKey?:string}>})=>
    m.parts?.some(p=>p.type==='work_result' && p.operationKey===scope.operationKey));
  expect(rows).toHaveLength(1);expect(rows[0].id).toBe(first.resultMessageId);
  expect(rows[0].sdkMessageId).toBeNull();expect(rows[0].rawText).toContain('Server-local');
  const key=rows[0].parts.find((p:{type:string})=>p.type==='work_result').localEventKey;expect(key).toBeTruthy();
  const again=await api(`/agent-sessions/${scope.rootSessionId}?transcriptLimit=200`);
  const same=again.messages.find((m:{id:number})=>m.id===first.resultMessageId);
  expect(same.parts.find((p:{type:string})=>p.type==='work_result').localEventKey).toBe(key);
  expect(reopened.counters).toEqual(before.counters);
  for(const count of Object.keys(before.counters)) expect(reopened.counters[count]-before.counters[count]).toBe(0);
  expect(reopened.status).toBe('completed');expect(native()).toEqual(before.native);
  const cancelled=await api(path+'/control',{control:'cancelled'});
  expect(cancelled.status).toBe('cancelled');expect(cancelled.resultMessageId).toBe(first.resultMessageId);
  const late=await api(path+'/control',{lateFact:'failed'});
  expect(late.status).toBe('cancelled');expect(late.resultMessageId).toBe(first.resultMessageId);
  expect(late.receipt.execution).toBe('not_exercised');expect(late.counters).toEqual(before.counters);
  const finalPage=await api(`/agent-sessions/${scope.rootSessionId}?transcriptLimit=200`);
  const finalRows=finalPage.messages.filter((m:{parts?:Array<{type:string;localEventKey?:string}>})=>m.parts?.some(p=>p.localEventKey===key));
  expect(finalRows).toHaveLength(1);expect(finalRows[0].id).toBe(first.resultMessageId);
  expect(finalRows[0].rawText).toContain('Control: cancelled');
});
