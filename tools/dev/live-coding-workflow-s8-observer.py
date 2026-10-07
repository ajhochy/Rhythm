#!/usr/bin/env python3
"""Transparent sandbox-only diagnostic proxy: never synthesizes admission."""
import hashlib, http.client, http.server, json, os, pathlib, threading, urllib.request
if os.environ.get('RHYTHM_LIVE_E2E') != '1': raise SystemExit('Opt-in required')
out = pathlib.Path(os.environ['RHYTHM_G2_LIVE_OUT'])
lock = threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def forward(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        frame = None
        if self.path.endswith('/provider-admission'):
            try:
                parsed = json.loads(raw)
                r = parsed['request']
                with urllib.request.urlopen('http://127.0.0.1:4197/session/' + r['sdkSessionId'] + '/rhythm-provider-frame/' + r['requestNonce'], timeout=2) as response:
                    frame = {'status': response.status, 'body': json.loads(response.read())}
            except Exception as error: frame = {'error': str(error)}
        connection = http.client.HTTPConnection('127.0.0.1', 4198, timeout=20)
        incoming_headers = dict(self.headers.items())
        forwarded_headers = dict(incoming_headers)
        header_hash = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        connection.request(self.command, self.path, body=raw, headers=forwarded_headers)
        response = connection.getresponse(); body = response.read(); headers = response.getheaders()
        self.send_response_only(response.status)
        for key, value in headers: self.send_header(key, value)
        self.end_headers(); self.wfile.write(body); self.wfile.flush()
        if self.path.endswith('/provider-admission'):
            with lock, (out / 'guard-exchanges.jsonl').open('a') as file:
                file.write(json.dumps({'method': self.command, 'path': self.path, 'request': json.loads(raw),
                    'actualApiStatus': response.status, 'actualApiBody': json.loads(body), 'nativePendingFrame': frame,
                    'actualApiBodySha256': hashlib.sha256(body).hexdigest(), 'forwardedBodySha256': hashlib.sha256(body).hexdigest(),
                    'incomingHeadersSha256': header_hash(incoming_headers), 'forwardedHeadersSha256': header_hash(forwarded_headers),
                    'authHeadersForwardedUnchanged': incoming_headers == forwarded_headers, 'admissionSynthesized': False}) + '\n')
        connection.close()
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = forward
server = http.server.ThreadingHTTPServer(('127.0.0.1', 4284), Handler)
(out / 'observer-ready.json').write_text(json.dumps({'pid': os.getpid(), 'port': 4284, 'transparent': True}))
server.serve_forever()
