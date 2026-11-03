"""Frozen operator CLI checks; real files and actual native Receiver, no SUT mocks."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

CLI = Path(__file__).with_name('hermes_fixture_provision.py')
NATIVE = Path('/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-integrated-rollout-20261014/tools/dev')

def implementation():
    assert CLI.is_file(), 'required supported provisioning CLI has not been implemented'
    spec = importlib.util.spec_from_file_location('provision', CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ProvisionContract(unittest.TestCase):
    def setUp(self):
        self.p = implementation()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.token = self.home / 'token'
        self.token.write_text('disposable-only-token')
        self.token.chmod(0o600)

    def test_01_protected_token(self):
        self.assertEqual(self.p.token_reference(self.token), 'disposable-only-token')

    def test_02_world_readable_denied(self):
        self.token.chmod(0o644)
        with self.assertRaises(ValueError): self.p.token_reference(self.token)

    def test_03_symlink_denied(self):
        link = self.home / 'link'; link.symlink_to(self.token)
        with self.assertRaises(ValueError): self.p.token_reference(link)

    def test_04_parent_symlink_denied(self):
        link = self.home / 'dir'; link.symlink_to(self.home, target_is_directory=True)
        with self.assertRaises(ValueError): self.p.token_reference(link / 'token')

    def test_05_oversize_denied(self):
        self.token.write_text('a' * 8193)
        with self.assertRaises(ValueError): self.p.token_reference(self.token)

    def test_06_empty_denied(self):
        self.token.write_text('')
        with self.assertRaises(ValueError): self.p.token_reference(self.token)

    def test_07_header_injection_denied(self):
        self.token.write_text('a\r\nInjected: yes')
        with self.assertRaises(ValueError): self.p.token_reference(self.token)

    def test_08_endpoint_userinfo_denied(self):
        with self.assertRaises(ValueError): self.p.endpoint('http://token@127.0.0.1:4898', fixture=True)

    def test_09_endpoint_query_denied(self):
        with self.assertRaises(ValueError): self.p.endpoint('http://127.0.0.1:4898?token=secret', fixture=True)

    def test_10_exact_sandbox_endpoint(self):
        self.assertEqual(self.p.endpoint('http://127.0.0.1:4898', fixture=True), 'http://127.0.0.1:4898')

    def test_11_no_live_API_fixture(self):
        with self.assertRaises(ValueError): self.p.endpoint('http://127.0.0.1:4001', fixture=True)

    def test_12_no_HTTP_without_optin(self):
        with self.assertRaises(ValueError): self.p.endpoint('http://127.0.0.1:4898')

    def test_13_dryrun_is_reference_only(self):
        plan = self.p.plan(self.token, 'http://127.0.0.1:4898', self.home, fixture=True)
        text = json.dumps(plan)
        self.assertEqual(plan['mode'], 'DRY_RUN')
        self.assertNotIn('disposable-only-token', text)
        self.assertFalse((self.home / 'rhythm-notify-registry.json').exists())

    def receiver(self):
        sys.path.insert(0, str(NATIVE))
        from hermes_webui_receiver.receiver import Receiver
        return Receiver

    def binding(self):
        return dict(runId='fixture-run', owner='fixture-owner', profile='default',
                    hermesSessionId='fixture-chat', sessionId='fixture-anchor')

    def test_14_supported_native_link_and_idempotency(self):
        receiver = self.receiver()
        binding = self.binding()
        self.p.install_link(self.home, binding, self.token, receiver)
        self.p.install_link(self.home, binding, self.token, receiver)
        data = json.loads((self.home / 'rhythm-notify-registry.json').read_text())
        self.assertTrue(data['runs']['fixture-run']['active'])
        store = receiver(self.home / 'rhythm-notify.sqlite')
        try: self.assertEqual(store.db.execute('SELECT count(*) FROM links').fetchone()[0], 1)
        finally: store.close()

    def test_15_immutable_conflict_preserves_existing(self):
        receiver = self.receiver(); binding = self.binding()
        self.p.install_link(self.home, binding, self.token, receiver)
        original = (self.home / 'rhythm-notify-registry.json').read_bytes()
        binding['hermesSessionId'] = 'foreign-chat'
        with self.assertRaises(ValueError): self.p.install_link(self.home, binding, self.token, receiver)
        self.assertEqual((self.home / 'rhythm-notify-registry.json').read_bytes(), original)

    def test_16_partial_registry_refused_no_adoption(self):
        receiver = self.receiver(); binding = self.binding()
        self.p.install_link(self.home, binding, self.token, receiver)
        registry = self.home / 'rhythm-notify-registry.json'
        data = json.loads(registry.read_text()); data['runs']['fixture-run']['active'] = False
        registry.write_text(json.dumps(data))
        with self.assertRaises(ValueError): self.p.install_link(self.home, binding, self.token, receiver)
        self.assertFalse(json.loads(registry.read_text())['runs']['fixture-run']['active'])

if __name__ == '__main__': unittest.main()
