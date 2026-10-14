"""Offline receiver state contracts, NOT native WebUI/DOM qualification."""
import hashlib
import importlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import hermes_notify_subscriber as subscriber


def event(**changes):
    return dict(dict(version=2, runId='run1', workflowId='run1', eventId='event1',
        cursor=1, sessionId='anchor1', hermesSessionId='chat1', kind='progress',
        text='Rhythm session updated.', referenceId=None, state='pending'), **changes)


class TransportContract(unittest.TestCase):
    def test_constructor_denies_unopted_http_before_any_request(self):
        with self.assertRaises(ValueError):
            subscriber.Subscriber('http://127.0.0.1:4001', 'fixture-only', None, None)

    def policy(self, url, **opts):
        self.assertTrue(callable(getattr(subscriber, 'validate_origin', None)),
                        'subscriber lacks exact private-relay origin authorization')
        return subscriber.validate_origin(url, **opts)

    def test_exact_optin(self):
        self.assertEqual(self.policy('http://127.0.0.1:4001', private_relay=True),
                         'http://127.0.0.1:4001')

    def test_unopted_and_nonexact_denied(self):
        with self.assertRaises(ValueError):
            self.policy('http://127.0.0.1:4001')
        for url in ('http://localhost:4001', 'http://127.0.0.1:4002',
                    'http://[::1]:4001', 'http://127.0.0.1:4001/',
                    'http://user@127.0.0.1:4001', 'http://127.0.0.1:4001?x=1',
                    'http://127.0.0.1:4001#x', 'http://127.0.0.1:04001',
                    'HTTP://127.0.0.1:4001', 'http://example.com:4001'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.policy(url, private_relay=True)

    def test_redirects_and_proxies_remain_disabled(self):
        client = subscriber.Subscriber('https://example.invalid', 'fixture-only', None, None)
        with self.assertRaises(ValueError):
            subscriber.NoRedirect().redirect_request(None, None, 302, '', {},
                                                     'http://other.invalid')
        self.assertFalse(any(isinstance(h, subscriber.urllib.request.ProxyHandler)
                             and h.proxies for h in client.opener.handlers))


class ReceiverContract(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('hermes_webui_receiver.receiver'),
                             'durable scoped receiver capability not implemented')
        self.module = importlib.import_module('hermes_webui_receiver.receiver')
        self.tmp = tempfile.TemporaryDirectory(prefix='hermes-receiver-unit-')
        self.path = Path(self.tmp.name) / 'receiver.sqlite'
        self.store = self.module.Receiver(self.path)
        self.binding = dict(runId='run1', owner='owner1', profile='profile1',
                            hermesSessionId='chat1', sessionId='anchor1')
        self.digest = hashlib.sha256(b'fixture-credential').hexdigest()
        self.store.link(self.binding, self.digest, operator_authorized=True)

    def tearDown(self):
        if hasattr(self, 'store'):
            self.store.close()
            self.tmp.cleanup()

    def receive(self, notification=None, token='fixture-credential'):
        return self.store.receive(event() if notification is None else notification,
                                  'Bearer ' + token, self.binding)

    def test_ingestion_is_not_visible_and_replay_identity_is_full(self):
        self.assertEqual(self.receive()['state'], 'accepted')
        self.assertEqual(self.receive(event(state='accepted'))['state'], 'accepted')
        self.assertEqual(self.store.db.execute('select count(*) from inbox').fetchone()[0], 1)
        for change in ({'cursor': 2}, {'referenceId': 'other'}, {'text': 'Rhythm session linked.'}):
            with self.subTest(change=change), self.assertRaises(self.module.Collision):
                self.receive(event(**change))

    def test_wrong_auth_tuple_and_unbounded_text_have_no_effect(self):
        for change in ({'hermesSessionId': 'chat2'}, {'sessionId': 'oldanchor'},
                       {'text': 'execute ' * 10000}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.receive(event(**change))
        with self.assertRaises(self.module.Denied):
            self.receive(token='other')
        self.assertEqual(self.store.db.execute('select count(*) from inbox').fetchone()[0], 0)

    def test_busy_retry_and_restart_preserve_intent(self):
        self.receive()
        intent = self.store.claim(self.binding, now=1)
        self.assertEqual(intent['event']['hermesSessionId'], 'chat1')
        self.store.busy(intent['event']['eventId'], intent['lease'])
        again = self.store.claim(self.binding, now=2)
        self.assertEqual(again['turnIdentity'], intent['turnIdentity'])
        self.store.close()
        self.store = self.module.Receiver(self.path)
        # Expired launching lease is ambiguous, not permission to launch again.
        self.assertIsNone(self.store.claim(self.binding, now=10000))
        self.assertEqual(self.store.status(event(), 'Bearer fixture-credential',
                                          self.binding)['state'], 'launching')

    def test_revoked_current_link_denies_every_retry_and_receipt(self):
        self.receive()
        self.store.revoke('run1', operator_authorized=True)
        for op in (lambda: self.receive(), lambda: self.store.claim(self.binding),
                   lambda: self.store.status(event(), 'Bearer fixture-credential', self.binding)):
            with self.assertRaises(self.module.Denied):
                op()
        with self.assertRaises(self.module.Collision):
            self.store.link({**self.binding, 'owner': 'owner2'}, self.digest,
                            operator_authorized=True)

    def test_visible_cannot_be_client_asserted_or_http200(self):
        self.receive(event(state='visible'))
        self.assertEqual(self.store.status(event(), 'Bearer fixture-credential',
                                          self.binding)['state'], 'accepted')
        self.assertFalse(hasattr(self.store, 'mark_visible'))


if __name__ == '__main__':
    unittest.main()
