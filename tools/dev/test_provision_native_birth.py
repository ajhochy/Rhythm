"""Frozen durable-birth criterion against actual pinned native HTTP and metadata."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from test_provision_native_http import NATIVE, ROOT
from test_provision_contract import implementation

def session_payloads(directory):
    records = {}
    index = None
    for path in sorted(directory.glob('*.json')):
        assert not path.is_symlink() and path.is_file(), 'regular non-symlink JSON required'
        payload = json.loads(path.read_text())
        if path.name == '_index.json':
            # Pinned models._write_session_index writes compact rows, not a Session.
            assert isinstance(payload, list), 'index must not contain top-level session_id'
            assert all(isinstance(row, dict) for row in payload), 'unknown index structure'
            index = payload
            continue
        assert isinstance(payload, dict), 'unknown session JSON'
        sid = payload.get('session_id')
        assert isinstance(sid, str) and sid and path.name == sid + '.json', 'session identity mismatch'
        assert isinstance(payload.get('messages'), list), 'Session messages required'
        records[sid] = payload
    assert index is not None, 'native index required'
    assert len(index) == len(records) and {row.get('session_id') for row in index} == set(records), 'index identity mismatch'
    for row in index:
        saved = records[row['session_id']]
        assert row.get('message_count') == len(saved['messages']), 'index message count mismatch'
        assert all(row.get(key) == saved.get(key) for key in ('profile', 'title')), 'index metadata mismatch'
    return records

class SessionIdentityContract(unittest.TestCase):
    def test_unexpected_chat_is_counted_and_rejected(self):
        with tempfile.TemporaryDirectory(prefix='hermes-birth-count-', dir='/private/tmp') as temp:
            directory = Path(temp)
            records = [dict(session_id=sid, messages=[], profile='default', title='fixture')
                       for sid in ('receipt-sid', 'unexpected-sid')]
            for record in records:
                (directory / (record['session_id'] + '.json')).write_text(json.dumps(record))
            (directory / '_index.json').write_text(json.dumps([
                dict(session_id=r['session_id'], message_count=0, profile=r['profile'], title=r['title'])
                for r in records]))
            self.assertEqual(set(session_payloads(directory)), {'receipt-sid', 'unexpected-sid'})
            with self.assertRaises(AssertionError):
                self.assertEqual(set(session_payloads(directory)), {'receipt-sid'})
            for name, payload in (('_unknown.json', {}), ('_index.json', records[0]),
                                  ('wrong-name.json', records[0])):
                with self.subTest(name=name):
                    case = directory / (name + '-case'); case.mkdir()
                    for original in directory.glob('*.json'): shutil.copyfile(original, case / original.name)
                    path = case / name
                    path.write_text(json.dumps(payload))
                    with self.assertRaises(AssertionError): session_payloads(case)
            # No server action: a symlink must fail before its payload is read.
            link = directory / 'linked.json'
            link.symlink_to(directory / 'receipt-sid.json')
            with self.assertRaises(AssertionError): session_payloads(directory)

@contextmanager
def native_fixture():
    pins = json.loads((NATIVE / 'source_snapshot_manifest.json').read_text())['hashes']
    patch = json.loads((NATIVE / 'native_patch_manifest.json').read_text())
    assert len(pins) == 107 and len(patch) == 7
    expected = dict(pins); expected.update({k: v['after'] for k, v in patch.items()})
    home = Path(tempfile.mkdtemp(prefix='hermes-native-birth-', dir='/private/tmp'))
    source = home / 'source'; source.mkdir(mode=0o700)
    for name, digest in expected.items():
        original = NATIVE / 'source_snapshot' / name
        assert not original.is_symlink() and hashlib.sha256(original.read_bytes()).hexdigest() == digest
        target = source / name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
    base = 'http://127.0.0.1:' + str(port)
    env = dict(PATH=os.defpath, HOME=str(home), HERMES_HOME=str(home / 'hermes'),
        HERMES_WEBUI_AGENT_DIR=str(home / 'no-agent'), HERMES_CONFIG_PATH=str(home / 'no-config.yaml'),
        HERMES_WEBUI_STATE_DIR=str(home / 'state'), HERMES_WEBUI_SETTINGS_FILE=str(home / 'settings.json'),
        HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_PORT=str(port), PYTHONDONTWRITEBYTECODE='1')
    bootstrap = '''
import runpy, sys
def fence(event, args):
    if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
        raise OSError('native birth fixture denies outbound/provider/process effects')
sys.addaudithook(fence)
from api.onboarding import complete_onboarding
complete_onboarding()
runpy.run_path('server.py', run_name='__main__')
'''
    with (home / 'native.log').open('wb') as output:
        process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap], cwd=source, env=env,
            stdout=output, stderr=output, umask=0o077)
        try:
            p = implementation()
            for _ in range(100):
                assert process.poll() is None, 'copied native startup failed'
                try: p.request_json(base, '/health'); break
                except OSError: time.sleep(.1)
            else: raise AssertionError('copied native readiness timeout')
            yield p, home, source, base, env
        finally:
            if process.poll() is None: process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)

@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'explicit native fixture only')
class DurableNativeBirth(unittest.TestCase):
    def test_new_chat_is_saved_empty_once_and_receipt_is_immutable(self):
        with native_fixture() as (p, home, source, base, env):
            state = home / 'state'
            p.create_native_fixture(state, base)
            receipt_path = state / 'rhythm-fixture-chat.json'
            receipt = json.loads(p.protected(receipt_path))
            sid = receipt['hermesSessionId']
            saved_path = state / 'sessions' / (sid + '.json')
            self.assertTrue(saved_path.is_file(), 'supported native creation must have durable birth metadata before SSE')
            saved = json.loads(saved_path.read_text())
            self.assertEqual(saved['session_id'], sid)
            self.assertEqual(saved['profile'], 'default')
            self.assertEqual(saved['title'], 'Rhythm notification disposable fixture')
            self.assertEqual(saved['messages'], [])
            self.assertFalse(saved.get('_metadata_stub', False))
            self.assertEqual(receipt['status'], 'created')
            self.assertEqual(receipt['durableRoute'], '/api/session/rename')
            before = saved_path.read_bytes()
            p.create_native_fixture(state, base)
            self.assertEqual(json.loads(p.protected(receipt_path)), receipt)
            self.assertEqual(saved_path.read_bytes(), before)
            self.assertEqual(session_payloads(state / 'sessions'), {sid: saved})
            # A partial receipt must not mint another conversation or adopt SID.
            p.atomic_json(receipt_path, dict(receipt, status='persisting'))
            with self.assertRaises(ValueError): p.create_native_fixture(state, base)
            self.assertEqual(session_payloads(state / 'sessions'), {sid: saved})
            self.assertEqual(saved_path.read_bytes(), before)
            print(json.dumps(dict(durableBirth='PASS', sameSID=sid, messagesCount=0,
                providerEffects=0, fixture=str(home), nativeCorePins=107, nativeOutputs=7)))

if __name__ == '__main__': unittest.main()
