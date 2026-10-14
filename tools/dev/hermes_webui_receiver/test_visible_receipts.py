"""Real copied native HTTP boundary tests; never fake a visible adapter response."""
import json
import tempfile
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path

from hermes_webui_receiver.test_native_wakeup import EVENT, fixture
from hermes_webui_receiver.native_adapter import NativeAdapter


class VisibleReceipts(unittest.TestCase):
    def request(self, server, path, body=None):
        request = urllib.request.Request(server.base + '/api/rhythm-notify/' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'})
        try:
            response = server.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, json.loads(response.read())

    def test_exact_completion_proof_forgery_replay_and_revoked_link(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with fixture(home) as server:
                query = 'render-metadata?hermesSessionId=fixture-chat'
                self.assertEqual(self.request(server, query)[1], {'events': []})
                self.assertEqual(self.request(server, 'render-receipt', {'state': 'visible', 'owner': 'fixture-owner'})[0], 400)
                server.post()
                server.wait_reply()
                metadata = None
                for _ in range(40):
                    code, data = self.request(server, query)
                    self.assertEqual(code, 200, data)
                    if data['events']:
                        metadata = data['events'][0]
                        break
                    time.sleep(.1)
                self.assertIsNotNone(metadata)
                for field, value in [('hermesSessionId', 'foreign-chat'), ('turnIdentity', 'wrong'),
                                     ('proofNonce', 'wrong'), ('messageId', 'wrong'), ('eventId', 'wrong')]:
                    self.assertEqual(self.request(server, 'render-receipt', {**metadata, field: value})[0], 404)
                self.assertEqual(self.request(server, 'render-receipt', {**metadata, 'owner': 'fixture-owner'})[0], 400)
                first = self.request(server, 'render-receipt', metadata)
                self.assertEqual(first, (200, dict(version=2, eventId=EVENT['eventId'], runId=EVENT['runId'],
                    hermesSessionId=EVENT['hermesSessionId'], state='visible')))
                self.assertEqual(self.request(server, 'render-receipt', metadata), first)
                time.sleep(1.1)
                self.assertEqual(server.post(path='status')[1], first[1])
                self.assertEqual(len(server.calls()), 1)
                path = home / 'state/rhythm-notify-registry.json'
                data = json.loads(path.read_text())
                data['runs'][EVENT['runId']]['active'] = False
                path.write_text(json.dumps(data))
                self.assertEqual(self.request(server, 'render-receipt', metadata)[0], 404)

    def test_adapter_closed_browser_does_not_claim_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with fixture(home) as server:
                registry = home / 'state/rhythm-notify-registry.json'
                data = json.loads(registry.read_text())
                token = home / 'relay-token'
                token.write_text('fixture-only-token')
                token.chmod(0o600)
                record = data['runs'][EVENT['runId']]
                record.update(receiverEndpoint=server.base, tokenFile=str(token))
                adapter_registry = home / 'adapter-registry.json'
                adapter_registry.write_text(json.dumps(data))
                adapter_registry.chmod(0o600)
                adapter = NativeAdapter(adapter_registry, fixture_origin=server.base)
                self.assertTrue(adapter.owns(EVENT))
                self.assertFalse(adapter.owns({**EVENT, 'hermesSessionId': 'foreign-chat'}))
                self.assertIsNone(adapter.deliver(EVENT))
                server.wait_reply()
                time.sleep(1.1)
                self.assertIsNone(adapter.deliver(EVENT))
                self.assertEqual(server.post(path='status')[1]['state'], 'completed')
                self.assertEqual(len(server.calls()), 1)
                token.chmod(0o644)
                self.assertFalse(adapter.owns(EVENT))


if __name__ == '__main__':
    unittest.main()
