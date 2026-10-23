"""Operator mode contract: subprocess CLI, protected synthetic refs, no live HTTP."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from test_provision_contract import implementation
from test_provision_native_http import NATIVE

CLI = Path(__file__).with_name('hermes_fixture_provision.py')

class OperatorMode(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='operator-mode-', dir='/private/tmp')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.source = self.root / 'source'; self.source.mkdir(mode=0o700)
        self.token = self.root / 'owner'; self.token.write_text('synthetic-secret-only'); self.token.chmod(0o600)
        self.cap = self.root / 'cap'; self.cap.write_text('synthetic-cap-only'); self.cap.chmod(0o600)
        self.manifest = self.root / 'approval.json'
        self.data = dict(version=2, fixtureOnly=True, executionMode='operator-fixture',
            fixtureRoot=str(self.root), stateDir=str(self.state), tokenFile=str(self.token),
            bridgeCapabilityFile=str(self.cap), nativeSource=str(self.source),
            nativeEndpoint='http://127.0.0.1:51001', apiEndpoint='http://127.0.0.1:4001',
            owner='1', profile='default', nativeCookieFile=None, nativeCsrfFile=None,
            nativeHashes={'api/rhythm_schema.py': '0'*64, 'api/rhythm_inbox.py': '0'*64},
            managerAgentId='manager', targetAgentId='target', prompt='fixture')
        self.save()

    def save(self):
        self.manifest.write_text(json.dumps(self.data)); self.manifest.chmod(0o600)

    def run_cli(self, api='http://127.0.0.1:4001', opt=True, extra=()):
        command = [sys.executable, '-B', str(CLI), '--token-file', str(self.token),
            '--state-dir', str(self.state), '--api', api,
            '--approved-fixture-manifest', str(self.manifest), '--bridge-capability-file', str(self.cap),
            '--native-source', str(self.source), '--native-endpoint', self.data['nativeEndpoint']]
        if opt: command += ['--allow-private-relay']
        result = subprocess.run(command + list(extra), capture_output=True, text=True, timeout=10)
        self.assertNotIn('synthetic-secret-only', result.stdout + result.stderr)
        self.assertNotIn('synthetic-cap-only', result.stdout + result.stderr)
        return result

    def test_exact_operator_dryrun(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['mode'], 'DRY_RUN')
        self.assertEqual(json.loads(result.stdout)['executionMode'], 'operator-fixture')
        self.assertEqual(list(self.state.iterdir()), [])

    def test_reject_endpoints_before_secret_read(self):
        self.token.unlink(); self.cap.unlink()
        for api in ('http://localhost:4001', 'http://[::1]:4001', 'http://127.0.0.1:4002',
                    'https://127.0.0.1:4001', 'http://10.0.0.1:4001', 'http://x@127.0.0.1:4001',
                    'http://127.0.0.1:4001/', 'http://127.0.0.1:4001?x=1',
                    'http://127.0.0.1:4001#x', 'http://127.0.0.1:04001', 'http://127.0.0.1:4898'):
            with self.subTest(api=api):
                result = self.run_cli(api)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('exact operator relay', result.stderr)

    def test_mode_conflict_and_manifest_guards(self):
        for key, value in (('executionMode', 'sandbox'), ('fixtureOnly', False), ('version', 1),
                           ('apiEndpoint', 'http://127.0.0.1:4898'), ('profile', 'other'),
                           ('nativeEndpoint', 'http://127.0.0.1:4001')):
            old = self.data[key]; self.data[key] = value; self.save()
            self.assertNotEqual(self.run_cli().returncode, 0)
            self.data[key] = old; self.save()
        self.assertNotEqual(self.run_cli(opt=False).returncode, 0)

    def test_canonical_default_unchanged(self):
        result = subprocess.run([sys.executable, '-B', str(CLI), '--token-file', str(self.token),
            '--state-dir', str(self.state)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['apiEndpoint'], 'http://127.0.0.1:4898')

    def test_missing_runtime_reference_stops_locally(self):
        self.cap.unlink()
        result = self.run_cli(extra=('--execute-owned-fixture',))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('STOP fileReference --bridge-capability-file', result.stderr)
        self.assertEqual(list(self.state.iterdir()), [])

    def test_stop_only_owned_link_idempotent_preserves_foreign(self):
        p = implementation()
        (self.source / 'api').mkdir()
        for name in self.data['nativeHashes']:
            raw = (NATIVE / 'source_snapshot' / name).read_bytes()
            (self.source / name).write_bytes(raw)
            self.data['nativeHashes'][name] = hashlib.sha256(raw).hexdigest()
        self.save()
        receiver = p.pinned_receiver(self.source, self.data['nativeHashes'])
        own = dict(runId='own-run', owner='1', profile='default', hermesSessionId='new-owned', sessionId='own-child')
        foreign = dict(runId='foreign-run', owner='1', profile='default', hermesSessionId='foreign', sessionId='foreign-child')
        for binding in (own, foreign):
            p.install_link(self.state, binding, self.token, receiver, receiver_endpoint=self.data['nativeEndpoint'])
        p.atomic_json(self.state / 'rhythm-fixture-chat.json', dict(version=2, status='created',
            profile='default', nativeEndpoint=self.data['nativeEndpoint'], hermesSessionId='new-owned',
            durableRoute='/api/session/rename', approvalDigest=hashlib.sha256(self.manifest.read_bytes()).hexdigest()))
        before = json.loads(p.protected(self.state / 'rhythm-notify-registry.json'))['runs']['foreign-run']
        for _ in range(2):
            result = self.run_cli(extra=('--stop-owned-fixture',))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'], 'STOPPED')
        records = json.loads(p.protected(self.state / 'rhythm-notify-registry.json'))['runs']
        self.assertEqual(records['foreign-run'], before)
        self.assertFalse(records['own-run']['active'])
        store = receiver(self.state / 'rhythm-notify.sqlite')
        try:
            self.assertEqual(dict(store.db.execute('SELECT run_id,active FROM links')), {'own-run': 0, 'foreign-run': 1})
        finally: store.close()

    def test_dryrun_and_invalid_targets_audited_no_secret_reads_or_network(self):
        # Audit the real CLI process; no replaced SUT functions/HTTP responses.
        wrapper = '''
import runpy, sys
secrets = set(sys.argv[2].split('|'))
cli = sys.argv[1]
sys.argv = [cli] + sys.argv[3:]
def fence(event, args):
    if event == 'socket.connect': raise AssertionError('network forbidden')
    if event == 'open' and str(args[0]) in secrets: raise AssertionError('secret read forbidden')
sys.addaudithook(fence)
runpy.run_path(cli, run_name='__main__')
'''
        base = [sys.executable, '-B', '-c', wrapper, str(CLI), str(self.token)+'|'+str(self.cap),
            '--token-file', str(self.token), '--state-dir', str(self.state), '--allow-private-relay',
            '--approved-fixture-manifest', str(self.manifest), '--bridge-capability-file', str(self.cap),
            '--native-source', str(self.source), '--native-endpoint', self.data['nativeEndpoint']]
        for api, expected in (('http://127.0.0.1:4001', 0), ('http://localhost:4001', 1)):
            result = subprocess.run(base + ['--api', api], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, expected, result.stderr)
            self.assertNotIn('AssertionError', result.stderr)
        self.assertEqual(list(self.state.iterdir()), [])

    def test_reject_owner_override_and_native_alias_before_credentials(self):
        self.token.unlink(); self.cap.unlink()
        self.data['rootOwnerClaim'] = 'foreign'; self.save()
        result = self.run_cli()
        self.assertIn('unsupported fields', result.stderr)
        del self.data['rootOwnerClaim']; self.save()
        for value in ('http://[::1]:51001', 'http://127.0.0.1:4001', 'http://0.0.0.0:51001',
                      'http://localhost:51001', 'http://127.0.0.1:051001'):
            self.data['nativeEndpoint'] = value; self.save()
            result = self.run_cli()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('fileReference', result.stderr)

if __name__ == '__main__': unittest.main()
