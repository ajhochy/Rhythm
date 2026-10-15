import express from 'express';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './helpers/real_server';

// Real source routers, resolver, repositories and HTTP. Only the upstream Cloud
// identity authority is synthetic; no credentials or data from the operator.
const local = process.env.HERMES_AUTH_MODE !== 'hosted';
let upstream: TestServer, api: TestServer, db: Database.Database;
let cards: string[], foreignCard: string, root: string, chat: string, run: string;
let cloudCalls = 0;
beforeAll(async () => {
  const cloud = express();
  cloud.get('/auth/me', (req, res) => {
    cloudCalls++;
    expect(req.headers.cookie).toBeUndefined();
    const token = req.header('Authorization') ?? '';
    if (token === 'Bearer fixture-offline') { req.socket.destroy(); return; }
    if (token === 'Bearer fixture-unavailable') { res.status(503).json({}); return; }
    const foreign = token === 'Bearer fixture-foreign-admin';
    const mismatch = token === 'Bearer fixture-sub-mismatch';
    if (!['Bearer fixture-valid-cloud', 'Bearer fixture-foreign-admin', 'Bearer fixture-sub-mismatch'].includes(token)) {
      res.status(401).json({}); return;
    }
    res.json({user:{id:foreign ? 9002 : 9001, name:'Synthetic Cloud', role:'admin',
      email:foreign ? 'admin@example.invalid' : 'member@example.invalid',
      googleSub:foreign ? 'fixture-admin-sub' : mismatch ? 'wrong-sub' : 'fixture-owner-sub'}});
  });
  upstream = await startTestServer(cloud);
  process.env.RHYTHM_CLOUD_API_URL = process.env.PROD_API_URL = upstream.baseUrl;
  process.env.DB_CLIENT = 'sqlite'; process.env.DB_PATH = ':memory:';
  process.env.AGENT_LOCAL = String(local);
  // The URL and local mode are controlled BEFORE any source auth imports.
  const {runMigrations} = await import('../database/migrations');
  const {setDb} = await import('../database/db');
  db = new Database(':memory:'); runMigrations(db); setDb(db);
  db.exec(`INSERT INTO users(id,name,email,google_sub,role,email_notifications_enabled) VALUES
    (1,'Foreign local admin','admin@example.invalid','fixture-admin-sub','admin',0),
    (2,'Local fixture owner','member@example.invalid','fixture-owner-sub','member',0);
    INSERT INTO sessions(token,user_id) VALUES ('fixture-local-owner',2);`);
  root = randomUUID(); chat = randomUUID(); run = randomUUID();
  const session = (id: string, owner: number) => db.prepare(`INSERT INTO agent_sessions
    (id,name,agent_kind,status,cwd,owner_user_id) VALUES (?,'Fixture','manager','completed','/private/tmp',?)`).run(id,owner);
  session(root,2); const other = randomUUID(); session(other,1);
  const {AgentApprovalsRepository} = await import('../repositories/agent_approvals_repository');
  const approvals = new AgentApprovalsRepository();
  cards = ['approve','reject','tamper'].map(action => approvals.create({sessionId:root,action,preview:'Synthetic exact preview'}).id);
  foreignCard = approvals.create({sessionId:other,action:'Foreign only'}).id;
  const {agentApprovalsRouter} = await import('../routes/agent_approvals_routes');
  const {createHermesNotifyRouter} = await import('../routes/hermes_notify_routes');
  const {hermesNotifyService} = await import('../services/hermes_notify_service');
  hermesNotifyService.initialize();
  const {requireAuth} = await import('../middleware/auth_middleware');
  const {errorHandler} = await import('../middleware/error_handler');
  const app = express(); app.use(express.json());
  app.get('/auth/me',requireAuth,(req,res) => res.json({user:req.auth!.user}));
  app.use('/agent-approvals',agentApprovalsRouter);
  app.use('/hermes-notify',createHermesNotifyRouter());
  app.use(errorHandler); api = await startTestServer(app);
},30000);
afterAll(async () => {
  if(api) await api.close(); if(upstream) await upstream.close();
  const {hermesNotifyService} = await import('../services/hermes_notify_service');
  hermesNotifyService.stop(); db?.close();
});
async function request(path: string, token: string | null = 'fixture-valid-cloud', body?: object, status=200) {
  const res = await fetch(api.baseUrl+path,{method:body ? 'POST' : 'GET',redirect:'error',
    headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(10000)});
  expect(res.status, path).toBe(status);
  // Test payloads are checked below; undici declares json() unknown in strict emit.
  return res as Omit<Response, 'json'> & { json(): Promise<any> };
}
it('valid Cloud identity normalizes 9001 to local owner 2, without private user fields',async () => {
  const res = await request('/hermes-notify/identity',undefined,undefined,local ? 200 : 401);
  if(local) expect(await res.json()).toEqual({version:1,ownerUserId:2});
  await request('/auth/me',undefined,undefined,401); // Deliberately still local-only.
});
it('relay list/get/approve/reject use the normalized owner and exact revision/hash',async () => {
  if(!local) { await request('/agent-approvals/relay/pending',undefined,undefined,401); return; }
  const page = await (await request('/agent-approvals/relay/pending')).json();
  expect(page.map((c: {id:string}) => c.id).sort()).toEqual([...cards].sort());
  for(const [i,decision] of ['approved','rejected'].entries()) {
    const card = await (await request(`/agent-approvals/relay/pending/${cards[i]}`)).json();
    const result = await (await request(`/agent-approvals/relay/${cards[i]}/decision`,undefined,
      {revision:card.revision,cardHash:card.cardHash,decision,attestation:'owner_chose_in_chat'})).json();
    expect(result.status).toBe(decision); expect(result.audit.ownerUserId).toBe(2);
  }
  const card = await (await request(`/agent-approvals/relay/pending/${cards[2]}`)).json();
  await request(`/agent-approvals/relay/${cards[2]}/decision`,undefined,
    {revision:card.revision,cardHash:'0'.repeat(64),decision:'approved',attestation:'owner_chose_in_chat'},409);
});
it('foreign Cloud admin cannot read or decide another local owner card',async () => {
  if(!local) return;
  const page = await (await request('/agent-approvals/relay/pending','fixture-foreign-admin')).json();
  expect(page.map((c: {id:string}) => c.id)).toEqual([foreignCard]);
  await request(`/agent-approvals/relay/pending/${cards[2]}`,'fixture-foreign-admin',undefined,404);
  const card = await (await request(`/agent-approvals/relay/pending/${cards[2]}`)).json();
  await request(`/agent-approvals/relay/${cards[2]}/decision`,'fixture-foreign-admin',
    {revision:card.revision,cardHash:card.cardHash,decision:'approved',attestation:'owner_chose_in_chat'},404);
});
it('notification origin/history/ACK/SSE are local-owner scoped with unchanged envelopes',async () => {
  const token = local ? 'fixture-valid-cloud' : 'fixture-local-owner';
  await request('/hermes-notify/origins',token,{sessionId:root,hermesSessionId:chat,workflowId:run},201);
  const page = await (await request('/hermes-notify/events',token)).json();
  expect(page.version).toBe(1); expect(page.events.length).toBeGreaterThan(0);
  const event = page.events[0]; expect(event.sessionId).toBe(root);
  expect(Object.keys(event).sort()).toEqual(['cursor','eventId','hermesSessionId','kind','referenceId','sessionId','state','text','version','workflowId']);
  await request('/hermes-notify/ack',token,{eventId:event.eventId,state:'accepted'});
  if(local) {
    expect((await (await request('/hermes-notify/events','fixture-foreign-admin')).json()).events).toEqual([]);
    await request('/hermes-notify/ack','fixture-foreign-admin',{eventId:event.eventId,state:'visible'},404);
    await request(`/hermes-notify/runs/${run}/origin`,'fixture-foreign-admin',{sessionId:root,hermesSessionId:chat},404);
  }
  const abort = new AbortController();
  const stream = await fetch(api.baseUrl+'/hermes-notify/stream',{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
  expect(stream.status).toBe(200); const reader = stream.body!.getReader();
  try { expect(new TextDecoder().decode((await reader.read()).value)).toContain(event.eventId); }
  finally { abort.abort(); await reader.cancel().catch(() => {}); }
});
it('no bearer is 401 despite ambient local session; revoked/bad/mismatched tokens fail closed',async () => {
  for(const path of ['/hermes-notify/identity','/hermes-notify/events','/agent-approvals/relay/pending']) {
    for(const token of [null,'fixture-revoked','fixture-bad','fixture-sub-mismatch']) await request(path,token,undefined,401);
  }
  expect(db.prepare('SELECT status FROM agent_approvals WHERE id=?').get(cards[2])).toEqual({status:'pending'});
});
it('offline Cloud preserves 503 semantics; hosted mode never attempts Cloud fallback',async () => {
  const before = cloudCalls;
  await request('/hermes-notify/identity','fixture-offline',undefined,local ? 503 : 401);
  if(!local) expect(cloudCalls).toBe(before);
  // Existing resolver treats HTTP non-OK as invalid, network unavailable as 503.
  await request('/hermes-notify/identity','fixture-unavailable',undefined,401);
});
it('local session identity and existing relay API remain usable in either mode',async () => {
  expect(await (await request('/hermes-notify/identity','fixture-local-owner')).json()).toEqual({version:1,ownerUserId:2});
  await request('/agent-approvals/relay/pending','fixture-local-owner');
});

// Supplemental V2 coverage; the seven frozen RED criteria above are unchanged.
it('V2 bridge run origin, history, SSE and ACK all use normalized local owner 2',async () => {
  const {AgentBridgeJobsRepository} = await import('../shared_agents/delegation_jobs_repository');
  const {AgentBridgeProjectionsRepository} = await import('../shared_agents/projections_repository');
  const token = local ? 'fixture-valid-cloud' : 'fixture-local-owner';
  const session = randomUUID(), projection = randomUUID(), chain = randomUUID(), native = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,owner_user_id)
    VALUES (?,'V2 fixture','manager','completed','/private/tmp',2)`).run(session);
  new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:2,hermesProfile:'default',
    agentId:'manager',revision:1,launchKind:'interactive',sessionKey:native,jobId:null,depth:0,chainId:chain,
    cwd:null,snapshotJson:'{}',issuedGeneration:'fixture-auth',issuedAt:now});
  const jobs = new AgentBridgeJobsRepository(db);
  const {row} = jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'fixture',
    localUserId:2,hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'fixture-auth',
    parentSessionId:chain,parentAgentId:'manager',parentProjectionId:projection,targetAgentId:'secretary',
    targetRevision:1,targetRuntime:'opencode',depth:1,chainId:chain,prompt:'Synthetic only',context:null,cwd:null,now});
  jobs.setChild(row.id,session);
  const path = `/hermes-notify/runs/${row.id}`;
  await request(path+'/origin',token,{sessionId:session,hermesSessionId:native},201);
  const page = await (await request(path+'/events',token)).json();
  expect(page).toMatchObject({version:2,runId:row.id}); expect(page.events.length).toBeGreaterThan(0);
  const event = page.events[0];
  expect(event).toMatchObject({version:2,runId:row.id,workflowId:row.id,sessionId:session,hermesSessionId:native});
  expect(Object.keys(event).sort()).toEqual(['cursor','eventId','hermesSessionId','kind','referenceId','runId','sessionId','state','text','version','workflowId']);
  if(local) {
    for(const suffix of ['/events','/origin','/ack']) await request(path+suffix,'fixture-foreign-admin',
      suffix === '/events' ? undefined : suffix === '/origin' ? {sessionId:session,hermesSessionId:native} : {eventId:event.eventId,state:'visible'},404);
    await request('/hermes-notify/stream?runId='+row.id,'fixture-foreign-admin',undefined,404);
  }
  const abort = new AbortController();
  const stream = await fetch(api.baseUrl+'/hermes-notify/stream?runId='+row.id,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
  expect(stream.status).toBe(200); const reader = stream.body!.getReader();
  try { expect(new TextDecoder().decode((await reader.read()).value)).toContain(event.eventId); }
  finally { abort.abort(); await reader.cancel().catch(() => {}); }
  await request(path+'/ack',token,{eventId:event.eventId,state:'accepted'});
  expect((await (await request(path+'/events',token)).json()).events.find((e: {eventId:string}) => e.eventId===event.eventId).state).toBe('accepted');
  await request(path+'/ack',token,{eventId:event.eventId,state:'visible'});
  // Visible tombstones leave the replay page; assert the exact event, not page[0].
  expect((await (await request(path+'/events',token)).json()).events.some((e: {eventId:string}) => e.eventId===event.eventId)).toBe(false);
  expect(db.prepare('SELECT state FROM hermes_notify_events WHERE event_id=?').get(event.eventId)).toEqual({state:'visible'});
  expect(db.prepare('SELECT owner_user_id AS owner FROM hermes_notify_origins WHERE session_id=?').get(session)).toEqual({owner:2});
});

it('CLI names the minimal identity endpoint and its real Python transport resolves the same owner',async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const {resolve} = await import('node:path');
  const file = resolve(__dirname,'../../../../tools/dev/hermes_fixture_provision.py');
  const code = `
import ast, pathlib, runpy, sys
source = pathlib.Path(sys.argv[1]).read_text()
tree = ast.parse(source)
calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'api_call']
identity = [n for n in calls if len(n.args) > 1 and isinstance(n.args[1], ast.Constant) and n.args[1].value == '/hermes-notify/identity']
assert len(identity) == 2 and '/auth/me' not in source
assert "['ownerUserId']" in source
p = runpy.run_path(sys.argv[1])
result = p['request_json'](sys.argv[2], '/hermes-notify/identity', sys.argv[3])
assert result == dict(version=1, ownerUserId=2)
print('minimal identity transport PASS')
`;
  const result = await promisify(execFile)('python3',['-B','-c',code,file,api.baseUrl,
    local ? 'fixture-valid-cloud' : 'fixture-local-owner'],{timeout:15000});
  expect(result.stdout.trim()).toBe('minimal identity transport PASS');
});
