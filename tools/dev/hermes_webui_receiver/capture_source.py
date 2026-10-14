"""One read-only, strict-SSH application snapshot; no remote imports or writes."""
import hashlib
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile


REMOTE = r'''
import hashlib, io, json, os, sys, tarfile
from pathlib import Path
root = Path('/webui')
excluded = {'.git', 'node_modules', '__pycache__', 'config', 'config-data', 'data', 'chats', 'logs', 'cache', 'credentials', 'sessions', 'uploads'}
paths = []
for folder in ('api', 'static'):
    for directory, dirs, files in os.walk(root / folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in excluded and not d.startswith('.') and not (Path(directory) / d).is_symlink())
        for name in sorted(files):
            p = Path(directory) / name
            if not p.is_symlink() and not name.startswith('.') and p.suffix in ('.py', '.js', '.css', '.html'):
                paths.append(p)
for name in ('server.py', 'bootstrap.py', 'managed_agent_startup.py', 'mcp_server.py', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'package.json'):
    p = root / name
    if p.is_file() and not p.is_symlink():
        paths.append(p)
with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as archive:
    for p in sorted(paths):
        content = p.read_bytes()
        info = tarfile.TarInfo(p.relative_to(root).as_posix())
        info.size = len(content)
        info.mode = 0o600
        archive.addfile(info, io.BytesIO(content))
'''


def main():
    base = Path(__file__).resolve().parent
    destination = base / 'source_snapshot'
    if destination.exists():
        raise ValueError('snapshot already exists; never overwrite')
    remote_command = 'docker exec hermes-webui-trial python3 -B -c ' + shlex.quote(REMOTE)
    result = subprocess.run(['ssh', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes',
                             '-oConnectTimeout=8', 'pi-nas@100.109.210.55', remote_command],
                            capture_output=True, timeout=120, check=True)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        for member in archive:
            path = Path(member.name)
            if (not member.isfile() or path.is_absolute() or '..' in path.parts or
                    member.name in files):
                raise ValueError('unsafe source archive')
            files[member.name] = archive.extractfile(member).read()
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    guard = json.loads((base / 'source_guard.json').read_text())
    for name, digest in guard['sourceHashes'].items():
        if hashes.get(name) != digest:
            raise ValueError('pinned source mismatch: ' + name)
    destination.mkdir(mode=0o700)
    for name, data in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o600)
    manifest = dict(image=guard['image'], revision=None, container='hermes-webui-trial',
                    sourceRoot='/webui', hashes=hashes, archiveHash=hashlib.sha256(result.stdout).hexdigest())
    (base / 'source_snapshot_manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print(json.dumps(dict(state='HASH_PINNED_SOURCE_COPY', files=len(files),
                         archiveHash=manifest['archiveHash'])))


if __name__ == '__main__':
    main()
