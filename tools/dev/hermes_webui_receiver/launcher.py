"""Protected staging launcher; default is read-only. Parent review required."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

STAGE = Path('/home/pi-nas/rhythm-notify-stage-bb4a5651')
UNIT = 'rhythm-notify-install-bb4a5651.service'


def require(condition):
    # Security checks must survive Python -O/-OO; never include private values.
    if not condition:
        raise ValueError('staging_or_host_guard_failed')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def protected_bytes(path):
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
            s = os.fstat(fd)
            require(s.st_uid in (0, os.getuid()) and not s.st_mode & 0o022)
        file_fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        with os.fdopen(file_fd, 'rb') as f:
            s = os.fstat(f.fileno())
            require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1)
            require((stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid) == (0o600, 1000, 1000))
            return f.read()
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-parent-authorized', action='store_true')
    parser.add_argument('--reviewed-candidate-sha')
    parser.add_argument('--independent-gate-reviewed')
    args = parser.parse_args()
    require(os.getuid() == os.getgid() == 1000)
    require(not Path('/.dockerenv').exists() and not Path('/run/.containerenv').exists())
    require(Path('/proc/1/comm').read_text().strip() == 'systemd')
    require(not any(marker in Path('/proc/self/cgroup').read_text().lower()
                    for marker in ('docker', 'kubepods', 'libpod', 'lxc')))
    require(Path('/usr/bin/systemd-run').is_file() and os.access('/usr/bin/systemd-run', os.X_OK))
    r = subprocess.run(['/usr/bin/systemctl', '--user', 'is-system-running'], capture_output=True, timeout=15)
    require(r.returncode == 0 and r.stdout.strip() == b'running')
    inventory = json.loads(protected_bytes(STAGE / 'inventory.json'))
    for name, expected in inventory.items():
        require('..' not in Path(name).parts and not Path(name).is_absolute())
        require(digest(protected_bytes(STAGE / name)) == expected)
    from hermes_webui_receiver import host_job as job
    require(Path(job.__file__) == STAGE / 'hermes_webui_receiver/host_job.py')
    require(Path(sys.modules['hermes_webui_receiver.receiver'].__file__) == STAGE / 'hermes_webui_receiver/receiver.py')
    require(Path(sys.modules['hermes_notify_subscriber'].__file__) == STAGE / 'hermes_notify_subscriber.py')
    raw = job.protected(STAGE / 'candidate-manifest.json')
    m = json.loads(raw)
    require(m['hostFacility'] == dict(kind='systemd-run', attestedAvailable=True, launchedOnHost=False))
    require(digest(job.protected(STAGE / 'independent-gate-evidence.json')) == m['nativeGate']['evidenceHash'])
    require(digest(job.protected(m['approvedPatchManifest'])) == m['nativeGate']['sourceManifestHash'])
    require(m['backupDirectory'] == str(STAGE / 'backup'))
    require(not os.path.lexists(m['backupDirectory']))
    require(not os.path.lexists(STAGE / 'executed-manifest.json'))
    container, config_digest = job.inspect(m['containerId'])
    require(container['Id'] == m['containerId'] and container['Image'] == m['image'])
    require(config_digest == m['configDigest'] and container['State']['Running'])
    require(container['State'].get('Health', {}).get('Status') == 'healthy')
    health = container.get('Config', {}).get('Healthcheck', {}).get('Test')
    require(isinstance(health, list) and len(health) >= 2 and health[0] in ('CMD', 'CMD-SHELL'))
    require(any(x.get('Source') == m['mountedSourceRoot'] and x.get('Destination') == '/webui'
                and x.get('RW') is False for x in container['Mounts']))
    evidence = json.loads(job.protected(STAGE / 'independent-gate-evidence.json'))
    source = Path(m['mountedSourceRoot'])
    for name, pin in evidence['originalSourcePins'].items():
        fd = job.open_directory((source / name).parent)
        try:
            data, _ = job.read_file(fd, (source / name).name)
            require(job.sha(data) == pin)
        finally:
            os.close(fd)
    before = {}
    for f in m['files']:
        require(job.sha(job.protected(f['artifact'])) == f['afterHash'])
        fd = job.open_directory((source / f['path']).parent)
        try:
            if f['operation'] == 'CREATE':
                require(not os.path.lexists(source / f['path']))
                before[f['path']] = {'absent': True, 'plannedMode': f['mode'], 'uid': f['uid'], 'gid': f['gid']}
            else:
                data, s = job.read_file(fd, (source / f['path']).name)
                require(job.sha(data) == f['beforeHash'])
                require((stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid) == (f['mode'], f['uid'], f['gid']))
                before[f['path']] = {'sha256': job.sha(data), 'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}
        finally:
            os.close(fd)
    executed = copy.deepcopy(m)
    # This actual read-only SSH host process supplies validation-only host proof;
    # candidate remains false. Execution additionally requires actual user service.
    executed['hostFacility']['launchedOnHost'] = True
    job.validate_manifest(executed)
    if not args.execute_parent_authorized:
        print(job.encoded(dict(state='read_only_preflight_pass', execution='NOTRUN',
                               candidateSHA=job.sha(raw), configDigest=config_digest,
                               serviceLaunched=False, candidateLaunchedOnHost=False,
                               hostProcessProof='PID1 systemd; self cgroup has no container markers; no container marker files',
                               before=before, facility='systemd-run user manager running',
                               backupAbsent=True, executedManifestAbsent=True)))
        return 0
    require(args.reviewed_candidate_sha == job.sha(raw))
    require(args.independent_gate_reviewed == m['nativeGate']['evidenceHash'])
    require(os.environ.get('INVOCATION_ID'))
    properties = job.command(['/usr/bin/systemctl', '--user', 'show', UNIT,
                              '--property=MainPID', '--property=ActiveState', '--property=InvocationID']).decode()
    props = dict(line.split('=', 1) for line in properties.splitlines())
    require(props['MainPID'] == str(os.getpid()) and props['ActiveState'] == 'active')
    require(props['InvocationID'] == os.environ['INVOCATION_ID'])
    fd = os.open(STAGE / 'executed-manifest.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(job.encoded(executed).encode())
        out.flush()
        os.fsync(out.fileno())
    job.fsync_directory(STAGE)
    # Only parent-authorized actual independent user-service execution reaches CLI.
    result = subprocess.run(['/usr/bin/python3', '-B', '-m', 'hermes_webui_receiver.host_job',
                             '--manifest', str(STAGE / 'executed-manifest.json'),
                             '--execute-parent-authorized'], cwd=STAGE)
    return result.returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('{"state":"BLOCKED","reason":"staging_or_host_guard_failed","execution":"NOTQUALIFIED"}')
        raise SystemExit(1)
