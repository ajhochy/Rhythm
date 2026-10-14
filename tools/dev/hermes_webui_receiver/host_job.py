"""Parent-only HOST job. No docker/file changes on import or preflight validation.

NOT executable with source_guard.json: independent native+DOM gate, full source
patch hashes, exact container/mount/config digest and host facility are missing.
Run from an independently attested host facility, NEVER inside the target container.
Configuration is hashed internally, never printed or put in receipts.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tempfile
import time

from .receiver import encoded

IMAGE = 'sha256:4fbb112fb9f90efac654c43239cffc233122c2b7536aaad9de1e88455c20de0a'
GATES = {'actual_native_entrypoint', 'frontend_dom', 'arrival_correct_chat_wake_visible',
         'busy_durable_no_steer', 'duplicate_full_identity_collision', 'restart_reopen',
         'crash_ambiguous_native_journal', 'old_session_owner_profile_revocation',
         'zero_network_provider_test_setup_only'}
OUTPUTS = {'server.py': 'REPLACE', 'api/routes.py': 'REPLACE',
           'api/models.py': 'REPLACE', 'static/ui.js': 'REPLACE',
           'api/rhythm_notify.py': 'CREATE', 'api/rhythm_inbox.py': 'CREATE',
           'api/rhythm_schema.py': 'CREATE'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pending_manifest_template(package_root):
    """Source-only template, deliberately invalid until parent supplies attestations.

    No host inspection, config values, secret material or deployment side effects.
    Local snapshot metadata is NOT evidence of deployed uid/gid/mode.
    """
    root = Path(package_root)
    raw = (root / 'native_patch_manifest.json').read_bytes()
    approved = json.loads(raw)
    guard = json.loads((root / 'source_guard.json').read_text())
    pins = json.loads((root / 'source_snapshot_manifest.json').read_text())['hashes']
    if set(approved) != set(OUTPUTS) or guard['image'] != IMAGE:
        raise ValueError('reviewed seven-output source required')
    files = []
    for name, operation in OUTPUTS.items():
        record = approved[name]
        if (set(record) != {'before', 'after'} or
                record['before'] != pins.get(name) or
                sha((root / 'source_snapshot' / name).read_bytes()) != record['after'] or
                (record['before'] is None) != (operation == 'CREATE')):
            raise ValueError('source template pins mismatch')
        files.append(dict(path=name, operation=operation, expectedAbsent=operation == 'CREATE',
                          beforeHash=record['before'], afterHash=record['after'],
                          artifact=None, mode=None, uid=None, gid=None))
    return dict(image=IMAGE, restartBudget=1, containerId=guard['containerId'],
                configDigest=None, mountedSourceRoot=guard['mountedSourceRoot'],
                backupDirectory=None, approvedPatchManifest=None, files=files,
                readiness=dict(kind='docker-health', status='healthy'),
                hostFacility=dict(kind=None, attestedAvailable=False, launchedOnHost=False),
                nativeGate=dict(result='NOTRUN', cases={k: 'NOTRUN' for k in sorted(GATES)},
                                verifier=None, sourceManifestHash=sha(raw),
                                evidenceHash=None, patchSetHash=None))


def absolute_path(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise ValueError('absolute canonical path required')
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.as_posix() != value or value == '/':
        raise ValueError('absolute canonical path required')
    return path


def open_directory(path):
    """Walk from / with pinned no-follow descriptors, never resolve symlinks."""
    path = absolute_path(str(path))
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                info = os.fstat(new)
                shared_tmp = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
                if info.st_uid not in (0, os.getuid()) or (info.st_mode & 0o022 and not shared_tmp):
                    raise ValueError('unsafe directory chain')
            except BaseException:
                os.close(new)
                raise
            os.close(fd)
            fd = new
        return fd
    except OSError:
        os.close(fd)
        raise ValueError('unsafe directory chain') from None
    except BaseException:
        os.close(fd)
        raise


def identity(info):
    return info.st_dev, info.st_ino


def read_file(parent_fd, name, owner_only=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    except OSError:
        raise ValueError('unsafe or missing file') from None
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('single-link regular file required')
        if owner_only and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) not in (0o400, 0o600)):
            raise ValueError('protected owner-only file required')
        data = stream.read()
        after = os.fstat(stream.fileno())
        if (identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (
                identity(after), after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('file changed during read')
    if identity(os.stat(name, dir_fd=parent_fd, follow_symlinks=False)) != identity(info):
        raise ValueError('file reference changed')
    return data, info


def protected(path):
    path = absolute_path(str(path))
    fd = open_directory(path.parent)
    try:
        return read_file(fd, path.name, owner_only=True)[0]
    finally:
        os.close(fd)


def validate_manifest(m):
    try:
        if not isinstance(m, dict) or set(m) != {
                'image', 'restartBudget', 'containerId', 'configDigest', 'nativeGate',
                'hostFacility', 'mountedSourceRoot', 'backupDirectory',
                'approvedPatchManifest', 'files', 'readiness'}:
            raise ValueError('unknown or incomplete deployment fields')
        if m['image'] != IMAGE or type(m['restartBudget']) is not int or m['restartBudget'] != 1:
            raise ValueError('image/restart budget mismatch')
        if not re.fullmatch(r'[0-9a-f]{64}', m['containerId']):
            raise ValueError('exact container identity required')
        if not re.fullmatch(r'[0-9a-f]{64}', m['configDigest']):
            raise ValueError('config digest required')
        gate = m['nativeGate']
        if not isinstance(gate, dict) or set(gate) != {
                'result', 'cases', 'verifier', 'sourceManifestHash', 'evidenceHash', 'patchSetHash'}:
            raise ValueError('unknown or incomplete gate fields')
        if gate['result'] != 'PASS' or set(gate['cases']) != GATES or any(v != 'PASS' for v in gate['cases'].values()):
            raise ValueError('independent native gate incomplete')
        if not isinstance(gate['verifier'], str) or gate['verifier'] == 'implementation-owner' or not gate['verifier'].strip():
            raise ValueError('independent verifier required')
        for key in ('sourceManifestHash', 'evidenceHash', 'patchSetHash'):
            if not re.fullmatch(r'[0-9a-f]{64}', gate[key]):
                raise ValueError('gate hashes required')
        facility = m['hostFacility']
        if not isinstance(facility, dict) or set(facility) != {'kind', 'attestedAvailable', 'launchedOnHost'}:
            raise ValueError('unknown or incomplete host facility fields')
        if facility['kind'] not in ('systemd-run', 'at', 'nohup') or facility['attestedAvailable'] is not True or facility['launchedOnHost'] is not True:
            raise ValueError('host facility not attested')
        absolute_path(m['mountedSourceRoot'])
        absolute_path(m['backupDirectory'])
        absolute_path(m['approvedPatchManifest'])
        if not isinstance(m['files'], list) or len(m['files']) != len(OUTPUTS):
            raise ValueError('approved files required')
        names = set()
        for f in m['files']:
            if not isinstance(f, dict) or set(f) != {
                    'path', 'operation', 'expectedAbsent', 'beforeHash', 'afterHash',
                    'artifact', 'mode', 'uid', 'gid'}:
                raise ValueError('explicit complete file operation required')
            name = f['path']
            if name not in OUTPUTS or name in names or f['operation'] != OUTPUTS[name]:
                raise ValueError('unapproved file path')
            names.add(name)
            absolute_path(f['artifact'])
            creating = f['operation'] == 'CREATE'
            if f['expectedAbsent'] is not creating:
                raise ValueError('explicit expected absence required')
            if creating:
                if f['beforeHash'] is not None:
                    raise ValueError('CREATE cannot replace existing source')
            elif not re.fullmatch(r'[0-9a-f]{64}', f['beforeHash']):
                raise ValueError('reviewed deployed source hash required')
            if not re.fullmatch(r'[0-9a-f]{64}', f['afterHash']):
                raise ValueError('exact artifact hash required')
            if (any(type(f[k]) is not int or not 0 <= f[k] < 2**32 - 1 for k in ('mode', 'uid', 'gid')) or
                    f['mode'] not in (0o600, 0o640, 0o644)):
                raise ValueError('approved safe owner/mode required')
        if sha(encoded(m['files']).encode()) != gate['patchSetHash']:
            raise ValueError('gate does not bind patch set')
        if ('readinessArgv' in m or 'readinessAttestedNoMutation' in m or
                m['readiness'] != {'kind': 'docker-health', 'status': 'healthy'}):
            raise ValueError('only structured Docker health comparison is allowed')
    except (KeyError, TypeError, AttributeError):
        raise ValueError('incomplete deployment manifest') from None
    return m


def command(argv, timeout=30):
    # Never log subprocess stdout/stderr: inspect may contain environment secrets.
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError('host command failed')
    return result.stdout


def inspect(container_id):
    data = json.loads(command(['docker', 'inspect', container_id]))[0]
    fingerprint = sha(encoded({k: data[k] for k in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}).encode())
    return data, fingerprint


def atomic_replace(path, data, mode, uid, gid, *, parent_fd=None, create=False, publication=None):
    if parent_fd is None:
        fd, name = tempfile.mkstemp(prefix='.rhythm-receiver-', dir=path.parent)
    else:
        name = '.rhythm-receiver-' + secrets.token_hex(16)
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent_fd)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fchmod(out.fileno(), mode)
            os.fchown(out.fileno(), uid, gid)
            os.fsync(out.fileno())
            if publication is not None:
                publication['inode'] = identity(os.fstat(out.fileno()))
        if parent_fd is None:
            os.replace(name, path)
        elif create:
            # link is the stdlib atomic no-clobber publication primitive.
            os.link(name, path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd,
                    follow_symlinks=False)
        else:
            os.replace(name, path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        if publication is not None:
            publication['committed'] = True
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if parent_fd is not None and identity(os.fstat(directory)) != identity(os.fstat(parent_fd)):
                raise ValueError('source directory changed')
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(name, dir_fd=parent_fd)  # Own temp only, never application data.
        except FileNotFoundError:
            pass

def fsync_directory(path, expected_fd=None):
    fd = open_directory(path)
    try:
        if expected_fd is not None and identity(os.fstat(fd)) != identity(os.fstat(expected_fd)):
            raise ValueError('durability directory changed')
        os.fsync(fd)
    finally:
        os.close(fd)


def run(m):
    validate_manifest(m)
    with ExitStack() as stack:
        return install(m, stack)


def install(m, stack):
    def directory(path):
        fd = open_directory(path)
        stack.callback(os.close, fd)
        return fd

    def unchanged_directory(path, fd):
        current = open_directory(path)
        try:
            if identity(os.fstat(current)) != identity(os.fstat(fd)):
                raise ValueError('directory chain changed')
        finally:
            os.close(current)

    def absent(fd, name):
        try:
            os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        raise ValueError('CREATE target must be absent')

    approved_path = Path(m['approvedPatchManifest'])
    approved_fd = directory(approved_path.parent)
    approved_bytes, approved_info = read_file(approved_fd, approved_path.name, True)
    if sha(approved_bytes) != m['nativeGate']['sourceManifestHash']:
        raise ValueError('approved source manifest digest mismatch')
    approved = json.loads(approved_bytes)
    if not isinstance(approved, dict) or set(approved) != set(OUTPUTS):
        raise ValueError('exact approved seven-output manifest required')
    for f in m['files']:
        if approved[f['path']] != {'before': f['beforeHash'], 'after': f['afterHash']}:
            raise ValueError('approved source/artifact hash binding mismatch')
    backup = Path(m['backupDirectory'])
    backup_parent_fd = directory(backup.parent)
    parent_info = os.fstat(backup_parent_fd)
    if parent_info.st_uid != os.getuid() or parent_info.st_mode & 0o077:
        raise ValueError('operator-owned protected backup parent required')
    absent(backup_parent_fd, backup.name)
    container, config_hash = inspect(m['containerId'])
    if container['Id'] != m['containerId'] or container['Image'] != IMAGE or config_hash != m['configDigest'] or not container['State']['Running']:
        raise ValueError('container/image/config preflight mismatch')
    health_test = container.get('Config', {}).get('Healthcheck', {}).get('Test')
    if (not isinstance(health_test, list) or len(health_test) < 2 or
            health_test[0] not in ('CMD', 'CMD-SHELL') or
            container['State'].get('Health', {}).get('Status') not in ('starting', 'healthy', 'unhealthy')):
        raise ValueError('existing configured Docker health required before writes')
    root = Path(m['mountedSourceRoot'])
    # Host-side source writes do not require a writable container bind mount.
    # Preserve the deployed read-only mount; require its exact application target.
    if not any(x.get('Source') == str(root) and x.get('Destination') == '/webui'
               for x in container['Mounts']):
        raise ValueError('approved application source mount absent')
    directory(root)
    prepared = []
    # Verify ALL source/artifact files before ANY application file replacement.
    for f in m['files']:
        target = root / f['path']
        parent_fd = directory(target.parent)
        artifact = Path(f['artifact'])
        artifact_fd = directory(artifact.parent)
        new, artifact_info = read_file(artifact_fd, artifact.name, True)
        if f['operation'] == 'CREATE':
            absent(parent_fd, target.name)
            old, info = None, None
        else:
            old, info = read_file(parent_fd, target.name)
            if (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) != (f['mode'], f['uid'], f['gid']):
                raise ValueError('deployed metadata does not match approval')
        if (old is not None and sha(old) != f['beforeHash']) or sha(new) != f['afterHash']:
            raise ValueError('source/artifact hash mismatch')
        prepared.append(dict(target=target, old=old, new=new, info=info, parent_fd=parent_fd,
                             artifact=artifact, artifact_fd=artifact_fd, artifact_info=artifact_info,
                             spec=f, publication={}))

    def recheck(record):
        target, fd, info = record['target'], record['parent_fd'], record['info']
        unchanged_directory(target.parent, fd)
        if info is None:
            absent(fd, target.name)
        else:
            data, current = read_file(fd, target.name)
            if (data != record['old'] or identity(current) != identity(info) or
                    (stat.S_IMODE(current.st_mode), current.st_uid, current.st_gid) !=
                    (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)):
                raise ValueError('source changed during install')
        artifact = record['artifact']
        unchanged_directory(artifact.parent, record['artifact_fd'])
        data, current = read_file(record['artifact_fd'], artifact.name, True)
        if data != record['new'] or identity(current) != identity(record['artifact_info']):
            raise ValueError('artifact changed during install')

    # Recheck the entire pinned plan before creating even the backup directory.
    for record in prepared:
        recheck(record)
    unchanged_directory(approved_path.parent, approved_fd)
    current_bytes, current_info = read_file(approved_fd, approved_path.name, True)
    if current_bytes != approved_bytes or identity(current_info) != identity(approved_info):
        raise ValueError('approved manifest changed')
    unchanged_directory(backup.parent, backup_parent_fd)
    os.mkdir(backup.name, mode=0o700, dir_fd=backup_parent_fd)
    backup_fd = directory(backup)
    for index, record in enumerate(prepared):
        if record['old'] is None:
            continue
        fd = os.open(str(index), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=backup_fd)
        with os.fdopen(fd, 'wb') as out:
            out.write(record['old'])
            out.flush()
            os.fsync(out.fileno())
    fd = os.open('original-metadata.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=backup_fd)
    with os.fdopen(fd, 'wb') as out:
        out.write(encoded(m['files']).encode())
        out.flush()
        os.fsync(out.fileno())
    fsync_directory(backup, backup_fd)
    fsync_directory(backup.parent, backup_parent_fd)
    # Persistent restart intent is written BEFORE invoking docker. Resuming the
    # same job cannot consume a second restart: backup path already exists.
    restarted = False
    attempted = []
    try:
        for record in prepared:
            recheck(record)
            f, target = record['spec'], record['target']
            # replace may commit before directory open/fsync/close raises.
            attempted.append(record)
            atomic_replace(target, record['new'], f['mode'], f['uid'], f['gid'],
                           parent_fd=record['parent_fd'], create=f['operation'] == 'CREATE',
                           publication=record['publication'])
        for record in prepared:
            unchanged_directory(record['target'].parent, record['parent_fd'])
            data, info = read_file(record['parent_fd'], record['target'].name)
            if sha(data) != record['spec']['afterHash'] or identity(info) != record['publication']['inode']:
                raise ValueError('installed source changed before restart')
        unchanged_directory(backup, backup_fd)
        current, current_hash = inspect(m['containerId'])
        if (current_hash != config_hash or current['Id'] != m['containerId'] or
                current['Image'] != IMAGE or not current['State']['Running']):
            raise ValueError('configuration changed before restart')
        fd = os.open('restart-intent', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=backup_fd)
        with os.fdopen(fd, 'wb') as out:
            out.write(b'ONE planned restart; ambiguous outcomes require operator review\n')
            out.flush()
            os.fsync(out.fileno())
        fsync_directory(backup, backup_fd)
        restarted = True
        command(['docker', 'restart', m['containerId']], timeout=120)
        for _ in range(30):
            current, current_hash = inspect(m['containerId'])
            if current_hash != config_hash or current['Image'] != IMAGE or current['Id'] != m['containerId']:
                raise RuntimeError('same image/config readiness failed')
            # Never execute a container-configured health command here. Only
            # compare the existing Docker health state returned by inspect.
            if current['State']['Running'] and current['State'].get('Health', {}).get('Status') == 'healthy':
                for record in prepared:
                    unchanged_directory(record['target'].parent, record['parent_fd'])
                    data, info = read_file(record['parent_fd'], record['target'].name)
                    f = record['spec']
                    if (sha(data) != f['afterHash'] or identity(info) != record['publication']['inode'] or
                            (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) !=
                            (f['mode'], f['uid'], f['gid'])):
                        raise ValueError('readiness source hash mismatch')
                return {'state': 'installed', 'plannedRestarts': 1, 'configurationPreserved': True}
            time.sleep(2)
        raise RuntimeError('readiness timeout')
    except BaseException:
        restoration = []
        for index, record in reversed(list(enumerate(attempted))):
            target, old, f, parent_fd = record['target'], record['old'], record['spec'], record['parent_fd']
            durable = True
            try:
                unchanged_directory(target.parent, parent_fd)
                try:
                    current = os.stat(target.name, dir_fd=parent_fd, follow_symlinks=False)
                except FileNotFoundError:
                    current = None
                ours = record['publication'].get('inode')
                original = identity(record['info']) if record['info'] is not None else None
                if current is not None and identity(current) not in (ours, original):
                    raise ValueError('rollback refuses foreign target')
                if old is None:
                    if current is not None:
                        os.unlink(target.name, dir_fd=parent_fd)  # Only our job-created inode.
                    fsync_directory(target.parent, parent_fd)
                else:
                    atomic_replace(target, old, f['mode'], f['uid'], f['gid'], parent_fd=parent_fd)
            except BaseException:
                # Continue restoring other attempted targets. Even matching bytes
                # do not prove durability after a rollback fsync/close failure.
                durable = False
            verified = False
            try:
                unchanged_directory(target.parent, parent_fd)
                if old is None:
                    absent(parent_fd, target.name)
                    verified = True
                else:
                    data, info = read_file(parent_fd, target.name)
                    verified = (data == old and stat.S_IMODE(info.st_mode) == f['mode'] and
                                info.st_uid == f['uid'] and info.st_gid == f['gid'])
            except (OSError, ValueError):
                pass
            restoration.append({'fileIndex': index, 'verified': verified, 'durable': durable})
        # No automatic second restart. The process may still have patched modules
        # loaded; source restoration is NOT a runtime rollback claim.
        restored = all(r['verified'] and r['durable'] for r in restoration)
        # A racing actor may have changed an UNattempted target. Do not erase it,
        # and do not claim the full approved source plan was restored either.
        for record in prepared[len(attempted):]:
            try:
                unchanged_directory(record['target'].parent, record['parent_fd'])
                if record['old'] is None:
                    absent(record['parent_fd'], record['target'].name)
                else:
                    data, info = read_file(record['parent_fd'], record['target'].name)
                    f = record['spec']
                    if (data != record['old'] or (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) !=
                            (f['mode'], f['uid'], f['gid'])):
                        restored = False
            except (OSError, ValueError):
                restored = False
        return {'state': ('source_restored_runtime_unqualified' if restored
                          else 'source_restore_unqualified'), 'restoration': restoration,
                'restartAttempted': restarted, 'rollbackRestartApprovalRequired': restarted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--execute-parent-authorized', action='store_true')
    args = parser.parse_args()
    try:
        m = validate_manifest(json.loads(protected(args.manifest)))
        result = run(m) if args.execute_parent_authorized else {'state': 'manifest_validated', 'execution': 'NOTRUN'}
        print(encoded(result))
        return 0 if result['state'] in ('installed', 'manifest_validated') else 1
    except Exception:
        print('{"state":"BLOCKED","reason":"host_preflight_or_manifest_incomplete"}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
