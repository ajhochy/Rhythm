"""Real launcher contracts; all fixtures and child output are retained."""
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
GUARD = '(version 1) (allow default) (deny file-write-unlink) (deny network*)'

def main():
    root = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-build-contract-', dir='/private/tmp'))
    sentinel = root / 'unlink-sentinel'
    sentinel.write_text('retain')
    proof = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/usr/bin/python3', '-B', '-c',
        'import pathlib,sys; p=pathlib.Path(sys.argv[1]); (p.parent/"normal-write").write_text("allowed"); p.unlink()', str(sentinel)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (root / 'guard.stdout').write_bytes(proof.stdout)
    (root / 'guard.stderr').write_bytes(proof.stderr)
    assert proof.returncode != 0 and sentinel.read_text() == 'retain'
    assert (root / 'normal-write').read_text() == 'allowed'
    passed = 0
    failed = 0
    # Regression: preserve mode silently reuses an unqualified prebuilt binary.
    # Refusal must happen even when the old binary exists and is executable.
    for name, script in [
        ('reject-prebuilt', 'build_engine'),
        ('owned-output-identity', 'test "$ENGINE_BIN" = "$SB/engine-build/opencode-darwin-arm64/bin/opencode"'),
    ]:
        sb = root / name
        sb.mkdir(mode=0o700)
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'RHYTHM_SANDBOX_DIR': str(sb), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
            'RHYTHM_SANDBOX_SKIP_ENGINE_BUILD': '1'}
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, '/bin/bash', '-c',
            'source "$1"; ' + script, 'contract', str(ROOT / 'tools/dev/sandbox.sh')], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (sb / 'stdout').write_bytes(result.stdout)
        (sb / 'stderr').write_bytes(result.stderr)
        ok = (result.returncode != 0 and b'preservation mode requires a fresh engine build' in result.stderr) if name == 'reject-prebuilt' else result.returncode == 0
        passed += int(ok)
        failed += int(not ok)
    # Regression: a preserving compile overwrites an existing output directory.
    sb = root / 'reject-existing-output'
    sb.mkdir(mode=0o700)
    output = sb / 'engine-build'
    output.mkdir()
    marker = output / 'retained-marker'
    marker.write_text('retain')
    env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        'RHYTHM_SANDBOX_DIR': str(sb), 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
        'RHYTHM_SANDBOX_BUILD_OUTPUT': str(output),
        'MODELS_DEV_API_JSON': str(ROOT / 'apps/opencode_fork/packages/opencode/test/tool/fixtures/models-api.json')}
    result = subprocess.run(['/usr/bin/sandbox-exec','-p',GUARD,'/opt/homebrew/bin/bun','--no-env-file','run',
        './script/build.ts','--single','--skip-install','--skip-embed-web-ui'], env=env,
        cwd=ROOT / 'apps/opencode_fork/packages/opencode',stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    (sb / 'stdout').write_bytes(result.stdout)
    (sb / 'stderr').write_bytes(result.stderr)
    ok = result.returncode != 0 and b'preserving build output must be fresh and owned' in result.stderr and marker.read_text() == 'retain'
    passed += int(ok)
    failed += int(not ok)
    print(f'guard_contracts_pass=2 build_contracts_pass={passed} build_contracts_fail={failed}')
    return int(failed != 0)

if __name__ == '__main__':
    raise SystemExit(main())
