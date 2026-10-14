"""Actual disposable source writes; only Docker inspection/commands are isolated."""
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from . import host_job as job
from .receiver import encoded


class FailureWindows(unittest.TestCase):
    def exercise(self, window=None, rollback_failure=False, second=False, read_only_mount=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'api').mkdir()
            (root / 'static').mkdir()
            files = []
            native = {}
            for index, (name, operation) in enumerate(job.OUTPUTS.items()):
                target = root / name
                if operation == 'REPLACE':
                    target.write_bytes(b'original-' + name.encode())
                artifact = root / (str(index) + '.patch')
                artifact.write_bytes(b'patched-' + name.encode())
                artifact.chmod(0o600)
                info = target.stat() if operation == 'REPLACE' else artifact.stat()
                before = job.sha(target.read_bytes()) if operation == 'REPLACE' else None
                after = job.sha(artifact.read_bytes())
                files.append(dict(path=name, artifact=str(artifact), operation=operation,
                                  expectedAbsent=operation == 'CREATE', beforeHash=before, afterHash=after,
                                  mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid))
                native[name] = dict(before=before, after=after)
            approved = root / 'approved.json'
            approved.write_text(encoded(native))
            approved.chmod(0o600)
            m = dict(image=job.IMAGE, restartBudget=1, containerId='a' * 64,
                     configDigest='b' * 64, mountedSourceRoot=str(root), files=files,
                     backupDirectory=str(root / 'backup'),
                     hostFacility=dict(kind='nohup', attestedAvailable=True, launchedOnHost=True),
                     approvedPatchManifest=str(approved),
                     readiness=dict(kind='docker-health', status='healthy'),
                     nativeGate=dict(result='PASS', verifier='fixture-independent-verifier',
                                     cases={k: 'PASS' for k in job.GATES},
                                     sourceManifestHash=job.sha(approved.read_bytes()), evidenceHash='d' * 64,
                                     patchSetHash=job.sha(encoded(files).encode())))
            container = dict(Id=m['containerId'], Image=job.IMAGE,
                             Config={'Healthcheck': {'Test': ['CMD', 'fixture-health']}},
                             State=dict(Running=True, Health=dict(Status='healthy')),
                             Mounts=[dict(Source=str(root), Destination='/webui', RW=not read_only_mount)])
            real_replace, real_fsync, real_open, real_close = os.replace, os.fsync, os.open, os.close
            injected = False
            commits = 0

            def fail(label):
                nonlocal injected
                if label == window and (not second or commits >= 2) and (not injected or rollback_failure):
                    injected = True
                    raise OSError('injected ' + label)

            def replace(src, dst, **kwargs):
                nonlocal commits
                if Path(dst).name in ('server.py', 'routes.py'):
                    commits += 1
                    fail('replace_before')
                    real_replace(src, dst, **kwargs)
                    fail('replace_after')
                else:
                    real_replace(src, dst, **kwargs)

            def fsync(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode) and commits:
                    fail('fsync')
                real_fsync(fd)

            def opening(path, flags, *args, **kwargs):
                if Path(path) in (root, root / 'api') and commits:
                    fail('open')
                return real_open(path, flags, *args, **kwargs)

            def close(fd):
                directory_fd = stat.S_ISDIR(os.fstat(fd).st_mode)
                real_close(fd)
                if directory_fd and commits:
                    fail('close')

            with patch.object(job, 'inspect', return_value=(container, m['configDigest'])), \
                    patch.object(job, 'command', return_value=b'') as command, \
                    patch.object(job.os, 'replace', side_effect=replace), \
                    patch.object(job.os, 'fsync', side_effect=fsync), \
                    patch.object(job.os, 'open', side_effect=opening), \
                    patch.object(job.os, 'close', side_effect=close):
                receipt = job.run(m)
            if window:
                self.assertTrue(injected)
                command.assert_not_called()
                for f in files:
                    if f['operation'] == 'REPLACE':
                        self.assertEqual(job.sha((root / f['path']).read_bytes()), f['beforeHash'])
                    else:
                        self.assertFalse((root / f['path']).exists())
                self.assertEqual(receipt['state'], 'source_restore_unqualified' if rollback_failure
                                 else 'source_restored_runtime_unqualified')
                self.assertFalse(receipt['restartAttempted'])
            else:
                self.assertEqual(receipt['state'], 'installed')
                self.assertEqual(command.call_args_list[0].args[0], ['docker', 'restart', m['containerId']])
                self.assertEqual(sum(c.args[0][0] == 'docker' for c in command.call_args_list), 1)

    def test_committed_file_restored_after_directory_fsync_failure(self):
        self.exercise('fsync')

    def test_all_pre_restart_failure_windows_restore_without_restart(self):
        for window in ('replace_before', 'replace_after', 'fsync', 'open', 'close'):
            for second in (False, True):
                with self.subTest(window=window, second=second):
                    self.exercise(window, second=second)

    def test_restore_fsync_failure_never_claims_durable_restoration(self):
        self.exercise('fsync', rollback_failure=True)

    def test_positive_preflight_fixture_consumes_only_one_restart(self):
        self.exercise()

    def test_host_write_preflight_accepts_container_readonly_source_mount(self):
        self.exercise(read_only_mount=True)

    def test_atomic_helper_precommit_failure_leaves_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / 'source.py'
            target.write_bytes(b'original')
            info = target.stat()
            with patch.object(job.os, 'fsync', side_effect=OSError('precommit fsync')):
                with self.assertRaises(OSError):
                    job.atomic_replace(target, b'patched', stat.S_IMODE(info.st_mode),
                                       info.st_uid, info.st_gid)
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(list(target.parent.iterdir()), [target])


if __name__ == '__main__':
    unittest.main()
