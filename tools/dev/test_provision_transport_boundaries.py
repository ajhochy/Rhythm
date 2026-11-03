"""Supplemental real transport/file/offline-module checks; no SUT mocks."""
import hashlib
import http.server
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from test_provision_contract import implementation
from test_provision_native_http import NATIVE

class Boundaries(unittest.TestCase):
    def test_redirect_and_proxy_are_denied(self):
        seen = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.path)
                if self.path == '/redirect':
                    self.send_response(302); self.send_header('Location', '/secret-sink'); self.end_headers()
                else:
                    self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
            def log_message(self, *args): pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever); thread.start()
        old = {k: os.environ.get(k) for k in ('HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy')}
        try:
            os.environ.update(HTTP_PROXY='http://127.0.0.1:1', http_proxy='http://127.0.0.1:1', NO_PROXY='', no_proxy='')
            base = 'http://127.0.0.1:' + str(server.server_port)
            p = implementation(); self.assertEqual(p.request_json(base, '/direct'), {})
            with self.assertRaises(ValueError): p.request_json(base, '/redirect', 'synthetic-secret')
            self.assertEqual(seen, ['/direct', '/redirect'])
        finally:
            for k, value in old.items():
                if value is None: os.environ.pop(k, None)
                else: os.environ[k] = value
            server.shutdown(); thread.join(); server.server_close()

    def test_native_cookie_never_flows_to_bridge_and_missing_csrf_has_no_request(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie = Path(directory).resolve() / 'cookie'; cookie.write_text('synthetic=value'); cookie.chmod(0o600)
            p = implementation()
            with self.assertRaises(ValueError): p.request_json('http://127.0.0.1:1', '/agent-bridge/v1/catalog', cookie_file=cookie)
            with self.assertRaises(p.BoundaryFailure):
                p.request_json('http://127.0.0.1:1', '/api/session/new', body={}, cookie_file=cookie, native=True)

    def test_actual_copied_receiver_loads_offline_and_rejects_changed_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory).resolve(); (source / 'api').mkdir()
            hashes = {}
            for name in ('api/rhythm_inbox.py', 'api/rhythm_schema.py'):
                raw = (NATIVE / 'source_snapshot' / name).read_bytes()
                (source / name).write_bytes(raw); hashes[name] = hashlib.sha256(raw).hexdigest()
            before = {key: sys.modules.get(key) for key in ('api', 'api.config', 'api.rhythm_inbox')}
            p = implementation(); receiver = p.pinned_receiver(source, hashes)
            self.assertEqual({key: sys.modules.get(key) for key in before}, before)
            token = source / 'token'; token.write_text('synthetic-only'); token.chmod(0o600)
            binding = dict(runId='offline-run', owner='1', profile='default', hermesSessionId='created-native', sessionId='broker-child')
            p.install_link(source, binding, token, receiver)
            store = receiver(source / 'rhythm-notify.sqlite')
            try: self.assertEqual(store.db.execute('SELECT count(*) FROM links').fetchone()[0], 1)
            finally: store.close()
            hashes['api/rhythm_inbox.py'] = '0' * 64
            with self.assertRaises(p.BoundaryFailure): p.pinned_receiver(source, hashes)

if __name__ == '__main__': unittest.main()
