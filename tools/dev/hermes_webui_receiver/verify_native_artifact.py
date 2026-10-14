"""Verify patched outputs AND every original source pin in a disposable copy."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def verify():
    pins = json.loads((ROOT / 'source_snapshot_manifest.json').read_text())['hashes']
    changes = json.loads((ROOT / 'native_patch_manifest.json').read_text())
    source = ROOT / 'source_snapshot'
    for name, record in changes.items():
        raw = (source / name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == record['after'], name
        if name.endswith('.py'):
            compile(raw, name, 'exec')
        elif name.endswith('.js'):
            subprocess.run(['node', '--check', str(source / name)], check=True)
    with tempfile.TemporaryDirectory() as directory:
        copied = Path(directory).resolve() / 'source'
        shutil.copytree(source, copied)
        # Only disposable artifact bytes are reversed, never the worktree/live host.
        subprocess.run(['git', 'apply', '--check', '--reverse', str(ROOT / 'native.patch')],
                       cwd=copied, check=True)
        subprocess.run(['git', 'apply', '--reverse', str(ROOT / 'native.patch')],
                       cwd=copied, check=True)
        for name, pin in pins.items():
            assert hashlib.sha256((copied / name).read_bytes()).hexdigest() == pin, name
    for name in ['test_native_http.py', 'native.py', 'build_native_patch.py',
                 'native.patch', 'native_patch_manifest.json', 'test_native_wakeup.py',
                 'test_native_browser.py', 'test_native_dom.mjs', 'verify_native_artifact.py']:
        print(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), name)
    print(f'PASS: {len(changes)} patched outputs; all {len(pins)} original pins recovered exactly; Python/JS syntax verified')


if __name__ == '__main__':
    verify()
