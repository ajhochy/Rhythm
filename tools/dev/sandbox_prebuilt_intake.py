"""Explicit sandbox-only intake; no compilation, signing, native launch or cleanup."""
import hashlib
import json
import os
import pathlib
import sqlite3
import stat
import subprocess
import sys

HELPERS = {'tools/dev/sandbox.sh', 'tools/dev/sandbox_copy_fixture.py', 'tools/dev/sandbox_prebuilt_intake.py'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    result = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def regular(path):
    path = pathlib.Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
            and path.resolve() == path, 'unowned, linked or noncanonical intake file')
    return info


def load(path, expected):
    regular(path)
    require(digest(path) == expected, 'receipt hash mismatch')
    return json.loads(pathlib.Path(path).read_text())


def exclusive_copy(source, destination, expected, mode):
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    before = regular(source)
    require(digest(source) == expected, 'intake source hash mismatch')
    require(destination.parent.resolve() == destination.parent
            and destination.parent.stat().st_uid == os.getuid(), 'unsafe intake destination')
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, mode)
    with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
        for chunk in iter(lambda: inp.read(1024 * 1024), b''):
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
        os.fchmod(out.fileno(), mode)
    after = regular(source)
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            and digest(source) == expected and digest(destination) == expected,
            'intake bytes changed; partial output retained')


def write_new(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def inventory_hash(entries):
    return hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def intake(root, sb, manifest, expected):
    root, sb = pathlib.Path(root), pathlib.Path(sb)
    require(root.resolve() == root and sb.resolve() == sb and sb.is_dir()
            and sb.stat().st_uid == os.getuid() and stat.S_IMODE(sb.stat().st_mode) == 0o700
            and str(sb).startswith('/private/tmp/'), 'unsafe intake sandbox')
    # Fail before any copying or external checks; repeated intake never replaces files.
    require(not (sb / 'engine-build').exists() and not (sb / 'engine-build').is_symlink()
            and not (sb / 'prebuilt-intake.receipt.json').exists(), 'intake destination exists')
    document = load(manifest, expected)
    require(document['schema'] == 'rhythm-preserving-prebuilt-intake-v1'
            and document['scope'] == 'source-attested-sandbox-only'
            and document['worktree'] == str(root) and document['ports'] == [4798, 4797, 4799], 'intake scope mismatch')
    require(document['boundaries'] == {'compiler_exit': 1, 'embedded_signature_qualified': False,
                                     'shipping_qualified': False, 'runtime_qualified': False}, 'false qualification boundary')
    require(set(document['helpers']) == HELPERS, 'helper freeze incomplete')
    for name, value in document['helpers'].items():
        require(digest(root / name) == value, 'launcher/helper freeze changed')
    fresh = pathlib.Path(document['fresh_root'])
    require(fresh.resolve() == fresh and fresh.is_dir() and fresh.stat().st_uid == os.getuid()
            and str(fresh).startswith('/private/tmp/rhythm-coordinator-qualification-sandbox-'), 'unowned fresh provenance root')
    engine, database = document['engine'], document['engine_database']
    require(pathlib.Path(engine['path']) == fresh / 'engine-build/opencode-darwin-arm64/bin/opencode'
            and pathlib.Path(database['path']) == fresh / 'engine-persistent-memory-bootstrap.db'
            and database['synthetic'] is True, 'wrong engine or synthetic database source')
    require(pathlib.Path(engine['signature_path']).is_relative_to(fresh), 'signature escapes fresh root')
    for name in ['path', 'signature_path']:
        regular(engine[name])
    require(digest(engine['path']) == engine['sha256'] and
            digest(engine['signature_path']) == engine['signature_sha256'], 'binary/detached hash mismatch')
    require(pathlib.Path(engine['path']).stat().st_mode & 0o111, 'engine is not executable')
    evidence = {name: load(ref['path'], ref['sha256']) for name, ref in document['evidence'].items()}
    build, before, after, reconciliation, finalization = [evidence[name] for name in [
        'fresh-build-result.json', 'inputs-before-v2.json', 'inputs-after-compile.json',
        'inputs-reconciliation.json', 'finalization-receipt.json']]
    require(build['exitCode'] == 1 and build['recipeCwd'] == str(root / 'apps/opencode_fork/packages/opencode')
            and build['freshRoot'] == str(fresh) and build['argv'] ==
            ['/usr/bin/sandbox-exec', '-p', '(version 1) (allow default) (deny file-write-unlink) (deny network*)',
             '/opt/homebrew/bin/bun', '--no-env-file', 'run', './script/build.ts', '--single', '--skip-install', '--skip-embed-web-ui'],
            'fresh build recipe mismatch')
    require(before['worktree'] == str(root) and after['worktree'] == str(root)
            and inventory_hash(before['inputs']) == before['closureSha256']
            and inventory_hash(after['inputs']) == after['closureSha256']
            and before['closureSha256'] == build['sourceClosureSha256'], 'input inventory binding mismatch')
    require(digest('/opt/homebrew/bin/bun') == build['compilerSha256'] == before['compilerSha256']
            == after['compilerSha256'] and reconciliation['compilerUnchanged'] is True
            and type(reconciliation['changedExistingInputs']) is int and reconciliation['changedExistingInputs'] == 0
            and type(reconciliation['removedInputs']) is int and reconciliation['removedInputs'] == 0,
            'compiler/input reconciliation mismatch')
    old = {item['path']: item for item in before['inputs']}
    new = {item['path']: item for item in after['inputs']}
    require(len(old) == len(before['inputs']) and len(new) == len(after['inputs'])
            and all(new.get(name) == item for name, item in old.items()), 'original compiled inputs changed')
    added = [item for name, item in new.items() if name not in old]
    require(len(added) == 1 and added[0] == reconciliation['newCompilerGeneratedBootstrapCopy']
            and added[0]['sha256'] == build['compilerSha256']
            and added[0]['path'].startswith('apps/opencode_fork/packages/opencode/.')
            and added[0]['path'].endswith('.bun-build'), 'unexplained source-tree output')
    # Actual complete frozen closure, not a named-source-only or historical receipt check.
    for item in after['inputs']:
        relative = pathlib.Path(item['path'])
        require(not relative.is_absolute() and '..' not in relative.parts
                and relative.parts[:2] == ('apps', 'opencode_fork'), 'input path escapes compiled closure')
        path = root / relative
        info = path.lstat()
        if item['kind'] == 'link':
            require(path.is_symlink() and hashlib.sha256(os.readlink(path).encode()).hexdigest() == item['targetSha256'], 'input link changed')
        else:
            require(item['kind'] == 'file' and stat.S_ISREG(info.st_mode)
                    and stat.S_IMODE(info.st_mode) == item['mode'] and info.st_size == item['size']
                    and digest(path) == item['sha256'], 'compiled input bytes or metadata changed')
    # The engine's complete compiled closure above stays immutable. A separately
    # rebuilt Stage-A API may change ONLY this named API transport source, with
    # both original identity and current pinned launcher-source identity recorded.
    api_bindings = document.get('api_source_bindings', {})
    api_sources = {'apps/api_server/src/services/opencode_client_service.ts',
                   'apps/api_server/src/services/agent_delegation_service.ts',
                   'apps/api_server/src/database/postgres_bootstrap.ts'}
    require(isinstance(api_bindings, dict) and set(api_bindings).issubset(api_sources), 'API source binding scope expanded')
    if api_bindings:
        ref = document['launcher_manifest']
        frozen = load(ref['path'], ref['sha256'])
        require(frozen['schema'] == 'rhythm-frozen-preserving-launcher-manifest-v1'
                and frozen['worktree'] == str(root), 'API source launcher binding mismatch')
        for api_source, binding in api_bindings.items():
            require(set(binding) == {'original_sha256', 'current_sha256'}
                    and api_source not in old and api_source not in new
                    and binding['original_sha256'] == before['namedSources'][api_source]
                    and binding['current_sha256'] == frozen['files'][api_source], 'API source provenance mismatch')
    for name, value in before['namedSources'].items():
        if name not in HELPERS:
            current = api_bindings[name]['current_sha256'] if name in api_bindings else value
            require(digest(root / name) == current, 'frozen API/MCP/named source changed')
    require(finalization['destination'] == engine['path'] and finalization['sourceSha256'] == engine['sha256']
            and finalization['returnCode'] == 0 and finalization['overwrite'] is False
            and finalization['unlinkCalls'] == 0 and finalization['rmdirCalls'] == 0
            and finalization['guardPolicyChanged'] is False and finalization['sameFilePreservedAtDestination'] is True
            and regular(engine['path']).st_ino == finalization['inode'], 'exact finalization identity mismatch')
    detached = evidence['detached-signing-receipt.json']
    require(detached['beforeSha256'] == detached['afterSha256'] == engine['sha256']
            and detached['embeddedSignatureQualified'] is False
            and all(check['exitCode'] == 0 for check in detached['checks'].values()), 'detached evidence mismatch')
    check = subprocess.run(['/usr/bin/codesign', '--verify', '--strict', '--detached',
                            engine['signature_path'], engine['path']], capture_output=True)
    require(check.returncode == 0, 'actual strict detached verification rejected')
    bootstrap, help_receipt, durable = [evidence[name] for name in [
        'engine-persistent-bootstrap-receipt.json', 'prepared-persistent-engine-help-receipt.json', 'wal-durable-reopen-receipt.json']]
    require(bootstrap['database'] == help_receipt['database'] == database['path'] and bootstrap['qualified'] is True
            and bootstrap['steps'] == [{'journal_mode': 'memory'}, {'journal_mode': 'wal'}, {'integrity_check': 'ok'}]
            and help_receipt['engineBinarySha256'] == engine['sha256'] and help_receipt['compilerExitRetained'] == 1
            and help_receipt['engineSourceChanged'] is False and help_receipt['guardChanged'] is False
            and len(help_receipt['checks']) == 2
            and all(c['exitCode'] == 0 and c['hasRunCommand'] and c['hasServeCommand'] for c in help_receipt['checks'])
            and durable['guardChanged'] is False and durable['deletionsPerformed'] is False
            and len(durable['checks']) == 3 and all(c['exitCode'] == 0 for c in durable['checks']), 'persistent native bootstrap evidence mismatch')
    db = pathlib.Path(database['path'])
    require(database['files'][''] == database['sha256'] and db.read_bytes()[18:20] == b'\x02\x02'
            and not pathlib.Path(str(db) + '-journal').exists(), 'prepared WAL set incomplete or rollback journal present')
    for suffix, value in database['files'].items():
        require(suffix in ('', '-wal', '-shm'), 'unknown SQLite sidecar')
        regular(str(db) + suffix)
        require(digest(str(db) + suffix) == value, 'prepared database set changed')
    # Sole executor must keep the source set cold; never silently discard pending WAL frames.
    target = sb / 'engine-build/opencode-darwin-arm64/bin'
    target.mkdir(parents=True, mode=0o700)
    exclusive_copy(engine['path'], target / 'opencode', engine['sha256'], 0o500)
    exclusive_copy(engine['signature_path'], target / 'opencode.detached-signature', engine['signature_sha256'], 0o400)
    store = sb / 'home/.local/share/opencode'
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    for suffix, value in database['files'].items():
        exclusive_copy(str(db) + suffix, store / ('opencode-rhythm-sandbox.db' + suffix), value, 0o600)
    for suffix, value in database['files'].items():
        require(digest(str(db) + suffix) == value, 'cold source set changed during intake')
    with sqlite3.connect((store / 'opencode-rhythm-sandbox.db').as_uri() + '?mode=ro&immutable=1', uri=True) as conn:
        require(conn.execute('PRAGMA integrity_check').fetchone() == ('ok',), 'copied prepared store unusable')
    write_new(sb / 'prebuilt-intake.receipt.json', {'scope': document['scope'], 'manifest_sha256': expected,
              'source_closure_sha256': before['closureSha256'], 'compiled_input_entries_checked': len(after['inputs']),
              'binary_sha256': engine['sha256'], 'prepared_source_files': database['files'],
              'compiler_exit': 1, 'embedded_signature_qualified': False, 'shipping_qualified': False,
              'runtime_qualified': False, 'detached_strict_verify_exit': 0, 'copied_store_integrity': 'ok'})


def payload_snapshot(root, sb, stage):
    root, sb = pathlib.Path(root), pathlib.Path(sb)
    require(root == pathlib.Path(__file__).resolve().parents[2] and sb.resolve() == sb
            and str(sb).startswith('/private/tmp/') and sb.is_dir()
            and sb.stat().st_uid == os.getuid() and stat.S_IMODE(sb.stat().st_mode) == 0o700
            and stage in ('before', 'after'), 'unsafe payload snapshot scope')
    result = {}
    for app in ['api_server', 'mcp_server']:
        base = root / 'apps' / app
        paths = [base / name for name in ['package.json', 'package-lock.json', 'tsconfig.json']]
        for name in ['src', 'vendor', 'node_modules']:
            directory = base / name
            if directory.is_dir():
                for parent, dirs, files in os.walk(directory, followlinks=False):
                    paths.extend(pathlib.Path(parent) / name for name in files)
                    paths.extend(pathlib.Path(parent) / name for name in dirs if (pathlib.Path(parent) / name).is_symlink())
        for path in paths:
            if not path.exists() and not path.is_symlink():
                continue
            # Environment files are never compiler inputs or credential evidence.
            if path.name.startswith('.env'):
                continue
            if path.is_symlink():
                value = hashlib.sha256(os.readlink(path).encode()).hexdigest()
            else:
                value = digest(path)
            result[str(path.relative_to(root))] = value
    if stage == 'after':
        require(result == json.loads((sb / 'payload-inputs-before.json').read_text()), 'API/MCP source/dependency bytes changed during build')
    write_new(sb / ('payload-inputs-' + stage + '.json'), result)


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'payload-snapshot':
            payload_snapshot(*sys.argv[2:])
        else:
            intake(*sys.argv[1:])
    except Exception as error:
        # Do not leak native stderr, configuration, database content or private paths.
        print('sandbox intake refused: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
