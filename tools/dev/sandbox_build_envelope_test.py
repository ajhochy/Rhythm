"""Static acceptance: catch caller-environment builds before a live sandbox exists."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BuildEnvelope(unittest.TestCase):
    def test_builds_use_prepared_runtime_environment(self):
        # Regression: build children inherit caller HOME/PATH or Bun loads dotenv.
        source = (ROOT / 'tools/dev/sandbox.sh').read_text()
        self.assertIn('env -i "${runtime_env[@]}" "MODELS_DEV_API_JSON=', source)
        self.assertIn('bun --no-env-file run ./script/build.ts --single --skip-install --skip-embed-web-ui', source)
        self.assertIn('(cd "$API_DIR" && env -i "${runtime_env[@]}" npm run build)', source)
        self.assertIn('(cd "$ROOT/apps/mcp_server" && env -i "${runtime_env[@]}" npm run build)', source)
        up = source.split('\nup() {', 1)[1].split('\nstop_recorded_engine_if_needed()', 1)[0]
        self.assertLess(up.index('copy_runtime_files'), up.index('\n  validate_security_shim'))
        self.assertLess(up.index('\n  validate_security_shim'), up.index('\n  build_engine'))
        self.assertEqual(up.count('\n  validate_security_shim'), 2)


if __name__ == '__main__':
    unittest.main()
