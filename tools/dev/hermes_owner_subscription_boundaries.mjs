// Live, disposable fixture only. Sources are born through supported HTTP, never SQL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
const root=resolve(import.meta.dirname,'../..');
const sb='/private/tmp/hermes-owner-subscription-4898-20261015-sandbox';
assert.equal(process.env.RHYTHM_SANDBOX_DIR,sb);
const require=createRequire(root+'/apps/api_server/package.json');
const Database=require('better-sqlite3'), db=new Database(sb+'/rhythm.db');
const headers={'Content-Type':'application/json',Authorization:'Bearer e02-synthetic-session-not-a-secret'};
const base='http://127.0.0.1:4898';
const request=(path,body,method=body?'POST':'GET')=>fetch(base+path,{headers,method,redirect:'error',...(body?{body:JSON.stringify(body)}:{})});
const born=[];
let ownerUserId;
async function create(){
  const response=await request('/agent-sessions',{name:'Synthetic subscription boundary',cwd:sb+'/home',modelMode:'fixed'});
  assert.equal(response.status,201);
  const data=await response.json(),session=data.session??data;
  const row=db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(session.id);
  assert.equal(row.owner_user_id,ownerUserId);assert.ok(row.sdk_session_id);
  born.push(session.id);return row;
}
const subscription=id=>({sourceKind:'agent_session',sourceId:id,hermesSessionId:'boundary-'+id,profile:'default'});
const events=id=>'/hermes-notify/runs/'+id+'/events';
const rows=id=>db.prepare('SELECT * FROM hermes_notify_events WHERE session_id=? ORDER BY cursor').all(id);
try {
  ownerUserId=(await (await request('/hermes-notify/identity')).json()).ownerUserId;
  assert.equal(ownerUserId,1);
  assert.ok(db.prepare('SELECT id FROM users WHERE id=?').get(2),'valid fixture owner2');
  // One extra metadata fixture only, through the normal project API; keep FK enforcement.
  const projectResponse=await request('/projects',{name:'Synthetic revocation target',cwd:sb+'/tmp'});
  assert.equal(projectResponse.status,201,'supported project fixture creation');
  const targetProject=await projectResponse.json();
  assert.ok(targetProject.id);
  assert.ok(db.prepare('SELECT id FROM projects WHERE id=?').get(targetProject.id),'project FK exists before move');
  const other=await create();
  // Audit the real stdio MCP process, forwarding allowed HTTP unchanged. No capability exists.
  const audit=process.env.RHYTHM_APPROVED_FIXTURE_ROOT+'/owner-mcp-audit.jsonl';
  const cap=sb+'/absent-runtime-capability.json';assert.equal(existsSync(cap),false);
  writeFileSync(audit,'',{mode:0o600});
  const preload=`
    import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    const log=entry=>fs.appendFileSync(${JSON.stringify(audit)},JSON.stringify(entry)+'\\n');
    const cap=${JSON.stringify(cap)};
    for(const object of [fs,fs.promises]) for(const name of ['open','openSync','readFile','readFileSync','createReadStream']) {
      if(typeof object[name]!=='function')continue;const original=object[name];
      object[name]=function(path,...args){if(String(path)===cap){log({capRead:true});throw Error('capability read forbidden');}return original.call(this,path,...args);};
    }
    syncBuiltinESMExports();const original=globalThis.fetch;
    globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);
      log({path:url.pathname,method:options?.method??'GET'});
      if(url.origin!=='http://127.0.0.1:4898'||!['/hermes-notify/subscriptions','/hermes-notify/subscriptions/disable'].includes(url.pathname))throw Error('registrar/projection/delegation or other HTTP forbidden');
      return original(input,options);};log({armed:true});`;
  const mcpRequire=createRequire(root+'/apps/mcp_server/package.json');
  const {Client}=mcpRequire('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=mcpRequire('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'owner-capability-audit',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import','data:text/javascript,'+encodeURIComponent(preload),root+'/apps/mcp_server/dist/index.js'],stderr:'pipe',
      env:{PATH:process.env.PATH,HOME:sb+'/home',RHYTHM_API_URL:base,RHYTHM_AGENT_URL:base,
        RHYTHM_API_TOKEN:'e02-synthetic-session-not-a-secret',RHYTHM_RUNTIME_CAPABILITY_FILE:cap}}));
    assert.equal((await client.listTools()).tools.length,114);
    assert.ok(!(await client.callTool({name:'rhythm_subscribe_updates',arguments:subscription(other.id)})).isError);
    assert.ok(!(await client.callTool({name:'rhythm_unsubscribe_updates',arguments:{sourceKind:'agent_session',sourceId:other.id}})).isError);
  } finally {await client.close();}
  const calls=readFileSync(audit,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls,[{armed:true},{path:'/hermes-notify/subscriptions',method:'POST'},
    {path:'/hermes-notify/subscriptions/disable',method:'POST'}],'no capability read or registrar/projection/delegation HTTP');
  assert.equal(existsSync(cap),false);
  const foreignBefore=db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(other.id),foreignRows=rows(other.id);
  // Test-only revocation of actual API-created rows; no fake event, SDK or origin is inserted.
  for(const [field,value] of [['owner_user_id',2],['owner_user_id',null],['sdk_session_id',other.sdk_session_id],['project_id',targetProject.id]]){
    const source=await create(),id=source.id;
    assert.equal((await request('/hermes-notify/subscriptions',subscription(id))).status,201);
    assert.equal((await request(events(id))).status,200);
    const retained=rows(id);assert.ok(retained.length>0);
    const stream=await request('/hermes-notify/stream?runId='+id+'&after='+retained.at(-1).cursor);
    assert.equal(stream.status,200);const reader=stream.body.getReader();
    db.prepare('UPDATE agent_sessions SET '+field+'=? WHERE id=?').run(value,id);
    assert.equal((await request(events(id))).status,404,field+' history');
    assert.equal((await request('/hermes-notify/stream?runId='+id)).status,404,field+' SSE');
    assert.equal((await request('/hermes-notify/runs/'+id+'/ack',{eventId:retained[0].event_id,state:'visible'})).status,404,field+' ACK');
    assert.ok([404,409].includes((await request('/hermes-notify/subscriptions',subscription(id))).status),field+' no rebind');
    // Real API event trigger while revoked must not publish anything new.
    const renamed=await request('/agent-sessions/'+id,{name:'Revoked scope rename'},'PATCH');
    // Ordinary PATCH/engine lookup may accept or reject a revoked fixture row.
    // Neither outcome may grant notify access or add outbox rows (asserted below).
    assert.ok([200,404].includes(renamed.status),'revoked fixture update response');
    // An existing SSE reader must close, not leak retained events, on the next flush.
    await Promise.race([(async()=>{for(;;){const end=await reader.read();if(end.done)return;
      assert.ok(!new TextDecoder().decode(end.value).includes('data:'),field+' no SSE leak');}})(),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE revocation timeout')),17000).unref())]);
    assert.deepEqual(rows(id),retained,field+' durable rows preserved');
    db.prepare('UPDATE agent_sessions SET '+field+'=? WHERE id=?').run(source[field],id);
    assert.deepEqual(db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(other.id),foreignBefore,'foreign source unchanged');
    assert.deepEqual(rows(other.id),foreignRows,'foreign journal unchanged');
    console.log('PASS revocation '+field+'='+String(value)+' history/SSE/ACK denial, existing SSE closure, retained rows');
  }
  const source=await create(),id=source.id;
  assert.equal((await request('/hermes-notify/subscriptions',subscription(id))).status,201);
  const retained=rows(id);
  const stream=await request('/hermes-notify/stream?runId='+id+'&after='+retained.at(-1).cursor);
  const reader=stream.body.getReader();
  assert.equal((await request('/hermes-notify/subscriptions/disable',{sourceKind:'agent_session',sourceId:id})).status,200);
  assert.equal((await reader.read()).done,true);
  assert.equal((await request(events(id))).status,404);
  assert.equal((await request('/hermes-notify/stream?runId='+id)).status,404);
  assert.equal((await request('/hermes-notify/runs/'+id+'/ack',{eventId:retained[0].event_id,state:'visible'})).status,404);
  assert.equal((await request('/agent-sessions/'+id,{name:'Disabled source update'},'PATCH')).status,200);
  await new Promise(r=>setTimeout(r,500));assert.deepEqual(rows(id),retained);
  assert.equal(db.prepare('SELECT count(*) n FROM agent_bridge_jobs').get().n,0);
  assert.deepEqual(db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(other.id),foreignBefore);
  assert.deepEqual(rows(other.id),foreignRows);
  const proof={ownerTransfer:'PASS',nullOwner:'PASS',currentSDK:'PASS',projectMove:'PASS',unsubscribe:'PASS',existingSSEClosure:'PASS',preservedRows:true,foreignSourceUnchanged:true,capabilityReadAttempts:0,registrarProjectionDelegationHTTP:0,auditedOwnerMCPRequests:2,bridgeJobs:0,projectFixture:targetProject.id,extraProjectMetadata:1,revocationCases:4,unsubscribeCases:1,existingSSEClosures:5,apiCreatedSources:born};
  writeFileSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT+'/boundaries.json',JSON.stringify(proof),{mode:0o600});
  console.log(JSON.stringify(proof));
} finally {db.close();}
