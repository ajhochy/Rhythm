"""Frozen CLI criterion, runnable with protected operator-owned sandbox references.

Independent parent prepares real copied native HTTP + supported bridge fixture;
this test never supplies a surrogate API or receiver. No production endpoints.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'owned fixture only')
class ExecuteCLI(unittest.TestCase):
    def test_supported_dispatch_publishes_actual_native_link(self):
        manifest = Path(os.environ['HERMES_CLI_APPROVED_MANIFEST'])
        data = json.loads(manifest.read_text())
        command = [sys.executable, '-B', str(Path(__file__).with_name('hermes_fixture_provision.py')),
                   '--token-file', data['tokenFile'], '--state-dir', data['stateDir'],
                   '--api', 'http://127.0.0.1:4898', '--execute-owned-fixture',
                   '--approved-fixture-manifest', str(manifest),
                   '--bridge-capability-file', data['bridgeCapabilityFile'],
                   '--native-source', data['nativeSource'], '--native-endpoint', data['nativeEndpoint']]
        result = subprocess.run(command, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary['status'], 'PROVISIONED')
        registry = json.loads((Path(data['stateDir']) / 'rhythm-notify-registry.json').read_text())
        binding = registry['runs'][summary['runId']]['binding']
        self.assertEqual(binding['owner'], '1')
        self.assertEqual(binding['profile'], 'default')
        receipt = json.loads((Path(data['stateDir']) / 'rhythm-fixture-chat.json').read_text())
        self.assertEqual(binding['hermesSessionId'], receipt['hermesSessionId'])
        self.assertEqual(binding['sessionId'], summary['sessionId'])
        self.assertNotIn(Path(data['tokenFile']).read_text().strip(), result.stdout + result.stderr)
        second = subprocess.run(command, capture_output=True, text=True, timeout=90)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(json.loads(second.stdout)['runId'], summary['runId'])

if __name__ == '__main__': unittest.main()
