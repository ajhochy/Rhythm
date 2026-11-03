"""Real launcher intake contract; never builds/executes native/API/MCP or cleans up."""
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/ai/runs/evidence/coordinator-preserving-launcher-intake-audit108-v2.json'
GUARD = '(version 1) (allow default) (deny file-write-unlink) (deny network*)'


class IntakeContract(unittest.TestCase):
    def test_generated_payload_source_freeze_without_compiling(self):
        # Regression: launcher silently mutates frozen API/MCP input bytes or
        # replaces an earlier generated-input receipt while recording build PASS.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-payload-freeze-', dir='/private/tmp'))
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'}
        for stage in ['before', 'after']:
            result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, 'python3', '-I',
                                     'tools/dev/sandbox_prebuilt_intake.py', 'payload-snapshot', str(ROOT), str(parent), stage],
                                    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            (parent / (stage + '.stderr')).write_bytes(result.stderr)
            self.assertEqual(result.returncode, 0)
        before = (parent / 'payload-inputs-before.json').read_bytes()
        self.assertEqual(json.loads(before), json.loads((parent / 'payload-inputs-after.json').read_bytes()))
        rejected = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, 'python3', '-I',
                                   'tools/dev/sandbox_prebuilt_intake.py', 'payload-snapshot', str(ROOT), str(parent), 'before'],
                                  cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual((parent / 'payload-inputs-before.json').read_bytes(), before)

    def test_unqualified_and_unsafe_intake_rejected(self):
        # Regression: skip/manifest flags select arbitrary binaries/live ports or
        # silently fall back to a build when qualification input is malformed.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-intake-denials-', dir='/private/tmp'))
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
               'RHYTHM_SANDBOX_DIR': str(parent), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
               'RHYTHM_SANDBOX_SKIP_ENGINE_BUILD': '1', 'RHYTHM_SANDBOX_API_PORT': '4798',
               'RHYTHM_SANDBOX_ENGINE_PORT': '4797', 'RHYTHM_SANDBOX_GATEWAY_PORT': '4799'}
        for name, changes in [('bare-skip', {}),
                              ('unpinned', {'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE)}),
                              ('wrong-hash', {'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE), 'RHYTHM_SANDBOX_PREBUILT_INTAKE_SHA256': '0' * 64}),
                              ('live-port', {'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE), 'RHYTHM_SANDBOX_ENGINE_PORT': '4096'}),
                              ('nonpreserving', {'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE), 'RHYTHM_SANDBOX_PRESERVE_FILES': '0'}),
                              ('competing-fork', {'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE), 'RHYTHM_SANDBOX_ENGINE_DIR': '/private/tmp/foreign-fork'})]:
            with self.subTest(name=name):
                result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/bin/bash', '-c',
                                         'source tools/dev/sandbox.sh; build_engine'], cwd=ROOT, env={**env, **changes},
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                (parent / (name + '.stderr')).write_bytes(result.stderr)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((parent / 'engine-build').exists())

    def test_clean_runtime_feature_and_payload_forwarding(self):
        # Regression: env-i drops the enabled workstream flag or points back at a
        # stale shared payload/store, bypassing frozen ownership checks.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-runtime-envelope-', dir='/private/tmp'))
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
               'RHYTHM_SANDBOX_DIR': str(parent), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
               'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(BASE), 'RHYTHM_WORKSTREAMS_ENABLED': 'true',
               'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1', 'RHYTHM_NUMBAT_MONITORING_DISABLED': '1'}
        script = '''source tools/dev/sandbox.sh
has() { local item; for item in "${runtime_env[@]}"; do [[ "$item" != "$1" ]] || return 0; done; return 1; }
has RHYTHM_WORKSTREAMS_ENABLED=true
has OPENCODE_DISABLE_DEFAULT_PLUGINS=1
has RHYTHM_NUMBAT_MONITORING_DISABLED=1
has OPENCODE_DB=opencode-rhythm-sandbox.db
has "RHYTHM_MCP_SERVER_BIN=$SB/mcp-dist/index.js"
[[ "$API_BIN" == "$SB/dist/server.js" ]]
'''
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/bin/bash', '-c', script], cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'')  # no environment/config export

    def test_copy_only_wal_bootstrap_preserves_source(self):
        # Regression: copied API data fails its first real WAL read or bootstrap
        # resets source metadata/weakens runtime journaling to OFF/MEMORY.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-api-wal-copy-', dir='/private/tmp'))
        memory = sqlite3.connect(':memory:')
        memory.executescript('CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(7); PRAGMA user_version=37;')
        source = parent / 'approved-synthetic.db'
        with source.open('xb') as stream:
            stream.write(memory.serialize())
        memory.close()
        source.chmod(0o400)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        target = parent / 'runtime.db'
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, 'python3', '-I',
                                 'tools/dev/sandbox_copy_fixture.py', str(source), str(target), '--wal-bootstrap'],
                                cwd=ROOT, env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (parent / 'bootstrap.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
        self.assertEqual(target.read_bytes()[18:20], b'\x02\x02')
        with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone(), ('wal',))
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',))
            self.assertEqual(db.execute('PRAGMA user_version').fetchone(), (37,))
            self.assertEqual(db.execute('SELECT value FROM marker').fetchall(), [(7,)])

    def test_exclusive_copy_rejects_existing_and_symlink(self):
        # Regression: shared copy primitive overwrites retained output or follows
        # a symlink while accepting byte-identical source/destination.
        spec = importlib.util.spec_from_file_location('intake', ROOT / 'tools/dev/sandbox_prebuilt_intake.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-exclusive-copy-', dir='/private/tmp'))
        source, existing = parent / 'source', parent / 'retained'
        source.write_bytes(b'new-owned-data')
        existing.write_bytes(b'retained-owned-data')
        link = parent / 'linked-destination'
        link.symlink_to(existing)
        for target in [existing, link]:
            with self.subTest(target=target.name):
                with self.assertRaises(FileExistsError):
                    module.exclusive_copy(source, target, hashlib.sha256(source.read_bytes()).hexdigest(), 0o600)
                self.assertEqual(existing.read_bytes(), b'retained-owned-data')

    def test_attested_prebuilt_next_consumer(self):
        # Regression: preservation rejects the actual source-attested candidate,
        # or silently accepts an old binary without copying its prepared WAL store.
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-intake-contract-', dir='/private/tmp'))
        sb = parent / 'runtime'
        sb.mkdir(mode=0o700)
        source = json.loads(BASE.read_text())
        source['helpers'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in [ROOT / 'tools/dev/sandbox.sh', ROOT / 'tools/dev/sandbox_copy_fixture.py',
                                       ROOT / 'tools/dev/sandbox_prebuilt_intake.py'] if p.is_file()}
        manifest = parent / 'intake.json'
        with manifest.open('x') as stream:
            json.dump(source, stream, sort_keys=True)
        digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
               'RHYTHM_SANDBOX_DIR': str(sb), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
               'RHYTHM_SANDBOX_SKIP_ENGINE_BUILD': '1', 'RHYTHM_SANDBOX_PREBUILT_INTAKE': str(manifest),
               'RHYTHM_SANDBOX_PREBUILT_INTAKE_SHA256': digest,
               'RHYTHM_SANDBOX_API_PORT': '4798', 'RHYTHM_SANDBOX_ENGINE_PORT': '4797',
               'RHYTHM_SANDBOX_GATEWAY_PORT': '4799', 'RHYTHM_WORKSTREAMS_ENABLED': 'true',
               'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1', 'RHYTHM_NUMBAT_MONITORING_DISABLED': '1'}
        before = hashlib.sha256(pathlib.Path(source['engine']['path']).read_bytes()).hexdigest()
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/bin/bash', '-c',
                                 'source tools/dev/sandbox.sh; build_engine'], cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (parent / 'intake.stdout').write_bytes(result.stdout)
        (parent / 'intake.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, 'source-attested preserving intake rejected; see retained local receipt')
        binary = sb / 'engine-build/opencode-darwin-arm64/bin/opencode'
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(), source['engine']['sha256'])
        self.assertEqual(hashlib.sha256(pathlib.Path(source['engine']['path']).read_bytes()).hexdigest(), before)
        store = sb / 'home/.local/share/opencode/opencode-rhythm-sandbox.db'
        self.assertEqual(hashlib.sha256(store.read_bytes()).hexdigest(), source['engine_database']['sha256'])
        self.assertEqual(store.read_bytes()[18:20], b'\x02\x02')
        receipt = json.loads((sb / 'prebuilt-intake.receipt.json').read_text())
        self.assertEqual(receipt['scope'], 'source-attested-sandbox-only')
        self.assertEqual(receipt['compiler_exit'], 1)
        self.assertIs(receipt['embedded_signature_qualified'], False)
        self.assertIs(receipt['runtime_qualified'], False)
        # Same destination must not be replaced, even by identical candidate bytes.
        refused = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/bin/bash', '-c',
                                  'source tools/dev/sandbox.sh; build_engine'], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (parent / 'repeat.stderr').write_bytes(refused.stderr)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(), source['engine']['sha256'])


if __name__ == '__main__':
    unittest.main()
