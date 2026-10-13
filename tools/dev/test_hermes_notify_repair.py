"""Focused repair contract: actual runner/inbox with deterministic transport/time fixtures."""
import io
import json
import unittest
from unittest.mock import patch
import hermes_notify_subscriber as module
from hermes_notify_subscriber import Subscriber, validate
from test_hermes_notify_subscriber import Contract, event

class StopProbe(BaseException):
    pass

class Repairs(Contract):
    def subscriber(self):
        self.adapter.owns = lambda notification: True
        consumer = Subscriber('http://127.0.0.1:4898', 'synthetic', self.inbox, self.adapter)
        consumer.ack = self.ack
        return consumer

    def test_cursor_identity_conflict_refuses_without_ack_or_mutation(self):
        consumer = self.subscriber()
        self.adapter.busy = True
        consumer.receive(event())
        before = self.inbox.db.execute('SELECT * FROM inbox').fetchall()
        acks = list(self.acks)
        with self.assertRaises(ValueError):
            consumer.receive({**event(), 'eventId': 'event-2'})
        self.assertEqual(self.inbox.db.execute('SELECT * FROM inbox').fetchall(), before)
        self.assertEqual(self.acks, acks)

    def test_malformed_types_are_validation_refusals(self):
        changes = [{'version': True}, {'cursor': True}]
        for field in event():
            for value in ([], {}, None):
                if field == 'referenceId' and value is None:
                    continue
                changes.append({field: value})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate({**event(), **change})
        for value in ([], None, {'error': {'message': 'synthetic'}}, {'events': []}):
            with self.subTest(shape=value), self.assertRaises(ValueError):
                validate(value)

    def test_actual_run_refuses_malformed_pages_and_stream_events(self):
        for page in (None, [], {'error': {}}, {'events': None}, {'events': {}}, {'events': [None]}):
            with self.subTest(page=page):
                consumer = self.subscriber()
                consumer.request = lambda *args: io.BytesIO(json.dumps(page).encode())
                with patch.object(module.time, 'monotonic', lambda: 10000), patch.object(module.time, 'sleep', side_effect=StopProbe), self.assertRaises(StopProbe):
                    consumer.run()
        self.adapter.busy = True
        self.inbox.accept(event())
        for notification in ({**event(), 'kind': []}, {**event(), 'eventId': 'event-2'}):
            with self.subTest(notification=notification):
                consumer = self.subscriber()
                consumer.request = lambda path, body=None: io.BytesIO(b'{"events": []}' if path == '/events' else b'data: ' + json.dumps(notification).encode() + b'\n')
                with patch.object(module.time, 'monotonic', lambda: 10000), patch.object(module.time, 'sleep', side_effect=StopProbe), self.assertRaises(StopProbe):
                    consumer.run()
        self.assertEqual(self.acks, [])
        self.assertEqual(self.inbox.db.execute('SELECT COUNT(*) FROM inbox').fetchone()[0], 1)

    def test_actual_run_watchdog_during_healthy_heartbeats(self):
        consumer = self.subscriber()
        clock = [10000]
        requests = []
        class Heartbeats(io.BytesIO):
            def readline(self, size=-1):
                clock[0] += 15
                if clock[0] > 11365:
                    raise StopProbe()
                return b': heartbeat\n'
        def transport(path, body=None):
            requests.append((path, clock[0] - 10000))
            return io.BytesIO(b'{"events": []}') if path == '/events' else Heartbeats()
        consumer.request = transport
        with patch.object(module.time, 'monotonic', lambda: clock[0]), self.assertRaises(StopProbe):
            consumer.run()
        self.assertEqual(requests, [('/events', 0), ('/stream', 0), ('/events', 600), ('/events', 1200)])
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.acks, [])

if __name__ == '__main__':
    unittest.main()
