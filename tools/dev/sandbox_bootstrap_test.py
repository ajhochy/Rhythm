"""Focused bootstrap contract; no servers, installs, or live source reads."""
import json
import os
import shutil
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Bootstrap(unittest.TestCase):
    def test_node_abi_preflight_and_runtime_resolution(self):
        # Regression: sanitized PATH selects a different Node ABI than the caller.
        script = str(ROOT / 'tools/dev/sandbox.sh')
        env = {'PATH': os.environ['PATH'], 'HOME': '/private/tmp/e02-bootstrap-home',
               'RHYTHM_SANDBOX_DIR': '/private/tmp/e02-bootstrap-runtime'}
        node = subprocess.check_output(['bash', '-c', 'command -v node'], env=env, text=True).strip()
        for override in (None, node):
            with self.subTest(override=override):
                selected = dict(env)
                if override is not None:
                    selected['RHYTHM_SANDBOX_NODE_BIN'] = override
                result = subprocess.run(
                    ['bash', '-c', 'source "$1"; validate_node; '
                     'printf "%s\\n" "$NODE_BIN"; '
                     'env -i "${runtime_env[@]}" /bin/bash -c \'command -v node; printf "%s\\n" "$PATH"; command -v opencode\'',
                     'bash', script], env=selected, capture_output=True, text=True, check=True)
                pinned, resolved, runtime_path, engine = result.stdout.splitlines()
                self.assertEqual(pinned, node)
                self.assertEqual(resolved, node)
                expected_engine = ROOT / 'apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode'
                self.assertEqual(engine, str(expected_engine))
                self.assertEqual(runtime_path.split(':')[:3],
                                 [env['RHYTHM_SANDBOX_DIR'] + '/bin', str(expected_engine.parent), str(Path(node).parent)])
        for invalid in ('', 'node', '/nonexistent/e02-node', '/private/tmp'):
            with self.subTest(invalid=invalid):
                result = subprocess.run(
                    ['bash', '-c', 'source "$1"; validate_node', 'bash', script],
                    env={**env, 'RHYTHM_SANDBOX_NODE_BIN': invalid}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('absolute executable', result.stderr)
        source = Path(script).read_text()
        self.assertEqual(source.count('"$NODE_BIN" "$API_DIR/dist/server.js"'), 3)
        up = source.split('up() {', 1)[1].split('\nstop_recorded_engine_if_needed()', 1)[0]
        restart = source.split('\nrestart() {', 1)[1].split('\nrequire_owned_api()', 1)[0]
        self.assertLess(up.index('validate_node'), up.index('mkdir -m 700'))
        self.assertLess(restart.index('validate_node'), restart.index('\n  stop'))

    def test_local_mcp_and_offline_environment(self):
        # Regression: local MCP falls back to npx or Arborist reaches a registry.
        result = subprocess.run(
            ['bash', '-c', 'source "$1"; env -i "${runtime_env[@]}" /usr/bin/env',
             'bash', str(ROOT / 'tools/dev/sandbox.sh')],
            env={'PATH': os.environ['PATH'], 'HOME': '/private/tmp/e02-bootstrap-home',
                 'RHYTHM_SANDBOX_DIR': '/private/tmp/e02-bootstrap-runtime'},
            capture_output=True, text=True, check=True)
        values = dict(line.split('=', 1) for line in result.stdout.splitlines())
        self.assertEqual(values.get('RHYTHM_MCP_SERVER_BIN'), str(ROOT / 'apps/mcp_server/dist/index.js'))
        self.assertEqual(values.get('RHYTHM_AGENT_URL'), 'http://127.0.0.1:4098')
        self.assertEqual(values.get('npm_config_offline'), 'true')
        self.assertEqual(values.get('npm_config_registry'), 'http://127.0.0.1:9')
        self.assertEqual(values.get('npm_config_cache'), '/private/tmp/e02-bootstrap-runtime/npm-cache')
        source = (ROOT / 'tools/dev/sandbox.sh').read_text()
        self.assertIn('[[ -f "$ROOT/apps/mcp_server/dist/index.js" ]] || fail', source)
        self.assertIn('bun run build --single --skip-install', source)
        self.assertIn('MODELS_DEV_API_JSON="$ROOT/apps/opencode_fork/packages/opencode/test/tool/fixtures/models-api.json"', source)

    def test_failure_evidence_survives_runtime_removal(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='rhythm-e02-evidence-test-') as parent:
            runtime = Path(parent) / 'runtime'
            runtime.mkdir(mode=0o700)
            (runtime / 'api_server.log').write_text('engine failed\ntoken=do-not-preserve\n')
            result = subprocess.run(
                ['bash', '-c', 'source "$1"; trap \'rc=$?; if ((rc != 0)); then preserve_diagnostics; fi\' EXIT; fail "identity failed"',
                 'bash', str(ROOT / 'tools/dev/sandbox.sh')],
                env={**os.environ, 'RHYTHM_SANDBOX_DIR': str(runtime)}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            evidence, = Path(parent).glob('runtime.evidence.*')
            shutil.rmtree(runtime)
            self.assertFalse(runtime.exists())
            log = (evidence / 'api_server.log').read_text()
            self.assertIn('engine failed', log)
            self.assertNotIn('do-not-preserve', log)

    def test_synthetic_fixture(self):
        # Regression: ad hoc schema, credentials, or writable source fixtures.
        generator = ROOT / 'tools/dev/sandbox_fixture.mjs'
        self.assertTrue(generator.is_file(), 'canonical synthetic fixture generator missing')
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='rhythm-e02-fixture-test-') as parent:
            fixture = Path(parent) / 'fixture'
            subprocess.run(['node', str(generator), str(fixture)], check=True)
            with sqlite3.connect(f'file:{fixture}/rhythm.db?mode=ro', uri=True) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',))
                self.assertEqual(db.execute('SELECT name, email, role, password_hash FROM users ORDER BY id').fetchall(),
                                 [('Synthetic Admin', 'admin@example.invalid', 'admin', None),
                                  ('Synthetic Member', 'member@example.invalid', 'member', None)])
                self.assertEqual(db.execute('SELECT count(*) FROM workspaces').fetchone(), (1,))
                self.assertEqual(db.execute('SELECT count(*) FROM workspace_members').fetchone(), (2,))
                self.assertEqual(db.execute("SELECT token FROM sessions WHERE expires_at IS NULL").fetchall(), [('e02-synthetic-session-not-a-secret',)])
                self.assertEqual(db.execute('SELECT count(*) FROM agent_scheduled_tasks WHERE enabled != 0').fetchone(), (0,))
            config = json.loads((fixture / 'opencode.json').read_text())
            self.assertEqual(config['mcp']['rhythm']['command'], ['node', str(ROOT / 'apps/mcp_server/dist/index.js')])
            for name in ('rhythm.db', 'opencode.json'):
                self.assertEqual((fixture / name).stat().st_mode & 0o777, 0o400)
            self.assertIn('initDb', generator.read_text())


if __name__ == '__main__':
    unittest.main()
