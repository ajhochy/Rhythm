"""Host job offline validation only; never imports docker or starts containers."""
import importlib.util
import copy
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from . import host_job as job
from . import test_host_exact_patch as exact


class HostJobContract(unittest.TestCase):
    def test_missing_native_gate_and_host_metadata_deny_install_plan(self):
        self.assertIsNotNone(importlib.util.find_spec('hermes_webui_receiver.host_job'),
                             'guarded host job not implemented')
        from hermes_webui_receiver.host_job import validate_manifest
        for manifest in ({}, {'nativeGate': {'result': 'PASS'}},
                         {'nativeGate': {'result': 'PASS'}, 'restartBudget': 2}):
            with self.assertRaises(ValueError):
                validate_manifest(manifest)


class HostHardening(unittest.TestCase):
    setUp = exact.ExactPatch.setUp
    bind = exact.ExactPatch.bind
    run_job = exact.ExactPatch.run_job
    assert_originals = exact.ExactPatch.assert_originals

    def test_seven_metadata_boundaries_and_both_source_parent_symlinks(self):
        for f in self.files:
            for key in ('mode', 'uid', 'gid', 'expectedAbsent', 'operation'):
                with self.subTest(path=f['path'], key=key):
                    saved = copy.deepcopy(self.m)
                    spec = next(x for x in self.m['files'] if x['path'] == f['path'])
                    del spec[key]
                    self.bind()
                    self.refuse()
                    self.m = saved
        for name in ('api', 'static'):
            with self.subTest(parent=name):
                moved = self.root / ('old-' + name)
                (self.root / name).rename(moved)
                (self.root / name).symlink_to(moved, target_is_directory=True)
                with self.assertRaises(ValueError):
                    self.run_job()
                self.assertFalse((self.root / 'backup').exists())
                (self.root / name).unlink()
                moved.rename(self.root / name)
                self.assert_originals()

    def test_readiness_config_image_and_root_drift_restores_all_seven(self):
        for drift in ('config', 'image', 'root'):
            with self.subTest(drift=drift):
                if drift != 'config':
                    self.tmp.cleanup()
                    self.setUp()
                changed = copy.deepcopy(self.container)
                if drift == 'image':
                    changed['Image'] = 'sha256:' + 'e' * 64
                if drift == 'root':
                    changed['Mounts'][0]['Source'] += '-foreign'
                with patch.object(job, 'inspect', side_effect=[
                        (self.container, self.m['configDigest']),
                        (self.container, self.m['configDigest']),
                        (changed, 'e' * 64)]), patch.object(job, 'command') as commands:
                    result = job.run(self.m)
                self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
                self.assertTrue(result['rollbackRestartApprovalRequired'])
                self.assertEqual(commands.call_count, 1)
                self.assert_originals()

    def test_foreign_created_targets_never_removed_during_rollback(self):
        for f in self.files:
            if f['operation'] != 'CREATE':
                continue
            with self.subTest(path=f['path']):
                if (self.root / 'backup').exists():
                    self.tmp.cleanup()
                    self.setUp()
                target = self.root / f['path']

                def command(*a, **kw):
                    foreign = self.root / 'foreign'
                    foreign.write_bytes(b'foreign-owned')
                    os.replace(foreign, target)
                    raise RuntimeError('ambiguous fake restart')

                with patch.object(job, 'inspect', return_value=(self.container, self.m['configDigest'])), \
                        patch.object(job, 'command', side_effect=command) as commands:
                    result = job.run(self.m)
                self.assertEqual(result['state'], 'source_restore_unqualified')
                self.assertEqual(target.read_bytes(), b'foreign-owned')
                self.assertTrue(result['restartAttempted'])
                self.assertEqual(commands.call_count, 1)
                for name, (data, original) in self.originals.items():
                    self.assertEqual((self.root / name).read_bytes(), data)
                    self.assertEqual((self.root / name).stat().st_mode, original.st_mode)

    def refuse(self):
        with patch.object(job, 'inspect', return_value=(self.container, self.m['configDigest'])), \
                patch.object(job, 'command') as commands:
            with self.assertRaises((ValueError, OSError)):
                job.run(self.m)
            commands.assert_not_called()
        self.assert_originals()
        self.assertFalse((self.root / 'backup').exists())

    def test_unsupported_readiness_programs_and_health_fields(self):
        for readiness in (dict(kind='argv', argv=['/bin/sh', '-c', 'exit 0']),
                          dict(kind='argv', argv=['/usr/bin/python3', '-c', 'print(1)']),
                          dict(kind='http', url='http://secret@127.0.0.1/health'),
                          dict(kind='docker-health', status='healthy', command='id'),
                          dict(kind='docker-health', status='running')):
            with self.subTest(readiness=readiness):
                self.m['readiness'] = readiness
                self.refuse()

    def test_every_missing_metadata_and_injected_delete_field(self):
        for key in ('uid', 'gid', 'mode', 'operation', 'expectedAbsent', 'beforeHash', 'afterHash'):
            with self.subTest(key=key):
                saved = copy.deepcopy(self.m)
                del self.m['files'][2][key]
                self.bind()
                self.refuse()
                self.m = saved
        self.m['deleteState'] = True
        self.refuse()

    def test_exact_plan_rejects_missing_extra_duplicate_and_unlisted_outputs(self):
        for change in ('missing', 'extra', 'duplicate', 'unlisted'):
            with self.subTest(change=change):
                saved = copy.deepcopy(self.m)
                if change == 'missing':
                    self.m['files'].pop()
                elif change == 'extra':
                    self.m['files'].append(copy.deepcopy(self.files[0]))
                elif change == 'duplicate':
                    self.m['files'][2]['path'] = self.m['files'][1]['path']
                else:
                    self.m['files'][2]['path'] = 'api/injected.py'
                self.bind()
                self.refuse()
                self.m = saved

    def test_backup_traversal_unsafe_parent_and_existing_symlink(self):
        self.m['backupDirectory'] = str(self.root) + '/../backup'
        self.refuse()
        self.m['backupDirectory'] = str(self.root / 'backup')
        self.root.chmod(0o755)
        self.refuse()
        self.root.chmod(0o700)
        (self.root / 'backup').symlink_to(self.native)
        with self.assertRaises(ValueError):
            self.run_job()
        self.assert_originals()
        self.assertTrue((self.root / 'backup').is_symlink())

    def test_last_artifact_hash_or_mode_mismatch_prevents_any_write(self):
        artifact = Path(self.files[-1]['artifact'])
        original = artifact.read_bytes()
        artifact.write_bytes(b'unapproved')
        self.refuse()
        artifact.write_bytes(original)
        artifact.chmod(0o644)
        self.refuse()

    def test_all_source_metadata_and_content_verified_before_backups(self):
        target = self.root / exact.PATHS[1]
        target.chmod(0o600)
        with self.assertRaises(ValueError):
            self.run_job()
        self.assertFalse((self.root / 'backup').exists())
        target.chmod(0o640)
        target.write_bytes(b'changed-original')
        with self.assertRaises(ValueError):
            self.run_job()
        self.assertFalse((self.root / 'backup').exists())

    def test_create_symlink_and_hardlinked_artifact_never_written(self):
        target = self.root / exact.PATHS[2]
        target.symlink_to(self.native)
        with self.assertRaises(ValueError):
            self.run_job()
        self.assertTrue(target.is_symlink())
        target.unlink()
        os.link(self.files[-1]['artifact'], self.root / 'artifact-alias')
        self.refuse()

    def test_create_race_preserves_foreign_inode_and_marks_restore_unqualified(self):
        real_atomic = job.atomic_replace
        foreign = self.root / exact.PATHS[2]
        injected = False

        def atomic(target, *args, **kwargs):
            nonlocal injected
            if kwargs.get('create') and not injected:
                injected = True
                foreign.write_bytes(b'foreign-data')
            return real_atomic(target, *args, **kwargs)

        with patch.object(job, 'atomic_replace', side_effect=atomic):
            result, commands = self.run_job()
        self.assertEqual(result['state'], 'source_restore_unqualified')
        self.assertEqual(foreign.read_bytes(), b'foreign-data')
        commands.assert_not_called()
        for name, (data, _) in self.originals.items():
            self.assertEqual((self.root / name).read_bytes(), data)

    def test_link_committed_then_error_removes_only_our_created_file(self):
        real_link = os.link
        injected = False

        def link(*args, **kwargs):
            nonlocal injected
            result = real_link(*args, **kwargs)
            if not injected:
                injected = True
                raise OSError('link committed then raised')
            return result

        with patch.object(job.os, 'link', side_effect=link):
            result, commands = self.run_job()
        self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
        self.assert_originals()
        commands.assert_not_called()

    def test_create_removal_durability_failure_is_truthful(self):
        real_atomic, real_fsync = job.atomic_replace, job.fsync_directory

        def atomic(target, *args, **kwargs):
            result = real_atomic(target, *args, **kwargs)
            if kwargs.get('create'):
                raise OSError('create committed')
            return result

        def fsync(path, *args):
            if Path(path) == self.root / 'api':
                raise OSError('removal directory fsync failed')
            return real_fsync(path, *args)

        with patch.object(job, 'atomic_replace', side_effect=atomic), \
                patch.object(job, 'fsync_directory', side_effect=fsync):
            result, commands = self.run_job()
        self.assertEqual(result['state'], 'source_restore_unqualified')
        self.assert_originals()
        commands.assert_not_called()

    def test_source_artifact_and_backup_chain_races_prevent_restart(self):
        for which in ('source', 'artifact', 'backup'):
            with self.subTest(which=which):
                if which != 'source':
                    self.tmp.cleanup()
                    self.setUp()
                real_mkdir = os.mkdir
                moved = self.root / 'old-api'

                def mkdir(path, *args, **kwargs):
                    result = real_mkdir(path, *args, **kwargs)
                    if str(path) == 'backup':
                        if which == 'source':
                            (self.root / 'api').rename(moved)
                            (self.root / 'api').symlink_to(moved, target_is_directory=True)
                        elif which == 'artifact':
                            Path(self.files[0]['artifact']).write_bytes(b'changed')
                        else:
                            (self.root / 'backup').rename(self.root / 'old-backup')
                            (self.root / 'backup').symlink_to(self.root / 'old-backup', target_is_directory=True)
                    return result

                with patch.object(job.os, 'mkdir', side_effect=mkdir), \
                        patch.object(job, 'inspect', return_value=(self.container, self.m['configDigest'])), \
                        patch.object(job, 'command') as commands:
                    if which == 'backup':
                        with self.assertRaises(ValueError):
                            job.run(self.m)
                    else:
                        result = job.run(self.m)
                        self.assertIn(result['state'], ('source_restore_unqualified', 'source_restored_runtime_unqualified'))
                    commands.assert_not_called()

    def test_configuration_drift_restores_without_restart(self):
        with patch.object(job, 'inspect', side_effect=[(self.container, self.m['configDigest']),
                                                       (self.container, 'e' * 64)]), \
                patch.object(job, 'command') as commands:
            result = job.run(self.m)
        self.assertEqual(result['state'], 'source_restored_runtime_unqualified')
        self.assertFalse(result['restartAttempted'])
        self.assert_originals()
        commands.assert_not_called()

    def test_unattempted_source_race_is_preserved_not_claimed_restored(self):
        real_mkdir = os.mkdir
        target = self.root / exact.PATHS[0]

        def mkdir(path, *args, **kwargs):
            result = real_mkdir(path, *args, **kwargs)
            if str(path) == 'backup':
                target.write_bytes(b'foreign-source-change')
            return result

        with patch.object(job.os, 'mkdir', side_effect=mkdir):
            result, commands = self.run_job()
        self.assertEqual(result['state'], 'source_restore_unqualified')
        self.assertEqual(target.read_bytes(), b'foreign-source-change')
        self.assertFalse(result['restartAttempted'])
        commands.assert_not_called()


if __name__ == '__main__':
    unittest.main()
