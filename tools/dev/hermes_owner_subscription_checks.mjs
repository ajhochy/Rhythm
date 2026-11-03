// Opt-in, canonical sandbox only; never uses operator credentials or Bridge enrollment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
const root=resolve(import.meta.dirname,'../..');
const fixture='/private/tmp/hermes-owner-subscription-4898-20261015-fixture';
const sb='/private/tmp/hermes-owner-subscription-4898-20261015-sandbox';
const runtime=`${root}/tools/dev/.hermes-shipping-runtime`, node=`${runtime}/node/bin/node`;
assert.equal(process.execPath,node);
assert.equal(createHash('sha256').update(readFileSync(`${runtime}/dist/opencode-darwin-arm64/bin/opencode`)).digest('hex'),'d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072');
const env={PATH:`${runtime}/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:fixture,
  RHYTHM_APPROVED_FIXTURE_ROOT:fixture,RHYTHM_LIVE_DB_PATH:`${fixture}/rhythm.db`,
  RHYTHM_SANDBOX_OPENCODE_CONFIG:`${fixture}/subscription-opencode-config.json`,RHYTHM_SANDBOX_DIR:sb,
  RHYTHM_SANDBOX_API_PORT:'4898',RHYTHM_SANDBOX_ENGINE_PORT:'4897',RHYTHM_SANDBOX_GATEWAY_PORT:'4899',
  RHYTHM_SANDBOX_NODE_BIN:node,RHYTHM_SANDBOX_ENGINE_DIR:runtime,RHYTHM_SANDBOX_SKIP_ENGINE_BUILD:'1',
  DB_CLIENT:'sqlite',RHYTHM_LIVE_E2E:'1',RHYTHM_OPTIMIZER_MODE:'shadow',OPENCODE_PURE:'1',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',
  OPENCODE_DISABLE_MODELS_FETCH:'1',RHYTHM_NUMBAT_MONITORING_DISABLED:'1'};
function command(file,args,cwd=root){execFileSync(file,args,{cwd,env,stdio:'inherit',timeout:240000});}
assert.ok(!existsSync(sb),'refuse existing sandbox');
if(!existsSync(fixture)){
  command(node,['tools/dev/sandbox_fixture.mjs',fixture]);
  const config=JSON.parse(readFileSync(`${fixture}/opencode.json`));
  config.mcp.rhythm.command=[node,`${root}/apps/mcp_server/dist/index.js`];
  config.mcp.rhythm.environment.RHYTHM_API_URL=config.mcp.rhythm.environment.RHYTHM_AGENT_URL='http://127.0.0.1:4898';
  writeFileSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG,JSON.stringify(config),{flag:'wx',mode:0o400});
}
const require=createRequire(`${root}/apps/mcp_server/package.json`);
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const client=new Client({name:'owner-subscription-acceptance',version:'1'});
try{
  command('/bin/bash',['tools/dev/sandbox.sh','up']);
  command('/bin/bash',['tools/dev/sandbox.sh','status']);
  const testEnv={...env,HOME:`${sb}/home`,TMPDIR:`${sb}/tmp`,DB_PATH:':memory:',
    NODE_OPTIONS:`--require=${root}/tools/dev/hermes_shipping_auth_test_helper/loopback.cjs`};
  execFileSync(node,['node_modules/vitest/vitest.mjs','run','src/__tests__/hermes_source_contract.test.ts',
    'src/__tests__/hermes_coordinator_notify_contract.test.ts','src/__tests__/hermes_coordinator_notify_boundaries.test.ts',
    'src/__tests__/hermes_coordinator_notify_revocation.test.ts','src/__tests__/hermes_wire_projection.test.ts',
    'src/__tests__/hermes_approvals.test.ts','--no-file-parallelism'],{cwd:`${root}/apps/api_server`,env:testEnv,stdio:'inherit',timeout:120000});
  execFileSync(node,['node_modules/vitest/vitest.mjs','run','src/__tests__/mcp_capabilities_and_tool_registration.test.ts',
    '--no-file-parallelism'],{cwd:`${root}/apps/mcp_server`,env:testEnv,stdio:'inherit',timeout:120000});
  execFileSync(node,['node_modules/typescript/bin/tsc','-p','tsconfig.json','--strict'],
    {cwd:`${root}/apps/mcp_server`,env:testEnv,stdio:'inherit',timeout:120000});
  command('/usr/bin/env',['python3','-B','tools/dev/test_owner_subscription_cli.py']);
  await client.connect(new StdioClientTransport({command:node,args:[`${root}/apps/mcp_server/dist/index.js`],stderr:'pipe',
    env:{PATH:env.PATH,HOME:`${sb}/home`,RHYTHM_API_URL:'http://127.0.0.1:4898',RHYTHM_AGENT_URL:'http://127.0.0.1:4898',RHYTHM_API_TOKEN:'e02-synthetic-session-not-a-secret'}}));
  const names=(await client.listTools()).tools.map(t=>t.name);
  const headers={'Content-Type':'application/json',Authorization:'Bearer e02-synthetic-session-not-a-secret'};
  const created=await fetch('http://127.0.0.1:4898/agent-sessions',{method:'POST',headers,redirect:'error',
    body:JSON.stringify({name:'Synthetic ordinary owner source',cwd:`${sb}/home`,modelMode:'fixed'})});
  assert.equal(created.status,201,'ordinary authenticated session creation');
  const data=await created.json(), session=data.session ?? data;
  assert.ok(session.id);
  const subscription={sourceKind:'agent_session',sourceId:session.id,hermesSessionId:'synthetic-saved-chat',profile:'default'};
  if(process.argv.includes('--source-red')){
    const response=await fetch('http://127.0.0.1:4898/hermes-notify/subscriptions',{method:'POST',headers,body:JSON.stringify(subscription)});
    assert.equal(response.status,201,'ordinary owned non-Bridge source subscription must not require runtime enrollment');
  }
  assert.ok(names.includes('rhythm_subscribe_updates'),'official MCP must expose owner subscription without runtime capability');
  assert.ok(names.includes('rhythm_unsubscribe_updates'));
  assert.equal(names.length,114); assert.equal(new Set(names).size,114);
  if(!process.argv.includes('--control-only')){
    command('/usr/bin/env',['python3','-B','tools/dev/hermes_owner_subscription_native.py',session.id]);
    const nativeProof=JSON.parse(readFileSync(`${fixture}/native-${session.id}.json`));
    assert.equal(nativeProof.nativeBrowserACK,true);
    subscription.hermesSessionId=nativeProof.hermesSessionId;
  }
  const result=await client.callTool({name:'rhythm_subscribe_updates',arguments:subscription});
  assert.ok(!result.isError,'ordinary owned session MCP subscribe');
  const control=JSON.parse(result.content[0].text);
  assert.equal(control.sourceKind,'agent_session');assert.equal(control.sourceId,session.id);
  assert.equal(control.workflowRunId,null);assert.equal(control.runId,session.id);
  const page=await fetch(`http://127.0.0.1:4898/hermes-notify/runs/${session.id}/events`,{headers});
  assert.equal(page.status,200);const events=(await page.json()).events;
  assert.ok(events.length>0);assert.ok(events.every(e=>e.version===2 && e.runId===session.id && e.kind!=='completion'));
  for(const body of [{...subscription,ownerUserId:2},{...subscription,callbackUrl:'http://127.0.0.1:1'},
    {...subscription,sourceKind:'bridge_job'}]){
    const response=await fetch('http://127.0.0.1:4898/hermes-notify/subscriptions',{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(response.status,400);
  }
  assert.equal((await fetch('http://127.0.0.1:4898/hermes-notify/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)})).status,401);
  const reassigned=await client.callTool({name:'rhythm_subscribe_updates',arguments:{...subscription,hermesSessionId:'other-chat'}});
  assert.equal(reassigned.isError,true);
  const off=await client.callTool({name:'rhythm_unsubscribe_updates',arguments:{sourceKind:'agent_session',sourceId:session.id}});
  assert.ok(!off.isError);
  assert.equal((await fetch(`http://127.0.0.1:4898/hermes-notify/runs/${session.id}/events`,{headers})).status,404);
  assert.equal((await fetch(`http://127.0.0.1:4898/hermes-notify/runs/${session.id}/ack`,{method:'POST',headers,body:JSON.stringify({eventId:events[0].eventId,state:'visible'})})).status,404);
  command('/usr/bin/env',['python3','-B','tools/dev/test_owner_subscription_cli.py']);
  execFileSync(node,['tools/dev/hermes_owner_subscription_boundaries.mjs'],{cwd:root,env,stdio:'inherit',timeout:90000});
  console.log('PASS inventory 112+2=114');
}finally{
  await client.close();
  if(existsSync(sb))command('/bin/bash',['tools/dev/sandbox.sh','down']);
}
