"""Auth-enabled copied native HTTP using existing session and CSRF machinery."""
import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
from hermes_webui_receiver.test_native_wakeup import Fixture, ROOT, PROVIDER


class AuthFixture(Fixture):
    def start(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0))
            port = reservation.getsockname()[1]
        self.base = f'http://127.0.0.1:{port}'
        tree = ast.parse((ROOT/'test_native_http.py').read_text())
        bootstrap = next(n.value.value for n in ast.walk(tree) if isinstance(n,ast.Assign)
            and any(isinstance(t,ast.Name) and t.id=='bootstrap' for t in n.targets))
        bootstrap = bootstrap[:bootstrap.index('runpy.run_path')]
        bootstrap += "\nfrom api.onboarding import complete_onboarding\ncomplete_onboarding()\nFAULT=''\n" + PROVIDER
        # Fixture provisioning through real existing login-session APIs, not auth mocks.
        bootstrap += '''
from api.auth import create_session, csrf_token_for_session
sessions = {}
for owner in ('fixture-owner', 'foreign-owner'):
    cookie = create_session(auth_type='password', username=owner, bound_profile='default')
    sessions[owner] = {'cookie': cookie, 'csrf': csrf_token_for_session(cookie)}
path = Path(os.environ['HOME']) / 'fixture-auth.json'
path.write_text(json.dumps(sessions))
path.chmod(0o600)
runpy.run_path('server.py', run_name='__main__')
'''
        env = dict(PATH=os.defpath, HOME=str(self.home),HERMES_HOME=str(self.home/'hermes'),
            HERMES_WEBUI_AGENT_DIR=str(self.home/'no-agent'),HERMES_CONFIG_PATH=str(self.home/'no-config.yaml'),
            HERMES_WEBUI_STATE_DIR=str(self.home/'state'),HERMES_WEBUI_SETTINGS_FILE=str(self.home/'settings.json'),
            HERMES_WEBUI_HOST='127.0.0.1',HERMES_WEBUI_PORT=str(port),
            HERMES_WEBUI_PASSWORD='isolated-fixture-password',PYTHONDONTWRITEBYTECODE='1')
        self.process = subprocess.Popen([sys.executable,'-B','-c',bootstrap],cwd=self.source,env=env,
            stdout=self.output,stderr=self.output)
        for _ in range(100):
            if self.process.poll() is not None:
                raise AssertionError('fixture startup failed\n'+self.logs())
            try:
                self.opener.open(self.base+'/health',timeout=.2).close()
                return self
            except OSError:
                time.sleep(.1)
        raise AssertionError('auth fixture startup timeout')


class VisibleAuth(unittest.TestCase):
    def test_existing_owner_auth_csrf_foreign_and_body_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            server = AuthFixture(Path(directory))
            try:
                server.start()
                server.post()
                server.wait_reply()
                auth = json.loads((server.home/'fixture-auth.json').read_text())
                def request(path, owner=None, body=None, csrf=False, origin=None):
                    headers = {'Content-Type':'application/json'}
                    if owner:
                        headers['Cookie'] = 'hermes_session='+auth[owner]['cookie']
                    if csrf:
                        headers['X-Hermes-CSRF-Token'] = auth[owner]['csrf']
                    if origin:
                        headers['Origin'] = origin
                    req = urllib.request.Request(server.base+'/api/rhythm-notify/'+path,
                        data=None if body is None else json.dumps(body).encode(),headers=headers)
                    try:
                        response=server.opener.open(req,timeout=5)
                    except urllib.error.HTTPError as error:
                        response=error
                    with response:
                        return response.code,json.loads(response.read())
                query='render-metadata?hermesSessionId=fixture-chat'
                self.assertEqual(request(query)[0],401)
                self.assertEqual(request(query,'foreign-owner')[0],404)
                metadata=None
                for _ in range(40):
                    code,data=request(query,'fixture-owner')
                    self.assertEqual(code,200,data)
                    if data['events']:
                        metadata=data['events'][0]
                        break
                    time.sleep(.1)
                self.assertIsNotNone(metadata)
                self.assertEqual(request('render-receipt','fixture-owner',metadata,origin=server.base)[0],403)
                self.assertEqual(request('render-receipt','fixture-owner',metadata,True,'http://foreign.invalid')[0],403)
                self.assertEqual(request('render-receipt','foreign-owner',metadata,True,server.base)[0],404)
                self.assertEqual(request('render-receipt','fixture-owner',{**metadata,'owner':'fixture-owner'},True,server.base)[0],400)
                self.assertEqual(request('render-receipt','fixture-owner',metadata,True,server.base)[1]['state'],'visible')
                self.assertEqual(len(server.calls()),1)
            finally:
                server.stop()


if __name__ == '__main__':
    unittest.main()
