"""Real supported native conversation creation in a copied, fenced WebUI.

This is not a Rhythm dispatch/SSE/browser/ACK test. No provider is installed or
mocked; outbound connections and child processes are denied before imports.
"""
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
import urllib.request

ROOT = Path(__file__).resolve().parent
NATIVE = Path('/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/tools/dev/hermes_webui_receiver')

@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'explicit disposable native HTTP test only')
class NativeProvisionHTTP(unittest.TestCase):
    def test_supported_new_session_is_created_once_by_CLI(self):
        pins = json.loads((NATIVE / 'source_snapshot_manifest.json').read_text())['hashes']
        patch_bytes = (NATIVE / 'native_patch_manifest.json').read_bytes()
        patch = json.loads(patch_bytes)
        self.assertEqual(len(pins), 107)
        self.assertEqual(len(patch), 7)
        expected = dict(pins)
        expected.update({name: record['after'] for name, record in patch.items()})
        with tempfile.TemporaryDirectory(prefix='hermes-provision-native-', dir='/private/tmp') as directory:
            home = Path(directory)
            source = home / 'source'; source.mkdir(mode=0o700)
            for name, digest in expected.items():
                original = NATIVE / 'source_snapshot' / name
                self.assertFalse(original.is_symlink())
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), digest, name)
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original, target)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
            env = dict(PATH=os.defpath, HOME=str(home), HERMES_HOME=str(home / 'hermes'),
                       HERMES_WEBUI_AGENT_DIR=str(home / 'no-agent'),
                       HERMES_CONFIG_PATH=str(home / 'no-config.yaml'),
                       HERMES_WEBUI_STATE_DIR=str(home / 'state'),
                       HERMES_WEBUI_SETTINGS_FILE=str(home / 'settings.json'),
                       HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_PORT=str(port),
                       PYTHONDONTWRITEBYTECODE='1')
            bootstrap = '''
import runpy, sys
def fence(event, args):
    if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
        raise OSError('native fixture denies outbound/provider/process effects')
sys.addaudithook(fence)
from api.onboarding import complete_onboarding
complete_onboarding()
runpy.run_path('server.py', run_name='__main__')
'''
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            base = 'http://127.0.0.1:' + str(port)
            with tempfile.TemporaryFile() as output:
                process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap], cwd=source,
                                           env=env, stdout=output, stderr=output)
                try:
                    for _ in range(100):
                        if process.poll() is not None:
                            output.seek(0); self.fail('copied native failed startup:\n' + output.read().decode())
                        try:
                            opener.open(base + '/health', timeout=.2).close(); break
                        except OSError: time.sleep(.1)
                    else: self.fail('copied native readiness timeout')
                    token = home / 'token'; token.write_text('disposable-only-token'); token.chmod(0o600)
                    command = [sys.executable, '-B', str(ROOT / 'hermes_fixture_provision.py'),
                               '--token-file', str(token), '--state-dir', str(home / 'state'),
                               '--create-native-owned-fixture', '--native-endpoint', base]
                    first = subprocess.run(command, capture_output=True, text=True, timeout=15)
                    self.assertEqual(first.returncode, 0, first.stderr)
                    receipt_path = home / 'state/rhythm-fixture-chat.json'
                    receipt = json.loads(receipt_path.read_text())
                    self.assertEqual(receipt['profile'], 'default')
                    self.assertTrue(receipt['hermesSessionId'])
                    second = subprocess.run(command, capture_output=True, text=True, timeout=15)
                    self.assertEqual(second.returncode, 0, second.stderr)
                    self.assertEqual(json.loads(receipt_path.read_text()), receipt)
                    self.assertNotIn('disposable-only-token', first.stdout + first.stderr)
                    print(json.dumps({'nativeCorePins': len(pins), 'nativeOutputs': len(patch),
                                      'nativeManifestSha256': hashlib.sha256(patch_bytes).hexdigest(),
                                      'supportedNativeCreation': 'PASS', 'providerEffects': 0}))
                finally:
                    if process.poll() is None: process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait(timeout=5)

if __name__ == '__main__': unittest.main()
