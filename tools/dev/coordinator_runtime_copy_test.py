"""Stock-up copy contract. No cleanup, mock filesystem, or private output."""
import hashlib
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = pathlib.Path('/private/tmp/rhythm-coordinator-repair-fixtures-r0b')
GUARD = '(version 1) (allow default) (deny file-write-unlink) (deny network*)'


def row_counts(path):
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        tables = db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        return {name: db.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
                for (name,) in tables}


def main():
    parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-qualification-sandbox-20261009-copy-', dir='/private/tmp'))
    sb = parent / 'runtime'
    source = FIXTURE / 'rhythm.db'
    before = hashlib.sha256(source.read_bytes()).digest()
    env = {'HOME': '/private/tmp', 'PATH': '/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'RHYTHM_APPROVED_FIXTURE_ROOT': str(FIXTURE), 'RHYTHM_LIVE_DB_PATH': str(source),
           'RHYTHM_SANDBOX_OPENCODE_CONFIG': str(FIXTURE / 'opencode-config'), 'RHYTHM_SANDBOX_DIR': str(sb),
           'RHYTHM_SANDBOX_API_PORT': '4798', 'RHYTHM_SANDBOX_ENGINE_PORT': '4797', 'RHYTHM_SANDBOX_GATEWAY_PORT': '4799',
           'DB_CLIENT': 'sqlite', 'RHYTHM_OPTIMIZER_MODE': 'shadow', 'RHYTHM_SANDBOX_PRESERVE_FILES': '1',
           'RHYTHM_WORKSTREAMS_ENABLED': 'true', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1', 'RHYTHM_NUMBAT_MONITORING_DISABLED': '1'}
    if sys.argv[1:] == ['--copy-only']:
        sb.mkdir(mode=0o700)
        command = ['/usr/bin/python3', '-I', str(ROOT / 'tools/dev/sandbox_copy_fixture.py'), str(source), str(sb / 'rhythm.db')]
    else:
        assert not sys.argv[1:], 'unsupported copy contract arguments'
        command = ['/bin/bash', 'tools/dev/sandbox.sh', 'up']
    result = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, *command],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (parent / 'up.stdout').write_bytes(result.stdout)
    (parent / 'up.stderr').write_bytes(result.stderr)
    print(('copy_only_exit=' if sys.argv[1:] else 'stock_up_exit=') + str(result.returncode))
    print('backup_disk_io_error_count=' + str(result.stderr.count(b'disk I/O error')))
    assert hashlib.sha256(source.read_bytes()).digest() == before, 'read-only source bytes changed'
    # Regression: protected stock backup publishes an empty/incomplete runtime DB.
    # Its next read must see all source tables and exact row counts, not just a file.
    try:
        matches = row_counts(sb / 'rhythm.db') == row_counts(source)
    except sqlite3.OperationalError:
        matches = False
    assert matches, 'stock copy next-read unavailable or table/row counts differ'
    with sqlite3.connect((sb / 'rhythm.db').as_uri() + '?mode=ro', uri=True) as db:
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
            mode = db.execute('PRAGMA journal_mode').fetchone()[0]
            assert mode == src.execute('PRAGMA journal_mode').fetchone()[0] == 'delete', 'copy changed reopened fixture durability'
    if sys.argv[1:]:
        retained = (sb / 'rhythm.db').read_bytes()
        refused = subprocess.run(['/usr/bin/sandbox-exec', '-p', GUARD, *command], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (parent / 'existing-destination.stderr').write_bytes(refused.stderr)
        assert refused.returncode != 0 and (sb / 'rhythm.db').read_bytes() == retained, 'existing destination overwritten'
        print('existing_destination_refused=1 reopened_runtime_durability_unchanged=1')
    print('readonly_source_hash_match=1 copy_table_row_counts_match=1')


if __name__ == '__main__':
    main()
