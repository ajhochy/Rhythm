"""Transport contract: real CLI HTTP client over an owned loopback listener."""
import http.server
import json
import threading
import unittest
from test_provision_contract import implementation

class BridgeTransport(unittest.TestCase):
    def test_bridge_requests_are_nonbrowser(self):
        seen = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(dict(self.headers))
                self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
            def log_message(self, *args): pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever); thread.start()
        try:
            implementation().request_json('http://127.0.0.1:' + str(server.server_port),
                                          '/agent-bridge/v1/catalog', 'synthetic-only')
            self.assertNotIn('Origin', seen[0], 'Bridge forbids browser Origin')
            self.assertNotIn('Cookie', seen[0])
            self.assertEqual(seen[0]['Authorization'], 'Bearer synthetic-only')
        finally:
            server.shutdown(); thread.join(); server.server_close()

if __name__ == '__main__': unittest.main()
