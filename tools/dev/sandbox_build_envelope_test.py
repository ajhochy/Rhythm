"""Static acceptance: catch caller-environment builds before a live sandbox exists."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BuildEnvelope(unittest.TestCase):
    def test_builds_use_prepared_runtime_environment(self):
        # Regression: build children inherit caller HOME/PATH or Bun loads dotenv.
        source = (ROOT / 'tools/dev/sandbox.sh').read_text()
        self.assertIn('env -i "${runtime_env[@]}" ${build_env[@]+"${build_env[@]}"}', source)
        self.assertIn('"MODELS_DEV_API_JSON=$ROOT/apps/opencode_fork/packages/opencode/test/tool/fixtures/models-api.json"', source)
        self.assertIn('bun --no-env-file run ./script/build.ts --single --skip-install --skip-embed-web-ui', source)
        self.assertIn('(cd "$API_DIR" && env -i "${runtime_env[@]}" npm run build)', source)
        self.assertIn('(cd "$ROOT/apps/mcp_server" && env -i "${runtime_env[@]}" npm run build)', source)
        up = source.split('\nup() {', 1)[1].split('\nstop_recorded_engine_if_needed()', 1)[0]
        self.assertLess(up.index('copy_runtime_files'), up.index('\n  validate_security_shim'))
        self.assertLess(up.index('\n  validate_security_shim'), up.index('\n  build_engine'))
        self.assertEqual(up.count('\n  validate_security_shim'), 2)


    def test_successful_build_without_expected_fork_binary_fails_closed(self):
        # A zero-exit builder must not allow startup to select stock PATH OpenCode.
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='rhythm-sandbox-build-gap-') as parent:
            runtime = Path(parent) / 'runtime'
            runtime.mkdir(mode=0o700)
            fake_bin = runtime / 'bin'
            fake_bin.mkdir()
            fake_bun = fake_bin / 'bun'
            fake_bun.write_text('#!/bin/sh\nprintf "fake bun completed\\n"\nexit 0\n')
            fake_bun.chmod(0o700)
            result = subprocess.run(
                ['bash', '-c', 'source "$1"; build_engine', 'bash', str(ROOT / 'tools/dev/sandbox.sh')],
                env={**os.environ, 'HOME': str(Path(parent) / 'home'),
                     'RHYTHM_SANDBOX_DIR': str(runtime), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1'},
                capture_output=True, text=True)
            self.assertIn('fake bun completed', (runtime / 'engine-build.log').read_text())
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('fork build did not produce expected executable', result.stderr)
            self.assertFalse((runtime / 'engine-build/opencode-darwin-arm64/bin/opencode').exists())


if __name__ == '__main__':
    unittest.main()
