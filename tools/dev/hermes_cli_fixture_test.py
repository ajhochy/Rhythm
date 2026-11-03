"""Official-handler synthetic bootstrap + real copied native fixture, no provider.

prepare writes a fresh synthetic registrar reference only. run requires canonical
sandbox up with that reference. The full criterion may fail for missing provider;
it must not invent child/session/event receipts to make the CLI pass.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from test_provision_native_http import NATIVE, ROOT
from test_provision_contract import implementation

FIXTURE = Path('/private/tmp/hermes-event-notify-20261012-fixture')
SB = Path('/private/tmp/hermes-shipping-rollout-20261014-sandbox')
REGISTRAR = FIXTURE / 'hermes-cli-synthetic-registrar.txt'
BASE = 'http://127.0.0.1:4898'
OWNER = 'e02-synthetic-session-not-a-secret'

def http(path, body=None, headers=None):
    request = urllib.request.Request(BASE + path, headers=dict({'Content-Type': 'application/json'}, **(headers or {})),
        data=None if body is None else json.dumps(body).encode())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=10) as response:
            raw = response.read(); return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

def require(path, body=None, headers=None, status=200):
    actual, result = http(path, body, headers)
    if actual != status:
        code = result.get('error', {})
        if isinstance(code, dict): code = code.get('code', 'unknown')
        raise AssertionError(f'{path}: HTTP {actual}, code={code}; expected {status}')
    return result

def counts():
    with sqlite3.connect((SB / 'rhythm.db').as_uri() + '?mode=ro', uri=True) as db:
        return tuple(db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
                     for table in ('agent_bridge_jobs', 'agent_sessions', 'hermes_notify_origins'))

def grant(scopes):
    capability = secrets.token_urlsafe(32)
    require('/agent-bridge/v1/registrar/grants', dict(grantId=str(uuid.uuid4()),
        capabilitySha256=hashlib.sha256(capability.encode()).hexdigest(), sessionToken=OWNER,
        hermesProfile='default', runtimeGeneration=str(uuid.uuid4()), serverOrigin=BASE,
        authGeneration='synthetic-cli-test', scopes=scopes),
        {'X-Rhythm-Bridge-Registrar': implementation().token_reference(REGISTRAR)}, 201)
    return capability

def run():
    assert os.environ.get('RHYTHM_LIVE_E2E') == '1', 'explicit fixture opt-in required'
    assert require('/auth/me', headers={'Authorization': 'Bearer ' + OWNER})['user']['id'] == 1
    before = counts()
    request = dict(idempotencyKey=str(uuid.uuid4()), parent=dict(projectionId=str(uuid.uuid4()), sessionKey='synthetic-unissued'),
                   targetAgentId='synthetic-unissued', prompt='fixture only', context=None)
    require('/agent-bridge/v1/delegations', request, {'Authorization': 'Bearer ' + OWNER}, 401)
    assert counts() == before
    wrong = grant(['catalog.read'])
    require('/agent-bridge/v1/delegations', request, {'X-Rhythm-Bridge-Capability': wrong}, 403)
    assert counts() == before
    capability = grant(['catalog.read', 'projection.issue', 'runtime.report', 'delegation.dispatch'])
    headers = {'X-Rhythm-Bridge-Capability': capability}
    require('/agent-bridge/v1/runtime/report', dict(hermesVersion='synthetic-fixture', pluginVersion='2',
        providers=[dict(id='openai-api', ready=True)], reasoningEfforts=[], terminalBackend='local'), headers, 204)
    suffix = secrets.token_hex(4)
    def profile(name, manager=False, targets=()):
        return require('/agent-configs', dict(id='cli-' + name + '-' + suffix, label='Synthetic CLI ' + name,
            enabled=True, isAgent=True, isManager=manager, sessionSelectable=True,
            modelProvider='openai', modelId='synthetic-no-provider', ocAgent='build',
            allowedMcpsJson='{}', allowedSkillsJson='[]', allowedDelegatesJson=json.dumps(list(targets)),
            corePermissionsJson=json.dumps({'*':'deny', 'task':'allow', 'rhythm_delegate_async':'allow', 'external_directory':'deny'})),
            {'Authorization':'Bearer ' + OWNER}, 201)
    target = profile('target')
    nonmanager = profile('nonmanager', False, [target['id']])
    manager = profile('manager', True, [target['id']])
    excluded = profile('excluded', True)
    for actor in (nonmanager, excluded):
        session_key = 'synthetic-denied-' + str(uuid.uuid4())
        projection = require('/agent-bridge/v1/projections', dict(sessionKey=session_key, cwd=None,
            launchKind='interactive', acceptVersions=[2], agentId=actor['id'], expectedRevision=actor['revision']), headers)
        denied = dict(request, parent=dict(projectionId=projection['projectionId'], sessionKey=session_key), targetAgentId=target['id'])
        require('/agent-bridge/v1/delegations', denied, headers, 403)
        assert counts() == before
    print(json.dumps(dict(officialRegistrar='PASS', ownerAuth=1, noGrant='401/0-effects', wrongScope='403/0-effects',
                         nonmanager='403/0-effects', excludedRoster='403/0-effects')), flush=True)
    pins = json.loads((NATIVE / 'source_snapshot_manifest.json').read_text())['hashes']
    patch = json.loads((NATIVE / 'native_patch_manifest.json').read_text())
    expected = dict(pins); expected.update({name: value['after'] for name, value in patch.items()})
    home = Path(tempfile.mkdtemp(prefix='hermes-cli-owned-', dir='/private/tmp'))
    source = home / 'source'; source.mkdir(mode=0o700)
    for name, digest in expected.items():
        original = NATIVE / 'source_snapshot' / name
        assert not original.is_symlink() and hashlib.sha256(original.read_bytes()).hexdigest() == digest
        target_path = source / name; target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target_path)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
    native_base = 'http://127.0.0.1:' + str(port)
    env = dict(PATH=os.defpath, HOME=str(home), HERMES_HOME=str(home / 'hermes'),
        HERMES_WEBUI_AGENT_DIR=str(home / 'no-agent'), HERMES_CONFIG_PATH=str(home / 'no-config.yaml'),
        HERMES_WEBUI_STATE_DIR=str(home / 'state'), HERMES_WEBUI_SETTINGS_FILE=str(home / 'settings.json'),
        HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_PORT=str(port), PYTHONDONTWRITEBYTECODE='1')
    bootstrap = '''
import json, os, runpy, sys
def fence(event, args):
    if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
        raise OSError('native fixture denies outbound/provider/process effects')
sys.addaudithook(fence)
from api.onboarding import complete_onboarding
complete_onboarding()
runpy.run_path('server.py', run_name='__main__')
'''
    if os.environ.get('HERMES_CURRENT_ACK') == '1':
        # External provider boundary only; actual routes/worker/save stay intact.
        sys.path.insert(0, str(NATIVE.parent))
        from hermes_webui_receiver.test_native_wakeup import PROVIDER
        bootstrap = bootstrap.replace("runpy.run_path('server.py', run_name='__main__')",
            "FAULT = ''\n" + PROVIDER + "\nrunpy.run_path('server.py', run_name='__main__')")
    with (home / 'native.log').open('wb') as output:
        process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap], cwd=source, env=env,
                                   stdout=output, stderr=output, umask=0o077)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(100):
                if process.poll() is not None: raise AssertionError('owned copied native startup failed')
                try: opener.open(native_base + '/health', timeout=.2).close(); break
                except OSError: time.sleep(.1)
            else: raise AssertionError('owned copied native readiness timeout')
            p = implementation()
            token = home / 'owner.txt'; p.atomic_json(home / 'fixture-marker.json', {'fixtureOnly': True})
            for path, value in ((token, OWNER), (home / 'capability.txt', capability)):
                with path.open('x') as file: os.fchmod(file.fileno(), 0o600); file.write(value)
            state = home / 'state'
            p.create_native_fixture(state, native_base)
            manifest = dict(version=2, fixtureOnly=True, fixtureRoot=str(home), stateDir=str(state), tokenFile=str(token),
                bridgeCapabilityFile=str(home / 'capability.txt'), nativeSource=str(source), nativeEndpoint=native_base,
                apiEndpoint=BASE, owner='1', profile='default', managerAgentId=manager['id'], targetAgentId=target['id'],
                prompt='Synthetic no-provider dispatch; no tools or external effects.', context=None,
                nativeHashes={name: expected[name] for name in ('api/rhythm_inbox.py', 'api/rhythm_schema.py')})
            manifest_path = home / 'approved-fixture.json'; p.atomic_json(manifest_path, manifest)
            print(json.dumps(dict(approvedManifest=str(manifest_path), nativePins=len(expected),
                                 nativeManifestSha256=hashlib.sha256((NATIVE / 'native_patch_manifest.json').read_bytes()).hexdigest())), flush=True)
            result = subprocess.run([sys.executable, '-B', str(ROOT / 'test_provision_execute_cli.py')],
                env=dict(os.environ, RHYTHM_LIVE_E2E='1', HERMES_CLI_APPROVED_MANIFEST=str(manifest_path)), timeout=100)
            if result.returncode == 0:
                # Independent actual native authority check in the copied synthetic
                # HOME, never an import of live native config by the operator CLI.
                verify = '''
import json, sys
def fence(event, args):
    if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
        raise OSError('native authority check is offline')
sys.addaudithook(fence)
from api.rhythm_notify import Native
native = Native()
records = native.records()
assert len(records) == 1
run = next(iter(records))
binding = native.current_binding(run)
assert binding == records[run]['binding']
print(json.dumps(dict(nativeCurrentBinding='PASS', **binding)))
'''
                subprocess.run([sys.executable, '-B', '-c', verify], cwd=source, env=env, check=True, timeout=15)
                if os.environ.get('HERMES_CURRENT_ACK') == '1':
                    from hermes_current_ack import verify_current_ack
                    verify_current_ack(manifest_path)
            return result.returncode
        finally:
            if process.poll() is None: process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)

if __name__ == '__main__':
    if sys.argv[1:] == ['prepare']:
        p = implementation()
        if REGISTRAR.exists(): p.token_reference(REGISTRAR)
        else:
            with REGISTRAR.open('x') as file: os.fchmod(file.fileno(), 0o600); file.write(secrets.token_urlsafe(32))
        print('protected synthetic registrar reference prepared; no secret output')
    else: sys.exit(run())
