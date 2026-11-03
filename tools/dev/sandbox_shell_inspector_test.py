"""No runtime, socket or signal: actual sourced shell process-read consumers only."""
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class ShellInspectorContract(unittest.TestCase):
    def test_no_denied_reads_and_exact_real_argv_consumer(self):
        # Bug: launch/stop/recovery still call denied setuid ps, or a rendered
        # substring lets an argv-embedded sandbox flag impersonate an exact arg.
        source = (ROOT / 'tools/dev/sandbox.sh').read_text()
        self.assertEqual(len(re.findall(r'\bps -o (?:command|lstart)=', source)), 0,
                         'guarded lifecycle still has denied setuid process reads')
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-shell-kernel-contract-', dir='/private/tmp'))
        script = '''source tools/dev/sandbox.sh
start="$(process_kernel_start "$$")"
[[ -n "$start" && "$start" == "$(process_kernel_start "$$")" ]]
process_kernel_arguments_match "$$" exact-owned-inspection-marker
if process_kernel_arguments_match "$$" wrong-marker; then exit 3; fi
if process_kernel_arguments_match "$$" source-text-not-an-argument; then exit 4; fi
if process_kernel_start 0 >/dev/null 2>&1; then exit 5; fi
'''
        result = subprocess.run(['/bin/bash', '-c', script, 'controlled-inspection-shell',
                                 'exact-owned-inspection-marker'], cwd=ROOT,
                                env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                capture_output=True)
        (parent / 'read.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, 'real shell kernel metadata/argv refusal contract failed')


if __name__ == '__main__':
    unittest.main()
