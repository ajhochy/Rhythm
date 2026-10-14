"""Frozen actual-seven host contract. Docker only is fake; no native runtime gate."""
import copy
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from . import host_job as job
from .receiver import encoded

ROOT = Path(__file__).resolve().parent
MANIFEST_HASH = '997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0'
EXPECTED = {'server.py': 'REPLACE', 'api/routes.py': 'REPLACE',
            'api/models.py': 'REPLACE', 'static/ui.js': 'REPLACE',
            'api/rhythm_notify.py': 'CREATE', 'api/rhythm_inbox.py': 'CREATE',
            'api/rhythm_schema.py': 'CREATE'}


class NativeManifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / 'source'
        shutil.copytree(ROOT / 'source_snapshot', self.source)
        subprocess.run(['git', 'apply', '--reverse', str(ROOT / 'native.patch')],
                       cwd=self.source, check=True, capture_output=True)
        pins = json.loads((ROOT / 'source_snapshot_manifest.json').read_text())['hashes']
        self.assertEqual(len(pins), 107)
        for name, digest in pins.items():
            self.assertEqual(job.sha((self.source / name).read_bytes()), digest, name)
        raw = (ROOT / 'native_patch_manifest.json').read_bytes()
        self.assertEqual(job.sha(raw), MANIFEST_HASH)
        self.native = json.loads(raw)
        self.assertEqual(set(self.native), set(EXPECTED))
        # Reverse empty-original diffs leave empty files, not deployed objects.
        # Fixture-only repair: assert empty before removing our disposable copy.
        for name, operation in EXPECTED.items():
            if operation == 'CREATE':
                target = self.source / name
                if target.exists():
                    self.assertEqual(target.read_bytes(), b'')
                    target.unlink()
        self.originals = self.tree()
        artifacts = self.root / 'artifacts'
        artifacts.mkdir(mode=0o700)
        approved = artifacts / 'approved.json'
        approved.write_bytes(raw)
        approved.chmod(0o600)
        files = []
        for i, (name, op) in enumerate(EXPECTED.items()):
            artifact = artifacts / str(i)
            artifact.write_bytes((ROOT / 'source_snapshot' / name).read_bytes())
            artifact.chmod(0o600)
            self.assertEqual(job.sha(artifact.read_bytes()), self.native[name]['after'])
            info = (self.source / name).stat() if op == 'REPLACE' else artifact.stat()
            files.append(dict(path=name, operation=op, expectedAbsent=op == 'CREATE',
                              beforeHash=self.native[name]['before'], afterHash=self.native[name]['after'],
                              artifact=str(artifact), mode=stat.S_IMODE(info.st_mode),
                              uid=info.st_uid, gid=info.st_gid))
        self.m = dict(image=job.IMAGE, restartBudget=1, containerId='a' * 64,
                      configDigest=None, mountedSourceRoot=str(self.source),
                      approvedPatchManifest=str(approved), backupDirectory=str(self.root / 'backup'),
                      files=files, readiness=dict(kind='docker-health', status='healthy'),
                      hostFacility=dict(kind='nohup', attestedAvailable=True, launchedOnHost=True),
                      nativeGate=dict(result='PASS', verifier='OFFLINE-FAKE-NOT-NATIVE-ATTESTATION',
                                      cases={k: 'PASS' for k in job.GATES},
                                      sourceManifestHash=MANIFEST_HASH, evidenceHash='d' * 64,
                                      patchSetHash=job.sha(encoded(files).encode())))
        self.container = dict(Id=self.m['containerId'], Image=job.IMAGE,
                              Config={'Healthcheck': {'Test': ['CMD', 'fixture-health']}}, HostConfig={},
                              State=dict(Running=True, Health=dict(Status='healthy')),
                              Mounts=[dict(Source=str(self.source), Destination='/webui', RW=False)])
        self.m['configDigest'] = job.sha(encoded({k: self.container[k] for k in
                                               ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}).encode())
        self.calls = []

    def tree(self):
        return {p.relative_to(self.source).as_posix():
                (p.read_bytes(), stat.S_IMODE(p.stat().st_mode), p.stat().st_uid, p.stat().st_gid)
                for p in self.source.rglob('*') if p.is_file()}

    def docker(self, argv, timeout=30):
        self.calls.append(argv)
        if argv == ['docker', 'inspect', self.m['containerId']]:
            return json.dumps([self.container]).encode()
        self.assertEqual(argv, ['docker', 'restart', self.m['containerId']])
        return b''

    def run_fake(self):
        with patch.object(job, 'command', side_effect=self.docker), patch.object(job.time, 'sleep'):
            return job.run(self.m)

    def test_actual_seven_plan_dry_validation_and_full_install(self):
        self.assertEqual(job.OUTPUTS, EXPECTED)
        self.assertIs(job.validate_manifest(self.m), self.m)
        self.assertEqual(self.tree(), self.originals)
        self.assertEqual(self.calls, [])
        result = self.run_fake()
        self.assertEqual(result['state'], 'installed')
        self.assertEqual(self.calls.count(['docker', 'restart', self.m['containerId']]), 1)
        after = self.tree()
        self.assertEqual(set(after), set(self.originals) | set(EXPECTED))
        for name, original in self.originals.items():
            self.assertEqual(after[name][1:], original[1:])
            if name not in EXPECTED:
                self.assertEqual(after[name], original)
        for f in self.m['files']:
            self.assertEqual(job.sha(after[f['path']][0]), f['afterHash'])
            self.assertEqual(after[f['path']][1:], (f['mode'], f['uid'], f['gid']))
        with self.assertRaises(ValueError):
            self.run_fake()
        self.assertEqual(self.calls.count(['docker', 'restart', self.m['containerId']]), 1)

    def test_all_seven_publication_faults_restore_exact_tree(self):
        real = job.atomic_replace
        for index in range(7):
            with self.subTest(index=index):
                if index:
                    self.tmp.cleanup()
                    self.setUp()
                target_name = self.m['files'][index]['path']
                injected = False

                def atomic(target, *a, **kw):
                    nonlocal injected
                    result = real(target, *a, **kw)
                    if target == self.source / target_name and not injected:
                        injected = True
                        raise OSError('publication committed before failure')
                    return result

                with patch.object(job, 'atomic_replace', side_effect=atomic):
                    result = self.run_fake()
                self.assertTrue(injected)
                self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
                self.assertFalse(result['restartAttempted'])
                self.assertEqual(self.tree(), self.originals)
                self.assertTrue(all(c[1] == 'inspect' for c in self.calls))

    def test_all_create_targets_no_clobber(self):
        for name, op in EXPECTED.items():
            if op != 'CREATE':
                continue
            with self.subTest(name=name):
                target = self.source / name
                target.write_bytes(b'foreign-existing')
                before = self.tree()
                with self.assertRaises(ValueError):
                    self.run_fake()
                self.assertEqual(self.tree(), before)
                self.assertFalse((self.root / 'backup').exists())
                target.unlink()

    def test_missing_or_disabled_docker_health_stops_before_writes(self):
        for config, state in [({}, self.container['State']),
                              ({'Healthcheck': {'Test': ['NONE']}}, self.container['State']),
                              (self.container['Config'], {'Running': True})]:
            with self.subTest(config=config, state=state):
                self.container['Config'], self.container['State'] = config, state
                self.m['configDigest'] = job.sha(encoded({k: self.container[k] for k in
                    ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}).encode())
                with self.assertRaises(ValueError):
                    self.run_fake()
                self.assertEqual(self.tree(), self.originals)
                self.assertFalse((self.root / 'backup').exists())

    def test_actual_template_never_fabricates_host_or_native_attestation(self):
        template = job.pending_manifest_template(ROOT)
        guard = json.loads((ROOT / 'source_guard.json').read_text())
        self.assertEqual(template['image'], guard['image'])
        self.assertEqual(template['containerId'], guard['containerId'])
        self.assertEqual(template['mountedSourceRoot'], guard['mountedSourceRoot'])
        self.assertIsNone(template['configDigest'])
        self.assertEqual(template['nativeGate']['result'], 'NOTRUN')
        self.assertEqual(template['nativeGate']['sourceManifestHash'], MANIFEST_HASH)
        self.assertIsNot(template['hostFacility']['attestedAvailable'], True)
        self.assertIsNot(template['hostFacility']['launchedOnHost'], True)
        self.assertEqual({f['path'] for f in template['files']}, set(EXPECTED))
        for f in template['files']:
            self.assertEqual((f['beforeHash'], f['afterHash']),
                             (self.native[f['path']]['before'], self.native[f['path']]['after']))
            self.assertTrue(all(f[k] is None for k in ('uid', 'gid', 'mode', 'artifact')))
        with patch.object(job, 'command') as commands:
            with self.assertRaises(ValueError):
                job.run(template)
            commands.assert_not_called()


if __name__ == '__main__':
    unittest.main()
