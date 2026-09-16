"""E02 bootstrap guard contracts: real preflight, no servers or mocked guards."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SandboxGuards(unittest.TestCase):
    def test_keychain_shim_is_required_and_blocks_security(self):
        # Regression: bare security falls through to the current account's Keychain.
        with tempfile.TemporaryDirectory(prefix="rhythm-e02-keychain-") as work:
            result = subprocess.run(
                ["bash", "-c", '''source "$1"
declare -F prepare_security_shim >/dev/null || exit 42
mkdir -m 700 "$SB"
prepare_security_shim
validate_security_shim
env -i "${runtime_env[@]}" /bin/sh -c 'command -v security; security'
''', "bash", str(ROOT / "tools/dev/sandbox.sh")],
                env={"PATH": os.environ["PATH"], "HOME": work,
                     "RHYTHM_SANDBOX_DIR": str(Path(work) / "sandbox")},
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 42, "Keychain isolation guard is missing")
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout.strip(), str(Path(work) / "sandbox/bin/security"))
            self.assertIn("sandbox: Keychain blocked", result.stderr)

    def test_keychain_shim_tampering_fails_closed(self):
        # Each rejected state must fail before the caller can launch any process.
        for mutation in ('rm "$SB/bin/security"',
                         'chmod 777 "$SB/bin/security"',
                         'chmod 700 "$SB/bin/security"; printf "#!/bin/sh\\nexit 0\\n" > "$SB/bin/security"; chmod 500 "$SB/bin/security"',
                         'rm "$SB/bin/security"; ln -s /usr/bin/security "$SB/bin/security"',
                         'chmod 777 "$SB/bin"'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory(prefix="rhythm-e02-keychain-") as work:
                result = subprocess.run(
                    ["bash", "-c", '''source "$1"
declare -F prepare_security_shim >/dev/null || exit 42
mkdir -m 700 "$SB"
prepare_security_shim
eval "$2"
validate_security_shim
''', "bash", str(ROOT / "tools/dev/sandbox.sh"), mutation],
                    env={"PATH": os.environ["PATH"], "HOME": work, "PYTHONOPTIMIZE": "1",
                         "RHYTHM_SANDBOX_DIR": str(Path(work) / "sandbox")},
                    capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 42, "Keychain isolation guard is missing")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("security shim", result.stderr)

    def test_unusable_mcp_is_rejected(self):
        # Regression: a nonempty but unusable MCP passes preflight.
        with tempfile.TemporaryDirectory(prefix="rhythm-e02-guard-") as work:
            root = Path(work)
            db = root / "fixture.db"
            db.touch()
            db.chmod(0o400)
            config = root / "config"
            config.mkdir()
            document = config / "opencode.json"
            document.write_text('{"mcp":{"unsafe":{"type":"local"}}}')
            document.chmod(0o400)
            config.chmod(0o500)
            env = dict(PATH=os.environ["PATH"], HOME=work,
                       RHYTHM_APPROVED_FIXTURE_ROOT=work, RHYTHM_LIVE_DB_PATH=str(db),
                       RHYTHM_SANDBOX_OPENCODE_CONFIG=str(config),
                       RHYTHM_SANDBOX_DIR=str(root / "sandbox"))
            result = subprocess.run(["bash", "-c", 'source "$1"; validate_copied_data_inputs',
                                     "bash", str(ROOT / "tools/dev/sandbox.sh")],
                                    env=env, capture_output=True, text=True)
            config.chmod(0o700)
            self.assertNotEqual(result.returncode, 0, "unusable MCP was accepted")
            self.assertIn("safe MCP", result.stderr)

    def test_runtime_environment_disables_ambient_promotion(self):
        # Regression: inherited promotion availability survives runtime overrides.
        result = subprocess.run(["bash", "-c", 'source "$1"; env -i "${runtime_env[@]}" /usr/bin/env',
                                 "bash", str(ROOT / "tools/dev/sandbox.sh")],
                                env={"PATH": os.environ["PATH"], "HOME": "/private/tmp/e02-fake-home",
                                     "AUTO_PROMOTION_FEATURE_AVAILABLE": "true",
                                     "OPENAI_API_KEY": "synthetic-sentinel"},
                                capture_output=True, text=True, check=True)
        values = dict(line.split("=", 1) for line in result.stdout.splitlines())
        self.assertEqual(values.get("AUTO_PROMOTION_FEATURE_AVAILABLE"), "false")
        self.assertEqual(values.get("DB_CLIENT"), "sqlite")
        self.assertEqual(values.get("RHYTHM_OPTIMIZER_MODE"), "shadow")
        self.assertNotIn("OPENAI_API_KEY", values)


if __name__ == "__main__":
    unittest.main()
