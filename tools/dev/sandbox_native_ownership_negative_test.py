"""Executor-only native negatives. Never starts runtime, signals, moves or deletes.

capture creates an immutable operator staging request; verify consumes the exact
reviewed staged record and invokes stock restart refusal or marker preservation.
Every case needs its own NEW live owned native cohort; old evidence is not reused.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CASES = {'stale-engine-start', 'foreign-engine-pid', 'symlink-engine-record', 'preexisting-marker'}


def require(value, message):
    if not value:
        raise AssertionError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and path.resolve() == path, 'unsafe native fixture record')
    return info


def identity(path):
    info = regular(path)
    return {'dev': info.st_dev, 'ino': info.st_ino, 'sha256': digest(path),
            'mode': stat.S_IMODE(info.st_mode), 'size': info.st_size}


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def command(sb, argv, label):
    child = subprocess.Popen(argv, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = child.communicate(timeout=45)
    except subprocess.TimeoutExpired:
        # Never implicitly kill a stock lifecycle operation on a test timeout.
        write_new(sb / 'native-negative-timeout.json', {'kind': 'EXECUTOR_CUSTODY_REQUIRED',
                  'owned_cli_pid': child.pid, 'no_test_signal': True})
        raise AssertionError('owned CLI still active; executor must inspect/return custody, not auto-retry')
    result = {'exit': child.returncode, 'stdout': out.decode(), 'stderr': err.decode()}
    write_new(sb / ('native-negative-' + label + '-diagnostic.json'), result)
    return result


def rpc(sb, method, pid, label):
    require(method in {'validateSandboxApiOwnership', 'recordSandboxEngineOwnership',
                      'validateSandboxEngineOwnership', 'requestSandboxHolderShutdown'}, 'unscoped RPC')
    return command(sb, ['/bin/bash', '-c',
                        'source tools/dev/sandbox.sh; sandbox_ownership "$1" "$2"',
                        'native-inspector-only', method, str(pid)], label)


def inventory_count():
    # Only the already-proven owned native engine, never user/host endpoints.
    with urllib.request.urlopen('http://127.0.0.1:4797/session', timeout=5) as response:
        value = json.load(response)
    require(isinstance(value, list), 'native inventory shape changed')
    require(len(value) == 0, 'requires exclusively empty inspector native cohort; no user session data')
    return 0


def load_context(case):
    require(os.environ.get('RHYTHM_LIVE_E2E') == '1' and
            os.environ.get('RHYTHM_NATIVE_NEGATIVE_TESTS') == '1', 'sole executor live opt-in required')
    require(case in CASES, 'unknown native negative case')
    sb = pathlib.Path(os.environ['RHYTHM_SANDBOX_DIR'])
    require(str(sb).startswith('/private/tmp/rhythm-coordinator-qualification-sandbox-20261009-stageA-NEG-')
            and sb.resolve() == sb and not sb.is_symlink() and sb.is_dir()
            and sb.stat().st_uid == os.getuid() and stat.S_IMODE(sb.stat().st_mode) == 0o700,
            'NEW owned negative cohort required; never GREEN/old cohort')
    require(os.environ.get('RHYTHM_SANDBOX_PRESERVE_FILES') == '1', 'all native files must be retained')
    require([os.environ.get('RHYTHM_SANDBOX_' + n + '_PORT') for n in ('API', 'ENGINE', 'GATEWAY')]
            == ['4798', '4797', '4799'], 'native negative ports changed')
    spec = importlib.util.spec_from_file_location('actual_recovery', ROOT / 'tools/dev/sandbox_api_recovery.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return sb, helper


def capture(case):
    sb, helper = load_context(case)
    api = int((sb / 'api_server.pid').read_text())
    require(rpc(sb, 'validateSandboxApiOwnership', api, 'api-before')['exit'] == 0,
            'real API provenance prerequisite failed')
    require(rpc(sb, 'recordSandboxEngineOwnership', api, 'bind-before')['exit'] == 0,
            'real initial API-parent binding failed')
    require(rpc(sb, 'validateSandboxEngineOwnership', 0, 'engine-before')['exit'] == 0,
            'real native engine prerequisite failed')
    records = {n: identity(sb / n) for n in ('api_server.pid', 'foreground_holder.pid',
               'opencode_engine.pid', 'opencode_engine.ownership.json')}
    pids = {role: int((sb / file).read_text()) for role, file in
            (('api', 'api_server.pid'), ('holder', 'foreground_holder.pid'), ('engine', 'opencode_engine.pid'))}
    starts = {role: helper.kernel_start(pid) for role, pid in pids.items()}
    require(len(set(pids.values())) == 3, 'native roles not distinct')
    require(not (sb / 'shutdown.requested').exists() and not (sb / 'shutdown.requested').is_symlink()
            and not (sb / 'shutdown.acknowledged').exists(), 'cohort already stopping')
    inventory = inventory_count()
    target_name = 'opencode_engine.pid' if case == 'foreign-engine-pid' else 'opencode_engine.ownership.json'
    original = json.loads((sb / 'opencode_engine.ownership.json').read_text())
    baseline = {'kind': 'NATIVE_INSPECTOR_ONLY_NO_AUTHORITY', 'case': case, 'sb': str(sb),
                'pids': pids, 'starts': starts, 'records': records, 'inventory': inventory,
                'original_engine_record': original, 'target': target_name,
                'retained_target': 'negative-retained-' + target_name,
                'authorization_issued': False, 'no_model_or_human_grant': True}
    write_new(sb / 'native-negative-before.json', baseline)
    request = {'case': case, 'authorization_issued': False, 'actual_tool_review_required': True,
               'no_test_moves_overwrites_deletes': True}
    if case == 'preexisting-marker':
        request.update({'operation': 'EXCLUSIVE_NOFOLLOW_CREATE', 'path': str(sb / 'shutdown.requested'),
                        'mode': '0600', 'bytes_utf8': 'native inspector pre-existing request; no grant\n',
                        'precondition': 'API/holder/engine live; foreground waiting on live API'})
    else:
        request.update({'operation': 'SEPARATE_REVIEWED_RENAME_EXCL_THEN_EXCLUSIVE_STAGING',
                        'source': str(sb / target_name), 'source_identity': records[target_name],
                        'destination': str(sb / baseline['retained_target']),
                        'refuse_on_denial': 'Hold exact cohort; no overwrite/unlink/security exception substitute'})
        if case == 'stale-engine-start':
            changed = json.loads(json.dumps(original))
            changed['state']['start'] = 'stale-inspector-captured-start'
            request['exclusive_replacement_json'] = changed
            request['exact_changed_field'] = '/state/start (NOT nonexistent engine_start)'
        elif case == 'foreign-engine-pid':
            request['exclusive_replacement_utf8'] = str(pids['holder']) + '\n'
            request['meaning'] = 'real sameUID owned native holder is foreign to engine role, not a foreignUID test'
        else:
            request['exclusive_replacement_symlink_target'] = str(sb / baseline['retained_target'])
            request['meaning'] = 'real symlink to retained genuine record; bytes otherwise unchanged'
    write_new(sb / 'native-negative-staging-request.json', request)
    print(json.dumps({'stage': 'CAPTURED_NOT_TESTED', 'case': case, 'review_request': str(sb / 'native-negative-staging-request.json'),
                      'baseline_proven': True, 'authorization_issued': False}))


def verify(case):
    sb, helper = load_context(case)
    before_file = sb / 'native-negative-before.json'
    regular(before_file)
    before = json.loads(before_file.read_text())
    require(before['case'] == case and before['sb'] == str(sb), 'wrong staged native case')
    for role, pid in before['pids'].items():
        require(helper.kernel_start(pid) == before['starts'][role], 'native process changed before test')
    require(inventory_count() == before['inventory'], 'native inventory changed before test')
    if case == 'preexisting-marker':
        marker = sb / 'shutdown.requested'
        retained = identity(marker)
        require(marker.read_bytes() == b'native inspector pre-existing request; no grant\n', 'wrong marker sentinel')
        result = rpc(sb, 'requestSandboxHolderShutdown', before['pids']['api'], 'marker-request')
        require(result['exit'] == 0, 'native marker preservation request refused')
        require(identity(marker) == retained, 'existing marker bytes/inode/mode changed')
        require(not (sb / 'shutdown.acknowledged').exists(), 'live-API holder unexpectedly exited early')
    else:
        target = sb / before['target']
        retained = sb / before['retained_target']
        require(identity(retained) == before['records'][before['target']], 'original native record inode/bytes not retained')
        if case == 'stale-engine-start':
            staged = json.loads(target.read_text())
            original = json.loads(json.dumps(before['original_engine_record']))
            original['state']['start'] = 'stale-inspector-captured-start'
            require(staged == original, 'negative changes more than exact real state.start')
            regular(target)
        elif case == 'foreign-engine-pid':
            regular(target)
            require(target.read_text() == str(before['pids']['holder']) + '\n', 'foreign PID is not exact controlled owned holder')
        else:
            require(target.is_symlink() and os.readlink(target) == str(retained)
                    and target.lstat().st_uid == os.getuid(), 'wrong symlink negative')
        unchanged = {n: identity(sb / n) for n in before['records'] if n != before['target']}
        require(all(v == before['records'][n] for n, v in unchanged.items()), 'unrelated baseline record changed')
        # Full real native stock API restart/launch refusal, not a mocked helper
        # or invented process. All earlier envelope/API/native inputs remain valid.
        result = command(sb, ['/bin/bash', 'tools/dev/sandbox.sh', 'restart-api'], 'stock-restart-refusal')
        require(result['exit'] != 0 and 'refus' in result['stderr'].lower(), 'stock native restart did not refuse')
        require(identity(retained) == before['records'][before['target']], 'SUT changed retained original record')
        require(all(identity(sb / n) == v for n, v in unchanged.items()), 'SUT changed unrelated native record')
        require(not (sb / 'shutdown.requested').exists() and not (sb / 'shutdown.acknowledged').exists(),
                'negative native launch created a shutdown request/ACK')
        require(not (sb / 'lifecycle').exists(), 'negative launch allocated recovery generation')
    for role, pid in before['pids'].items():
        require(helper.kernel_start(pid) == before['starts'][role], 'API/engine/holder signalled or replaced')
    require(inventory_count() == before['inventory'], 'SDK session inventory changed after negative')
    receipt = {'case': case, 'status': 'PASS', 'native_process_starts_unchanged': True,
               'native_inventory': 0, 'test_runtime_launches': 0, 'test_direct_signals': 0,
               'original_records_retained': True, 'different_UID_proof': 'NOTRUN'}
    write_new(sb / 'native-negative-result.json', receipt)
    print(json.dumps(receipt))


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] in ('capture', 'verify'), 'usage: capture|verify CASE')
    (capture if sys.argv[1] == 'capture' else verify)(sys.argv[2])
