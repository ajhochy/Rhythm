// Canonical sandbox lifecycle + real source HTTP auth matrix. No live credentials.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, lstatSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
assert.equal(process.env.RHYTHM_LIVE_E2E,'1','explicit isolated live-test opt-in required');
const exec = promisify(execFile);
const root = resolve(import.meta.dirname,'../..');
const fixture = '/private/tmp/hermes-auth-compatibility-20261014-fixture';
const sb = '/private/tmp/hermes-auth-compatibility-20261014-sandbox';
const runtime = `${root}/tools/dev/.hermes-shipping-runtime`, node = `${runtime}/node/bin/node`;
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(process.execPath,node);
assert.equal(hash(`${runtime}/dist/opencode-darwin-arm64/bin/opencode`),'d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072');
assert.ok(!existsSync(sb),'refuse existing sandbox');
const files = ['apps/api_server/src/routes/agent_approvals_routes.ts','apps/api_server/src/routes/hermes_notify_routes.ts',
  'apps/api_server/src/middleware/auth_middleware.ts','apps/api_server/src/services/mobile_cloud_identity_service.ts',
  'apps/api_server/src/security/relay_approval_security.ts','apps/api_server/src/security/human_approval_security.ts',
  'apps/api_server/src/security/trusted_mcp_call.ts','apps/api_server/src/services/hermes_notify_service.ts',
  'apps/api_server/src/__tests__/hermes_cloud_owner_auth.test.ts','apps/mcp_server/src/index.ts',
  'tools/dev/hermes_fixture_provision.py','tools/dev/sandbox.sh'];
const snapshot = () => Object.fromEntries(files.map(p => [p,hash(`${root}/${p}`)]));
const evidence = {sourceBefore:snapshot(),commands:[],modelRequests:0};
const env = {PATH:`${resolve(node,'..')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:fixture,
  RHYTHM_APPROVED_FIXTURE_ROOT:fixture,RHYTHM_LIVE_DB_PATH:`${fixture}/rhythm.db`,
  RHYTHM_SANDBOX_OPENCODE_CONFIG:`${fixture}/auth-opencode-config.json`,RHYTHM_SANDBOX_DIR:sb,
  RHYTHM_SANDBOX_API_PORT:'5498',RHYTHM_SANDBOX_ENGINE_PORT:'5497',RHYTHM_SANDBOX_GATEWAY_PORT:'5499',
  RHYTHM_SANDBOX_NODE_BIN:node,RHYTHM_SANDBOX_ENGINE_DIR:runtime,RHYTHM_SANDBOX_SKIP_ENGINE_BUILD:'1',
  DB_CLIENT:'sqlite',RHYTHM_OPTIMIZER_MODE:'shadow',OPENCODE_PURE:'1',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',
  OPENCODE_DISABLE_MODELS_FETCH:'1',RHYTHM_NUMBAT_MONITORING_DISABLED:'1',NO_PROXY:'*',no_proxy:'*'};
async function command(file,args,childEnv=env,cwd=root) {
  const entry = {file,args,exit:null}; evidence.commands.push(entry);
  try {
    const result = await exec(file,args,{env:childEnv,cwd,timeout:240000,maxBuffer:8*1024*1024});
    entry.exit=0; console.log(result.stdout.trim()); return result;
  } catch(error) {
    entry.exit=error.code; console.log(error.stdout || ''); console.error(error.stderr || ''); throw error;
  }
}
const metadata = createServer((req,res) => {
  if(req.method==='GET' && req.url==='/v1/models') {
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({object:'list',data:[]}));
  } else { evidence.modelRequests++; res.writeHead(400); res.end(); }
});
let up=false;
try {
  for(const port of [5498,5497,5499]) {
    const r=await exec('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN'])
      .catch(e => { assert.equal(e.code,1); return {stdout:''}; });
    assert.equal(r.stdout,'','sandbox port must be free');
  }
  if(!existsSync(fixture)) await command(node,['tools/dev/sandbox_fixture.mjs',fixture]);
  assert.equal(lstatSync(`${fixture}/rhythm.db`).mode&0o777,0o400);
  await new Promise((done,fail) => {metadata.once('error',fail);metadata.listen(0,'127.0.0.1',done);});
  const config=JSON.parse(readFileSync(`${fixture}/opencode.json`,'utf8'));
  config.mcp.rhythm.command=[node,`${root}/apps/mcp_server/dist/index.js`];
  config.mcp.rhythm.environment.RHYTHM_API_URL=config.mcp.rhythm.environment.RHYTHM_AGENT_URL='http://127.0.0.1:5498';
  config.provider={'auth-fixture':{npm:'@ai-sdk/openai-compatible',options:{apiKey:'synthetic-not-a-credential',
    baseURL:`http://127.0.0.1:${metadata.address().port}/v1`},models:{'metadata-only':{name:'metadata-only',tool_call:false,limit:{context:4096,output:512}}}}};
  config.model=config.small_model='auth-fixture/metadata-only';
  // Repeated verification uses the same source path, but refreshes only our own
  // synthetic metadata URL after confirming its fixture boundary.
  if(existsSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG)) {
    assert.equal(lstatSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG).mode&0o777,0o400);
    const {chmodSync}=await import('node:fs'); chmodSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG,0o600);
    writeFileSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG,JSON.stringify(config)); chmodSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG,0o400);
  } else writeFileSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG,JSON.stringify(config),{flag:'wx',mode:0o400});
  await command('/bin/bash',['tools/dev/sandbox.sh','up']); up=true;
  await command('/bin/bash',['tools/dev/sandbox.sh','status']);
  for(const path of ['/health','/opencode/health']) assert.equal((await fetch(`http://127.0.0.1:5498${path}`,{redirect:'error'})).status,200);
  const auth={Authorization:'Bearer e02-synthetic-session-not-a-secret'};
  const id=await fetch('http://127.0.0.1:5498/hermes-notify/identity',{headers:auth,redirect:'error'});
  assert.equal(id.status,200); assert.deepEqual(await id.json(),{version:1,ownerUserId:1});
  for(const path of ['/hermes-notify/identity','/hermes-notify/events','/agent-approvals/relay/pending']) {
    assert.equal((await fetch(`http://127.0.0.1:5498${path}`,{redirect:'error'})).status,401);
  }
  evidence.liveApi={health:200,engine:200,identity:{version:1,ownerUserId:1},missingBearer:401};
  const require=createRequire(`${root}/apps/mcp_server/package.json`);
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'cloud-owner-compatibility-fixture',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:node,args:[`${root}/apps/mcp_server/dist/index.js`],stderr:'pipe',
      env:{PATH:'/usr/bin:/bin',HOME:`${sb}/home`,RHYTHM_API_URL:'http://127.0.0.1:5498',
        RHYTHM_AGENT_URL:'http://127.0.0.1:5498',RHYTHM_API_TOKEN:'e02-synthetic-session-not-a-secret'}}));
    const {tools}=await client.listTools(), names=tools.map(t=>t.name);
    assert.equal(names.length,114); assert.equal(new Set(names).size,114);
    for(const name of ['rhythm_list_pending_approvals','rhythm_get_pending_approval','rhythm_decide_approval','rhythm_subscribe_updates','rhythm_unsubscribe_updates']) assert.ok(names.includes(name));
    evidence.mcpInventory={baseline:109,approvals:3,subscriptions:2,additive:5,total:114};
  } finally {await client.close();}
  const testEnv={...env,HOME:`${sb}/home`,XDG_CONFIG_HOME:`${sb}/home/.config`,XDG_DATA_HOME:`${sb}/home/.local/share`,
    XDG_CACHE_HOME:`${sb}/home/.cache`,TMPDIR:`${sb}/tmp`,DB_PATH:':memory:',RHYTHM_OPENCODE_ENGINE_PORT:'5497',
    NODE_OPTIONS:`--require=${root}/tools/dev/hermes_shipping_auth_test_helper/loopback.cjs`};
  for(const mode of ['local','hosted']) {
    const report=`${fixture}/${mode}-${randomUUID()}.json`;
    await command(node,['node_modules/vitest/vitest.mjs','run','src/__tests__/hermes_cloud_owner_auth.test.ts',
      '--no-file-parallelism','--reporter=json',`--outputFile=${report}`],{...testEnv,HERMES_AUTH_MODE:mode},`${root}/apps/api_server`);
    const r=JSON.parse(readFileSync(report,'utf8')); assert.equal(r.numFailedTests,0); assert.equal(r.numPassedTests,9);
    evidence[mode]={passed:r.numPassedTests,report};
  }
  await command(node,['node_modules/typescript/bin/tsc','-p','tsconfig.json','--strict'],testEnv,`${root}/apps/api_server`);
  await command(node,['node_modules/typescript/bin/tsc','-p','tsconfig.json','--strict'],testEnv,`${root}/apps/mcp_server`);
  assert.equal(evidence.modelRequests,0);
} finally {
  try { if(up || existsSync(sb)) await command('/bin/bash',['tools/dev/sandbox.sh','down']); }
  finally {
    metadata.closeAllConnections(); await new Promise(done => metadata.close(done));
    evidence.sourceAfter=snapshot(); assert.deepEqual(evidence.sourceAfter,evidence.sourceBefore);
    assert.ok(!existsSync(sb),'canonical down must remove owned sandbox');
    writeFileSync(`${fixture}/compatibility-receipt-${randomUUID()}.json`,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o400});
    console.log(JSON.stringify({liveApi:evidence.liveApi,local:evidence.local,hosted:evidence.hosted,mcpInventory:evidence.mcpInventory,modelRequests:evidence.modelRequests,teardown:'canonical down'}));
  }
}
