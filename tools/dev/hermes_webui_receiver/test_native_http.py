"""Actual copied server HTTP contract, isolated state and zero outbound network.

No fake receiver or transcript. Provider injection is not yet implemented.
"""
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request


class NativeHTTP(unittest.TestCase):
    def test_arrival_is_durable_in_registered_native_receive_route(self):
        source = Path(__file__).resolve().parent / 'source_snapshot'
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            copied = home / 'source'
            shutil.copytree(source, copied)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            env = dict(PATH=os.defpath, HOME=str(home), HERMES_HOME=str(home / 'hermes'),
                       HERMES_WEBUI_AGENT_DIR=str(home / 'no-agent'),
                       HERMES_CONFIG_PATH=str(home / 'no-config.yaml'),
                       HERMES_WEBUI_STATE_DIR=str(home / 'state'),
                       HERMES_WEBUI_SETTINGS_FILE=str(home / 'settings.json'),
                       HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_PORT=str(port),
                       PYTHONDONTWRITEBYTECODE='1')
            # Test-only hard network fence: server's own test flag allows private
            # addresses, so use an audit hook that rejects ALL outbound connects.
            bootstrap = '''
import hashlib, json, os, runpy, sys
from pathlib import Path
def audit(event, args):
    if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
        raise OSError('offline fixture denies outbound/process effects')
sys.addaudithook(audit)
from api.config import STATE_DIR, SESSION_DIR, DEFAULT_WORKSPACE
from api.models import Session
DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
SESSION_DIR.mkdir(parents=True, exist_ok=True)
Session(session_id='fixture-chat', profile='default', workspace=str(DEFAULT_WORKSPACE),
        model='fixture-model', model_provider='fixture-provider').save()
STATE_DIR.mkdir(parents=True, exist_ok=True)
registry = STATE_DIR / 'rhythm-notify-registry.json'
registry.write_text(json.dumps({'version': 2, 'runs': {
    'fixture-run': {'binding': {'runId': 'fixture-run', 'owner': 'fixture-owner',
                              'profile': 'default', 'hermesSessionId': 'fixture-chat',
                              'sessionId': 'fixture-anchor'}, 'active': True,
                    'credentialDigest': hashlib.sha256(b'fixture-only-token').hexdigest()}}}))
registry.chmod(0o600)
runpy.run_path('server.py', run_name='__main__')
'''
            with tempfile.TemporaryFile() as output:
                process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap], cwd=copied,
                                           env=env, stdout=output, stderr=output)
                try:
                    base = 'http://127.0.0.1:' + str(port)
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    ready = False
                    for _ in range(100):
                        if process.poll() is not None:
                            output.seek(0)
                            self.fail('actual copied server exited before HTTP gate:\n' + output.read().decode())
                        try:
                            with opener.open(base + '/health', timeout=.2):
                                ready = True
                                break
                        except (OSError, urllib.error.URLError):
                            time.sleep(.1)
                    self.assertTrue(ready, 'actual copied server did not become ready')
                    event = dict(version=2, runId='fixture-run', eventId='fixture-event', cursor=1,
                                 sessionId='fixture-anchor', hermesSessionId='fixture-chat',
                                 workflowId='fixture-run', kind='progress', text='Rhythm session linked.',
                                 referenceId=None, state='pending')
                    request = urllib.request.Request(base + '/api/rhythm-notify/receive',
                                                     data=json.dumps(event).encode(), method='POST',
                                                     headers={'Authorization': 'Bearer fixture-only-token',
                                                              'Content-Type': 'application/json'})
                    try:
                        response = opener.open(request, timeout=5)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        body = response.read().decode()
                        self.assertEqual(response.code, 200, body)
                        self.assertEqual(json.loads(body)['state'], 'accepted')
                finally:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()  # This fixture's owned child only.
                        process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
