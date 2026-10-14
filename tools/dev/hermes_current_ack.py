"""Actual shipping Bridge event -> real SSE/subscriber/native DOM/HTTP ACK.

Invoked only inside the owned CLI fixture lifecycle. No source SQL writes.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import uuid
from test_provision_native_http import NATIVE, ROOT
from test_provision_contract import implementation

def verify_current_ack(manifest_path):
    assert os.environ.get('RHYTHM_LIVE_E2E') == '1'
    sys.path.insert(0, str(NATIVE.parent))
    from hermes_notify_subscriber import Inbox, Subscriber
    from hermes_webui_receiver.native_adapter import NativeAdapter
    p = implementation()
    manifest = json.loads(p.protected(manifest_path))
    state = Path(manifest['stateDir']); home = state.parent
    base = manifest['nativeEndpoint']; api = manifest['apiEndpoint']
    registry = state / 'rhythm-notify-registry.json'
    records = json.loads(p.protected(registry))['runs']
    assert len(records) == 1
    run_id, record = next(iter(records.items())); binding = record['binding']
    sid = binding['hermesSessionId']
    saved_path = state / 'sessions' / (sid + '.json')
    saved = json.loads(saved_path.read_text())
    assert saved['session_id'] == sid and saved['profile'] == 'default'
    assert saved['messages'] == [] and saved['title'] == p.FIXTURE_TITLE
    assert not (home / 'provider-calls.jsonl').exists(), 'zero native provider effects before SSE'
    session_records = [json.loads(path.read_text()) for path in (state / 'sessions').glob('*.json')
                       if path.name != '_index.json']
    assert len(session_records) == 1 and session_records[0]['session_id'] == sid
    token = p.token_reference(manifest['tokenFile'])
    adapter = NativeAdapter(registry, fixture_origin=base)
    inbox_path = home / 'subscriber.db'
    consumer = Subscriber(api, token, Inbox(inbox_path), adapter, run_id, loopback_test=True)
    with consumer.request('/runs/' + run_id + '/events') as response:
        events = json.loads(response.read())['events']
    event = next(e for e in events if e['kind'] in ('progress', 'error'))
    assert event['hermesSessionId'] == sid and event['sessionId'] == binding['sessionId']
    assert event['runId'] == run_id and event['version'] == 2
    assert event['text'] in ('Rhythm session linked.', 'Rhythm session updated.', 'Rhythm session reported an error.')
    observed = {str(path.relative_to(ROOT.parent.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (ROOT.parent.parent / 'apps/api_server/src/services/hermes_notify_service.ts',
                             ROOT.parent.parent / 'apps/api_server/dist/services/hermes_notify_service.js',
                             ROOT.parent.parent / 'apps/api_server/src/shared_agents/delegation_coordinator.ts',
                             ROOT.parent.parent / 'apps/api_server/dist/shared_agents/delegation_coordinator.js')}
    p.atomic_json(home / 'current-ack-source-receipt.json', dict(event=event,
        observedSourceHashes=observed, nativeDurableBirth=True, preSSEProviderEffects=0))
    print(json.dumps(dict(actualSourceFields=sorted(event), sourceEventKinds=[e['kind'] for e in events],
        observedSourceHashes=observed, fixture=str(home))), flush=True)
    source_db = Path('/private/tmp/hermes-shipping-rollout-20261014-sandbox/rhythm.db')
    def foreign_rows():
        with sqlite3.connect(source_db.as_uri() + '?mode=ro', uri=True) as db:
            return db.execute('SELECT * FROM hermes_notify_events WHERE event_id!=? ORDER BY cursor', (event['eventId'],)).fetchall()
    foreign_before = foreign_rows()
    wrong_run = str(uuid.uuid4())
    assert not adapter.owns(dict(event, runId=wrong_run, workflowId=wrong_run))
    assert not adapter.owns(dict(event, hermesSessionId='foreign-chat'))
    wrong_owner = Subscriber(api, 'invalid-synthetic-owner', consumer.inbox, adapter, run_id, loopback_test=True)
    try: wrong_owner.request('/runs/' + run_id + '/events')
    except urllib.error.HTTPError as error: assert error.code == 401
    else: raise AssertionError('invalid owner accepted')
    # Foreign native control also comes from supported HTTP, never Session.save.
    foreign = p.request_json(base, '/api/session/new', body={'profile': 'default', 'worktree': False}, native=True)['session']['session_id']
    p.request_json(base, '/api/session/rename', body={'session_id': foreign, 'title': 'Foreign disposable control'}, native=True)
    foreign_path = state / 'sessions' / (foreign + '.json'); foreign_bytes = foreign_path.read_bytes()
    with consumer.request('/stream?runId=' + run_id) as stream:
        for _ in range(100):
            line = stream.readline(8193)
            if line.startswith(b'data: '):
                received = json.loads(line[6:])
                if received['eventId'] == event['eventId']:
                    assert received == event
                    consumer.receive(received)
                    break
        else: raise AssertionError('known actual Bridge event missing from SSE')
    metadata_path = '/api/rhythm-notify/render-metadata?' + urllib.parse.urlencode({'hermesSessionId': sid})
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        metadata = p.request_json(base, metadata_path, native=True)['events']
        if len(metadata) == 1: break
        time.sleep(.1)
    else: raise AssertionError('actual native completion/render metadata timeout; fixture=' + str(home))
    proof = metadata[0]
    assert proof['eventId'] == event['eventId'] and proof['hermesSessionId'] == sid
    assert len(proof['proofNonce']) == 64
    try:
        p.request_json(base, '/api/rhythm-notify/render-receipt', body=dict(proof, proofNonce='0'*64), native=True)
    except urllib.error.HTTPError as error: assert error.code == 404
    else: raise AssertionError('unqualified nonce became visible')
    def provider_count():
        return len((home / 'provider-calls.jsonl').read_text().splitlines())
    assert provider_count() == 1
    consumer.inbox.db.close(); consumer.inbox = Inbox(inbox_path)
    consumer.receive(event)
    assert provider_count() == 1
    browser = subprocess.run(['node', str(ROOT / 'hermes_current_ack_dom.mjs'), base, sid, foreign,
        '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js',
        '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
        str(home)], env=dict(PATH='/opt/homebrew/bin:' + os.defpath, HOME=str(home), TMPDIR=str(home)),
        capture_output=True, text=True, timeout=45)
    assert browser.returncode == 0, browser.stdout + browser.stderr
    print(browser.stdout, flush=True)
    receipt = adapter.deliver(event)
    assert receipt == dict(version=2, eventId=event['eventId'], runId=run_id, hermesSessionId=sid, state='visible')
    wrong = Subscriber(api, token, consumer.inbox, adapter, wrong_run, loopback_test=True)
    try: consumer.inbox.drain(adapter, wrong.ack)
    except urllib.error.HTTPError as error: assert error.code == 404
    else: raise AssertionError('wrong-run ACK accepted')
    assert consumer.inbox.db.execute('SELECT visible FROM inbox').fetchone()[0] == 1
    consumer.inbox.db.close(); consumer.inbox = Inbox(inbox_path)
    consumer.inbox.drain(adapter, consumer.ack); consumer.receive(event)
    assert consumer.inbox.db.execute('SELECT visible FROM inbox').fetchone()[0] == 2
    with consumer.request('/runs/' + run_id + '/events') as response:
        assert event['eventId'] not in [e['eventId'] for e in json.loads(response.read())['events']]
    with sqlite3.connect(source_db.as_uri() + '?mode=ro', uri=True) as db:
        assert db.execute('SELECT state FROM hermes_notify_events WHERE event_id=?', (event['eventId'],)).fetchone()[0] == 'visible'
    assert foreign_rows() == foreign_before and foreign_path.read_bytes() == foreign_bytes
    assert provider_count() == 1
    consumer.inbox.db.close()
    observed = {str(path.relative_to(ROOT.parent.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (ROOT.parent.parent / 'apps/api_server/src/services/hermes_notify_service.ts',
                             ROOT.parent.parent / 'apps/api_server/dist/services/hermes_notify_service.js',
                             ROOT.parent.parent / 'apps/api_server/src/shared_agents/delegation_coordinator.ts',
                             ROOT.parent.parent / 'apps/api_server/dist/shared_agents/delegation_coordinator.js')}
    result = dict(currentShippingACK='PASS', receipt=receipt, deliveredUniqueEvents=1,
        sourceEventKinds=[e['kind'] for e in events], nativeProviderEffects=1, preSSEProviderEffects=0,
        tombstone=2, foreignUntouched=True, fixture=str(home), observedSourceHashes=observed,
        sourceLLMSuccess=False)
    p.atomic_json(home / 'current-ack-proof.json', result)
    print(json.dumps(result), flush=True)
