"""Real copied HTTP/turn runner/save/restart; only external Agent boundary supplied."""
import ast
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
EVENT = dict(version=2, runId='fixture-run', eventId='fixture-event', cursor=1,
             sessionId='fixture-anchor', hermesSessionId='fixture-chat',
             workflowId='fixture-run', kind='progress', text='Rhythm session linked.',
             referenceId=None, state='pending')

PROVIDER = '''
import types
from pathlib import Path
import api.streaming as streaming
class FixtureAgent:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self._session_db = kwargs.get('session_db')
        self._interrupted = False
        self._last_error = None
    def run_conversation(self, user_message, conversation_history=None, **kwargs):
        with (Path(os.environ['HOME']) / 'provider-calls.jsonl').open('a') as file:
            file.write(json.dumps({'session': self.session_id, 'input': user_message}) + '\\n')
            file.flush()
            os.fsync(file.fileno())
        if FAULT == 'after-launch':
            os._exit(72)
        while (Path(os.environ['HOME']) / 'hold-provider').exists():
            import time
            time.sleep(.05)
        self.stream_delta_callback('Fixture native reply.')
        return {'messages': list(conversation_history or []) + [
            {'role': 'user', 'content': user_message},
            {'role': 'assistant', 'content': 'Fixture native reply.'}],
            'input_tokens': 1, 'output_tokens': 1}
streaming.AIAgent = FixtureAgent
# Only the upstream provider runtime module, absent from this source snapshot.
runtime = types.ModuleType('hermes_cli.runtime_provider')
runtime.resolve_runtime_provider = lambda **kwargs: {
    'provider': 'fixture-provider', 'api_key': 'offline-fixture-only',
    'base_url': 'http://127.0.0.1:1'}
package = types.ModuleType('hermes_cli')
package.__path__ = []
sys.modules.setdefault('hermes_cli', package)
sys.modules['hermes_cli.runtime_provider'] = runtime
if FAULT in ('before-journal', 'after-journal', 'journal-error'):
    import api.turn_journal as journal
    append = journal.append_turn_journal_event
    def fault_append(sid, event, **kwargs):
        if event.get('rhythm_notify'):
            if FAULT == 'before-journal':
                os._exit(70)
            if FAULT == 'journal-error':
                raise OSError('fixture journal persistence failure')
            value = append(sid, event, **kwargs)
            os._exit(71)
        return append(sid, event, **kwargs)
    journal.append_turn_journal_event = fault_append
'''


class Fixture:
    def __init__(self, home, fault=''):
        self.home, self.fault = home, fault
        self.source = home / 'source'
        if not self.source.exists():
            shutil.copytree(ROOT / 'source_snapshot', self.source)
        self.output = tempfile.TemporaryFile()
        self.process = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def start(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        self.base = 'http://127.0.0.1:' + str(port)
        tree = ast.parse((ROOT / 'test_native_http.py').read_text())
        bootstrap = next(n.value.value for n in ast.walk(tree)
                         if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'bootstrap'
                                                             for t in n.targets))
        # Same security fences as the frozen fixture; never recreate state on restart.
        if (self.home / 'initialized').exists():
            bootstrap = bootstrap[:bootstrap.index('from api.config import')]
        else:
            bootstrap = bootstrap[:bootstrap.index("runpy.run_path")]
            bootstrap += "\nSession(session_id='foreign-chat', profile='default', workspace=str(DEFAULT_WORKSPACE), model='fixture-model', model_provider='fixture-provider').save()\n"
            bootstrap += "\n(Path(os.environ['HOME']) / 'initialized').touch()\n"
        # Supported first-run fixture completion, never a production/UI bypass.
        bootstrap += '\nfrom api.onboarding import complete_onboarding\ncomplete_onboarding()\n'
        bootstrap += '\nFAULT = ' + repr(self.fault) + '\n' + PROVIDER
        bootstrap += "\nrunpy.run_path('server.py', run_name='__main__')\n"
        env = dict(PATH=os.defpath, HOME=str(self.home), HERMES_HOME=str(self.home / 'hermes'),
                   HERMES_WEBUI_AGENT_DIR=str(self.home / 'no-agent'),
                   HERMES_CONFIG_PATH=str(self.home / 'no-config.yaml'),
                   HERMES_WEBUI_STATE_DIR=str(self.home / 'state'),
                   HERMES_WEBUI_SETTINGS_FILE=str(self.home / 'settings.json'),
                   HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_PORT=str(port),
                   PYTHONDONTWRITEBYTECODE='1')
        self.process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap], cwd=self.source,
                                        env=env, stdout=self.output, stderr=self.output)
        for _ in range(100):
            if self.process.poll() is not None:
                raise AssertionError('fixture exited during startup\n' + self.logs())
            try:
                self.opener.open(self.base + '/health', timeout=.2).close()
                return self
            except OSError:
                time.sleep(.1)
        raise AssertionError('fixture startup timeout\n' + self.logs())

    def logs(self):
        self.output.seek(0)
        return self.output.read().decode()

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.output.close()

    def post(self, event=EVENT, path='receive', headers=None):
        request = urllib.request.Request(self.base + '/api/rhythm-notify/' + path,
            data=json.dumps(event).encode(), method='POST', headers={
                'Authorization': 'Bearer fixture-only-token', 'Content-Type': 'application/json',
                **(headers or {})})
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, json.loads(response.read())

    def saved(self, sid='fixture-chat'):
        files = list((self.home / 'state').rglob(sid + '.json'))
        if len(files) != 1:
            raise AssertionError('expected one native session JSON: ' + str(files))
        return json.loads(files[0].read_text())

    def calls(self):
        path = self.home / 'provider-calls.jsonl'
        return path.read_text().splitlines() if path.exists() else []

    def wait_reply(self):
        for _ in range(100):
            if any(m.get('content') == 'Fixture native reply.' for m in self.saved().get('messages', [])):
                return
            if self.process.poll() is not None:
                break
            time.sleep(.1)
        raise AssertionError('actual native reply was not saved\n' + self.logs())


@contextlib.contextmanager
def fixture(home, fault=''):
    server = Fixture(home, fault)
    try:
        yield server.start()
    finally:
        server.stop()


class NativeWakeup(unittest.TestCase):
    def test_real_native_reply_duplicate_restart_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            with fixture(home) as server:
                self.assertEqual(server.post()[0], 200)
                server.wait_reply()
                self.assertEqual(len(server.calls()), 1)
                journals = list((home / 'state').rglob('fixture-chat~*.jsonl'))
                entries = [json.loads(line) for path in journals for line in path.read_text().splitlines()]
                submitted = [e for e in entries if e.get('event') == 'submitted']
                self.assertEqual(len(submitted), 1)
                payload = json.dumps({k: v for k, v in EVENT.items() if k != 'state'},
                                     sort_keys=True, separators=(',', ':'), ensure_ascii=True)
                digest = hashlib.sha256(payload.encode()).hexdigest()
                self.assertEqual(submitted[0]['turn_id'], 'rhythm_' + digest)
                self.assertEqual(submitted[0]['rhythm_notify'], {
                    'eventId': EVENT['eventId'], 'identityHash': digest, 'runId': EVENT['runId']})
                self.assertTrue(any(e.get('event') == 'worker_started' and e.get('turn_id') == 'rhythm_' + digest
                                    for e in entries))
                self.assertEqual(server.saved('foreign-chat')['messages'], [])
                self.assertEqual(server.post()[0], 200)
                self.assertEqual(server.post(path='status')[0], 200)
            with fixture(home) as server:
                self.assertEqual(server.post()[0], 200)
                server.wait_reply()
                time.sleep(1.1)
                self.assertEqual(len(server.calls()), 1)
                # Actual normal session route, not notification evidence payload.
                with server.opener.open(server.base + '/api/session?session_id=fixture-chat', timeout=5) as response:
                    self.assertIn('Fixture native reply.', response.read().decode())

    def test_collision_foreign_chat_revocation_and_browser_denial(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            with fixture(home) as server:
                self.assertEqual(server.post()[0], 200)
                self.assertEqual(server.post({**EVENT, 'cursor': 2})[0], 409)
                self.assertEqual(server.post({**EVENT, 'hermesSessionId': 'foreign-chat'})[0], 404)
                self.assertEqual(server.post(headers={'Origin': server.base})[0], 403)
                self.assertEqual(server.post(headers={'Authorization': 'Bearer wrong'})[0], 404)
                path = home / 'state' / 'rhythm-notify-registry.json'
                data = json.loads(path.read_text())
                data['runs']['fixture-run']['active'] = False
                path.write_text(json.dumps(data))
                self.assertEqual(server.post()[0], 404)

    def test_busy_is_durable_and_never_steers_active_turn(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            (home / 'hold-provider').touch()
            with fixture(home) as server:
                self.assertEqual(server.post()[0], 200)
                for _ in range(100):
                    if server.calls():
                        break
                    time.sleep(.1)
                self.assertEqual(len(server.calls()), 1, server.logs())
                second = {**EVENT, 'eventId': 'second-event', 'cursor': 2, 'text': 'Rhythm session updated.'}
                self.assertEqual(server.post(second)[0], 200)
                time.sleep(2)
                self.assertEqual(len(server.calls()), 1)
                self.assertEqual(server.post(second, path='status')[1]['state'], 'accepted')
                (home / 'hold-provider').unlink()
                for _ in range(100):
                    if len(server.calls()) == 2:
                        break
                    time.sleep(.1)
                self.assertEqual(len(server.calls()), 2, server.logs())

    def test_journal_persist_failure_is_scoped_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with fixture(Path(directory).resolve(), 'journal-error') as server:
                self.assertEqual(server.post()[0], 200)
                time.sleep(2)
                self.assertEqual(server.calls(), [])
                self.assertEqual(server.post(path='status')[1]['state'], 'launching')

    def test_owner_profile_and_old_session_binding_changes_are_denied(self):
        for field, value in [('owner', 'foreign-owner'), ('profile', 'foreign-profile'),
                             ('hermesSessionId', 'foreign-chat')]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                home = Path(directory).resolve()
                with fixture(home) as server:
                    path = home / 'state' / 'rhythm-notify-registry.json'
                    data = json.loads(path.read_text())
                    data['runs']['fixture-run']['binding'][field] = value
                    path.write_text(json.dumps(data))
                    self.assertEqual(server.post()[0], 404)
                    time.sleep(1.1)
                    self.assertEqual(server.calls(), [])
                    self.assertEqual(server.saved('foreign-chat')['messages'], [])

    def test_crash_windows_quarantine_without_blind_retry(self):
        for fault, count in [('before-journal', 0), ('after-journal', 0), ('after-launch', 1)]:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                home = Path(directory).resolve()
                with fixture(home, fault) as server:
                    self.assertEqual(server.post()[0], 200)
                    server.process.wait(timeout=10)
                    self.assertEqual(len(server.calls()), count)
                with fixture(home) as server:
                    self.assertEqual(server.post()[0], 200)
                    time.sleep(1.1)
                    self.assertEqual(len(server.calls()), count)
                    self.assertNotEqual(server.post(path='status')[1]['state'], 'visible')


if __name__ == '__main__':
    unittest.main()
