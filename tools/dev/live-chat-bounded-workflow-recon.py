#!/usr/bin/env python3
"""Chat-only finite workflow recon with optional exact-source behavioral qualification. Startup and teardown are owned by sandbox.sh."""
import argparse, hashlib, json, os, pathlib, re, shutil, signal, socket, sqlite3, subprocess, time, urllib.error, urllib.request, uuid
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
parser.add_argument('--restart-approved-wake', action='store_true')
parser.add_argument('--diagnose-restart-mcp', action='store_true')
parser.add_argument('--qualify-source-sha')
args = parser.parse_args()
if args.diagnose_restart_mcp and (not args.restart_approved_wake or args.qualify_source_sha):
    raise SystemExit('Restart MCP diagnostic requires restart mode and cannot qualify source')
if os.environ.get('RHYTHM_LIVE_E2E') != '1':
    raise SystemExit('RHYTHM_LIVE_E2E=1 required; no process started')
if args.qualify_source_sha:
    if not re.fullmatch(r'[a-f0-9]{40}', args.qualify_source_sha):
        raise SystemExit('Full 40-hex source SHA required; no process started')
    current_head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if current_head != args.qualify_source_sha or subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True).strip():
        raise SystemExit('Exact committed clean source required; no process started')
OUT = pathlib.Path(args.out).resolve()
OUT.mkdir(parents=True, exist_ok=False)
SB = pathlib.Path('/private/tmp/rhythm-codex-g2-' + uuid.uuid4().hex[:12])
FIX = OUT / 'fixtures'
FIX.mkdir(mode=0o700)
NODE = shutil.which('node')
BUN = shutil.which('bun')
if not NODE or not BUN:
    raise SystemExit('Installed compatible node and bun are required; no install attempted')
TOKEN = 'g2-synthetic-token-not-a-secret'
body = 'The invented handoff requires an owner and a deadline.'
note = f'---\nkind: fact\nstatus: stable\n---\n{body}\n'
memory_id = str(uuid.uuid4())
version = 'sha256:' + hashlib.sha256(note.encode()).hexdigest()
scenario = {'sandbox': str(SB), 'fixtureRoot': str(FIX), 'sourceId': 'memory:' + memory_id, 'memoryId': memory_id,
            'version': version, 'note': note, 'privateDataCopied': False}
(OUT / 'scenario.json').write_text(json.dumps(scenario, indent=2))
now = lambda: datetime.now(timezone.utc).isoformat()
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
receipt = {'startedAtUtc': now(), 'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
           'sandbox': str(SB), 'ports': [4197, 4198, 4199], 'externalModelSynthetic': True, 'semanticRankingSynthetic': True, 'apiEngineMocked': False, 'qualification': 'DIRTY_RECON_ONLY',
           'normalRuntimeTouched': False, 'privateDataCopied': False, 'observations': [], 'restartApprovedWake': args.restart_approved_wake}
if args.qualify_source_sha: receipt['qualification'] = 'EXACT_COMMITTED_SOURCE'; receipt['qualifiedSourceSha'] = args.qualify_source_sha
protected_ports = [4001, 4002, 4096, 49333]
receipt['normalRuntimeListenersBefore'] = {str(port): subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fp'], capture_output=True, text=True).stdout.splitlines() for port in protected_ports}
receipt['harnessSha256'] = {str(p.relative_to(ROOT)): sha(p) for p in [ROOT / 'tools/dev/live-chat-bounded-workflow-recon.py', ROOT / 'tools/dev/live-chat-bounded-workflow-provider.ts', ROOT / 'tools/dev/live-chat-bounded-workflow-observer.py']}
source_paths = subprocess.check_output(['git', 'ls-files', '-z', 'apps/api_server/src', 'apps/mcp_server/src', 'apps/opencode_fork/packages/opencode/src', 'tools/dev/sandbox.sh'], cwd=ROOT).split(b'\0')
receipt['productSourceSha256'] = {os.fsdecode(p): sha(ROOT / os.fsdecode(p)) for p in source_paths if p and (ROOT / os.fsdecode(p)).is_file() and '/__tests__/' not in os.fsdecode(p) and not os.fsdecode(p).endswith('.test.ts')}
receipt['unreadableTrackedPaths'] = [os.fsdecode(p) for p in source_paths if p and not (ROOT / os.fsdecode(p)).is_file()]
def save(): (OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2))
def record(name, **value):
    receipt['observations'].append({'name': name, 'atUtc': now(), **value}); save()
def listen(port):
    with socket.socket() as s: return s.connect_ex(('127.0.0.1', port)) == 0
def request(path, payload=None, port=4198, method=None, extra_headers=None):
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=None if payload is None else json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN, **(extra_headers or {})}, method=method or ('GET' if payload is None else 'POST'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode(); return {'status': r.status, 'body': json.loads(text) if text else None}
    except urllib.error.HTTPError as r:
        text = r.read().decode()
        try: value = json.loads(text)
        except ValueError: value = text[:1000]
        return {'status': r.code, 'body': value}
def sql(query, values=()):
    with sqlite3.connect('file:' + str(SB / 'rhythm.db') + '?mode=ro', uri=True, timeout=5) as db:
        db.row_factory = sqlite3.Row
        return [dict(x) for x in db.execute(query, values)]
def mcp_config_metadata():
    path = SB / 'home/.config/opencode/opencode.json'
    config = json.loads(path.read_text())
    rhythm = config.get('mcp', {}).get('rhythm', {})
    return {'configSha256':sha(path), 'type':rhythm.get('type'), 'timeout':rhythm.get('timeout'),
      'command':rhythm.get('command'), 'environmentSha256':{k:hashlib.sha256(str(v).encode()).hexdigest() for k,v in rhythm.get('environment',{}).items()}}
def current(session_id):
    return json.loads(sql('SELECT coordinator_conversation_json FROM agent_sessions WHERE id=?', (session_id,))[0]['coordinator_conversation_json'])
def wait_for(predicate, seconds, reason):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value: return value
        time.sleep(.25)
    raise RuntimeError(reason)
model = None
observer = None
sandbox_env = None
logs = []
save()
try:
    occupied = [p for p in [4197, 4198, 4199, 4175, 4284] if listen(p)]
    if occupied: raise RuntimeError('Occupied sandbox ports; untouched: ' + repr(occupied))
    clean_env = {'PATH': os.environ.get('PATH', os.defpath), 'HOME': str(FIX),
                 'RHYTHM_LIVE_E2E': '1', 'RHYTHM_G2_LIVE_OUT': str(OUT), 'LANG': 'en_US.UTF-8'}
    observer_log = (OUT / 'observer.log').open('w'); logs.append(observer_log)
    observer = subprocess.Popen(['/usr/bin/python3', '-B', str(ROOT / 'tools/dev/live-chat-bounded-workflow-observer.py')], cwd=ROOT, env=clean_env, stdout=observer_log, stderr=subprocess.STDOUT)
    wait_for(lambda: (OUT / 'observer-ready.json').exists(), 10, 'Transparent observer readiness timeout')
    log = (OUT / 'model.log').open('w'); logs.append(log)
    model = subprocess.Popen([BUN, str(ROOT / 'tools/dev/live-chat-bounded-workflow-provider.ts')], cwd=ROOT, env=clean_env, stdout=log, stderr=subprocess.STDOUT)
    wait_for(lambda: (OUT / 'model-ready.json').exists() or model.poll() is not None, 20, 'Provider readiness timeout')
    if model.poll() is not None: raise RuntimeError('Provider failed; see model.log')
    provider_url = json.loads((OUT / 'model-ready.json').read_text())['url']
    record('synthetic_provider_ready', providerUrl=provider_url, pid=model.pid)
    # Fresh migrations, not a copy of any private database.
    migrate = OUT / 'prepare-fixture.cjs'
    migrate.write_text("const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(process.argv[2]+'/apps/api_server/package.json');const Database=r('better-sqlite3');const db=new Database(process.argv[3]);require(process.argv[2]+'/apps/api_server/dist/database/migrations.js').runMigrations(db);db.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').run('Synthetic G2 Owner','g2@example.invalid');db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,1)').run(process.argv[4]);db.prepare('UPDATE agent_configs SET enabled=0').run();for(const [id,marker,manager,delegates] of [['secretary','G2_SYNTHETIC_SECRETARY',1,['workflow-orchestrator']],['workflow-orchestrator','G2_SYNTHETIC_MANAGER',1,['verification-gate']],['verification-gate','G2_SYNTHETIC_REVIEWER',0,[]]]){db.prepare(\"INSERT INTO agent_configs(id,label,icon,command,is_agent,enabled,is_manager,system_prompt,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_delegates_json,core_permissions_json) VALUES(?,?,?,'opencode',1,1,?,?, 'test','test-model',?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,is_agent=1,is_manager=excluded.is_manager,system_prompt=excluded.system_prompt,model_provider='test',model_id='test-model',oc_agent=excluded.oc_agent,allowed_mcps_json=excluded.allowed_mcps_json,allowed_delegates_json=excluded.allowed_delegates_json,core_permissions_json=excluded.core_permissions_json,locked=0\").run(id,id,'check',manager,marker,id,JSON.stringify({rhythm:id==='verification-gate'?['rhythm_search_memory']:id==='secretary'?['rhythm_search_memory','rhythm_get_coordinator_status','rhythm_propose_bounded_coding_workflow','rhythm_start_bounded_coding_workflow']:['rhythm_search_memory','rhythm_delegate_async']}),JSON.stringify(delegates),JSON.stringify({read:'allow',glob:'allow',grep:'allow',bash:'deny',edit:'deny',write:'deny',external_directory:'deny'}));}db.prepare(\"INSERT INTO agent_memory(id,kind,content,source,source_id,status,owner_user_id) VALUES(?,'fact',?,'obsidian-memory','memory/fact/g2-synthetic.md','stable',NULL)\").run(process.argv[5],process.argv[6]);db.prepare('UPDATE agent_scheduled_tasks SET enabled=0').run();db.close();")
    credential_script = OUT / 'prepare-human.cjs'
    credential_script.write_text("const fs=require('node:fs');const c=require(process.argv[2]+'/apps/api_server/dist/__tests__/helpers/human_approval_test_credentials.js').installHumanApprovalTestCredentials();fs.writeFileSync(process.argv[3],JSON.stringify({capability:c.capability,publicKey:c.publicKey,privateKey:c.privateKey.export({type:'pkcs8',format:'pem'})}),{mode:0o600});")
    credential_file = FIX / 'synthetic-human.json'
    subprocess.run([NODE,str(credential_script),str(ROOT),str(credential_file)],cwd=ROOT,env=clean_env,check=True,capture_output=True)
    credentials = json.loads(credential_file.read_text())
    credential_file.chmod(0o400)
    dbpath = FIX / 'rhythm.db'
    subprocess.run([NODE, str(migrate), str(ROOT), str(dbpath), TOKEN, memory_id, body], cwd=ROOT, env=clean_env, check=True, stdout=(OUT / 'fixture.log').open('w'), stderr=subprocess.STDOUT, timeout=30)
    model_config = {'name': 'Test', 'id': 'test', 'env': [], 'npm': '@ai-sdk/openai-compatible', 'models': {'test-model': {'id': 'test-model', 'name': 'Test Model', 'attachment': False, 'reasoning': False, 'temperature': False, 'tool_call': True, 'release_date': '2025-01-01', 'limit': {'context': 100000, 'output': 10000}, 'cost': {'input': 0, 'output': 0}, 'options': {}}}, 'options': {'apiKey': 'synthetic-key', 'baseURL': provider_url}}
    config = {'provider': {'test': model_config}, 'model': 'test/test-model', 'small_model': 'test/test-model',
              'mcp': {'rhythm': {'type': 'local', 'timeout': 600000, 'command': [NODE, str(ROOT / 'apps/mcp_server/dist/index.js')], 'environment': {'RHYTHM_API_URL': 'http://127.0.0.1:4198', 'RHYTHM_AGENT_URL': 'http://127.0.0.1:4284', 'RHYTHM_API_TOKEN': TOKEN}}},
              'agent': {id: {'description': marker, 'mode': 'all', 'model': 'test/test-model', 'prompt': marker, 'permission': {'read': 'allow', 'glob': 'allow', 'grep': 'allow', 'bash': 'deny', 'edit': 'deny', 'write': 'deny', 'external_directory': 'deny'}} for id, marker in [('secretary', 'G2_SYNTHETIC_SECRETARY'), ('workflow-orchestrator', 'G2_SYNTHETIC_MANAGER'), ('verification-gate', 'G2_SYNTHETIC_REVIEWER')]}}
    configdir = FIX / 'opencode-config'; configdir.mkdir(mode=0o700)
    configpath = configdir / 'opencode.json'; configpath.write_text(json.dumps(config, indent=2))
    authpath = configdir / 'auth.json'; authpath.write_text(json.dumps({'test': {'type': 'api', 'key': 'synthetic-key'}}))
    for p in [dbpath, configpath, authpath]: p.chmod(0o400)
    configdir.chmod(0o500)
    record('invented_readonly_fixture', databaseSha256=sha(dbpath), configSha256=sha(configpath), authSha256=sha(authpath), sourceVersion=version)
    # Only the stock launcher may execute this adapter. Opt-ins are scoped to its exact disposable runtime.
    adapter = OUT / 'sandbox-node.py'
    adapter.write_text('#!/usr/bin/python3 -B\nimport os,sys,pathlib,json,hashlib\n' +
        f'node={NODE!r};server={str(ROOT / "apps/api_server/dist/server.js")!r};sb=pathlib.Path({str(SB)!r});out=pathlib.Path({str(OUT)!r})\n' +
        "if sys.argv[1:2]==[server]:\n" +
        " if sys.argv[1:] != [server,'--parent-pid=1','--rhythm-sandbox='+str(sb)] or os.environ.get('DB_PATH')!=str(sb/'rhythm.db') or os.environ.get('RHYTHM_OPENCODE_ENGINE_PORT')!='4197' or os.environ.get('RHYTHM_MOBILE_GATEWAY_PORT')!='4199': raise SystemExit('Sandbox adapter isolation check failed')\n" +
        " note=json.loads((out/'scenario.json').read_text())['note'];p=sb/'vault/memory/fact/g2-synthetic.md'\n" +
        " if p.exists() or p.is_symlink():\n" +
        "  if p.is_symlink() or not p.is_file() or p.read_bytes()!=note.encode() or p.stat().st_mode & 0o222: raise SystemExit('Existing invented note drifted; refusing rewrite')\n" +
        " else: p.parent.mkdir(parents=True,exist_ok=True);p.write_text(note);p.chmod(0o400)\n" +
        " c=json.loads((out/'fixtures/synthetic-human.json').read_text());os.environ['HUMAN_APPROVAL_CAPABILITY_SHA256']=hashlib.sha256(c['capability'].encode()).hexdigest();os.environ['HUMAN_APPROVAL_PUBLIC_KEY']=c['publicKey'];os.environ['ENGRAPH_MEMORY_URL']='http://127.0.0.1:4284'\n" +
        " os.environ['RHYTHM_AGENT_URL']='http://127.0.0.1:4284';os.environ['RHYTHM_WORKSTREAMS_ENABLED']='true';os.environ['RHYTHM_MANAGED_CONTEXT_EXPORTS']='1'\n" +
        "os.execv(node,[node,*sys.argv[1:]])\n")
    adapter.chmod(0o700)
    sandbox_env = {**clean_env, 'RHYTHM_APPROVED_FIXTURE_ROOT': str(FIX), 'RHYTHM_LIVE_DB_PATH': str(dbpath),
        'RHYTHM_SANDBOX_OPENCODE_CONFIG': str(configdir), 'RHYTHM_SANDBOX_DIR': str(SB), 'RHYTHM_SANDBOX_API_PORT': '4198',
        'RHYTHM_SANDBOX_ENGINE_PORT': '4197', 'RHYTHM_SANDBOX_GATEWAY_PORT': '4199', 'RHYTHM_SANDBOX_NODE_BIN': str(adapter),
        'RHYTHM_SANDBOX_SKIP_ENGINE_BUILD': '1', 'DB_CLIENT': 'sqlite', 'RHYTHM_OPTIMIZER_MODE': 'shadow', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1', 'OPENCODE_PURE': '1',
        'RHYTHM_NUMBAT_MONITORING_DISABLED': '1', 'npm_config_offline': 'true'}
    if args.diagnose_restart_mcp:
        curl_dir = OUT/'diagnostic-bin'; curl_dir.mkdir()
        curl_wrapper = curl_dir/'curl'
        curl_wrapper.write_text('#!/usr/bin/python3\nimport os,sys,subprocess,pathlib\nif any(a.endswith("/opencode/mcp/rhythm/ensure") for a in sys.argv[1:]):\n r=subprocess.run(["/usr/bin/curl",*sys.argv[1:]],stdout=subprocess.PIPE);pathlib.Path('+repr(str(OUT/'stock-ensure-responses.jsonl'))+').open("ab").write(r.stdout+b"\\n");sys.stdout.buffer.write(r.stdout);sys.exit(r.returncode)\nelse: os.execv("/usr/bin/curl",["/usr/bin/curl",*sys.argv[1:]])\n')
        curl_wrapper.chmod(0o700)
        sandbox_env['PATH'] = str(curl_dir)+os.pathsep+sandbox_env['PATH']
    log = (OUT / 'sandbox.log').open('w'); logs.append(log)
    launch = subprocess.run([str(ROOT / 'tools/dev/sandbox.sh'), 'up'], cwd=ROOT, env=sandbox_env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
    record('stock_sandbox_up', exitCode=launch.returncode)
    if launch.returncode: raise RuntimeError('Stock sandbox up failed; see sandbox.log')
    receipt['engineBinarySha256'] = sha(ROOT / 'apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode')
    record('api_health', response=request('/health'))
    record('engine_health', response=request('/opencode/health'))
    actual_engine_health = request('/global/health', port=4197)
    record('actual_engine_global_health', response=actual_engine_health)
    if args.qualify_source_sha:
        receipt.setdefault('operationalChecks',{})['engine_source_fingerprint_exact'] = actual_engine_health['status']==200 and actual_engine_health['body'].get('version')=='0.0.0-rhythm-'+args.qualify_source_sha
        if not receipt['operationalChecks']['engine_source_fingerprint_exact']: raise RuntimeError('Running engine does not match frozen source version')
    record('gateway_health', response=request('/mobile-gateway/health', port=4199))
    inventory_script = OUT / 'mcp-inventory.cjs'
    inventory_script.write_text("const {createRequire}=require('node:module');const r=createRequire(process.argv[2]+'/apps/mcp_server/package.json');(async()=>{const {Client}=await import(r.resolve('@modelcontextprotocol/sdk/client/index.js'));const {StdioClientTransport}=await import(r.resolve('@modelcontextprotocol/sdk/client/stdio.js'));const client=new Client({name:'chat-bounded-live-inventory',version:'1'},{capabilities:{}});const transport=new StdioClientTransport({command:process.execPath,args:[process.argv[2]+'/apps/mcp_server/dist/index.js'],env:{PATH:process.env.PATH,HOME:process.env.HOME,RHYTHM_API_URL:'http://127.0.0.1:4198',RHYTHM_AGENT_URL:'http://127.0.0.1:4284',RHYTHM_API_TOKEN:'g2-synthetic-token-not-a-secret'},stderr:'pipe'});const timeout=setTimeout(()=>{client.close().finally(()=>process.exit(1))},20000);try{await client.connect(transport);const listed=await client.listTools();process.stdout.write(JSON.stringify({count:listed.tools.length,names:listed.tools.map(t=>t.name)}))}finally{clearTimeout(timeout);await client.close()}})().catch(e=>{process.stderr.write(String(e));process.exit(1)})")
    inventory_child = subprocess.Popen([NODE,str(inventory_script),str(ROOT)],cwd=ROOT,env=clean_env,text=True,
      stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    inventory_timed_out = False
    try:
        inventory_output, inventory_error = inventory_child.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        inventory_timed_out = True
        os.killpg(inventory_child.pid, signal.SIGTERM)
        try: inventory_output, inventory_error = inventory_child.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(inventory_child.pid, signal.SIGKILL)
            inventory_output, inventory_error = inventory_child.communicate(timeout=2)
    # The initialized MCP child shares this freshly owned process group.
    inventory_group_absent = False
    for attempt in range(20):
        try: os.killpg(inventory_child.pid, 0)
        except ProcessLookupError: inventory_group_absent = True; break
        time.sleep(.1)
    if not inventory_group_absent:
        os.killpg(inventory_child.pid, signal.SIGKILL)
        for attempt in range(20):
            try: os.killpg(inventory_child.pid, 0)
            except ProcessLookupError: inventory_group_absent = True; break
            time.sleep(.1)
    record('actual_mcp_inventory_cleanup', exitCode=inventory_child.returncode, timedOut=inventory_timed_out,
      ownedProcessGroupAbsent=inventory_group_absent)
    if inventory_timed_out or inventory_child.returncode or not inventory_group_absent:
        raise RuntimeError('Actual MCP inventory child failed or cleanup incomplete: '+inventory_error[:500])
    inventory = json.loads(inventory_output)
    record('actual_mcp_inventory', **inventory)
    actual = sql("SELECT id FROM agent_memory WHERE source='obsidian-memory' AND source_id='memory/fact/g2-synthetic.md' AND owner_user_id IS NULL")
    if len(actual) != 1: raise RuntimeError('Expected one actual startup-indexed synthetic note')
    scenario['sourceId'] = 'memory:' + actual[0]['id']
    (OUT / 'model-scenario.json').write_text(json.dumps(scenario, indent=2))
    wait_for(lambda: (OUT / 'model-scenario-ready.json').exists(), 20, 'Actual provider source readiness timeout')
    record('actual_selected_source', sourceId=scenario['sourceId'], version=version)
    setup = request('/coordinator-conversations/setup', {'commandKey': 'g2-live-setup', 'profileId': 'secretary'})
    record('setup', response=setup)
    sid, pid = setup['body']['sessionId'], setup['body']['projectId']; scope = {'sessionId': sid, 'projectId': pid}
    control = current(sid)
    goal = request('/coordinator-conversations/goals', {**scope, 'expectedControlRevision': control['controlRevision'], 'commandKey': 'g2-live-goal', 'objective': 'Validate the invented source and produce an independently reviewed cited brief.'})
    record('goal', response=goal)
    control = current(sid); gid = control['goals'][0]['id']
    foreground = request('/coordinator-conversations/message', {**scope,'expectedControlRevision':control['controlRevision'],
        'commandKey':'chat-finite-propose','message':'CHAT_BOUNDED_START_REQUEST Run the captured goal against the current g2 synthetic note; estimate enough scope and present the exact same-chat human approval card.'})
    record('foreground',response=foreground)
    pending = wait_for(lambda: sql("SELECT id,decision_nonce,payload_digest,bound_payload_json,status FROM agent_approvals WHERE session_id=? AND security_action='coordinator.workflow.start' AND status='pending'",(sid,)), 60, 'No pending proposal card from real Secretary MCP')
    record('proposal_pending', approvals=pending, conversation=current(sid),
      workstreams=sql('SELECT id FROM agent_workstreams WHERE project_id=?',(pid,)),
      delegations=sql('SELECT id FROM agent_async_delegations WHERE parent_session_id=?',(sid,)),
      jobs=sql("SELECT id,state FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'"))
    approval = pending[0]
    # Sign with the existing test credential helper; no native/live signing key is copied.
    signer_script = OUT/'sign-human.cjs'
    signer_script.write_text("const fs=require('node:fs'),crypto=require('node:crypto');const c=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));c.privateKey=crypto.createPrivateKey(c.privateKey);const a=JSON.parse(process.argv[4]);process.stdout.write(require(process.argv[2]+'/apps/api_server/dist/__tests__/helpers/human_approval_test_credentials.js').signHumanApprovalDecision(c,a,'approved'));")
    signature = subprocess.check_output([NODE,str(signer_script),str(ROOT),str(credential_file),json.dumps({'id':approval['id'],'decisionNonce':approval['decision_nonce'],'payloadDigest':approval['payload_digest']})],cwd=ROOT,env=clean_env,text=True)
    decision = request('/agent-approvals/'+approval['id'], {'status':'approved','signature':signature}, method='PATCH',
        extra_headers={'X-Rhythm-Human-Approval':credentials['capability']})
    record('signed_human_decision', response=decision, rootState=sql('SELECT status FROM agent_sessions WHERE id=?',(sid,)),
        durable=sql('SELECT status,continuation_state,consumed_at FROM agent_approvals WHERE id=?',(approval['id'],)))
    if args.restart_approved_wake:
        if args.diagnose_restart_mcp: record('pre_restart_mcp_diagnostic',globalMcp=request('/mcp',port=4197),apiMcp=request('/opencode/mcp'),config=mcp_config_metadata())
        before_restart = {'apiPid': (SB/'api_server.pid').read_text().strip(), 'enginePid':(SB/'opencode_engine.pid').read_text().strip(),
          'conversation':current(sid), 'approval':sql('SELECT status,continuation_state,consumed_at,expires_at,payload_digest,bound_payload_json FROM agent_approvals WHERE id=?',(approval['id'],))}
        with (OUT/'restart.log').open('w') as restart_log:
            restarted = subprocess.run([str(ROOT/'tools/dev/sandbox.sh'),'restart'],cwd=ROOT,env=sandbox_env,stdout=restart_log,stderr=subprocess.STDOUT,timeout=120)
        if restarted.returncode:
            record('stock_restart_approved_wake',exitCode=restarted.returncode,before=before_restart,after=None)
            raise RuntimeError('Stock restart failed; see restart.log')
        record('stock_restart_approved_wake', exitCode=restarted.returncode, before=before_restart,
          after={'apiPid':(SB/'api_server.pid').read_text().strip(),'enginePid':(SB/'opencode_engine.pid').read_text().strip(),
            'conversation':current(sid),'approval':sql('SELECT status,continuation_state,consumed_at,expires_at,payload_digest,bound_payload_json FROM agent_approvals WHERE id=?',(approval['id'],))})
    (OUT/'model-control.json').write_text(json.dumps({'releaseProposal':True}))
    jobs = lambda: sql("SELECT id,state,native_child_session_id,native_metadata_json,native_application_json,native_usage_json,native_result_json FROM agent_bridge_jobs WHERE native_execution_kind='coordinator' ORDER BY rowid")
    if args.diagnose_restart_mcp:
        def first_start_response():
            path=OUT/'guard-exchanges.jsonl'
            if not path.exists(): return None
            return next((x for x in (json.loads(line) for line in path.read_text().splitlines()) if x['path']=='/coordinator-agent/start-workflow'),None)
        first=wait_for(first_start_response,30,'No diagnostic native start response')
        record('post_first_start_mcp_diagnostic',firstStart=first,globalMcp=request('/mcp',port=4197),apiMcp=request('/opencode/mcp'),config=mcp_config_metadata(),
          stockEnsureResponses=[json.loads(line) for line in (OUT/'stock-ensure-responses.jsonl').read_text().splitlines()],
          workstreams=sql('SELECT id,state,state_reason FROM agent_workstreams WHERE project_id=?',(pid,)),jobs=jobs(),conversation=current(sid),
          approvals=sql('SELECT status,consumed_at,continuation_state FROM agent_approvals WHERE id=?',(approval['id'],)))
        raise RuntimeError('Bounded restart MCP diagnostic captured; no readiness mutation attempted')
    wait_for(lambda: len(jobs())>0, 70, 'No first finite job from exact approved native wake')
    record('initial_jobs',jobs=jobs(),conversation=current(sid),approvals=sql('SELECT status,consumed_at,continuation_state FROM agent_approvals WHERE id=?',(approval['id'],)))
    (OUT / 'model-control.json').write_text(json.dumps({'releaseFirst': True}))
    wait_for(lambda: len(jobs()) >= 2, 110, 'No second ordinal after real manager terminal reconciliation')
    record('second_ordinal', jobs=jobs(), conversation=current(sid))
    def completed():
        rows = sql('SELECT state,checkpoint_json FROM agent_workstreams WHERE project_id=? ORDER BY rowid', (pid,))
        return rows if rows and rows[0]['state'] == 'completed' else None
    state = wait_for(completed, 160, 'No checked final stop after actual reviewer')
    record('checked_final_stop', workstreams=state, jobs=jobs(), conversation=current(sid), delegations=sql('SELECT ad.id,ad.parent_session_id,ad.child_session_id,ad.target_agent_config_id,ad.status,ad.completed_at,ad.notified_at,ad.error_text,s.sdk_session_id FROM agent_async_delegations ad LEFT JOIN agent_sessions s ON s.id=ad.child_session_id ORDER BY ad.rowid'))
    completed_delegations = receipt['observations'][-1]['delegations']
    actual_reviewers = [item for item in completed_delegations if item['target_agent_config_id'] == 'verification-gate']
    record('terminal_reviewer_native_messages', reviewers=[{'sdkSessionId': item['sdk_session_id'], 'response': request('/session/' + item['sdk_session_id'] + '/message', port=4197)} for item in actual_reviewers])
    control = current(sid)
    continued = request('/coordinator-conversations/continue-plan', {**scope, 'expectedControlRevision': control['controlRevision'], 'goalId': gid, 'authorizationId': current(sid)['continuations'][0]['authorizationId']})
    record('continuation_replay_after_stop', response=continued, jobs=jobs())
    # Give the existing minute reconciliation sweep another opportunity; no UI/status read drives advancement.
    quiescence_start = time.monotonic()
    while time.monotonic() - quiescence_start < 65:
        time.sleep(1)
    record('final_quiescence', observedSeconds=round(time.monotonic() - quiescence_start, 2), jobs=jobs(), conversation=current(sid))
    control = current(sid)
    status_turn = request('/coordinator-conversations/message', {**scope,'expectedControlRevision':control['controlRevision'],
        'commandKey':'chat-finite-checked-status','message':'CHAT_BOUNDED_STATUS_REQUEST Report the current server-checked criteria, actual ordinals and stop for the captured goal.'})
    record('checked_status_foreground',response=status_turn)
    wait_for(lambda: (OUT/'guard-exchanges.jsonl').exists() and '/coordinator-agent/status' in (OUT/'guard-exchanges.jsonl').read_text(),30,'No signed status MCP observation')
    record('final_native_dispatches',dispatches=sql('SELECT origin,reason_code,outcome,sdk_user_message_id FROM agent_turn_dispatches WHERE session_id=? ORDER BY rowid',(sid,)))
    if args.qualify_source_sha:
        observed = {item['name']:item for item in receipt['observations']}
        final_jobs = observed['final_quiescence']['jobs']
        metadata = [json.loads(job['native_metadata_json']) for job in final_jobs]
        applications = [json.loads(job['native_application_json']) for job in final_jobs]
        usages = [json.loads(job['native_usage_json']) for job in final_jobs]
        checkpoint = json.loads(observed['checked_final_stop']['workstreams'][0]['checkpoint_json'])
        reviewers = [item for item in observed['checked_final_stop']['delegations'] if item['target_agent_config_id']=='verification-gate']
        review_receipts = [item for app in applications for item in app.get('workflowReceipts',[]) if item['criterionId']=='reviewed_summary_with_citation']
        native_reviewers = observed['terminal_reviewer_native_messages']['reviewers']
        reviewer_messages = native_reviewers[0]['response']['body'] if len(native_reviewers)==1 else []
        reviewer_users = {message['info']['id'] for message in reviewer_messages if message['info']['role']=='user'}
        terminals = [message['info'] for message in reviewer_messages if message['info']['role']=='assistant' and message['info'].get('finish')=='stop' and message['info'].get('time',{}).get('completed',0)>0 and message['info'].get('error') is None]
        review = review_receipts[0].get('review') if len(review_receipts)==1 else None
        exchanges = [json.loads(line) for line in (OUT/'guard-exchanges.jsonl').read_text().splitlines()]
        discovered = json.loads((OUT/'discovered-reference.json').read_text())
        proposal = json.loads(approval['bound_payload_json'])
        admitted = observed['initial_jobs']['conversation']['continuations'][0]
        ids = lambda rows: [row['id'] for row in rows]
        receipt['qualificationChecks'] = {
          'actual_mcp_tools_111': inventory['count']==111 and all(name in inventory['names'] for name in ['rhythm_propose_bounded_coding_workflow','rhythm_start_bounded_coding_workflow']) and observed['actual_mcp_inventory_cleanup']['ownedProcessGroupAbsent'],
          'actual_discovery_selector': discovered['fromActualMcpResult'] is True and discovered['referenceSourceId']==scenario['sourceId']==proposal['referenceSourceId'] and discovered['referenceVersion']==version==proposal['referenceVersion'],
          'proposal_no_authority_or_job': observed['proposal_pending']['jobs']==[] and observed['proposal_pending']['conversation']['continuations']==[] and observed['proposal_pending']['workstreams']==[] and observed['proposal_pending']['delegations']==[],
          'signed_decision_queued_busy_unconsumed': decision['status']==200 and decision['body']['actor']=='user:1' and observed['signed_human_decision']['rootState'][0]['status']=='working' and observed['signed_human_decision']['durable']==[{'status':'approved','continuation_state':'queued','consumed_at':None}],
          'exact_native_wake_and_start': sum(x['origin']=='approval_continuation' and x['reason_code'].startswith('workflow_approval_resume_') and x['outcome']=='accepted' for x in observed['final_native_dispatches']['dispatches'])==1 and any(x['path']=='/coordinator-agent/start-workflow' and x['actualApiBody'].get('status')=='started' for x in exchanges),
          'native_start_replay_held': [x['actualApiBody']['status'] for x in exchanges if x['path']=='/coordinator-agent/start-workflow']==['started','held'],
          'single_approval_consumed': len(observed['initial_jobs']['approvals'])==1 and bool(observed['initial_jobs']['approvals'][0]['consumed_at']) and observed['initial_jobs']['approvals'][0]['continuation_state']=='delivered',
          'exact_approved_values': admitted['maxTurns']==proposal['estimate']['outerTurns'] and admitted['totalTokenAuthorization']==proposal['estimate']['totalSoftTokens'] and admitted['maxWallTimeSeconds']==proposal['estimate']['workerWallSeconds'] and admitted['expiresAt']==proposal['expiresAt'],
          'guard_transport_exact': bool(exchanges) and all(x['actualApiBodySha256']==x['forwardedBodySha256'] and x['incomingHeadersSha256']==x['forwardedHeadersSha256'] and x['authHeadersForwardedUnchanged'] and not x['admissionSynthesized'] for x in exchanges),
          'exact_ordinals_one_two': len(final_jobs)==2 and [item['workflow']['authorization']['ordinal'] for item in metadata]==[1,2],
          'manager_jobs_and_accounting': all(job['state']=='succeeded' for job in final_jobs) and all(usage for usage in usages) and all(json.loads(job['native_result_json'])['usageStatus']=='actual' for job in final_jobs),
          'both_checked_applications': len(applications)==2 and all(app['status']=='applied' and app['authority']=='server_checked_selected_reference_summary_v1' for app in applications),
          'both_criteria_verified': {c['id']:c['status'] for c in checkpoint['criteria']}=={'selected_reference_current':'verified','reviewed_summary_with_citation':'verified'},
          'actual_terminal_reviewer': len(reviewers)==1 and reviewers[0]['status'] in ['completed','notified'] and bool(reviewers[0]['completed_at']) and reviewers[0]['error_text'] is None and len(terminals)==1 and bool(review) and native_reviewers[0]['sdkSessionId']==reviewers[0]['sdk_session_id']==review['reviewerSdkSessionId'] and terminals[0]['id']==review['reviewerTerminalMessageId'] and terminals[0]['parentID'] in reviewer_users,
          'reviewer_under_second_manager': len(reviewers)==1 and reviewers[0]['parent_session_id']==metadata[1]['workflow']['prepared']['delegation']['managerSessionId'],
          'replayed_continuation_no_job': ids(observed['checked_final_stop']['jobs'])==ids(observed['continuation_replay_after_stop']['jobs'])==ids(final_jobs),
          'quiescence_no_third': observed['final_quiescence']['observedSeconds']>=65 and len(final_jobs)==2,
          'signed_checked_status': any(x['path']=='/coordinator-agent/status' and 'selected_reference_current' in json.dumps(x['actualApiBody']) and 'reviewed_summary_with_citation' in json.dumps(x['actualApiBody']) for x in exchanges),
        }
        if args.restart_approved_wake:
            restart = observed['stock_restart_approved_wake']; before,after=restart['before'],restart['after']
            receipt['qualificationChecks']['restart_preserves_exact_proposal'] = restart['exitCode']==0 and before['apiPid']!=after['apiPid'] and before['enginePid']!=after['enginePid'] and before['approval'][0]['expires_at']==after['approval'][0]['expires_at'] and before['approval'][0]['payload_digest']==after['approval'][0]['payload_digest'] and before['approval'][0]['bound_payload_json']==after['approval'][0]['bound_payload_json']
        if not all(receipt['qualificationChecks'].values()): raise RuntimeError('Failed exact qualifications: '+','.join(k for k,v in receipt['qualificationChecks'].items() if not v))
    receipt['reconReachedFinalStop'] = True

except Exception as error:
    receipt['error'] = str(error)
    if SB.exists():
        try:
            record('failure_state', sessions=sql('SELECT id,parent_session_id,sdk_session_id,profile_id,permission_mode,status,coordinator_conversation_json FROM agent_sessions'), jobs=sql("SELECT * FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'"))
        except Exception as read_error: receipt['failureReadError'] = str(read_error)
finally:
    receipt['evidenceErrors'] = []
    receipt['cleanupErrors'] = []
    def cleanup_step(label, action, evidence=False):
        try: return action()
        except Exception as error:
            receipt['evidenceErrors' if evidence else 'cleanupErrors'].append({'step': label, 'error': str(error)})
            return None
    def capture_evidence():
        evidence = OUT / 'runtime-evidence'
        if SB.exists():
            cleanup_step('evidence_directory', lambda: evidence.mkdir(exist_ok=True), evidence=True)
            for name in ['api_server.log', 'engine-build.log', 'opencode-health.log']:
                source = SB / name
                if source.is_file(): cleanup_step(name, lambda source=source: shutil.copyfile(source, evidence / source.name), evidence=True)
            def backup_database(source):
                target = evidence / ('api-' + source.name if source.name == 'rhythm.db' else 'engine-' + source.name)
                with sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True) as db, sqlite3.connect(target) as copied: db.backup(copied)
            for source in [SB / 'rhythm.db', *list((SB / 'home/.local/share/opencode').glob('*.db'))]:
                if source.is_file(): cleanup_step(source.name, lambda source=source: backup_database(source), evidence=True)
            native_home = SB / 'home/.local/share/opencode'
            for dirname in ['log', 'storage/rhythm/dayflow-guard']:
                source = native_home / dirname
                if source.is_dir(): cleanup_step(dirname, lambda source=source, dirname=dirname: shutil.copytree(source, evidence / dirname.replace('/', '-')), evidence=True)
    cleanup_step('evidence_capture', capture_evidence, evidence=True)
    # Every teardown is independent of evidence copies and of the other processes.
    if sandbox_env:
        def stock_down():
            with (OUT / 'teardown.log').open('w') as log:
                down = subprocess.run([str(ROOT / 'tools/dev/sandbox.sh'), 'down'], cwd=ROOT, env=sandbox_env, stdout=log, stderr=subprocess.STDOUT, timeout=60)
            receipt['sandboxDownExitCode'] = down.returncode
            if down.returncode: raise RuntimeError('Stock sandbox down exit ' + str(down.returncode))
        cleanup_step('stock_sandbox_down', stock_down)
    if model and model.poll() is None:
        cleanup_step('provider_stop_control', lambda: (OUT / 'model-control.json').write_text(json.dumps({'releaseFirst': True, 'stop': True})))
        try: model.wait(timeout=15)
        except subprocess.TimeoutExpired: pass
        except Exception as error: receipt['cleanupErrors'].append({'step': 'provider_graceful_wait', 'error': str(error)})
    for label, process in [('provider', model), ('observer', observer)]:
        if process and process.poll() is None:
            cleanup_step(label + '_terminate', process.terminate)
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cleanup_step(label + '_kill', process.kill)
                cleanup_step(label + '_kill_wait', lambda process=process: process.wait(timeout=10))
            except Exception as error: receipt['cleanupErrors'].append({'step': label + '_wait', 'error': str(error)})
    receipt['completedAtUtc'] = now()
    receipt['listenerAbsentAfterTeardown'] = {str(p): not listen(p) for p in [4197, 4198, 4199, 4284]}
    if (OUT / 'model-ready.json').exists():
        from urllib.parse import urlparse
        port = urlparse(json.loads((OUT / 'model-ready.json').read_text())['url']).port
        receipt['listenerAbsentAfterTeardown'][str(port)] = not listen(port)
    receipt['normalRuntimeListenersAfter'] = {str(port): subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fp'], capture_output=True, text=True).stdout.splitlines() for port in protected_ports}
    receipt['normalRuntimeTouched'] = receipt['normalRuntimeListenersBefore'] != receipt['normalRuntimeListenersAfter']
    receipt['productSourceUnchanged'] = all(sha(ROOT / p) == h for p, h in receipt['productSourceSha256'].items())
    if args.qualify_source_sha:
        receipt.setdefault('qualificationChecks',{})['source_clean_exact_before_after'] = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==args.qualify_source_sha and not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True).strip()
    receipt['sandboxAbsentAfterTeardown'] = not SB.exists()
    fixture_baseline = next((item for item in receipt['observations'] if item['name'] == 'invented_readonly_fixture'), None)
    fixture_proof = cleanup_step('readonly_fixture_proof', lambda: bool(fixture_baseline) and sha(FIX / 'rhythm.db') == fixture_baseline['databaseSha256'] and sha(FIX / 'opencode-config/opencode.json') == fixture_baseline['configSha256'] and sha(FIX / 'opencode-config/auth.json') == fixture_baseline['authSha256'] and all((path.stat().st_mode & 0o222) == 0 for path in [FIX / 'rhythm.db', FIX / 'opencode-config/opencode.json', FIX / 'opencode-config/auth.json', FIX / 'opencode-config']), evidence=True)
    receipt['readonlyFixturesUnchanged'] = fixture_proof is True
    for log in logs: cleanup_step('log_close', log.close)
    receipt.setdefault('operationalChecks', {}).update({'source_unchanged': receipt['productSourceUnchanged'], 'all_owned_listeners_absent': all(receipt['listenerAbsentAfterTeardown'].values()), 'evidence_and_cleanup_complete': not receipt['evidenceErrors'] and not receipt['cleanupErrors'], 'stock_teardown_and_fixtures_preserved': receipt.get('sandboxDownExitCode') == 0 and receipt['sandboxAbsentAfterTeardown'] and receipt['readonlyFixturesUnchanged']})
    save()
print(json.dumps({'receipt': str(OUT / 'receipt.json'), 'reconReachedFinalStop': receipt.get('reconReachedFinalStop', False), 'error': receipt.get('error'), 'listenerAbsentAfterTeardown': receipt['listenerAbsentAfterTeardown']}))
raise SystemExit(0 if receipt.get('reconReachedFinalStop') and not receipt['normalRuntimeTouched'] and all(receipt['operationalChecks'].values()) and all(receipt.get('qualificationChecks',{}).values()) else 1)
