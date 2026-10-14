"""Real sandbox SSE -> subscriber inbox -> SQLite fixture transcript, NOT Hermes."""
import json
import os
from pathlib import Path
import sqlite3
from hermes_notify_subscriber import Inbox, Subscriber
from test_hermes_notify_subscriber import FixtureTranscriptAdapter

assert os.environ.get('RHYTHM_LIVE_E2E') == '1'
assert os.environ.get('RHYTHM_SANDBOX_API_PORT') == '4898'
root = Path(os.environ['RHYTHM_SANDBOX_DIR'])
assert str(root) == '/private/tmp/hermes-event-notify-20261012-sandbox'
db = sqlite3.connect(f'file:{root}/rhythm.db?mode=ro', uri=True)
token = db.execute('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').fetchone()[0]
db.close()
adapter = FixtureTranscriptAdapter(root / 'consumer-fixture-transcript.db')
adapter.owns = lambda e: e['hermesSessionId'] == 'synthetic-hermes-parent' and e['workflowId'] == 'synthetic-workflow'
adapter.busy = True
inbox = Inbox(root / 'consumer-inbox.db')
consumer = Subscriber('http://127.0.0.1:4898', token, inbox, adapter, loopback_test=True)
with consumer.request('/stream') as stream:
    for _ in range(10):
        line = stream.readline(8193)
        if line.startswith(b'data: '):
            event = json.loads(line[6:])
            consumer.receive(event)
            break
    else:
        raise AssertionError('real notification SSE frame not received')
assert adapter.db.execute('SELECT COUNT(*) FROM transcript').fetchone()[0] == 0
with consumer.request('/events') as response:
    pending = json.loads(response.read())['events']
assert next(e for e in pending if e['eventId'] == event['eventId'])['state'] == 'accepted'
inbox.db.close()
consumer.inbox = Inbox(root / 'consumer-inbox.db')
adapter.busy = False
consumer.inbox.drain(adapter, consumer.ack)
consumer.receive(event)  # Duplicate after visible ACK must not write again.
assert adapter.db.execute('SELECT COUNT(*) FROM transcript').fetchone()[0] == 1
with consumer.request('/events') as response:
    assert all(e['eventId'] != event['eventId'] for e in json.loads(response.read())['events'])
consumer.inbox.db.close()
adapter.db.close()
print('PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript row -> visible ACK; NOT actual Hermes')
