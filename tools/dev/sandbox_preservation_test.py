#!/usr/bin/env python3
"""Real launcher filesystem contracts; every fixture and output is retained.

The rm boundary guard prevents a RED run from violating preservation. It does
not substitute stop/down/ownership checks: any attempted deletion fails a test.
No backend, engine, model, or unrelated process is started or signalled.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(tempfile.mkdtemp(prefix='rhythm-coordinator-preservation-', dir='/private/tmp'))
BASE.chmod(0o700)
SHELL = r'''
rm() { : >"$RHYTHM_TEST_EVIDENCE/deletion-attempted"; return 97; }
export -f rm
source "$1"
case "$2" in
  failure) trap cleanup_failed_up EXIT; exit 17 ;;
  foreign) printf '%s\n' "$$" >"$PID_FILE"; stop ;;
  *) "$2" ;;
esac
'''


def exercise(name, action, flag='1'):
    evidence = BASE / name
    evidence.mkdir(mode=0o700)
    runtime = evidence / 'runtime'
    runtime.mkdir(mode=0o700)
    (runtime / 'evidence.log').write_text('synthetic-preservation-marker\n')
    env = {
        'HOME': str(evidence), 'TMPDIR': str(evidence),
        'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        'RHYTHM_TEST_EVIDENCE': str(evidence),
        'RHYTHM_SANDBOX_DIR': str(runtime),
        'RHYTHM_SANDBOX_API_PORT': '4798',
        'RHYTHM_SANDBOX_ENGINE_PORT': '4797',
        'RHYTHM_SANDBOX_GATEWAY_PORT': '4799',
        'RHYTHM_SANDBOX_PRESERVE_FILES': flag,
    }
    # Keep raw evidence local; emit criterion/status/counts only.
    with (evidence / 'shell.log').open('xb') as log:
        result = subprocess.run(['/bin/bash', '-c', SHELL, 'contract',
                                 str(ROOT / 'tools/dev/sandbox.sh'), action],
                                env=env, stdout=log, stderr=log)
    intact = (runtime / 'evidence.log').read_text() == 'synthetic-preservation-marker\n'
    no_delete = not (evidence / 'deletion-attempted').exists()
    receipts = list(runtime.glob('stop-receipt.*'))
    if flag == 'invalid':
        refused = b'RHYTHM_SANDBOX_PRESERVE_FILES must be 0 or 1' in (evidence / 'shell.log').read_bytes()
        return result.returncode != 0 and intact and no_delete and not receipts and refused
    if action in ('stop', 'down'):
        return result.returncode == 0 and intact and no_delete and len(receipts) == 1
    if action == 'failure':
        return result.returncode == 17 and intact and no_delete and len(receipts) == 1
    if action in ('restart', 'restart_engine', 'restart_api'):
        refused = b'preservation mode requires a new unique sandbox directory' in (evidence / 'shell.log').read_bytes()
        return result.returncode != 0 and intact and no_delete and not receipts and refused
    return result.returncode != 0 and intact and no_delete and not receipts


CASES = [
    ('preserve-stop', 'stop', '1'),
    ('preserve-down', 'down', '1'),
    ('preserve-failure', 'failure', '1'),
    ('refuse-foreign-pid', 'foreign', '1'),
    ('refuse-invalid-flag', 'stop', 'invalid'),
    ('refuse-preserved-restart', 'restart', '1'),
    ('refuse-preserved-engine-restart', 'restart_engine', '1'),
    ('refuse-preserved-api-restart', 'restart_api', '1'),
]
passed = 0
for name, action, flag in CASES:
    ok = exercise(name, action, flag)
    passed += int(ok)
    print(f'{name}: {"PASS" if ok else "FAIL"}')
print(f'contracts={len(CASES)} passed={passed} failed={len(CASES) - passed}')
raise SystemExit(0 if passed == len(CASES) else 1)
