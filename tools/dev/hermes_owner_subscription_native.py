"""Owned4898 ordinary source -> official MCP -> pinned native/browser -> real API ACK.

Only upstream native provider is deterministic. No source event/ACK/engine is mocked.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from test_provision_native_http import NATIVE, ROOT
from test_provision_contract import implementation

assert os.environ.get('RHYTHM_LIVE_E2E') == '1'
SOURCE = sys.argv[1]
BASE = 'http://127.0.0.1:4898'
SB = Path('/private/tmp/hermes-owner-subscription-4898-20261015-sandbox')
FIXTURE = Path('/private/tmp/hermes-owner-subscription-4898-20261015-fixture')
NODE = ROOT / '.hermes-shipping-runtime/node/bin/node'
p = implementation()
pins = json.loads((NATIVE / 'source_snapshot_manifest.json').read_text())['hashes']
patch = json.loads((NATIVE / 'native_patch_manifest.json').read_text())
assert len(pins) == 107 and len(patch) == 7
expected = dict(pins); expected.update({name: value['after'] for name, value in patch.items()})
home = Path(tempfile.mkdtemp(prefix='owner-native-',dir=str(FIXTURE)))
source = home / 'source'; source.mkdir(mode=0o700)
for name, digest in expected.items():
    original = NATIVE / 'source_snapshot' / name
    assert not original.is_symlink() and hashlib.sha256(original.read_bytes()).hexdigest() == digest
    target = source / name; target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(original,target)
with socket.socket() as reservation:
    reservation.bind(('127.0.0.1',0)); port = reservation.getsockname()[1]
native = 'http://127.0.0.1:' + str(port)
env = dict(PATH=os.defpath,HOME=str(home),HERMES_HOME=str(home / 'hermes'),
    HERMES_WEBUI_AGENT_DIR=str(home / 'no-agent'),HERMES_CONFIG_PATH=str(home / 'no-config.yaml'),
    HERMES_WEBUI_STATE_DIR=str(home / 'state'),HERMES_WEBUI_SETTINGS_FILE=str(home / 'settings.json'),
    HERMES_WEBUI_HOST='127.0.0.1',HERMES_WEBUI_PORT=str(port),PYTHONDONTWRITEBYTECODE='1')
sys.path.insert(0,str(NATIVE.parent))
from hermes_webui_receiver.test_native_wakeup import PROVIDER
from hermes_webui_receiver.native_adapter import NativeAdapter
from hermes_notify_subscriber import Inbox, Subscriber
bootstrap = '''
import json, os, runpy, sys
def fence(event, args):
    if event in ('socket.connect','subprocess.Popen','os.system'):
        raise OSError('native fixture denies outbound provider/process effects')
sys.addaudithook(fence)
from api.onboarding import complete_onboarding
complete_onboarding()
FAULT = ''
''' + PROVIDER + "\nrunpy.run_path('server.py',run_name='__main__')"
with (home / 'native.log').open('wb') as output:
    process = subprocess.Popen([sys.executable,'-B','-c',bootstrap],cwd=source,env=env,stdout=output,stderr=output,umask=0o077)
    try:
        for _ in range(100):
            assert process.poll() is None,'copied native startup failed'
            try: p.request_json(native,'/health',native=True); break
            except OSError: time.sleep(.1)
        else: raise AssertionError('native readiness timeout')
        state = home / 'state'; token = home / 'owner.txt'
        with token.open('x') as file: os.fchmod(file.fileno(),0o600); file.write('e02-synthetic-session-not-a-secret')
        manifest = dict(version=2,fixtureOnly=True,executionMode='sandbox-fixture',fixtureRoot=str(home),stateDir=str(state),
            tokenFile=str(token),nativeSource=str(source),nativeEndpoint=native,apiEndpoint=BASE,owner='1',profile='default',
            sourceKind='agent_session',sourceId=SOURCE,nativeCookieFile=None,nativeCsrfFile=None,
            nativeHashes={name:expected[name] for name in ('api/rhythm_inbox.py','api/rhythm_schema.py')})
        approval = home / 'approval.json'; p.atomic_json(approval,manifest)
        cli = [sys.executable,'-B',str(ROOT / 'hermes_fixture_provision.py'),'--attach-existing-owned-source',
            '--api',BASE,'--token-file',str(token),'--state-dir',str(state),'--native-source',str(source),
            '--native-endpoint',native,'--approved-fixture-manifest',str(approval)]
        subprocess.run(cli,check=True,timeout=15)
        subprocess.run(cli+['--create-native-owned-fixture'],check=True,timeout=15)
        sid = json.loads(p.protected(state / 'rhythm-fixture-chat.json'))['hermesSessionId']
        saved = json.loads((state / 'sessions' / (sid+'.json')).read_text())
        assert saved['messages'] == [] and saved['profile'] == 'default'
        # Real external SDK client, owner bearer only. No runtime registrar/capability.
        code = '''
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const [root,source,sid]=process.argv.slice(1);
const require=createRequire(root+'/apps/mcp_server/package.json');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const client=new Client({name:'ordinary-owner-native',version:'1'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'/apps/mcp_server/dist/index.js'],stderr:'pipe',env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,RHYTHM_API_URL:'http://127.0.0.1:4898',RHYTHM_AGENT_URL:'http://127.0.0.1:4898',RHYTHM_API_TOKEN:'e02-synthetic-session-not-a-secret'}}));
 assert.equal((await client.listTools()).tools.length,114);
 const result=await client.callTool({name:'rhythm_subscribe_updates',arguments:{sourceKind:'agent_session',sourceId:source,hermesSessionId:sid,profile:'default'}});
 assert.ok(!result.isError,JSON.stringify(result));
 const control=JSON.parse(result.content[0].text);
 assert.equal(control.workflowRunId,null);assert.equal(control.sourceKind,'agent_session');
} finally { await client.close(); }
'''
        subprocess.run([str(NODE),'--input-type=module','-e',code,str(ROOT.parent.parent),SOURCE,sid],
            env=dict(PATH=os.defpath,HOME=str(SB / 'home')),check=True,timeout=20)
        subprocess.run(cli+['--execute-owned-fixture'],check=True,timeout=20)
        assert not (home / 'provider-calls.jsonl').exists()
        # Actual supported API rename -> actual engine session.updated -> durable outbox.
        request = urllib.request.Request(BASE+'/agent-sessions/'+SOURCE,method='PATCH',
            data=json.dumps(dict(name='Synthetic meaningful source update')).encode(),
            headers={'Content-Type':'application/json','Authorization':'Bearer '+p.token_reference(token)})
        with urllib.request.build_opener(urllib.request.ProxyHandler({}),p.NoRedirect()).open(request,timeout=10) as response:
            assert response.status == 200
        adapter = NativeAdapter(state / 'rhythm-notify-registry.json',fixture_origin=native)
        inbox_path = home / 'subscriber.db'; consumer = Subscriber(BASE,p.token_reference(token),Inbox(inbox_path),adapter,SOURCE,loopback_test=True)
        deadline = time.monotonic()+10
        while time.monotonic()<deadline:
            with consumer.request('/runs/'+SOURCE+'/events') as response: events=json.loads(response.read())['events']
            updates=[e for e in events if e['kind']=='progress' and e['text']=='Rhythm session updated.']
            if updates: break
            time.sleep(.1)
        else: raise AssertionError('actual API rename produced no engine/outbox progress')
        event=updates[-1]
        assert set(event)=={'version','eventId','cursor','sessionId','hermesSessionId','workflowId','runId','kind','text','referenceId','state'}
        assert event['version']==2 and event['runId']==SOURCE and event['sessionId']==SOURCE
        assert not any(e['kind']=='completion' for e in events)
        (home / 'hold-provider').touch(mode=0o600)
        with consumer.request('/stream?runId='+SOURCE) as stream:
            for _ in range(100):
                line=stream.readline(8193)
                if line.startswith(b'data: ') and json.loads(line[6:])['eventId']==event['eventId']:
                    consumer.receive(json.loads(line[6:])); break
            else: raise AssertionError('actual SSE missing event')
        deadline=time.monotonic()+10
        while not (home / 'provider-calls.jsonl').exists():
            assert time.monotonic()<deadline, 'native provider launch timeout'
            time.sleep(.1)
        # Selected event is executing, not visible: duplicate/reopen cannot complete it.
        consumer.inbox.db.close();consumer.inbox=Inbox(inbox_path);consumer.receive(event)
        assert len((home / 'provider-calls.jsonl').read_text().splitlines())==1
        assert p.request_json(native,'/api/rhythm-notify/render-metadata?'+urllib.parse.urlencode(dict(hermesSessionId=sid)),native=True)['events']==[]
        with sqlite3.connect((SB / 'rhythm.db').as_uri()+'?mode=ro',uri=True) as db:
            assert db.execute('SELECT state FROM hermes_notify_events WHERE event_id=?',(event['eventId'],)).fetchone()[0]=='accepted'
        (home / 'hold-provider').unlink()
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            metadata=p.request_json(native,'/api/rhythm-notify/render-metadata?'+urllib.parse.urlencode(dict(hermesSessionId=sid)),native=True)['events']
            if metadata: break
            time.sleep(.1)
        else: raise AssertionError('actual native worker/render timeout: '+str(home))
        proof=metadata[0]; assert proof['eventId']==event['eventId']
        try: p.request_json(native,'/api/rhythm-notify/render-receipt',body=dict(proof,proofNonce='0'*64),native=True)
        except urllib.error.HTTPError as error: assert error.code==404
        else: raise AssertionError('wrong nonce accepted')
        consumer.inbox.db.close();consumer.inbox=Inbox(inbox_path);consumer.receive(event)
        assert len((home / 'provider-calls.jsonl').read_text().splitlines())==1
        foreign=p.request_json(native,'/api/session/new',body=dict(profile='default',worktree=False),native=True)['session']['session_id']
        p.request_json(native,'/api/session/rename',body=dict(session_id=foreign,title='Foreign disposable control'),native=True)
        subprocess.run([str(NODE),str(ROOT / 'hermes_current_ack_dom.mjs'),native,sid,foreign,
            '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js',
            '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',str(home)],
            env=dict(PATH=os.defpath,HOME=str(home),TMPDIR=str(home)),check=True,timeout=45)
        consumer.inbox.drain(adapter,consumer.ack); consumer.receive(event)
        assert consumer.inbox.db.execute('SELECT visible FROM inbox').fetchone()[0]==2
        with sqlite3.connect((SB / 'rhythm.db').as_uri()+'?mode=ro',uri=True) as db:
            assert db.execute('SELECT state FROM hermes_notify_events WHERE event_id=?',(event['eventId'],)).fetchone()[0]=='visible'
            assert db.execute('SELECT count(*) FROM agent_bridge_jobs').fetchone()[0]==0
        assert len((home / 'provider-calls.jsonl').read_text().splitlines())==1
        with consumer.request('/runs/'+SOURCE+'/events') as response:
            assert event['eventId'] not in [e['eventId'] for e in json.loads(response.read())['events']]
        consumer.inbox.db.close()
        result=dict(sourceKind='agent_session',sourceId=SOURCE,hermesSessionId=sid,eventId=event['eventId'],
            officialMCP=True,actualRenameEvent=True,nativeBrowserACK=True,nativeProviderEffects=1,sourceModelRequests=0,
            busyDuplicateReopen=True,fixture=str(home),
            screenshotSHA256=hashlib.sha256((home / 'current-shipping-native-ack.png').read_bytes()).hexdigest(),
            providerEvidence=str(home / 'provider-calls.jsonl'),
            providerSHA256=hashlib.sha256((home / 'provider-calls.jsonl').read_bytes()).hexdigest(),
            receiptSHA256=hashlib.sha256(json.dumps(proof,sort_keys=True).encode()).hexdigest())
        p.atomic_json(home / 'render-receipt.json',proof)
        p.atomic_json(FIXTURE / ('native-'+SOURCE+'.json'),result)
        print(json.dumps(result),flush=True)
    finally:
        if process.poll() is None: process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)
