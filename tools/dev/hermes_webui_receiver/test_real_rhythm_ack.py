"""Env-gated actual Rhythm HTTP/SSE -> subscriber -> native HTTP/DOM -> ACK."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
from hermes_notify_subscriber import Inbox, Subscriber
from hermes_webui_receiver.receiver import Receiver
from hermes_webui_receiver.native_adapter import NativeAdapter
from hermes_webui_receiver.test_native_wakeup import ROOT, fixture


@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'requires approved sandbox')
class RealRhythmACK(unittest.TestCase):
    def test_actual_v2_sse_native_dom_ack_retry_reopen_one_provider(self):
        sandbox = Path('/private/tmp/hermes-event-notify-20261012-sandbox')
        self.assertEqual(os.environ.get('RHYTHM_SANDBOX_API_PORT'), '4898')
        result = subprocess.run(['node', str(ROOT/'prepare_real_ack.mjs')], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        fixtures = json.loads(next(line[13:] for line in result.stdout.splitlines() if line.startswith('ACK_FIXTURES ')))
        selected = fixtures[0]
        event = selected['event']
        with sqlite3.connect(f'file:{sandbox}/rhythm.db?mode=ro', uri=True) as db:
            token = db.execute('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').fetchone()[0]
            foreign_before = db.execute('SELECT * FROM hermes_notify_events WHERE session_id IN (?,?) ORDER BY cursor',
                                        (fixtures[1]['anchor'], fixtures[2]['anchor'])).fetchall()
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with fixture(home) as server:
                # Operator provision in isolated fixture only; no HTTP adoption.
                registry = home/'state/rhythm-notify-registry.json'
                data = json.loads(registry.read_text())
                record = data['runs'].pop('fixture-run')
                binding = record['binding']
                binding.update(runId=event['runId'], sessionId=event['sessionId'], owner='1')
                data['runs'][event['runId']] = record
                registry.write_text(json.dumps(data))
                store = Receiver(home/'state/rhythm-notify.sqlite')
                store.link(binding, record['credentialDigest'], operator_authorized=True)
                store.close()
                native_token = home/'relay-token'
                native_token.write_text('fixture-only-token'); native_token.chmod(0o600)
                record.update(receiverEndpoint=server.base, tokenFile=str(native_token))
                adapter_registry = home/'adapter-registry.json'
                adapter_registry.write_text(json.dumps(data)); adapter_registry.chmod(0o600)
                adapter = NativeAdapter(adapter_registry, fixture_origin=server.base)
                inbox_path = home/'subscriber.db'
                consumer = Subscriber('http://127.0.0.1:4898', token, Inbox(inbox_path), adapter,
                                      event['runId'], loopback_test=True)
                self.assertFalse(adapter.owns({**event, 'runId': fixtures[1]['runId'], 'workflowId':fixtures[1]['runId']}))
                self.assertFalse(adapter.owns({**event, 'hermesSessionId':'foreign-chat'}))
                with consumer.request('/runs/'+event['runId']+'/events') as response:
                    self.assertIn(event, json.loads(response.read())['events'])
                with consumer.request('/stream?runId='+event['runId']) as stream:
                    for _ in range(100):
                        line = stream.readline(8193)
                        if line.startswith(b'data: '):
                            received = json.loads(line[6:])
                            if received['eventId'] == event['eventId']:
                                self.assertEqual(received, event)
                                consumer.receive(received)
                                break
                    else:
                        self.fail('target event absent from actual SSE')
                server.wait_reply()
                # ponytail: saved reply precedes the worker's durable drain observation.
                expected = dict(version=2, eventId=event['eventId'], runId=event['runId'],
                                hermesSessionId=event['hermesSessionId'], state='completed')
                started = time.monotonic()
                deadline = started + 10
                statuses = []
                while True:
                    status = server.post(event, path='status')
                    statuses.append(status)
                    remaining = deadline - time.monotonic()
                    if status == (200, expected) or remaining <= 0:
                        break
                    time.sleep(min(.05, remaining))
                # Only sanitized fixture identity/proof fields, never auth or full logs.
                with sqlite3.connect(f'file:{home}/state/rhythm-notify.sqlite?mode=ro', uri=True) as db:
                    rows = db.execute('SELECT event_id,run_id,identity_hash,turn_id,state,proof FROM inbox').fetchall()
                journal = [{k: entry[k] for k in ('event', 'turn_id', 'rhythm_notify',
                           'assistant_message_index') if k in entry}
                           for path in (home/'state').rglob(event['hermesSessionId']+'~*.jsonl')
                           for entry in map(json.loads, path.read_text().splitlines())]
                diagnostic = dict(statuses=statuses, inbox=rows, journal=journal,
                                  elapsed=time.monotonic()-started)
                if status != (200, expected) or remaining < 0:
                    self.fail('exact native completion readiness timeout: '+json.dumps(diagnostic))
                print('REAL_ACK_COMPLETION '+json.dumps(diagnostic))
                self.assertEqual(server.post(event, path='status')[1]['state'], 'completed')
                self.assertEqual(len(server.calls()), 1)
                self.assertEqual(server.saved('foreign-chat')['messages'], [])
                self.assertEqual(server.post({**event,'cursor':event['cursor']+1})[0],409)
                consumer.inbox.db.close()  # actual durable consumer reopen before DOM
                consumer.inbox = Inbox(inbox_path)
                consumer.receive(event)
                self.assertEqual(len(server.calls()), 1)
                browser = subprocess.run(['node', str(ROOT/'test_real_ack_dom.mjs'), server.base,
                    '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js',
                    '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
                    os.environ.get('RHYTHM_NATIVE_EVIDENCE_DIR',directory)], cwd=home,
                    env=dict(PATH='/opt/homebrew/bin:'+os.defpath,HOME=str(home),TMPDIR=str(home)),
                    capture_output=True,text=True,timeout=45)
                self.assertEqual(browser.returncode,0,browser.stdout+browser.stderr)
                print(browser.stdout)
                receipt = adapter.deliver(event)
                self.assertEqual(receipt,dict(version=2,eventId=event['eventId'],runId=event['runId'],hermesSessionId='fixture-chat',state='visible'))
                # Actual API rejects wrong run ACK; locally qualified receipt persists.
                wrong = Subscriber(consumer.base,token,consumer.inbox,adapter,fixtures[1]['runId'],loopback_test=True)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    consumer.inbox.drain(adapter, wrong.ack)
                self.assertEqual(error.exception.code,404)
                self.assertEqual(consumer.inbox.db.execute('SELECT visible FROM inbox').fetchone()[0],1)
                consumer.inbox.db.close()
                consumer.inbox = Inbox(inbox_path)
                consumer.inbox.drain(adapter,consumer.ack)
                consumer.receive(event)
                self.assertEqual(consumer.inbox.db.execute('SELECT visible FROM inbox').fetchone()[0],2)
                with consumer.request('/runs/'+event['runId']+'/events') as response:
                    self.assertNotIn(event['eventId'],[e['eventId'] for e in json.loads(response.read())['events']])
                with sqlite3.connect(f'file:{sandbox}/rhythm.db?mode=ro',uri=True) as db:
                    self.assertEqual(db.execute('SELECT state FROM hermes_notify_events WHERE event_id=?',(event['eventId'],)).fetchone()[0],'visible')
                    self.assertEqual(db.execute('SELECT * FROM hermes_notify_events WHERE session_id IN (?,?) ORDER BY cursor',
                        (fixtures[1]['anchor'],fixtures[2]['anchor'])).fetchall(),foreign_before)
                self.assertEqual(len(server.calls()),1)
                self.assertEqual(server.saved('foreign-chat')['messages'],[])
                consumer.inbox.db.close()
                print('REAL_RHYTHM_ACK '+json.dumps({'eventId':event['eventId'],'runId':event['runId'],'anchor':event['sessionId'],'receipt':receipt,'providers':1,'tombstone':2}))
