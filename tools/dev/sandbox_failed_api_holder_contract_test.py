"""LIVE executor-only stock stop contract. No engine/API launch or direct signals."""
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'external owned failed-API cohort required')
class FailedApiHolderContract(unittest.TestCase):
    def test_stock_down_requests_owned_holder_and_observes_normal_ack(self):
        # Regression: stop writes shutdown.requested only while API is alive;
        # dead API + owned live holder therefore never observes normal shutdown.
        self.assertEqual(os.environ.get('RHYTHM_STAGE_A_FAILED_API_COHORT'), '1')
        self.assertEqual(os.environ.get('RHYTHM_SANDBOX_PRESERVE_FILES'), '1')
        sb = pathlib.Path(os.environ['RHYTHM_SANDBOX_DIR'])
        self.assertTrue(str(sb).startswith('/private/tmp/rhythm-coordinator-qualification-sandbox-'))
        self.assertEqual(sb.resolve(), sb)
        self.assertEqual(sb.stat().st_uid, os.getuid())
        self.assertEqual(stat.S_IMODE(sb.stat().st_mode), 0o700)
        self.assertEqual([os.environ.get('RHYTHM_SANDBOX_' + name + '_PORT')
                          for name in ('API', 'ENGINE', 'GATEWAY')], ['4798', '4797', '4799'])
        spec = importlib.util.spec_from_file_location('actual_recovery', ROOT / 'tools/dev/sandbox_api_recovery.py')
        recovery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(recovery)
        preserved = {}
        for name in ('api_server.pid', 'opencode_engine.pid', 'opencode_engine.ownership.json', 'foreground_holder.pid'):
            p = sb / name
            self.assertTrue(p.is_file() and not p.is_symlink())
            self.assertEqual(p.stat().st_uid, os.getuid())
            preserved[name] = p.read_bytes()
        holder_pid = int(preserved['foreground_holder.pid'])
        holder_start = recovery.kernel_start(holder_pid)  # actual ownUID/current start
        recovery.kernel_arguments_match(holder_pid, ['up', '--foreground'])
        api_pid = int(preserved['api_server.pid'])
        with self.assertRaises(ValueError):
            recovery.kernel_start(api_pid)  # refuse a still-live API; no test-induced API kill
        engine_pid = int(preserved['opencode_engine.pid'])
        recovery.kernel_start(engine_pid)
        self.assertFalse((sb / 'shutdown.requested').exists())
        self.assertFalse((sb / 'shutdown.acknowledged').exists())
        # Invoke the current real launcher validator; no ownership mocks. This
        # checks actual engine UID/start/argv/executable/config/store provenance.
        validated = subprocess.run(['/bin/bash', '-c',
                                    'source tools/dev/sandbox.sh; sandbox_ownership validateSandboxEngineOwnership'],
                                   cwd=ROOT, capture_output=True, timeout=15)
        self.assertEqual(validated.returncode, 0, 'real engine provenance prerequisite failed')
        self.assertEqual(recovery.kernel_start(holder_pid), holder_start)
        result = subprocess.run(['/bin/bash', 'tools/dev/sandbox.sh', 'down'],
                                cwd=ROOT, capture_output=True, timeout=90)
        diagnostic = sb / 'stage-A-holder-stop-diagnostic.json'
        with diagnostic.open('x') as stream:
            json.dump({'exit': result.returncode, 'stdout': result.stdout.decode(),
                       'stderr': result.stderr.decode()}, stream)
        self.assertEqual(result.returncode, 0, 'stock owned stop failed; diagnostics retained')
        requested = sb / 'shutdown.requested'
        self.assertTrue(requested.is_file() and not requested.is_symlink(),
                        'dead-API stop omitted the exclusive holder request')
        self.assertEqual(requested.stat().st_uid, os.getuid())
        ack = sb / 'shutdown.acknowledged'
        self.assertTrue(ack.is_file() and not ack.is_symlink(), 'owned holder did not acknowledge normal shutdown')
        for _ in range(50):
            try:
                recovery.kernel_start(holder_pid)
            except ValueError:
                break
            time.sleep(0.1)
        else:
            self.fail('owned foreground holder survived normal acknowledgement')
        for name, value in preserved.items():
            self.assertEqual((sb / name).read_bytes(), value, 'stop replaced retained provenance')
        print(json.dumps({'stage_A_holder_stop': 'PASS', 'original_records_retained': True,
                          'direct_test_signals': 0, 'launches': 0}))


if __name__ == '__main__':
    unittest.main()
