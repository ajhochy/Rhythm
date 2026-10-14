"""Read-only signed candidate verification; never launch either application."""
import hashlib
import json
import pathlib
import plistlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
STAGE = ROOT / 'apps/electron/dist/Rhythm.app'
ORIGINAL = pathlib.Path('/Applications/Rhythm.app')
receipt = json.loads((STAGE.parent / 'hermes-shipping-stage.json').read_text())


def run(*args):
    return subprocess.check_output(args)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root):
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and not p.is_symlink()}


for app in [ORIGINAL, STAGE]:
    run('codesign', '--verify', '--deep', '--strict', str(app))
    metadata = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)], capture_output=True, check=True).stderr.decode()
    assert 'TeamIdentifier=56Q69NYP9H' in metadata
    assert 'runtime' in metadata
original_entitlements = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(ORIGINAL)))
candidate_entitlements = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(STAGE)))
assert original_entitlements == candidate_entitlements
for name, expected in receipt['preservedRendererLauncher'].items():
    assert inventory(STAGE / 'Contents/Resources' / name) == expected, name
    assert inventory(ORIGINAL / 'Contents/Resources' / name) == expected, name
for name, expected in receipt['changedPayloadFiles'].items():
    path = STAGE / 'Contents/Resources' / name
    assert digest(path) == expected['after'], name
    before = ORIGINAL / 'Contents/Resources' / name
    assert (digest(before) if before.exists() else None) == expected['before'], name
for name, expected in receipt['sourceFiles'].items():
    assert digest(ROOT / name) == expected, name
assert digest(ORIGINAL / 'Contents/Resources/opencode_bin/opencode') == receipt['originalEngineSha256']
files = inventory(STAGE)
tree_hash = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
archive = STAGE.parent / 'Rhythm-hermes-shipping-signed-only.zip'
assert sys.argv[1:] in [[], ['--archive']]
if sys.argv[1:] == ['--archive']:
    assert not archive.exists() and not archive.is_symlink(), 'never overwrite an archived candidate'
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(STAGE), str(archive))
print(json.dumps({'status': 'SIGNED_COMPLETE_APP_NOT_NOTARIZED_FEATURE_INCOMPLETE',
                  'candidate': str(STAGE), 'team': '56Q69NYP9H', 'codesignDeepStrict': 'PASS',
                  'originalDeepStrict': 'PASS', 'entitlements': 'UNCHANGED',
                  'rendererLauncher': 'BYTE_IDENTICAL', 'compiledPayloadFiles': len(receipt['changedPayloadFiles']),
                  'regularFileInventorySha256': tree_hash, 'files': len(files),
                  'archive': str(archive) if archive.exists() else None,
                  'archiveSha256': digest(archive) if archive.exists() else None,
                  'installedWrites': 0, 'restarts': 0}))
