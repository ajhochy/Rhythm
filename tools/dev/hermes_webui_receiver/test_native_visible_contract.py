"""Actual renderer-to-native receipt acceptance; no DOM or ACK seeding."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

from hermes_webui_receiver.test_native_wakeup import EVENT, ROOT, fixture


class NativeVisibleContract(unittest.TestCase):
    def test_actual_unobscured_renderer_qualifies_exact_native_visible_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            evidence = Path(os.environ.get('RHYTHM_NATIVE_EVIDENCE_DIR', directory)).resolve()
            self.assertTrue(evidence.is_dir(), 'Evidence directory must already exist')
            with fixture(home) as server:
                result = subprocess.run([
                    'node', str(ROOT / 'test_repair_visible.mjs'), server.base,
                    '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js',
                    '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
                    str(evidence)], cwd=home,
                    env=dict(PATH='/opt/homebrew/bin:' + os.defpath, HOME=str(home), TMPDIR=str(home)),
                    capture_output=True, text=True, timeout=45)
                print(result.stdout, result.stderr)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                server.wait_reply()
                code, receipt = server.post(path='status')
                for _ in range(30):
                    if receipt.get('state') == 'visible':
                        break
                    time.sleep(.1)
                    code, receipt = server.post(path='status')
                print('ACTUAL_RENDERER_NATIVE_RECEIPT', json.dumps(receipt, sort_keys=True))
                self.assertEqual(code, 200)
                self.assertEqual(receipt, dict(version=2, eventId=EVENT['eventId'],
                    runId=EVENT['runId'], hermesSessionId=EVENT['hermesSessionId'], state='visible'))


if __name__ == '__main__':
    unittest.main()
