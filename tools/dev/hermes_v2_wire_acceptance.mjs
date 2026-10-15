import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const require = createRequire(new URL('../../apps/api_server/package.json', import.meta.url));
const repo = name => require(`./dist/${name}`);
const sb = '/private/tmp/hermes-coordinator-notify-20261014-sandbox';
const base = 'http://127.0.0.1:4998/hermes-notify';
const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const validate = events => spawnSync('python3', ['-B', new URL('./hermes_v2_pinned_validator.py', import.meta.url).pathname],
  {input: JSON.stringify(events), encoding:'utf8'});

test('real GET/SSE V1/V2 preserves pinned exact schema, labels, identity, references and authority', {skip:!enabled}, async () => {
  assert.equal(process.env.RHYTHM_SANDBOX_DIR, sb);
  assert.match(readFileSync(`${sb}/api_server.pid`, 'utf8').trim(), /^\d+$/);
  for (const url of ['http://127.0.0.1:4998/health','http://127.0.0.1:4998/opencode/health'])
    assert.equal((await fetch(url, {redirect:'error'})).status, 200);
  const engine = await (await fetch('http://127.0.0.1:4997/session', {method:'POST', redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Synthetic wire fixture'})})).json();
  assert.ok(engine.id);
  const db = new (require('better-sqlite3'))(`${sb}/rhythm.db`);
  repo('database/db').setDb(db);
  try {
    const owner = new (repo('repositories/users_repository').UsersRepository)().create({name:'Synthetic wire owner',email:`${randomUUID()}@example.invalid`}).id;
    const token = new (repo('repositories/sessions_repository').SessionsRepository)().create(owner).token;
    const http = (path, method='GET', body, auth=token) => fetch(base+path, {method,redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json', ...(auth?{Authorization:`Bearer ${auth}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const root=randomUUID(), legacy=randomUUID(), chat=randomUUID(), chain=randomUUID(), project=randomUUID(), projection=randomUUID(), now=new Date().toISOString();
    db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)').run(project,'Synthetic wire',sb,now);
    for (const id of [root,legacy]) db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id,project_id,profile_id)
      VALUES (?,'Synthetic wire','manager','idle',?,?,?,?,'secretary')`).run(id,sb,owner,id===root?engine.id:randomUUID(),project);
    new (repo('shared_agents/projections_repository').AgentBridgeProjectionsRepository)(db).insert({projectionId:projection,localUserId:owner,
      hermesProfile:'default',agentId:'manager',revision:1,launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId:chain,
      cwd:null,snapshotJson:'{}',issuedGeneration:'synthetic-wire',issuedAt:now});
    const jobs=new (repo('shared_agents/delegation_jobs_repository').AgentBridgeJobsRepository)(db);
    const {row}=jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'synthetic-wire',localUserId:owner,
      hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'synthetic-wire',parentSessionId:chain,parentAgentId:'manager',parentProjectionId:projection,
      targetAgentId:'secretary',targetRevision:1,targetRuntime:'opencode',depth:1,chainId:chain,prompt:'Synthetic',context:null,cwd:null,now});
    jobs.setChild(row.id,root);
    assert.equal((await http(`/runs/${row.id}/origin`,'POST',{sessionId:root,hermesSessionId:chat})).status,201);
    assert.equal((await http('/origins','POST',{sessionId:legacy,hermesSessionId:'legacy-chat',workflowId:'opaque-wire'})).status,201);
    const labels=[['progress','Rhythm session updated.',null],['progress','Rhythm returned output; verification pending.',null],
      ['completion','Rhythm agent execution completed.',null],['completion','Rhythm session completed.',null],
      ['error','Rhythm session reported an error.',null],['question','Rhythm session has a question. Open the Rhythm session.','opaque-request'],
      ['approval-request','Rhythm session needs approval. Open the Rhythm card.','canonical-card'],
      ['progress','Rhythm workflow running: 1 settled, 2 awaiting.',null],['completion','Rhythm workflow succeeded: 3 settled, 0 awaiting.',null]];
    // Retained-history synthetic rows test serialization, NOT engine/question/card/verification producers.
    for (const sid of [root,legacy]) for (const [kind,text,ref] of labels)
      db.prepare('INSERT INTO hermes_notify_events(event_id,session_id,source_key,kind,text,reference_id) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(),sid,randomUUID(),kind,text,ref);
    const journal = () => db.prepare('SELECT * FROM hermes_notify_events WHERE session_id IN (?,?) ORDER BY cursor').all(root,legacy);
    const get = async run => {const response=await http(run?`/runs/${row.id}/events`:'/events');assert.equal(response.status,200);return (await response.json()).events;};
    const sse = async (run, count) => {
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),5000);
      const response=await fetch(base+(run?`/stream?runId=${row.id}`:'/stream'),{redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
      assert.equal(response.status,200); const reader=response.body.getReader(); let buffer='', events=[];
      try { while(events.length<count) {const part=await reader.read();assert.equal(part.done,false);buffer+=new TextDecoder().decode(part.value);
        let end;while((end=buffer.indexOf('\n\n'))>=0) {const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
          const data=frame.split('\n').find(line=>line.startsWith('data: '));if(data) {const e=JSON.parse(data.slice(6));assert.ok(frame.includes(`id: ${e.cursor}\n`));events.push(e);}} }
        return events;
      } finally {clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
    };
    const v2=await get(true), v1=(await get(false)).filter(e=>e.sessionId===legacy), before=journal();
    const stream2=await sse(true,v2.length), stream1=(await sse(false,v1.length)).filter(e=>e.sessionId===legacy);
    writeFileSync(`${sb}/wire-receipt.json`,JSON.stringify({v2,v1,stream2,stream1},null,2),{mode:0o600});
    const result=validate([...v2,...v1,...stream2,...stream1]);
    assert.equal(result.status,0,`actual pinned Python validator rejection: ${result.stdout}${result.stderr}`);
    assert.deepEqual(stream2,v2); assert.deepEqual(stream1,v1);
    for (const events of [v2,v1]) {
      assert.deepEqual(new Set(events.map(e=>e.kind)),new Set(['progress','completion','error','question','approval-request']));
      assert.ok(events.some(e=>e.text==='Rhythm session updated.'));
      assert.ok(events.some(e=>e.text==='Rhythm session completed.'));
      assert.ok(!events.some(e=>e.text.includes('verification pending')||e.text.includes('agent execution')));
      assert.equal(events.find(e=>e.kind==='question').referenceId,'opaque-request');
      assert.equal(events.find(e=>e.kind==='approval-request').referenceId,'canonical-card');
      for (let i=1;i<events.length;i++) assert.ok(events[i].cursor>events[i-1].cursor);
    }
    assert.deepEqual(journal(),before,'wire reads must not rewrite source rows/hash/identity');
    assert.notEqual(validate([{...v2[0],unknownPrivateField:'private'}]).status,0,'receiver MUST reject unknown fields');
    for (const path of [`/runs/${row.id}/events`,`/stream?runId=${row.id}`]) assert.equal((await http(path,'GET',undefined,null)).status,401);
    for (const path of ['/runs/foreign-run/events','/stream?runId=foreign-run']) assert.equal((await http(path)).status,404);
    assert.equal((await http('/runs/foreign-run/ack','POST',{eventId:v2[0].eventId,state:'visible'})).status,404);
    assert.equal((await http(`/runs/${row.id}/ack`,'POST',{eventId:v2[0].eventId,state:'accepted'})).status,200);
    assert.equal((await get(true)).find(e=>e.eventId===v2[0].eventId).state,'accepted');
    assert.equal((await http(`/runs/${row.id}/ack`,'POST',{eventId:v2[0].eventId,state:'visible'})).status,200);
    assert.equal((await http(`/runs/${row.id}/ack`,'POST',{eventId:v2[0].eventId,state:'accepted'})).status,200);
    assert.equal(db.prepare('SELECT state FROM hermes_notify_events WHERE event_id=?').get(v2[0].eventId).state,'visible');
    for (const sid of [root,legacy]) db.prepare('INSERT INTO hermes_notify_events(event_id,session_id,source_key,kind,text) VALUES (?,?,?,?,?)')
      .run(randomUUID(),sid,randomUUID(),'progress','PRIVATE arbitrary model/question prose');
    for (const run of [true,false]) assert.ok(!(await get(run)).some(e=>e.text.includes('PRIVATE')),'unknown text withheld, not genericized');
    db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(root);
    for (const path of [`/runs/${row.id}/events`,`/stream?runId=${row.id}`]) assert.equal((await http(path)).status,404,'root membership denied before serialization');
    console.log(JSON.stringify({pinnedValidator:'PASS',kinds:5,GETandSSE:'V1/V2 identical',sourceRowsUnchanged:true,
      receiptSha256:createHash('sha256').update(readFileSync(`${sb}/wire-receipt.json`)).digest('hex')}));
  } finally {db.close();}
});
