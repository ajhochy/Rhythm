"""Actual stock env-i cold boundary, inspector child only; no API/engine/files/signals."""
import json
import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SB = '/private/tmp/rhythm-cold-api-environment-inspector-NOT-RUNTIME'


class ColdApiEnvironment(unittest.TestCase):
    def test_both_up_branches_publish_exact_scope_to_real_env_i_consumer(self):
        # Regression: cold API loses SB while replacement forwards it, so the
        # correct fixedScope guard refuses an otherwise valid held-result read.
        env = {'HOME': '/private/tmp', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin',
               'RHYTHM_SANDBOX_DIR': SB, 'RHYTHM_SANDBOX_API_PORT': '4798',
               'RHYTHM_SANDBOX_ENGINE_PORT': '4797', 'RHYTHM_SANDBOX_GATEWAY_PORT': '4799'}
        definition = subprocess.run(['/bin/bash', '-c', 'source tools/dev/sandbox.sh; declare -f up'],
                                    cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout
        self.assertEqual(len([line for line in definition.splitlines()
                             if 'env -i "${runtime_env[@]}"' in line and '"$API_BIN"' in line]), 2,
                         'contract both foreground/background actual cold exec sites')
        command = '''source tools/dev/sandbox.sh
        exec /usr/bin/env -i "${runtime_env[@]}" /usr/bin/python3 -I -B -c '
import os,json
print(json.dumps({k:os.environ.get(k) for k in ["RHYTHM_SANDBOX_DIR","HOME","PORT","RHYTHM_OPENCODE_ENGINE_PORT","RHYTHM_MOBILE_GATEWAY_PORT"]}))'
'''
        result = subprocess.run(['/bin/bash', '-c', command], cwd=ROOT, env=env,
                                capture_output=True, text=True, check=True)
        actual = json.loads(result.stdout)
        self.assertEqual(actual['PORT'], '4798')
        self.assertEqual(actual['RHYTHM_OPENCODE_ENGINE_PORT'], '4797')
        self.assertEqual(actual['RHYTHM_MOBILE_GATEWAY_PORT'], '4799')
        self.assertEqual(actual['HOME'], SB + '/home')
        self.assertEqual(actual['RHYTHM_SANDBOX_DIR'], SB, 'exact scope must survive cold env-i, not only restart')
        self.assertFalse(pathlib.Path(SB).exists(), 'inspector must never create/launch runtime')


if __name__ == '__main__':
    unittest.main()
