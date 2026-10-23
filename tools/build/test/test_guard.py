import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

GUARD = Path(__file__).resolve().parents[1] / 'guard.py'
REPO = GUARD.parents[2]


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.root = self.base / 'scratch'

    def tearDown(self):
        self.temp.cleanup()

    def argv(self, code, limit=20000, extra=()):
        return [sys.executable, str(GUARD), '--repo', str(self.repo), '--root', str(self.root),
                '--limit-bytes', str(limit), *extra, '--', sys.executable, '-c', code]

    def run_guard(self, code, limit=20000, extra=()):
        return subprocess.run(self.argv(code, limit, extra), capture_output=True, text=True, timeout=10)

    def assert_clean(self):
        self.assertEqual(list(self.root.glob('run-*')), [])

    def test_refuses_before_side_effects(self):
        output = self.repo / 'apps/electron/dist'
        output.mkdir(parents=True)
        (output / 'large').write_bytes(b'x' * 22000)
        result = self.run_guard(f'open({str(self.base / "side")!r}, "w").close()')
        self.assertEqual(result.returncode, 74, result.stderr)
        self.assertFalse((self.base / 'side').exists())
        self.assert_clean()

    def test_mobile_default_outputs_are_budgeted_before_launch(self):
        for name in ('apps/mobile/dist-e2e', 'apps/mobile/ios/build',
                     'apps/mobile/android/app/build'):
            with self.subTest(output=name):
                output = self.repo / name
                output.mkdir(parents=True)
                large = output / 'large'
                large.write_bytes(b'x' * 22000)
                side = self.base / 'side'
                result = self.run_guard(f'open({str(side)!r}, "w").close()')
                self.assertEqual(result.returncode, 74, result.stderr)
                self.assertFalse(side.exists())
                large.unlink()
        self.assert_clean()

    def test_growth_and_cleanup_preserve_source_and_external(self):
        sentinel = self.base / 'external'
        sentinel.write_text('keep')
        source = self.repo / 'source'
        source.write_text('keep source')
        result = self.run_guard('import os,time; from pathlib import Path; '
                                'Path(os.environ["TMPDIR"],"big").write_bytes(b"x"*30000); time.sleep(5)')
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertEqual(source.read_text(), 'keep source')
        self.assert_clean()

    def test_generated_output_and_retained_accounting(self):
        output = self.repo / 'apps/electron/dist'
        code = f'from pathlib import Path; import time; p=Path({str(output)!r}); p.mkdir(parents=True); (p/"big").write_bytes(b"x"*30000); time.sleep(5)'
        self.assertEqual(self.run_guard(code).returncode, 75)
        self.assertTrue((output / 'big').exists())
        self.assertEqual(self.run_guard('raise SystemExit(0)').returncode, 74)
        self.assert_clean()

    def test_temporary_input_symlinks_are_not_followed_or_deleted(self):
        source = self.repo / 'large-source'
        source.write_bytes(b's' * 30000)
        result = self.run_guard('import os,time; from pathlib import Path; '
            f'Path(os.environ["TMPDIR"],"repo").symlink_to({str(self.repo)!r}, target_is_directory=True); '
            'time.sleep(.3)')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(source.read_bytes(), b's' * 30000)
        self.assert_clean()

    def test_temporary_ipc_socket_and_fifo_are_counted_and_cleaned(self):
        result = self.run_guard('import os,socket,time; '
            'os.chdir(os.environ["TMPDIR"]); os.mkfifo("fifo"); '
            's=socket.socket(socket.AF_UNIX); s.bind("socket"); time.sleep(.3)')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_clean()

    def test_ipc_in_registered_output_is_still_refused(self):
        output = self.repo / 'apps/electron/dist'
        output.mkdir(parents=True)
        os.mkfifo(output / 'fifo')
        result = self.run_guard('raise SystemExit(9)')
        self.assertEqual(result.returncode, 74, result.stderr)

    def test_success_failure_receipts_bounded(self):
        for code in (0, 7, 0):
            result = self.run_guard('import os; from pathlib import Path; '
                                    'Path(os.environ["TMPDIR"],"small").write_text("ok"); '
                                    f'raise SystemExit({code})')
            self.assertEqual(result.returncode, code, result.stderr)
            self.assert_clean()
        self.assertEqual(json.loads((self.root / 'latest.json').read_text())['exit'], 0)
        self.assertEqual(json.loads((self.root / 'previous.json').read_text())['exit'], 7)
        self.assertEqual(len(list(self.root.glob('*json'))), 4)

    def test_symlinks_and_invalid_limits(self):
        output = self.repo / 'apps/electron/dist'
        output.mkdir(parents=True)
        (output / 'link').symlink_to(self.base / 'external')
        self.assertEqual(self.run_guard('raise SystemExit(9)').returncode, 74)
        for limit in ('0', '-1', '1.2', 'NaN', str(10 * 1024**3 + 1)):
            self.assertEqual(self.run_guard('raise SystemExit(9)', limit).returncode, 74)

    def test_concurrent_aggregate(self):
        ready = self.base / 'ready'
        first = subprocess.Popen(self.argv('import os,time; from pathlib import Path; '
            'Path(os.environ["TMPDIR"],"first").write_bytes(b"x"*11000); '
            f'Path({str(ready)!r}).touch(); time.sleep(5)'), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.wait_file(ready)
            result = self.run_guard('import os,time; from pathlib import Path; '
                'Path(os.environ["TMPDIR"],"second").write_bytes(b"x"*11000); time.sleep(5)')
            self.assertEqual(result.returncode, 75, result.stderr)
        finally:
            first.terminate()
            first.communicate(timeout=5)
        self.assert_clean()

    def wait_file(self, path):
        deadline = time.monotonic() + 4
        while not path.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(path.exists())

    def test_signal_kills_ignoring_grandchild_after_leader_exit(self):
        pidfile = self.base / 'grandchild'
        grandchild = f'import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path({str(pidfile)!r}).write_text(str(os.getpid())); time.sleep(30)'
        code = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{grandchild!r}]); time.sleep(30)'
        parent = subprocess.Popen(self.argv(code), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.wait_file(pidfile)
            parent.send_signal(signal.SIGTERM)
            parent.communicate(timeout=5)
            self.assertEqual(parent.returncode, 143)
            pid = int(pidfile.read_text())
            probe = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], text=True, capture_output=True)
            self.assertTrue(probe.returncode != 0 or probe.stdout.strip().startswith('Z'), probe.stdout)
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.communicate()
        self.assert_clean()

    def test_nested_guard_and_boolean_no_bypass(self):
        nested = [sys.executable, str(GUARD), '--repo', str(self.repo), '--check-active']
        result = self.run_guard(f'import subprocess; raise SystemExit(subprocess.call({nested!r}))')
        self.assertEqual(result.returncode, 0, result.stderr)
        env = dict(os.environ, RHYTHM_BUILD_TOKEN='true')
        result = subprocess.run([*self.argv('pass')[:-4], '--check-active'], env=env, capture_output=True)
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_nested_node_registers_watch_without_boolean_bypass(self):
        fixture = self.base / 'entry.mjs'
        watched = self.base / 'nested-output'
        watched.mkdir()
        fixture.write_text(f'import {{ensureBuildGuard}} from {str(GUARD.with_name("ensure-guard.mjs"))!r};\n'
            f'await ensureBuildGuard({{repoRoot:{str(self.repo)!r},watch:[{str(watched)!r}]}});\n'
            f'await import("node:fs").then(fs=>fs.writeFileSync({str(watched / "big")!r},Buffer.alloc(30000)));\n'
            'await new Promise(r=>setTimeout(r,5000));')
        code = f'import subprocess; raise SystemExit(subprocess.call(["node",{str(fixture)!r}]))'
        result = self.run_guard(code)
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assert_clean()

    def test_internal_symlinks_hardlinks_and_nested_watch(self):
        output = self.base / 'output'
        output.mkdir()
        (output / 'file').write_bytes(b'x' * 9000)
        os.link(output / 'file', output / 'hardlink')
        (output / 'alias').symlink_to('file')
        result = self.run_guard('pass', extra=('--watch', str(output), '--watch', str(output / 'file')))
        self.assertEqual(result.returncode, 0, result.stderr)
        (output / 'escape').symlink_to(self.base / 'external')
        self.assertEqual(self.run_guard('pass').returncode, 74)

    def test_root_symlink_and_unmarked_root_refused(self):
        self.root.symlink_to(self.repo, target_is_directory=True)
        self.assertEqual(self.run_guard('pass').returncode, 74)
        self.root.unlink()
        self.root.mkdir(mode=0o700)
        self.assertEqual(self.run_guard('pass').returncode, 74)

    def test_leader_exit_still_kills_ignoring_grandchild(self):
        pidfile = self.base / 'orphan'
        grandchild = f'import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path({str(pidfile)!r}).write_text(str(os.getpid())); time.sleep(30)'
        code = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{grandchild!r}]); time.sleep(.15)'
        result = self.run_guard(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.wait_file(pidfile)
        probe = subprocess.run(['ps', '-p', pidfile.read_text(), '-o', 'stat='], capture_output=True, text=True)
        self.assertTrue(probe.returncode != 0 or probe.stdout.strip().startswith('Z'))
        self.assert_clean()

    def test_stale_cleanup_requires_registry_marker_and_dead_group(self):
        self.assertEqual(self.run_guard('pass').returncode, 0)
        state_path = self.root / 'registry.json'
        state = json.loads(state_path.read_text())
        tokens = ['run-' + digit * 24 for digit in '1234']
        for token in tokens:
            path = self.root / token
            path.mkdir()
            run = {'pid': 99999999, 'group': 99999999, 'identity': 'old guard.py'}
            marker = {'owner': 'rhythm-build-scratch-v1', 'token': token,
                      'pid': run['pid'], 'identity': run['identity']}
            if token == tokens[1]:
                run['group'] = os.getpgrp()  # live group cannot be reaped
            if token == tokens[2]:
                marker['identity'] = 'mismatched owner'
            if token != tokens[3]:
                state['runs'][token] = run
            (path / 'run.json').write_text(json.dumps(marker))
            (path / 'sentinel').write_text('preserve unless proven stale')
        unknown = self.root / 'unknown'
        unknown.mkdir()
        (unknown / 'sentinel').write_text('preserve')
        state_path.write_text(json.dumps(state))
        result = self.run_guard('pass')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / tokens[0]).exists())
        for token in tokens[1:]:
            self.assertTrue((self.root / token / 'sentinel').exists())
        self.assertTrue((unknown / 'sentinel').exists())

    def test_output_directory_churn_during_monitoring(self):
        output = self.repo / 'apps/electron/dist'
        code = f"""
from pathlib import Path
import shutil,time
root = Path({str(output)!r})
root.mkdir(parents=True)
# Keep many nested names populated while the supervisor scans them.
for index in range(48):
    path = root / str(index) / 'nested' / 'transient'
    path.mkdir(parents=True)
    (path / 'small').write_bytes(b'x' * 32)
deadline = time.monotonic() + 1.2
count = 0
while time.monotonic() < deadline:
    branch = root / str(count % 48)
    shutil.rmtree(branch)
    branch.write_bytes(b'x')  # briefly replace a directory with a regular file
    branch.unlink()
    path = branch / 'nested' / 'transient'
    path.mkdir(parents=True)
    (path / 'small').write_bytes(b'x' * 32)
    count += 1
(root / 'completed').write_text(str(count))
"""
        result = self.run_guard(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreater(int((output / 'completed').read_text()), 0)
        self.assert_clean()

    def test_concurrent_first_start_publishes_valid_shared_root(self):
        gate = self.base / 'start'
        # Six real supervisors start against the same previously absent root.
        code = f"""
import subprocess,time
from pathlib import Path
while not Path({str(gate)!r}).exists():
    time.sleep(.001)
raise SystemExit(subprocess.call({self.argv('import time; time.sleep(.1)', limit=20000)!r}))
"""
        workers = [subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True) for _ in range(6)]
        gate.touch()
        try:
            for worker in workers:
                _, error = worker.communicate(timeout=10)
                self.assertEqual(worker.returncode, 0, error)
        finally:
            for worker in workers:
                if worker.poll() is None:
                    worker.terminate()
                    worker.communicate(timeout=5)
        self.assertEqual(json.loads((self.root / 'owner.json').read_text()),
                         {'owner': 'rhythm-build-scratch-v1', 'uid': os.getuid()})
        self.assert_clean()

    def test_real_node_and_shell_entrypoint_preflight(self):
        # Explicit watch fixtures exercise Node wrapper without packaging.
        watched = self.base / 'watched'
        watched.write_bytes(b'x' * 22000)
        fixture = self.base / 'entry.mjs'
        fixture.write_text(f'import {{ensureBuildGuard}} from {str(GUARD.with_name("ensure-guard.mjs"))!r};\n'
            f'await ensureBuildGuard({{repoRoot:{str(self.repo)!r},watch:[{str(watched)!r}]}});\n'
            f'await import("node:fs").then(fs=>fs.writeFileSync({str(self.base / "side")!r},"bad"));')
        env = dict(os.environ, RHYTHM_BUILD_ROOT=str(self.root), RHYTHM_BUILD_LIMIT_BYTES='20000')
        result = subprocess.run(['node', str(fixture)], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 74, result.stderr)
        self.assertFalse((self.base / 'side').exists())
        # Actual packager entrypoints refuse before any packaging command.
        for command in (['node', str(REPO / 'apps/electron/scripts/package-mac.mjs')],
                        ['node', str(REPO / 'apps/electron/scripts/build-native-dayflow-wrapper.mjs'), '--out', str(watched)],
                        ['bash', str(REPO / 'tools/release/package_macos.sh')]):
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 74, result.stderr)


if __name__ == '__main__':
    unittest.main()
