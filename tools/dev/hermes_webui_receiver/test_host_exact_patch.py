"""Frozen exact-plan contract: real disposable files, fake Docker boundary only."""
import copy
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from . import host_job as job
from .receiver import encoded

PATHS = ('server.py', 'api/routes.py', 'api/rhythm_notify.py',
         'api/rhythm_inbox.py', 'api/rhythm_schema.py', 'api/models.py', 'static/ui.js')
REPLACEMENTS = {'server.py', 'api/routes.py', 'api/models.py', 'static/ui.js'}


class ExactPatch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'api').mkdir()
        (self.root / 'static').mkdir()
        self.files = []
        native = {}
        self.originals = {}
        for i, name in enumerate(PATHS):
            target = self.root / name
            old = b'original-' + name.encode() if name in REPLACEMENTS else None
            if old is not None:
                target.write_bytes(old)
                target.chmod(0o640)
                self.originals[name] = (old, target.stat())
            artifact = self.root / ('artifact-' + str(i))
            artifact.write_bytes(b'patch-' + name.encode())
            artifact.chmod(0o600)
            before, after = job.sha(old) if old is not None else None, job.sha(artifact.read_bytes())
            native[name] = dict(before=before, after=after)
            self.files.append(dict(path=name, operation='REPLACE' if old is not None else 'CREATE',
                                   expectedAbsent=old is None, beforeHash=before, afterHash=after,
                                   artifact=str(artifact), mode=0o640,
                                   uid=os.getuid(), gid=os.getgid()))
        self.native = self.root / 'approved.json'
        self.native.write_text(encoded(native))
        self.native.chmod(0o600)
        self.m = dict(image=job.IMAGE, restartBudget=1, containerId='a' * 64,
                      configDigest='b' * 64, mountedSourceRoot=str(self.root), files=self.files,
                      approvedPatchManifest=str(self.native), backupDirectory=str(self.root / 'backup'),
                      hostFacility=dict(kind='nohup', attestedAvailable=True, launchedOnHost=True),
                      readiness=dict(kind='docker-health', status='healthy'),
                      nativeGate=dict(result='PASS', verifier='independent-fixture',
                                      cases={k: 'PASS' for k in job.GATES},
                                      sourceManifestHash=job.sha(self.native.read_bytes()),
                                      evidenceHash='d' * 64, patchSetHash=job.sha(encoded(self.files).encode())))
        self.container = dict(Id=self.m['containerId'], Image=job.IMAGE,
                              Config={'Healthcheck': {'Test': ['CMD', 'fixture-health']}},
                              State=dict(Running=True, Health=dict(Status='healthy')),
                              Mounts=[dict(Source=str(self.root), Destination='/webui', RW=False)])

    def bind(self):
        self.m['nativeGate']['patchSetHash'] = job.sha(encoded(self.m['files']).encode())

    def run_job(self):
        with patch.object(job, 'inspect', return_value=(self.container, self.m['configDigest'])), \
                patch.object(job, 'command', return_value=b'') as commands, \
                patch.object(job.time, 'sleep'):
            result = job.run(self.m)
        return result, commands

    def assert_originals(self):
        for name, (data, original) in self.originals.items():
            target = self.root / name
            self.assertEqual(target.read_bytes(), data)
            current = target.stat()
            self.assertEqual((stat.S_IMODE(current.st_mode), current.st_uid, current.st_gid),
                             (stat.S_IMODE(original.st_mode), original.st_uid, original.st_gid))
        for name in set(PATHS) - REPLACEMENTS:
            self.assertFalse((self.root / name).exists())

    def test_exact_seven_outputs_readonly_mount_backups_and_one_restart(self):
        result, commands = self.run_job()
        self.assertEqual(result['state'], 'installed')
        self.assertEqual(commands.call_args_list[0].args[0], ['docker', 'restart', self.m['containerId']])
        self.assertEqual(commands.call_count, 1)
        for f in self.files:
            target = self.root / f['path']
            self.assertEqual(job.sha(target.read_bytes()), f['afterHash'])
            self.assertEqual((stat.S_IMODE(target.stat().st_mode), target.stat().st_uid, target.stat().st_gid),
                             (f['mode'], f['uid'], f['gid']))
        self.assertEqual((self.root / 'backup/0').read_bytes(), self.originals[PATHS[0]][0])
        self.assertEqual((self.root / 'backup/1').read_bytes(), self.originals[PATHS[1]][0])
        for index, name in enumerate(PATHS):
            if name in REPLACEMENTS:
                self.assertEqual((self.root / 'backup' / str(index)).read_bytes(), self.originals[name][0])
        self.assertEqual({p.name for p in (self.root / 'api').iterdir()},
                         {Path(p).name for p in PATHS if p.startswith('api/')})
        self.assertEqual({p.name for p in (self.root / 'static').iterdir()}, {'ui.js'})

    def test_shell_readiness_is_rejected_before_writes(self):
        self.m['readinessArgv'] = ['/bin/sh', '-c', 'exit 0']
        self.m['readinessAttestedNoMutation'] = True
        with self.assertRaises(ValueError):
            self.run_job()
        self.assert_originals()
        self.assertFalse((self.root / 'backup').exists())

    def test_existing_new_target_is_never_clobbered(self):
        target = self.root / PATHS[2]
        target.write_bytes(b'existing-data')
        with self.assertRaises(ValueError):
            self.run_job()
        self.assertEqual(target.read_bytes(), b'existing-data')
        self.assertFalse((self.root / 'backup').exists())

    def test_backup_parent_symlink_refused_before_writes(self):
        (self.root / 'alias').symlink_to(self.root, target_is_directory=True)
        self.m['backupDirectory'] = str(self.root / 'alias/backup')
        with self.assertRaises(ValueError):
            self.run_job()
        self.assert_originals()

    def test_unapproved_traversal_state_deletion_and_missing_metadata_refused(self):
        mutations = [('path', '../server.py'), ('path', 'state.db'),
                     ('operation', 'DELETE'), ('operation', 'NEW'), ('uid', None),
                     ('mode', 0o777), ('beforeHash', None)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                original = copy.deepcopy(self.m)
                self.m['files'][0][key] = value
                self.bind()
                with self.assertRaises(ValueError):
                    self.run_job()
                self.assert_originals()
                self.assertFalse((self.root / 'backup').exists())
                self.m = original

    def test_approved_manifest_digest_and_exact_path_binding(self):
        self.native.write_text('{}')
        with self.assertRaises(ValueError):
            self.run_job()
        self.assert_originals()

    def test_injected_source_symlink_and_artifact_symlink_refused(self):
        for which in ('source', 'artifact'):
            with self.subTest(which=which):
                path = self.root / PATHS[0] if which == 'source' else Path(self.files[0]['artifact'])
                data = path.read_bytes()
                mode = stat.S_IMODE(path.stat().st_mode)
                path.unlink()
                path.symlink_to(self.native)
                with self.assertRaises(ValueError):
                    self.run_job()
                self.assertFalse((self.root / 'backup').exists())
                path.unlink()
                path.write_bytes(data)
                path.chmod(mode)

    def test_each_partial_file_directory_fsync_restores_bytes_identity_and_absence(self):
        for failure_index in range(len(PATHS)):
            with self.subTest(index=failure_index):
                if failure_index:
                    self.tmp.cleanup()
                    self.setUp()
                real_fsync = os.fsync
                publications = 0
                real_replace, real_link = os.replace, os.link
                injected = False

                def publish(fn, *args, **kwargs):
                    nonlocal publications
                    result = fn(*args, **kwargs)
                    publications += 1
                    return result

                def fsync(fd):
                    nonlocal injected
                    if stat.S_ISDIR(os.fstat(fd).st_mode) and publications == failure_index + 1 and not injected:
                        injected = True
                        raise OSError('partial output directory durability')
                    return real_fsync(fd)

                with patch.object(job.os, 'replace', side_effect=lambda *a, **k: publish(real_replace, *a, **k)), \
                        patch.object(job.os, 'link', side_effect=lambda *a, **k: publish(real_link, *a, **k)), \
                        patch.object(job.os, 'fsync', side_effect=fsync):
                    result, commands = self.run_job()
                self.assertTrue(injected)
                commands.assert_not_called()
                self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
                self.assert_originals()

    def test_readiness_failure_restores_source_not_runtime_no_second_restart(self):
        self.container['State']['Health']['Status'] = 'unhealthy'
        result, commands = self.run_job()
        self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
        self.assertTrue(result['rollbackRestartApprovalRequired'])
        self.assertEqual(commands.call_count, 1)
        self.assert_originals()

    def test_existing_backup_blocks_duplicate_restart(self):
        (self.root / 'backup').mkdir(mode=0o700)
        with self.assertRaises((ValueError, FileExistsError)):
            self.run_job()
        self.assert_originals()


if __name__ == '__main__':
    unittest.main()
