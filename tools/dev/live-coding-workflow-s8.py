#!/usr/bin/env python3
"""Bounded invented-data G2 recon. All API/engine startup is owned by sandbox.sh."""
import argparse, hashlib, json, os, pathlib, shutil, socket, sqlite3, subprocess, time, urllib.error, urllib.request, uuid
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
if os.environ.get('RHYTHM_LIVE_E2E') != '1':
    raise SystemExit('RHYTHM_LIVE_E2E=1 required; no process started')
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
           'sandbox': str(SB), 'ports': [4197, 4198, 4199], 'externalModelSynthetic': True, 'apiEngineMocked': False,
           'normalRuntimeTouched': False, 'privateDataCopied': False, 'observations': []}
protected_ports = [4001, 4002, 4096, 49333]
receipt['normalRuntimeListenersBefore'] = {str(port): subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fp'], capture_output=True, text=True).stdout.splitlines() for port in protected_ports}
receipt['harnessSha256'] = {str(p.relative_to(ROOT)): sha(p) for p in [ROOT / 'tools/dev/live-coding-workflow-s8.py', ROOT / 'tools/dev/live-coding-workflow-s8-provider.ts', ROOT / 'tools/dev/live-coding-workflow-s8-observer.py']}
source_paths = subprocess.check_output(['git', 'ls-files', '-z', 'apps/api_server/src', 'apps/mcp_server/src', 'apps/opencode_fork/packages/opencode/src', 'tools/dev/sandbox.sh'], cwd=ROOT).split(b'\0')
receipt['productSourceSha256'] = {os.fsdecode(p): sha(ROOT / os.fsdecode(p)) for p in source_paths if p and (ROOT / os.fsdecode(p)).is_file() and '/__tests__/' not in os.fsdecode(p) and not os.fsdecode(p).endswith('.test.ts')}
receipt['unreadableTrackedPaths'] = [os.fsdecode(p) for p in source_paths if p and not (ROOT / os.fsdecode(p)).is_file()]
def save(): (OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2))
def record(name, **value):
    receipt['observations'].append({'name': name, 'atUtc': now(), **value}); save()
def listen(port):
    with socket.socket() as s: return s.connect_ex(('127.0.0.1', port)) == 0
def request(path, payload=None, port=4198):
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=None if payload is None else json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN}, method='GET' if payload is None else 'POST')
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
    observer = subprocess.Popen(['/usr/bin/python3', '-B', str(ROOT / 'tools/dev/live-coding-workflow-s8-observer.py')], cwd=ROOT, env=clean_env, stdout=observer_log, stderr=subprocess.STDOUT)
    wait_for(lambda: (OUT / 'observer-ready.json').exists(), 10, 'Transparent observer readiness timeout')
    log = (OUT / 'model.log').open('w'); logs.append(log)
    model = subprocess.Popen([BUN, str(ROOT / 'tools/dev/live-coding-workflow-s8-provider.ts')], cwd=ROOT, env=clean_env, stdout=log, stderr=subprocess.STDOUT)
    wait_for(lambda: (OUT / 'model-ready.json').exists() or model.poll() is not None, 20, 'Provider readiness timeout')
    if model.poll() is not None: raise RuntimeError('Provider failed; see model.log')
    provider_url = json.loads((OUT / 'model-ready.json').read_text())['url']
    record('synthetic_provider_ready', providerUrl=provider_url, pid=model.pid)
    # Fresh migrations, not a copy of any private database.
    migrate = OUT / 'prepare-fixture.cjs'
    migrate.write_text("const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(process.argv[2]+'/apps/api_server/package.json');const Database=r('better-sqlite3');const db=new Database(process.argv[3]);require(process.argv[2]+'/apps/api_server/dist/database/migrations.js').runMigrations(db);db.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').run('Synthetic G2 Owner','g2@example.invalid');db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,1)').run(process.argv[4]);db.prepare('UPDATE agent_configs SET enabled=0').run();for(const [id,marker,manager,delegates] of [['secretary','G2_SYNTHETIC_SECRETARY',1,['workflow-orchestrator']],['workflow-orchestrator','G2_SYNTHETIC_MANAGER',1,['verification-gate']],['verification-gate','G2_SYNTHETIC_REVIEWER',0,[]]]){db.prepare(\"INSERT INTO agent_configs(id,label,icon,command,is_agent,enabled,is_manager,system_prompt,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_delegates_json,core_permissions_json) VALUES(?,?,?,'opencode',1,1,?,?, 'test','test-model',?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,is_agent=1,is_manager=excluded.is_manager,system_prompt=excluded.system_prompt,model_provider='test',model_id='test-model',oc_agent=excluded.oc_agent,allowed_mcps_json=excluded.allowed_mcps_json,allowed_delegates_json=excluded.allowed_delegates_json,core_permissions_json=excluded.core_permissions_json,locked=0\").run(id,id,'check',manager,marker,id,JSON.stringify({rhythm:id==='verification-gate'?['rhythm_search_memory']:['rhythm_search_memory','rhythm_delegate_async']}),JSON.stringify(delegates),JSON.stringify({read:'allow',glob:'allow',grep:'allow',bash:'deny',edit:'deny',write:'deny',external_directory:'deny'}));}db.prepare(\"INSERT INTO agent_memory(id,kind,content,source,source_id,status,owner_user_id) VALUES(?,'fact',?,'obsidian-memory','memory/fact/g2-synthetic.md','stable',NULL)\").run(process.argv[5],process.argv[6]);db.prepare('UPDATE agent_scheduled_tasks SET enabled=0').run();db.close();")
    dbpath = FIX / 'rhythm.db'
    subprocess.run([NODE, str(migrate), str(ROOT), str(dbpath), TOKEN, memory_id, body], cwd=ROOT, env=clean_env, check=True, stdout=(OUT / 'fixture.log').open('w'), stderr=subprocess.STDOUT, timeout=30)
    model_config = {'name': 'Test', 'id': 'test', 'env': [], 'npm': '@ai-sdk/openai-compatible', 'models': {'test-model': {'id': 'test-model', 'name': 'Test Model', 'attachment': False, 'reasoning': False, 'temperature': False, 'tool_call': True, 'release_date': '2025-01-01', 'limit': {'context': 100000, 'output': 10000}, 'cost': {'input': 0, 'output': 0}, 'options': {}}}, 'options': {'apiKey': 'synthetic-key', 'baseURL': provider_url}}
    config = {'provider': {'test': model_config}, 'model': 'test/test-model', 'small_model': 'test/test-model',
              'mcp': {'rhythm': {'type': 'local', 'timeout': 600000, 'command': [NODE, str(ROOT / 'apps/mcp_server/dist/index.js')], 'environment': {'RHYTHM_API_URL': 'http://127.0.0.1:4198', 'RHYTHM_AGENT_URL': 'http://127.0.0.1:4284', 'RHYTHM_API_TOKEN': TOKEN}}},
              'agent': {id: {'description': marker, 'mode': 'all', 'model': 'test/test-model', 'prompt': marker, 'permission': {'read': 'allow', 'glob': 'allow', 'grep': 'allow', 'bash': 'deny', 'edit': 'deny', 'write': 'deny', 'external_directory': 'deny'}} for id, marker in [('secretary', 'G2_SYNTHETIC_SECRETARY'), ('workflow-orchestrator', 'G2_SYNTHETIC_MANAGER'), ('verification-gate', 'G2_SYNTHETIC_REVIEWER')]}}
    configpath = FIX / 'opencode.json'; configpath.write_text(json.dumps(config, indent=2))
    for p in [dbpath, configpath]: p.chmod(0o400)
    record('invented_readonly_fixture', databaseSha256=sha(dbpath), configSha256=sha(configpath), sourceVersion=version)
    # Only the stock launcher may execute this adapter. Opt-ins are scoped to its exact disposable runtime.
    adapter = OUT / 'sandbox-node.py'
    adapter.write_text('#!/usr/bin/python3 -B\nimport os,sys,pathlib,json\n' +
        f'node={NODE!r};server={str(ROOT / "apps/api_server/dist/server.js")!r};sb=pathlib.Path({str(SB)!r});out=pathlib.Path({str(OUT)!r})\n' +
        "if sys.argv[1:2]==[server]:\n" +
        " if sys.argv[1:] != [server,'--parent-pid=1','--rhythm-sandbox='+str(sb)] or os.environ.get('DB_PATH')!=str(sb/'rhythm.db') or os.environ.get('RHYTHM_OPENCODE_ENGINE_PORT')!='4197' or os.environ.get('RHYTHM_MOBILE_GATEWAY_PORT')!='4199': raise SystemExit('Sandbox adapter isolation check failed')\n" +
        " note=json.loads((out/'scenario.json').read_text())['note'];p=sb/'vault/memory/fact/g2-synthetic.md';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(note);p.chmod(0o400)\n" +
        " os.environ['RHYTHM_AGENT_URL']='http://127.0.0.1:4284';os.environ['RHYTHM_WORKSTREAMS_ENABLED']='true';os.environ['RHYTHM_MANAGED_CONTEXT_EXPORTS']='1'\n" +
        "os.execv(node,[node,*sys.argv[1:]])\n")
    adapter.chmod(0o700)
    sandbox_env = {**clean_env, 'RHYTHM_APPROVED_FIXTURE_ROOT': str(FIX), 'RHYTHM_LIVE_DB_PATH': str(dbpath),
        'RHYTHM_SANDBOX_OPENCODE_CONFIG': str(configpath), 'RHYTHM_SANDBOX_DIR': str(SB), 'RHYTHM_SANDBOX_API_PORT': '4198',
        'RHYTHM_SANDBOX_ENGINE_PORT': '4197', 'RHYTHM_SANDBOX_GATEWAY_PORT': '4199', 'RHYTHM_SANDBOX_NODE_BIN': str(adapter),
        'DB_CLIENT': 'sqlite', 'RHYTHM_OPTIMIZER_MODE': 'shadow', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1', 'OPENCODE_PURE': '1',
        'RHYTHM_NUMBAT_MONITORING_DISABLED': '1', 'npm_config_offline': 'true'}
    log = (OUT / 'sandbox.log').open('w'); logs.append(log)
    launch = subprocess.run([str(ROOT / 'tools/dev/sandbox.sh'), 'up'], cwd=ROOT, env=sandbox_env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
    record('stock_sandbox_up', exitCode=launch.returncode)
    if launch.returncode: raise RuntimeError('Stock sandbox up failed; see sandbox.log')
    receipt['engineBinarySha256'] = sha(ROOT / 'apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode')
    record('api_health', response=request('/health'))
    record('engine_health', response=request('/opencode/health'))
    record('gateway_health', response=request('/mobile-gateway/health', port=4199))
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
    admission = {'commandKey': 'g2-live-admission', 'totalTokenAuthorization': 8192, 'maxTurns': 2, 'maxWallTimeSeconds': 300,
        'expiresInSeconds': 600, 'acknowledgesSoftTotalTokenAuthorization': True, 'purpose': 'workflow', 'acknowledgesCodingWorkflowCoverage': True,
        'workflowCheck': {'kind': 'selected_reference_summary_v1', 'sourceId': scenario['sourceId'], 'expectedVersion': version}}
    plan_body = {**scope, 'expectedControlRevision': control['controlRevision'], 'goalId': gid, 'admission': admission}
    plan = request('/coordinator-conversations/prepare-plan', plan_body); record('admission', response=plan)
    if plan['body'].get('kind') != 'planned':
        raise RuntimeError('Workflow admission held: ' + plan['body'].get('kind', 'unknown'))
    jobs = lambda: sql("SELECT id,state,native_child_session_id,native_metadata_json,native_application_json,native_usage_json,native_result_json FROM agent_bridge_jobs WHERE native_execution_kind='coordinator' ORDER BY rowid")
    record('initial_jobs', jobs=jobs())
    record('admission_replay_while_first_held', response=request('/coordinator-conversations/prepare-plan', plan_body), jobs=jobs())
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
    continued = request('/coordinator-conversations/continue-plan', {**scope, 'expectedControlRevision': control['controlRevision'], 'goalId': gid, 'authorizationId': 'g2-live-admission'})
    record('continuation_replay_after_stop', response=continued, jobs=jobs())
    # Give the existing minute reconciliation sweep another opportunity; no UI/status read drives advancement.
    quiescence_start = time.monotonic()
    while time.monotonic() - quiescence_start < 65:
        time.sleep(1)
    record('final_quiescence', observedSeconds=round(time.monotonic() - quiescence_start, 2), jobs=jobs(), conversation=current(sid))
    # Contract checks are intentionally fail-closed, independently of a completed row.
    observations = {item['name']: item for item in receipt['observations']}
    final_jobs = observations['final_quiescence']['jobs']
    metadata = [json.loads(job['native_metadata_json']) for job in final_jobs]
    applications = [json.loads(job['native_application_json'] or '{}') for job in final_jobs]
    criteria = {item['id']: item['status'] for item in json.loads(state[0]['checkpoint_json'])['criteria']}
    review_receipts = [item for app in applications for item in app.get('workflowReceipts', []) if item['criterionId'] == 'reviewed_summary_with_citation']
    reviewer = [item for item in observations['checked_final_stop']['delegations'] if item['target_agent_config_id'] == 'verification-gate']
    native_reviewers = observations['terminal_reviewer_native_messages']['reviewers']
    reviewer_messages = native_reviewers[0]['response']['body'] if len(native_reviewers) == 1 and native_reviewers[0]['response']['status'] == 200 else []
    reviewer_user_ids = {message['info']['id'] for message in reviewer_messages if message['info']['role'] == 'user'}
    reviewer_terminals = [message['info'] for message in reviewer_messages if message['info']['role'] == 'assistant' and message['info'].get('finish') == 'stop' and isinstance(message['info'].get('time', {}).get('completed'), (int, float)) and message['info']['time']['completed'] > 0 and message['info'].get('error') is None]
    checked_review = review_receipts[0].get('review') if len(review_receipts) == 1 else None
    admitted = observations['admission']['response']['body']['conversation']['continuations'][0]
    ids = lambda rows: [row['id'] for row in rows]
    exchanges = [json.loads(line) for line in (OUT / 'guard-exchanges.jsonl').read_text().splitlines()] if (OUT / 'guard-exchanges.jsonl').exists() else []
    receipt['qualificationChecks'] = {
        'guard_transport_exact': len(exchanges) > 0 and all(item['actualApiBodySha256'] == item['forwardedBodySha256'] and item['incomingHeadersSha256'] == item['forwardedHeadersSha256'] and item['authHeadersForwardedUnchanged'] and not item['admissionSynthesized'] for item in exchanges),
        'actual_runtime_health': observations['api_health']['response']['status'] == 200 and observations['api_health']['response']['body']['status'] == 'ok' and observations['engine_health']['response']['status'] == 200 and observations['engine_health']['response']['body']['status'] == 'ready' and observations['engine_health']['response']['body']['bridgeLive'] is True and observations['gateway_health']['response']['status'] == 200 and observations['gateway_health']['response']['body']['status'] == 'ready',
        'actual_gateway_contract': observations['gateway_health']['response']['body']['contractFingerprint'] == '7d073feb9488653df95157a18f9ca39666b41019fb99fd576c590280b380bc10',
        'admitted_canonical_key': admitted['workflow']['check']['canonicalId'] == 'memory/fact/g2-synthetic.md',
        'exact_ordinals_one_two': len(final_jobs) == 2 and [item['workflow']['authorization']['ordinal'] for item in metadata] == [1, 2],
        'both_manager_jobs_succeeded': all(job['state'] == 'succeeded' for job in final_jobs),
        'both_server_checked_applications': len(applications) == 2 and all(app.get('status') == 'applied' and app.get('authority') == 'server_checked_selected_reference_summary_v1' for app in applications),
        'both_criteria_verified': criteria == {'selected_reference_current': 'verified', 'reviewed_summary_with_citation': 'verified'},
        'actual_terminal_reviewer': len(reviewer) == 1 and reviewer[0]['status'] in ['completed', 'notified'] and isinstance(reviewer[0]['completed_at'], str) and bool(reviewer[0]['completed_at']) and reviewer[0]['error_text'] is None and (reviewer[0]['status'] != 'notified' or isinstance(reviewer[0]['notified_at'], str) and bool(reviewer[0]['notified_at'])) and len(native_reviewers) == 1 and len(reviewer_terminals) == 1 and bool(checked_review) and native_reviewers[0]['sdkSessionId'] == reviewer[0]['sdk_session_id'] == checked_review['reviewerSdkSessionId'] and reviewer_terminals[0]['sessionID'] == checked_review['reviewerSdkSessionId'] and reviewer_terminals[0]['id'] == checked_review['reviewerTerminalMessageId'] and reviewer_terminals[0]['parentID'] in reviewer_user_ids,
        'reviewer_under_second_manager': len(reviewer) == 1 and len(metadata) == 2 and reviewer[0]['parent_session_id'] == metadata[1]['workflow']['prepared']['delegation']['managerSessionId'],
        'replayed_admission_no_new_job': len(observations['initial_jobs']['jobs']) == 1 and ids(observations['initial_jobs']['jobs']) == ids(observations['admission_replay_while_first_held']['jobs']),
        'replayed_continuation_no_new_job': ids(observations['checked_final_stop']['jobs']) == ids(observations['continuation_replay_after_stop']['jobs']) == ids(final_jobs),
        'minute_quiescence_no_third_job': observations['final_quiescence']['observedSeconds'] >= 65 and len(final_jobs) == 2,
    }
    failed = [name for name, passed in receipt['qualificationChecks'].items() if not passed]
    if failed: raise RuntimeError('UNVERIFIED bounded workflow qualifications: ' + ', '.join(failed))
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
    receipt['sandboxAbsentAfterTeardown'] = not SB.exists()
    fixture_baseline = next((item for item in receipt['observations'] if item['name'] == 'invented_readonly_fixture'), None)
    fixture_proof = cleanup_step('readonly_fixture_proof', lambda: bool(fixture_baseline) and sha(FIX / 'rhythm.db') == fixture_baseline['databaseSha256'] and sha(FIX / 'opencode.json') == fixture_baseline['configSha256'] and all((path.stat().st_mode & 0o222) == 0 for path in [FIX / 'rhythm.db', FIX / 'opencode.json']), evidence=True)
    receipt['readonlyFixturesUnchanged'] = fixture_proof is True
    for log in logs: cleanup_step('log_close', log.close)
    receipt.setdefault('qualificationChecks', {}).update({'source_unchanged': receipt['productSourceUnchanged'], 'all_owned_listeners_absent': all(receipt['listenerAbsentAfterTeardown'].values()), 'evidence_and_cleanup_complete': not receipt['evidenceErrors'] and not receipt['cleanupErrors'], 'stock_teardown_and_fixtures_preserved': receipt.get('sandboxDownExitCode') == 0 and receipt['sandboxAbsentAfterTeardown'] and receipt['readonlyFixturesUnchanged']})
    save()
print(json.dumps({'receipt': str(OUT / 'receipt.json'), 'reconReachedFinalStop': receipt.get('reconReachedFinalStop', False), 'error': receipt.get('error'), 'listenerAbsentAfterTeardown': receipt['listenerAbsentAfterTeardown']}))
raise SystemExit(0 if receipt.get('reconReachedFinalStop') and not receipt['normalRuntimeTouched'] and all(receipt['qualificationChecks'].values()) else 1)
