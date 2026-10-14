import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from hermes_webui_receiver.test_native_wakeup import EVENT, ROOT, fixture
from hermes_webui_receiver.native_adapter import NativeAdapter


class VisibleReopen(unittest.TestCase):
    def test_closed_browser_foreign_obscured_reopen_actual_adapter_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with fixture(home) as server:
                registry = home / 'state/rhythm-notify-registry.json'
                data = json.loads(registry.read_text())
                token = home / 'relay-token'
                token.write_text('fixture-only-token')
                token.chmod(0o600)
                data['runs'][EVENT['runId']].update(receiverEndpoint=server.base,tokenFile=str(token))
                path = home / 'adapter-registry.json'
                path.write_text(json.dumps(data))
                path.chmod(0o600)
                adapter = NativeAdapter(path, fixture_origin=server.base)
                self.assertIsNone(adapter.deliver(EVENT))
                server.wait_reply()
                time.sleep(1.1)
                self.assertEqual(server.post(path='status')[1]['state'], 'completed')
                result = subprocess.run(['node', str(ROOT/'test_visible_reopen.mjs'), server.base,
                    '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js',
                    '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'],
                    cwd=home,env=dict(PATH='/opt/homebrew/bin:'+os.defpath, HOME=str(home),TMPDIR=str(home)),
                    capture_output=True,text=True,timeout=45)
                print(result.stdout,result.stderr)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr+server.logs())
                self.assertEqual(adapter.deliver(EVENT), dict(version=2,eventId=EVENT['eventId'],
                    runId=EVENT['runId'],hermesSessionId=EVENT['hermesSessionId'],state='visible'))
                self.assertEqual(len(server.calls()),1)


if __name__ == '__main__':
    unittest.main()
