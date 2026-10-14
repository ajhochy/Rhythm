"""Frozen round-one boundary probes: actual copied native HTTP and renderer."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from .test_native_wakeup import fixture, EVENT, ROOT
from . import host_job as job
from .receiver import encoded


class RepairRound1(unittest.TestCase):
    def test_queued_profile_mutation_cannot_be_erased_to_authorize_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            (home / 'hold-provider').touch()
            with fixture(home) as server:
                self.assertEqual(server.post()[0], 200)
                for _ in range(100):
                    if server.calls():
                        break
                    time.sleep(.1)
                self.assertEqual(len(server.calls()), 1)
                second = {**EVENT, 'eventId': 'queued-profile-event', 'cursor': 2}
                self.assertEqual(server.post(second)[0], 200)
                self.assertEqual(server.post(second, path='status')[1]['state'], 'accepted')
                path = next((home / 'state').rglob('fixture-chat.json'))
                saved = json.loads(path.read_text())
                saved['profile'] = 'foreign-profile'
                path.write_text(json.dumps(saved))
                (home / 'hold-provider').unlink()
                server.wait_reply()
                time.sleep(2.2)
                observed = dict(profile=server.saved()['profile'], providerCalls=len(server.calls()),
                                status=server.post(second, path='status'))
                print('QUEUED_PROFILE', json.dumps(observed))
                self.assertEqual(observed['providerCalls'], 1, observed)
                self.assertEqual(observed['profile'], 'foreign-profile', observed)

    def test_saved_completion_is_not_forever_started(self):
        with tempfile.TemporaryDirectory() as directory:
            with fixture(Path(directory).resolve()) as server:
                self.assertEqual(server.post()[0], 200)
                server.wait_reply()
                receipt = None
                for _ in range(30):
                    code, receipt = server.post(path='status')
                    self.assertEqual(code, 200)
                    if receipt['state'] == 'completed':
                        break
                    time.sleep(.1)
                print('CLOSED_BROWSER_COMPLETION', json.dumps(receipt))
                self.assertEqual(receipt['state'], 'completed', receipt)

    def test_actual_browser_reply_is_unobscured(self):
        dependency = '/Users/ajhochhalter/Documents/Rhythm/apps/web/node_modules/playwright/index.js'
        executable = '/Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'
        evidence = ROOT.parents[2] / 'docs/ai/runs/artifacts/hermes-notify-repair-round1'
        evidence.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            with fixture(home) as server:
                result = subprocess.run(['node', str(ROOT / 'test_repair_visible.mjs'), server.base,
                                         dependency, executable, str(evidence)], cwd=home,
                    env=dict(PATH='/opt/homebrew/bin:' + os.defpath, HOME=str(home), TMPDIR=str(home)),
                    capture_output=True, text=True, timeout=45)
                print(result.stdout)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_exact_five_file_patch_installs_new_files_with_one_fake_restart(self):
        changes = json.loads((ROOT / 'native_patch_manifest.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'source'
            shutil.copytree(ROOT / 'source_snapshot', source)
            subprocess.run(['git', 'apply', '--reverse', str(ROOT / 'native.patch')], cwd=source, check=True)
            # Unified diffs with empty originals leave empty additive files. Only
            # this disposable fixture owns them; the original source is untouched.
            for name, record in changes.items():
                if record['before'] is None:
                    target = source / name
                    if target.exists():
                        self.assertEqual(target.read_bytes(), b'')
                        target.unlink()
            files = []
            for index, (name, record) in enumerate(changes.items()):
                artifact = root / ('artifact-' + str(index))
                artifact.write_bytes((ROOT / 'source_snapshot' / name).read_bytes())
                artifact.chmod(0o600)
                files.append(dict(path=name, operation='create' if record['before'] is None else 'replace',
                                  artifact=str(artifact), beforeHash=record['before'], afterHash=record['after']))
            m = dict(image=job.IMAGE, restartBudget=1, containerId='a' * 64, configDigest='b' * 64,
                     mountedSourceRoot=str(source), files=files, backupDirectory=str(root / 'backup'),
                     hostFacility=dict(kind='nohup', attestedAvailable=True, launchedOnHost=True),
                     readinessArgv=['/usr/bin/curl', '--fail', '--silent', '--max-time', '3',
                                    'http://127.0.0.1:8787/health'], readinessAttestedNoMutation=True,
                     nativeGate=dict(result='PASS', verifier='fixture-independent-verifier',
                                     cases={k: 'PASS' for k in job.GATES}, sourceManifestHash='c' * 64,
                                     evidenceHash='d' * 64, patchSetHash=job.sha(encoded(files).encode())))
            container = dict(Id=m['containerId'], Image=job.IMAGE, State=dict(Running=True),
                             Mounts=[dict(Source=str(source), Destination='/webui', RW=False)])
            with patch.object(job, 'inspect', return_value=(container, m['configDigest'])), \
                    patch.object(job, 'command', return_value=b'') as command:
                try:
                    receipt = job.run(m)
                except ValueError as error:
                    self.fail('Exact native patch rejected before installation: ' + str(error))
            self.assertEqual(receipt['state'], 'installed')
            self.assertEqual(sum(c.args[0][0] == 'docker' for c in command.call_args_list), 1)
            for name, record in changes.items():
                self.assertEqual(job.sha((source / name).read_bytes()), record['after'])


if __name__ == '__main__':
    unittest.main()
