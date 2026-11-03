"""Clone the sealed shipping app, stage only compiled feature bytes; never install/launch."""
import hashlib
import json
import pathlib
import plistlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
ORIGINAL = pathlib.Path('/Applications/Rhythm.app')
STAGE = ROOT / 'apps/electron/dist/Rhythm.app'
BASE = 'c74f4392a6df61979fbe33e620a0077ebb6e0b4b'


def run(*args):
    return subprocess.check_output(args, cwd=ROOT)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root):
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and not p.is_symlink()}


assert ROOT == pathlib.Path('/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014')
assert run('git', 'rev-parse', 'HEAD').decode().strip() == BASE
assert not STAGE.exists() and not STAGE.is_symlink(), 'never overwrite a prior candidate'
run('codesign', '--verify', '--deep', '--strict', str(ORIGINAL))
entitlements = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(ORIGINAL)))
assert entitlements == plistlib.loads((ROOT / 'apps/electron/entitlements/mac.plist').read_bytes())
resources = ORIGINAL / 'Contents/Resources'
for package in ['api_server', 'mcp_server']:
    installed = json.loads((resources / package / 'package-lock.json').read_text())['packages']
    source = json.loads((ROOT / 'apps' / package / 'package-lock.json').read_text())['packages']
    for key in set(installed) | set(source):
        for field in ['version', 'resolved', 'integrity', 'dependencies', 'optionalDependencies']:
            assert installed.get(key, {}).get(field) == source.get(key, {}).get(field), (package, key, field)
    assert (ROOT / 'apps' / package / 'dist').is_dir()
preserved = {name: inventory(resources / name) for name in ['app', 'shared']}
STAGE.parent.mkdir(parents=True, exist_ok=True)
run('ditto', str(ORIGINAL), str(STAGE))
changed = {}
for package in ['api_server', 'mcp_server']:
    source = ROOT / 'apps' / package / 'dist'
    destination = STAGE / 'Contents/Resources' / package / 'dist'
    for path in sorted(source.rglob('*')):
        if not path.is_file() or path.is_symlink() or '__tests__' in path.parts:
            continue
        target = destination / path.relative_to(source)
        if target.exists() and digest(path) == digest(target):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        changed[f'{package}/dist/{path.relative_to(source)}'] = {
            'before': digest(target) if target.exists() else None, 'after': digest(path),
        }
        shutil.copyfile(path, target)
for name, files in preserved.items():
    assert inventory(STAGE / 'Contents/Resources' / name) == files, name
feature_files = sorted(set(run('git', 'diff', '--name-only').decode().splitlines()) | {
    p for p in run('git', 'ls-files', '--others', '--exclude-standard').decode().splitlines()
    if p.startswith(('apps/api_server/src/', 'apps/mcp_server/src/'))
})
source_hashes = {p: digest(ROOT / p) for p in feature_files if p.startswith(('apps/api_server/src/', 'apps/mcp_server/src/'))}
feature_digest = hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest()
identity_path = STAGE / 'Contents/Resources/api_server/build-identity.json'
identity = json.loads(identity_path.read_text())
assert identity['sourceRevision'] == BASE
identity.update(dirty=True, feature='hermes-shipping-rollout', featureSourceSha256=feature_digest)
identity_path.write_text(json.dumps(identity, sort_keys=True) + '\n')
receipt = {'status': 'UNSIGNED_COMPLETE_APP_NOT_INSTALLABLE', 'baseline': BASE,
           'candidate': str(STAGE), 'installedWrites': 0, 'restarts': 0,
           'featureSourceSha256': feature_digest, 'sourceFiles': source_hashes,
           'changedPayloadFiles': changed, 'preservedRendererLauncher': preserved,
           'originalEngineSha256': digest(resources / 'opencode_bin/opencode')}
receipt_path = STAGE.parent / 'hermes-shipping-stage.json'
with receipt_path.open('x') as f:
    json.dump(receipt, f, sort_keys=True, indent=2)
run('codesign', '--verify', '--deep', '--strict', str(ORIGINAL))
print(json.dumps({'stage': str(STAGE), 'changedPayloadFiles': len(changed),
                  'receipt': str(receipt_path), 'sha256': digest(receipt_path)}))
