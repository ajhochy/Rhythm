"""Executor-only synthetic CLI contracts. Retain fixtures; never signal or launch Rhythm."""
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
HELPER = ROOT / 'tools/dev/sandbox_api_recovery.py'
PYTHON = '/usr/bin/python3'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PrepareCLIContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Never accept operator/live PIDs or records. Every inspected PID is a
        # child created here, with natural EOF exit instead of terminate/kill.
        cls.root = pathlib.Path(os.environ['RHYTHM_PID_CONTRACT_ROOT'])
        info = cls.root.lstat()
        if (cls.root.resolve() != cls.root or not str(cls.root).startswith('/private/tmp/rhythm-pid-contract-')
                or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or any(cls.root.iterdir())):
            raise ValueError('requires fresh exclusively owned empty synthetic contract root')
        spec = importlib.util.spec_from_file_location('actual_recovery', HELPER)
        cls.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.helper)
        cls.children = []
        for role in ('api-inspector-fixture', 'holder-inspector-fixture', 'engine-inspector-fixture'):
            child = subprocess.Popen([PYTHON, '-I', '-B', '-c',
                                      'import sys; print("owned-inspector-ready",flush=True); sys.stdin.buffer.read()', role],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            cls.children.append(child)
            if child.stdout.readline() != b'owned-inspector-ready\n':
                raise ValueError('controlled inspector child not ready')
        cls.api, cls.holder, cls.engine = cls.children
        cls.starts = {p.pid: cls.helper.kernel_start(p.pid) for p in cls.children}

    @classmethod
    def tearDownClass(cls):
        for child in cls.children:
            child.stdin.close()
        for child in cls.children:
            child.wait(timeout=10)
            child.stdout.close()
            child.stderr.close()
        # No fixture cleanup, unlink, signal or process-ownership substitution.

    def fixture(self, symlink_record=False):
        sb = pathlib.Path(tempfile.mkdtemp(prefix='inspector-only-', dir=self.root))
        (sb / 'fixture-label.json').write_text(json.dumps({
            'kind': 'SYNTHETIC_PROCESS_INSPECTOR_ONLY', 'coding_authority': False,
            'human_approval': False, 'no_runtime_or_signals': True}))
        binary, store, config = [sb / name for name in ('inert-binary', 'inert-store', 'inert-config')]
        for path in (binary, store, config):
            path.write_bytes(b'synthetic inspector-only inert bytes\n')
        state = {'pid': self.engine.pid, 'start': self.starts[self.engine.pid],
                 'binary': {'path': str(binary)}, 'store': str(store), 'config': {'path': str(config)}}
        record = sb / ('retained-ownership.json' if symlink_record else 'opencode_engine.ownership.json')
        record.write_text(json.dumps({
            'fixture': 'synthetic inspector, not engine/coding authority', 'state': state}))
        if symlink_record:
            (sb / 'opencode_engine.ownership.json').symlink_to(record)
        for name, pid in (('api_server.pid', self.api.pid), ('foreground_holder.pid', self.holder.pid),
                          ('opencode_engine.pid', self.engine.pid)):
            (sb / name).write_text(str(pid) + '\n')
        return sb

    def snapshot(self, sb):
        return {str(p.relative_to(sb)): p.read_bytes() for p in sb.iterdir() if p.is_file()}

    def cli(self, sb, action, *args):
        result = subprocess.run([PYTHON, '-I', '-B', str(HELPER), action, str(sb), *args],
                                capture_output=True, timeout=10)
        # Keep raw diagnostics only inside this exclusively owned local fixture.
        path = sb / ('diagnostic-' + str(len(list(sb.glob('diagnostic-*')))) + '.json')
        with path.open('x') as stream:
            json.dump({'exit': result.returncode, 'stdout': result.stdout.decode(),
                       'stderr': result.stderr.decode()}, stream)
        return result

    def assert_originals(self, sb, original):
        for name, data in original.items():
            self.assertEqual((sb / name).read_bytes(), data)
        for child in self.children:
            self.assertIsNone(child.poll(), 'controlled process was signalled/exited')
            self.assertEqual(self.helper.kernel_start(child.pid), self.starts[child.pid])

    def capture_inspector_intent(self, sb):
        # Negative stable-binding fixtures capture actual owned metadata, not
        # invented current identity. No approval, executable runtime or grant.
        binary, store, config = [sb / name for name in ('inert-binary', 'inert-store', 'inert-config')]
        b, s = binary.stat(), store.stat()
        intent = {'old_api_pid': self.api.pid, 'old_api_start': self.starts[self.api.pid],
                  'holder_pid': self.holder.pid, 'holder_start': self.starts[self.holder.pid],
                  'engine_pid': self.engine.pid, 'engine_start': self.starts[self.engine.pid],
                  'engine_ownership_sha256': digest(sb / 'opencode_engine.ownership.json'),
                  'binary_dev': b.st_dev, 'binary_ino': b.st_ino, 'binary_sha256': digest(binary),
                  'store_dev': s.st_dev, 'store_ino': s.st_ino, 'config_sha256': digest(config),
                  'approval_issued': False, 'fixture': 'synthetic captured inspector binding only'}
        generation = sb / 'lifecycle/api-generation-000001'
        generation.mkdir(parents=True, mode=0o700)
        (generation / 'intent.json').write_text(json.dumps(intent))
        return generation, intent

    def test_canonical_cli_prepare_publishes_actual_integer_identity(self):
        # Regression: CLI strings reach strict kernel_start, creating an empty
        # generation instead of a usable integer-bound recovery intent.
        sb = self.fixture()
        original = self.snapshot(sb)
        result = self.cli(sb, 'prepare', str(self.api.pid))
        self.assertEqual(result.returncode, 0, 'actual canonical CLI prepare must succeed; diagnostics retained')
        generation, intent = self.helper.latest(sb)  # next actual consumer read
        self.assertEqual(generation.name, 'api-generation-000001')
        self.assertIs(type(intent['old_api_pid']), int)
        self.assertEqual(intent['old_api_pid'], self.api.pid)
        self.assertEqual(intent['old_api_start'], self.starts[self.api.pid])
        self.assertEqual(intent['holder_pid'], self.holder.pid)
        self.assertEqual(intent['holder_start'], self.starts[self.holder.pid])
        self.assertEqual(intent['engine_pid'], self.engine.pid)
        self.assertEqual(intent['engine_start'], self.starts[self.engine.pid])
        self.assertEqual(intent['engine_ownership_sha256'], digest(sb / 'opencode_engine.ownership.json'))
        self.assertEqual(intent['binary_sha256'], digest(sb / 'inert-binary'))
        self.assertEqual(intent['config_sha256'], digest(sb / 'inert-config'))
        for label, path in (('binary', sb / 'inert-binary'), ('store', sb / 'inert-store')):
            self.assertEqual((intent[label + '_dev'], intent[label + '_ino']),
                             (path.stat().st_dev, path.stat().st_ino))
        self.assertFalse(intent['approval_issued'])
        self.helper.stable_engine(sb, intent)
        self.assert_originals(sb, original)

    def test_malformed_cli_rejects_before_generation(self):
        # Regression: coercion accepts noncanonical PID or ignores extra args.
        pid = str(self.api.pid)
        invalid = [(), ('',), (pid, 'extra'), (' ' + pid,), (pid + ' ',), ('+' + pid,),
                   ('-' + pid,), ('0' + pid,), ('２',), ('٢',), ('2.0',), ('True',),
                   ('False',), ('0',), ('1',), ('-2',), ('2147483648',), ('9' * 40,)]
        for args in invalid:
            with self.subTest(args=args):
                sb = self.fixture()
                original = self.snapshot(sb)
                result = self.cli(sb, 'prepare', *args)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(b'IndexError', result.stderr, 'missing CLI arg must raise ValueError')
                self.assertFalse(list((sb / 'lifecycle').glob('api-generation-*')))
                self.assert_originals(sb, original)

    def test_direct_kernel_types_remain_strict(self):
        # Regression: fixing CLI broadens the shared kernel API to coerce types.
        for pid in (str(self.api.pid), True, False, float(self.api.pid), None, 0, 1, -1, 2147483648):
            with self.subTest(pid=pid):
                with self.assertRaises(ValueError):
                    self.helper.kernel_start(pid)

    def test_numeric_wrong_pid_and_dead_owned_child_refuse(self):
        # Wrong PID must fail the actual PID-file guard; dead PID must fail the
        # actual kernel lookup, not just mismatching fixture text.
        sb = self.fixture()
        result = self.cli(sb, 'prepare', str(self.holder.pid))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'current API PID changed', result.stderr)
        self.assertFalse(list((sb / 'lifecycle').glob('api-generation-*')))
        child = subprocess.Popen([PYTHON, '-I', '-B', '-c', 'pass'])
        self.assertEqual(child.wait(timeout=10), 0)
        with self.assertRaises(ValueError):
            self.helper.kernel_start(child.pid)
        sb = self.fixture()
        (sb / 'api_server.pid').write_text(str(child.pid) + '\n')
        result = self.cli(sb, 'prepare', str(child.pid))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'kernel process metadata unavailable', result.stderr,
                      'must reach the dead kernel guard, not merely reject CLI type')
        self.assertFalse(list((sb / 'lifecycle').glob('*/intent.json')))

    def test_symlinked_record_and_prior_incomplete_intent_refuse(self):
        # Regression: following a record symlink or automatically retrying an
        # incomplete generation destroys the preserved failure mechanism.
        sb = self.fixture(symlink_record=True)
        record = sb / 'opencode_engine.ownership.json'
        target = sb / 'retained-ownership.json'
        result = self.cli(sb, 'prepare', str(self.api.pid))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'unsafe recovery record', result.stderr)
        self.assertEqual(record.resolve(), target)
        sb = self.fixture()
        generation, _ = self.capture_inspector_intent(sb)
        before = (generation / 'intent.json').read_bytes()
        result = self.cli(sb, 'prepare', str(self.api.pid))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'previous recovery incomplete', result.stderr)
        self.assertEqual((generation / 'intent.json').read_bytes(), before)
        self.assertEqual(len(list((sb / 'lifecycle').glob('api-generation-*'))), 1)

    def test_captured_binding_mismatch_rejected_by_real_cli_consumer(self):
        # Each divergence has a risk-relevant state change. The real next CLI
        # consumer must reject current binary/store/config/PID/start drift.
        for field in ('binary', 'store', 'config', 'holder_start', 'engine_pid', 'api_pid'):
            with self.subTest(field=field):
                sb = self.fixture()
                generation, intent = self.capture_inspector_intent(sb)
                expected = b'engine/store/holder binding changed'
                if field == 'binary':
                    (sb / 'inert-binary').write_bytes(b'changed inert binary bytes\n')
                elif field == 'config':
                    (sb / 'inert-config').write_bytes(b'changed inert config bytes\n')
                elif field == 'store':
                    previous_store = sb / 'retained-inert-store'
                    previous_store.write_bytes(b'synthetic prior store identity\n')
                    # Captured identity is from a different actual retained
                    # inode, never a fabricated current kernel/file identity.
                    intent['store_dev'], intent['store_ino'] = previous_store.stat().st_dev, previous_store.stat().st_ino
                    (generation / 'intent.json').write_text(json.dumps(intent))
                elif field == 'holder_start':
                    intent['holder_start'] = 'mismatching captured start'
                    (generation / 'intent.json').write_text(json.dumps(intent))
                elif field == 'engine_pid':
                    (sb / 'opencode_engine.pid').write_text(str(self.holder.pid) + '\n')
                else:
                    (sb / 'api_server.pid').write_text(str(self.holder.pid) + '\n')
                    result = self.cli(sb, 'prepare', str(self.api.pid))
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(b'current API PID changed', result.stderr)
                    continue
                result = self.cli(sb, 'holder-state', str(self.api.pid))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)


if __name__ == '__main__':
    unittest.main()
