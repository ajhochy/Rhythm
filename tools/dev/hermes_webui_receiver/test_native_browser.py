import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from .test_native_wakeup import fixture, ROOT


class NativeBrowser(unittest.TestCase):
    def test_existing_frontend_live_reopen_and_foreign_chat_dom(self):
        dependency = '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js'
        executable = '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'
        self.assertTrue(Path(dependency).is_file(), 'installed browser dependency absent')
        self.assertTrue(Path(executable).is_file(), 'installed Chromium binary absent')
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            with fixture(home) as server:
                result = subprocess.run(['node', str(ROOT / 'test_native_dom.mjs'), server.base,
                                         dependency, executable], cwd=home,
                    env=dict(PATH='/opt/homebrew/bin:' + os.defpath, HOME=str(home),
                             TMPDIR=str(home)), capture_output=True, text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr + server.logs())
                self.assertIn('"liveDOM":"PASS"', result.stdout)
                self.assertEqual(len(server.calls()), 1)
                print(result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
