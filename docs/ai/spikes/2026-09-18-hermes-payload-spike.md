---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-b2-hermes-spike
status: partial
tags: [spike, rhythm, hermes, packaging]
---

# Hermes arm64 payload — Phase 0

**Recommendation: NO-GO for Phase 2 on this evidence.** The relocatable-interpreter
approach is promising: a diagnostic copy runs both requested commands after moving,
and all 71 native files accept ad-hoc signing. However, a clean, locked Python 3.12
Hermes install could not be built in this network-restricted worker. The diagnostic
uses installed Python 3.11 packages, includes extra dependencies, and differs from
the lock. It must not become the release payload. This is an evidence/environment
blocker, not a finding that Hermes cannot be packaged.

Continue with approach 1 on a builder with approved artifact access or a complete
offline wheelhouse. Do not change `apps/electron/scripts/package-mac.mjs` yet.

## Results

Sizes are allocated disk space from `du -sk`, divided by 1024 for MiB. Mach-O counts
are regular files detected by magic and confirmed by `file`; internal symlink
aliases are counted once. N/A means no artifact was built, not zero size/code.

| Approach | Works? (`--version`; `serve --help`) | Size | Mach-O count | Absolute-path leaks | Notes |
|---|---|---:|---:|---|---|
| 1. uv relocatable venv + Python 3.12.13 standalone | **Blocked**: Hermes installation failed; interpreter alone works after relocation | **74.1 MiB**, interpreter + empty venv only | **11**, interpreter only | Raw venv: absolute `home` and interpreter symlink. After normalization: 0 files contain this `.spike` path; 393 contain the original uv install path | Download failed on DNS; used a copied local interpreter for diagnostics. Locked dependencies and exact build backend could not be resolved offline. This is not a measured complete Hermes payload. |
| Supplemental approach-1 diagnostic: copied installed Python 3.11.15 dependencies + archived Hermes source | **Yes; yes**, exit 0, after relocation and after ad-hoc re-signing | **404.5 MiB** after re-signing; 404.0 MiB before | **71**: 1 executable, 25 dylibs, 45 `.so` files | 0 `.spike` content matches after cold no-bytecode test; 261 files contain original `.hermes` paths | 138 installed distributions; `nemo-relay` 0.7.1 versus lock 0.7.2. Source modules copied into site-packages, not installed from a newly built wheel. Not a release candidate. |
| 2. PyInstaller onedir | **Blocked**: PyInstaller could not be installed | N/A | N/A | Not measured | Requested only after approach 1 remained unqualified. PyPI DNS failure; no onedir build attempted. |
| 3. shiv | **Blocked**: shiv could not be installed | N/A | N/A | Not measured | PyPI DNS failure. Independently, shiv needs a compatible external interpreter and extracts dependencies into a runtime cache; it would still need the bundled interpreter and additional immutable-payload work. [shiv documentation](https://shiv.readthedocs.io/en/latest/) |

The complete Python 3.12 payload's size, native count, and CLI behavior remain
**unknown**. Do not substitute the diagnostic's numbers for those measurements.

## Inputs and boundaries

- Launch: 2026-09-18 18:58:11 PDT (2026-09-19 01:58:11 UTC); 45-minute deadline
  19:43:11 PDT. Branch and write probe passed before work.
- Rhythm base: `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`.
- Host: macOS 26.5.2, arm64; Node 22.23.0; uv 0.11.8.
- Hermes source: `~/.hermes/hermes-agent`, version 0.20.5, commit
  `68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`. Used `git archive HEAD` into `.spike/source`
  to avoid writing build metadata into the operator's checkout. Existing local
  deletions/untracked files were excluded and left untouched.
- `pyproject.toml`: Python `>=3.11,<3.14`; build backend requires
  `setuptools==83.0.0`. Despite the brief's shorthand, several core dependencies
  have ranges, including FastAPI, uvicorn, urllib3 and nemo-relay. Enforce `uv.lock`.
- Source lock SHA-256:
  `77dc0848db9647989f05f664298b48fe63f8cb3a11dae14d04678508372d07d7`.
- Source pyproject SHA-256:
  `04115a32c0be51373dfb51eb44243fe66eab97e87a84e992bbbb7fae9e79eead`.
- Copied local Python 3.12.13 executable SHA-256:
  `bc9a27bd52c265e86fcd73ef1d4165ec8a47695cffb7624cb0ee618dca83e6c0`.
  It reports a June 2 build; it is not provenance-equivalent to the failed
  uv download of the `20260414` standalone artifact.
- All output, caches, HOME directories, source copies, signing mutations and
  deletions are under `.spike/`. `.spike/.gitignore` contains `*`. No service was
  started, no socket bound, no credentials inherited by CLI probes, no commit made.
- `gh issue view 1534 --repo ajhochy/Rhythm --json title,body,url` failed connecting
  to GitHub. The four #1534 requirements below come from the worker brief; the full
  issue was not independently read.

## What the experiments establish

**Relocation requires explicit interpreter handling.** `uv venv --relocatable`
made relocatable console scripts but retained an absolute interpreter symlink and
`home` in `pyvenv.cfg`. Replacing `venv/bin/python` with a relative link to the
copied interpreter and removing `home` worked for the two tested CPython versions.
Both trees were renamed to paths containing spaces; the former paths no longer
existed. Hermes probes ran from `.spike/empty-cwd` with only a temporary HOME and
`PATH=/usr/bin:/bin` (plus bytecode suppression in the indicated tests).
This is a measured recipe for these interpreters, not a guarantee for other builds.
uv documents the limits of relocatable entry points in its [CLI reference](https://docs.astral.sh/uv/reference/cli/#uv-venv).

Python 3.12 loaded `ssl` and `sqlite3` after relocation. The diagnostic returned:

```text
Hermes Agent v0.20.5 (2026.8.19)
Install method: unknown
Python: 3.11.15
OpenAI SDK: 2.24.0

usage: hermes serve [-h] [--port PORT] [--host HOST] [--insecure] ...
```

**Bytecode writes must be controlled before sealing the app.** The default two
commands created 254 `.pyc` files in the diagnostic payload. Removing precisely
those generated files and repeating with `PYTHONDONTWRITEBYTECODE=1` produced zero
created, changed, or deleted payload files by SHA-256 comparison. The same held
after re-signing. HOME received `.hermes/SOUL.md` and three log files, outside the
payload. This proves the two CLI paths only; it does not prove a running server,
updater, lazy dependency installer or plugin never writes into its installation.

**A zero `.spike` grep is insufficient.** The copied 3.12 interpreter retains 391
bytecode filenames, one `_sysconfigdata__darwin_darwin.py`, and the
`libpython3.12.dylib` install ID containing its old uv root. The 3.11 diagnostic
retains 258 bytecode files, sysconfig data, the libpython install ID, and Hermes'
editable-install `direct_url.json` containing the old `.hermes` root. The editable
import hooks themselves were removed. Neither relocated tree has an escaping or
broken symlink (12 links each). The absolute libpython string was confirmed with
`otool -D` as the library's **own install ID**; the 3.12 executable's `otool -L`
lists system libraries. It is not evidence that the successful interpreter probe
loaded libpython from the operator's directory.

## Signing inventory and notarization risks

The Python 3.12-only tree's exact signing targets are:

```text
python/bin/python3.12
python/lib/libpython3.12.dylib
python/lib/libtcl9.0.dylib
python/lib/libtcl9tk9.0.dylib
python/lib/thread3.0.4/libtcl9thread3.0.4.dylib
python/lib/thread3.0.4/libthread3.0.4.dylib
python/lib/itcl4.3.5/libitcl4.3.5.dylib
python/lib/itcl4.3.5/libtcl9itcl4.3.5.dylib
python/lib/python3.12/lib-dynload/_crypt.cpython-312-darwin.so
python/lib/python3.12/lib-dynload/_dbm.cpython-312-darwin.so
python/lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so
```

For the diagnostic, sign the interpreter, all 7 interpreter dylibs, 4 stdlib
extensions, all 41 site-packages `.so` files, and all 18 hidden
`PIL/.dylibs/*.dylib` files. The inventory procedure below emits the complete
71-path list to `.spike/logs/diagnostic311-sign-list.txt`, along with every file's
SHA-256 and native linkage. Do not rely on executable permission bits or omit
hidden dependency directories.

- Initially all 71 arm64 slices displayed ad-hoc signatures and none enabled the
  hardened runtime. Five universal binaries failed default strict verification
  because their x86_64 slices were unsigned: `google/_upb/_message.abi3.so`, both
  `charset_normalizer/md*.so` files, `nacl/_sodium.abi3.so`, and `uvloop/loop*.so`.
  The explicit arm64 verification of uvloop succeeded while x86_64 signature
  display reported “code object is not signed at all.”
- In the copied diagnostic only, `codesign --force --sign -` succeeded for all
  71 targets, followed by 71/71 successful `codesign --verify --strict` checks.
  Post-signing CLI probes passed. This establishes ad-hoc signability, not
  Developer ID, hardened-runtime compatibility, Gatekeeper or notarization.
- Phase 2 must sign nested native code with the distribution identity, enable the
  hardened runtime for executables, use timestamps, then seal the containing app.
  Test the actual identity and library-validation behavior; no entitlement
  relaxation was proposed or tested. Apple describes the requirements in
  [Creating distribution-signed code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
  and [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution?language=objc).
- Normalize/remove build-location metadata before signing; if Mach-O install
  names or slices change, sign afterward. Record inventory hashes after these
  mutations and native signing. Prevent runtime bytecode and dependency installs
  from mutating sealed resources. Apple's [Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/)
  explains nested-code sealing and library-location restrictions.
- PyInstaller supports signing collected native code, but no PyInstaller artifact
  was produced here. Its documented signing support is not experimental evidence
  for Hermes. [PyInstaller macOS notes](https://pyinstaller.org/en/stable/feature-notes.html#macos-binary-code-signing)

## Phase 2 gates under the brief's #1534 rules

1. **Manifest:** pin the Hermes commit, uv and standalone artifact/version/hash,
   Python ABI/architecture, chosen extras, lock digest, entry point and minimum
   supported macOS. Build non-editable from the lock with reviewed build inputs.
   The copied 138-distribution environment is unsuitable input.
2. **Inventory hashes:** inventory every regular file and symlink target, reject
   escaping links and unexpected native architectures, list every Mach-O target,
   normalize paths and sign native files, then hash the final payload before the
   outer app seal. Verify it again after startup. This spike generated local
   inventories but did not implement Rhythm's manifest/inventory contract.
3. **Offline start:** obtain a fresh-HOME, network-denied **real server startup**
   test from the signed app on a clean Mac with no developer Python/uv/Hermes.
   Version/help do not exercise server import closure, JSON-RPC/WebSocket routes,
   provider configuration, plugin data or lazy installs. A nested deny-network
   `sandbox-exec` preflight was rejected by the host (`sandbox_apply: Operation
   not permitted`), so no independent network-denial proof is claimed here.
4. **Licenses:** assemble notices for Hermes, CPython, every shipped distribution
   and bundled native library (including Pillow codecs and Tcl/Tk). Hermes declares
   MIT and includes LICENSE; the interpreter includes Python's LICENSE.txt.
   A diagnostic metadata scan found license/copying paths in 131/138 distributions;
   the remaining seven need inspection, not an assumption of missing permission.
   This is not a completed license inventory or legal review.

## Reproduction and captured checks

Use this worktree root throughout; do not run builds in `~/.hermes`. The commands
below intentionally retain failed attempts. The networked route is expected to
fail in this worker. On a fresh authorized builder it needs the same pinned inputs
and a re-measurement; no successful clean-build command is claimed here.

```sh
pwd
git rev-parse --abbrev-ref HEAD
echo ok > .write-probe && rm .write-probe
mkdir -p .spike
printf '*\n' > .spike/.gitignore
mkdir -p .spike/tmp .spike/logs .spike/build-home .spike/python-bin .spike/uv-cache
export UV_CACHE_DIR="$PWD/.spike/uv-cache"
export UV_PYTHON_BIN_DIR="$PWD/.spike/python-bin"
export UV_LINK_MODE=copy
export TMPDIR="$PWD/.spike/tmp"
UV=/Users/ajhochhalter/.local/bin/uv

"$UV" python install 3.12 --install-dir .spike/python
# Observed exit 1: GitHub DNS lookup failed after three retries.

# Offline fallback: copy the existing interpreter, preserving internal links.
mkdir -p .spike/payload .spike/source
/usr/bin/python3 -B - <<'PY'
from pathlib import Path
import shutil
source = Path('/Users/ajhochhalter/.local/share/uv/python/cpython-3.12-macos-aarch64-none').resolve()
shutil.copytree(source, '.spike/payload/python', symlinks=True)
PY
git -C /Users/ajhochhalter/.hermes/hermes-agent archive HEAD | tar -x -C .spike/source
cp -R /Users/ajhochhalter/.cache/uv/. .spike/uv-cache/
"$UV" venv --relocatable --python "$PWD/.spike/payload/python/bin/python3.12" .spike/payload/venv
"$UV" export --offline --frozen --no-dev --no-emit-project --project .spike/source \
  --format requirements-txt --output-file .spike/requirements.lock.txt
"$UV" pip install --offline --python .spike/payload/venv/bin/python \
  --require-hashes -r .spike/requirements.lock.txt
# Observed exit 1: annotated-doc==0.0.4 could not be resolved from usable cache.
"$UV" build --offline --wheel --python .spike/payload/python/bin/python3.12 \
  --out-dir .spike/wheels .spike/source
# Observed exit 2: setuptools==83.0.0 could not be resolved from usable cache.
env UV_HTTP_RETRIES=0 UV_HTTP_TIMEOUT=10 "$UV" pip install \
  --python .spike/payload/venv/bin/python .spike/source
# Observed exit 2: PyPI /simple/croniter/ DNS lookup failed.
env UV_HTTP_RETRIES=0 UV_HTTP_TIMEOUT=10 "$UV" pip install \
  --python .spike/payload/venv/bin/python pyinstaller
env UV_HTTP_RETRIES=0 UV_HTTP_TIMEOUT=10 "$UV" pip install \
  --python .spike/payload/venv/bin/python shiv
# Both exit 2: respective PyPI DNS lookup failures. No alternative builds.

# Normalize this interpreter-only diagnostic before moving it.
.spike/payload/python/bin/python3.12 -B - <<'PY'
from pathlib import Path
link = Path('.spike/payload/venv/bin/python')
link.unlink()
link.symlink_to('../../python/bin/python3.12')
cfg = Path('.spike/payload/venv/pyvenv.cfg')
cfg.write_text('\n'.join(s for s in cfg.read_text().splitlines()
                         if not s.startswith('home = ')) + '\n')
PY
mv .spike/payload '.spike/relocated payload'
mkdir -p .spike/interpreter-final-home
env -i HOME="$PWD/.spike/interpreter-final-home" PATH=/usr/bin:/bin \
  PYTHONDONTWRITEBYTECODE=1 "$PWD/.spike/relocated payload/venv/bin/python" -B \
  -c 'import sys,ssl,sqlite3; print(sys.version); print(sys.prefix); print(sys.base_prefix); print(ssl.OPENSSL_VERSION); print(sqlite3.sqlite_version)'
# Exit 0: Python 3.12.13; relocated prefixes; OpenSSL 3.5.6; SQLite 3.53.1.
```

The first local interpreter copy accidentally dereferenced internal aliases; it
was replaced inside `.spike` with `copytree(..., symlinks=True)` before the final
inventory. The recipe above directly creates that final layout. The failed
download and local interpreter are distinct build inputs, as recorded above.

The diagnostic helpers below are reproduced in full so this document does not
depend on ignored `.spike` files surviving. Save each to the indicated path.

### `.spike/build-diagnostic.py`

```python
"""Offline diagnostic only: installed Python 3.11 deps, not a lock-clean build."""
from pathlib import Path
import shutil
import subprocess
import tomllib

spike = Path(__file__).resolve().parent
upstream = Path('/Users/ajhochhalter/.hermes/hermes-agent')
target = spike / 'diagnostic-311'
target.mkdir()
interpreter = (upstream / 'venv/bin/python').resolve().parent.parent
shutil.copytree(interpreter, target / 'python', symlinks=True)
subprocess.run([
    '/Users/ajhochhalter/.local/bin/uv', 'venv', '--relocatable',
    '--python', str(target / 'python/bin/python3.11'), str(target / 'venv')
], check=True)
site = target / 'venv/lib/python3.11/site-packages'
shutil.copytree(upstream / 'venv/lib/python3.11/site-packages', site,
                symlinks=True, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
# Remove the editable install hooks so no imports reach the operator's source.
for item in site.glob('__editable__*hermes*'):
    item.unlink()
metadata = tomllib.loads((spike / 'source/pyproject.toml').read_text())
settings = metadata['tool']['setuptools']
for name in settings['py-modules']:
    shutil.copy2(spike / 'source' / (name + '.py'), site)
for name in settings['packages']['find']['include']:
    if '.' not in name:
        shutil.copytree(spike / 'source' / name, site / name, dirs_exist_ok=True)
shutil.copy2(upstream / 'venv/bin/hermes', target / 'venv/bin/hermes')
python_link = target / 'venv/bin/python'
python_link.unlink()
python_link.symlink_to('../../python/bin/python3.11')
cfg = target / 'venv/pyvenv.cfg'
cfg.write_text('\n'.join(line for line in cfg.read_text().splitlines()
                         if not line.startswith('home = ')) + '\n')
print('Diagnostic payload:', target)
print('Copied installed distributions; not a uv.lock-qualified build.')
```

### `.spike/probe-payload.py`

```python
"""Run only version/help, with a clean environment and no inherited credentials."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile

spike = Path(__file__).resolve().parent
payload = Path(sys.argv[1]).resolve()
label = sys.argv[2]
no_bytecode = '--no-bytecode' in sys.argv[3:]
cwd = spike / 'empty-cwd'
cwd.mkdir(exist_ok=True)
home = Path(tempfile.mkdtemp(prefix=label + '-home-', dir=spike))
environment = {'HOME': str(home), 'PATH': '/usr/bin:/bin'}
if no_bytecode:
    environment['PYTHONDONTWRITEBYTECODE'] = '1'

def snapshot():
    return {str(p.relative_to(payload)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in payload.rglob('*') if p.is_file() and not p.is_symlink()}

before = snapshot()
results = []
for name, args in [('version', ['--version']), ('serve-help', ['serve', '--help'])]:
    command = [str(payload / 'venv/bin/hermes'), *args]
    try:
        proc = subprocess.run(command, cwd=cwd, env=environment, capture_output=True,
                              text=True, timeout=30)
        output = proc.stdout + proc.stderr
        code = proc.returncode
    except (OSError, subprocess.TimeoutExpired) as exc:
        output = str(exc)
        code = -1
    (spike / 'logs' / f'{label}-{name}.log').write_text(output)
    results.append({'command': command, 'exit_code': code, 'output': output})
    print(name, 'exit', code, '\n', output[-2500:])
after = snapshot()
record = {'payload': str(payload), 'environment': environment, 'cwd': str(cwd),
          'commands': results,
          'created': sorted(after.keys() - before.keys()),
          'deleted': sorted(before.keys() - after.keys()),
          'changed': sorted(k for k in before.keys() & after.keys() if before[k] != after[k]),
          'home_files': sorted(str(p.relative_to(home)) for p in home.rglob('*') if p.is_file())}
(spike / 'logs' / f'{label}-probe.json').write_text(json.dumps(record, indent=2))
print('Payload changes:', {k: len(record[k]) for k in ['created', 'deleted', 'changed']})

raise SystemExit(any(result["exit_code"] != 0 for result in results))
```

### `.spike/inventory.py`

```python
"""Read-only payload inventory: hashes, native code, links, and path leaks."""
from collections import Counter
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

spike = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve()
label = sys.argv[2]
magic = {bytes.fromhex(v) for v in ['feedface', 'cefaedfe', 'feedfacf',
                                  'cffaedfe', 'cafebabe', 'bebafeca',
                                  'cafebabf', 'bfbafeca']}
needles = {'spike': str(spike).encode(),
           'operator_hermes': b'/Users/ajhochhalter/.hermes',
           'operator_uv': b'/Users/ajhochhalter/.local/share/uv',
           'operator_cache': b'/Users/ajhochhalter/.cache'}
files, natives, links, leaks = [], [], [], {k: [] for k in needles}
logical_bytes = 0
for directory, dirs, names in os.walk(root, followlinks=False):
    for name in sorted(dirs + names):
        path = Path(directory) / name
        relative = str(path.relative_to(root))
        if path.is_symlink():
            resolved = path.resolve()
            links.append({'path': relative, 'target': os.readlink(path),
                          'escapes': not resolved.is_relative_to(root),
                          'exists': path.exists()})
        elif path.is_file():
            data = path.read_bytes()
            logical_bytes += len(data)
            files.append({'path': relative, 'size': len(data),
                          'sha256': hashlib.sha256(data).hexdigest()})
            for key, needle in needles.items():
                if needle in data:
                    leaks[key].append(relative)
            if data[:4] in magic:
                kind = subprocess.check_output(['/usr/bin/file', '-b', str(path)], text=True).strip()
                if 'Mach-O' not in kind:
                    continue
                sign = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=4', str(path)],
                                      capture_output=True, text=True)
                verify = subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(path)],
                                        capture_output=True, text=True)
                details = sign.stdout + sign.stderr
                status = ('unsigned' if sign.returncode else
                          'ad-hoc' if 'Signature=adhoc' in details else 'identity-signed')
                deps = subprocess.run(['/usr/bin/otool', '-L', str(path)],
                                      capture_output=True, text=True)
                natives.append({'path': relative, 'type': kind, 'signature': status,
                                'verify_exit': verify.returncode,
                                'verify_output': verify.stdout + verify.stderr,
                                'hardened_runtime': 'runtime)' in details,
                                'dependencies': deps.stdout.splitlines()[1:]})
du = subprocess.check_output(['/usr/bin/du', '-sk', str(root)], text=True)
record = {'root': str(root), 'regular_file_count': len(files),
          'logical_bytes': logical_bytes, 'allocated_kib': int(du.split()[0]),
          'macho_count': len(natives),
          'signature_counts': dict(Counter(n['signature'] for n in natives)),
          'verify_failure_count': sum(n['verify_exit'] != 0 for n in natives),
          'hardened_runtime_count': sum(n['hardened_runtime'] for n in natives),
          'macho_types': dict(Counter('dylib' if n['path'].endswith('.dylib') else
                                     'so' if n['path'].endswith('.so') else 'other'
                                     for n in natives)),
          'absolute_path_leaks': leaks, 'links': links,
          'native_files': natives, 'files': files}
(spike / 'logs' / f'{label}-inventory.json').write_text(json.dumps(record, indent=2))
(spike / 'logs' / f'{label}-sign-list.txt').write_text('\n'.join(n['path'] for n in natives)+'\n')
print(json.dumps({k: record[k] for k in ['regular_file_count', 'logical_bytes',
      'allocated_kib', 'macho_count', 'signature_counts', 'verify_failure_count',
      'hardened_runtime_count', 'macho_types']}, indent=2))
print('Leak file counts:', {key: len(value) for key, value in leaks.items()})
print('Symlinks:', len(links), 'escaping:', sum(link['escapes'] for link in links),
      'broken:', sum(not link['exists'] for link in links))
```

### Diagnostic and signing commands

Continue with the scoped environment variables from above. The probe helper exits
nonzero if either command fails; each child has a 30-second timeout. Its JSON
contains the exact clean environment, stdout/stderr, individual exit codes,
payload hash changes and HOME writes.

```sh
'.spike/relocated payload/python/bin/python3.12' -B .spike/build-diagnostic.py
mv .spike/diagnostic-311 '.spike/relocated diagnostic 311'
'.spike/relocated payload/python/bin/python3.12' -B .spike/probe-payload.py \
  '.spike/relocated diagnostic 311' diagnostic311-default
# Both exit 0; 254 created files, all .pyc; no modified or deleted files.

'.spike/relocated payload/python/bin/python3.12' -B - <<'PY'
from pathlib import Path
import json
root = Path('.spike/relocated diagnostic 311').resolve()
record = json.loads(Path('.spike/logs/diagnostic311-default-probe.json').read_text())
for relative in record['created']:
    target = root / relative
    assert target.is_relative_to(root) and target.suffix == '.pyc'
    target.unlink()
PY
'.spike/relocated payload/python/bin/python3.12' -B .spike/probe-payload.py \
  '.spike/relocated diagnostic 311' diagnostic311-cold-no-bytecode --no-bytecode
# Both exit 0; created/deleted/changed = 0/0/0.
'.spike/relocated payload/python/bin/python3.12' -B .spike/inventory.py \
  '.spike/relocated payload' interpreter312
'.spike/relocated payload/python/bin/python3.12' -B .spike/inventory.py \
  '.spike/relocated diagnostic 311' diagnostic311
# 11 and 71 Mach-O files; 75,864 and 413,740 KiB before re-signing.

rg -a -l --hidden --no-ignore -F "$PWD/.spike" '.spike/relocated payload'
rg -a -l --hidden --no-ignore -F "$PWD/.spike" '.spike/relocated diagnostic 311'
# Both rg calls exit 1 (no matches), which is the expected scan result.

# Re-sign only the copied diagnostic, never the operator's installation.
'.spike/relocated payload/python/bin/python3.12' -B - <<'PY'
from pathlib import Path
import json, subprocess
spike = Path('.spike').resolve()
record = json.loads((spike / 'logs/diagnostic311-inventory.json').read_text())
root = Path(record['root'])
results = []
for item in record['native_files']:
    path = root / item['path']
    sign = subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(path)],
                          capture_output=True, text=True)
    verify = subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(path)],
                            capture_output=True, text=True)
    results.append({'path': item['path'], 'sign_exit': sign.returncode,
                    'verify_exit': verify.returncode,
                    'output': sign.stdout + sign.stderr + verify.stdout + verify.stderr})
(spike / 'logs/diagnostic311-adhoc-sign.json').write_text(json.dumps(results, indent=2))
print('Ad-hoc signed:', sum(r['sign_exit'] == 0 for r in results), '/', len(results))
print('Strict verification:', sum(r['verify_exit'] == 0 for r in results), '/', len(results))
raise SystemExit(any(r['sign_exit'] or r['verify_exit'] for r in results))
PY
# Exit 0: Ad-hoc signed 71/71; Strict verification 71/71.
'.spike/relocated payload/python/bin/python3.12' -B .spike/probe-payload.py \
  '.spike/relocated diagnostic 311' diagnostic311-resigned --no-bytecode
'.spike/relocated payload/python/bin/python3.12' -B .spike/inventory.py \
  '.spike/relocated diagnostic 311' diagnostic311-resigned
# Both CLI commands exit 0, no payload hash changes; final 414,248 KiB,
# 387,646,431 logical bytes, 14,667 regular files, 71 native files,
# 0 strict signature-verification failures, 0 hardened-runtime executables.
git diff --check
git diff --exit-code -- apps/electron/scripts/package-mac.mjs
```

The inventory classifies signature display for the host architecture; inspect
`verify_failure_count` as well, because universal binaries can have an unsigned
non-host slice. To reproduce the observed architecture distinction:

```sh
/usr/bin/codesign --display --verbose=4 --arch arm64 \
  '.spike/relocated diagnostic 311/venv/lib/python3.11/site-packages/uvloop/loop.cpython-311-darwin.so'
/usr/bin/codesign --display --verbose=4 --arch x86_64 \
  '.spike/relocated diagnostic 311/venv/lib/python3.11/site-packages/uvloop/loop.cpython-311-darwin.so'
/usr/bin/codesign --verify --strict --arch arm64 \
  '.spike/relocated diagnostic 311/venv/lib/python3.11/site-packages/uvloop/loop.cpython-311-darwin.so'
```

Run those three commands **before** the re-signing loop to observe the initial
unsigned x86_64 result. After the loop, both slices are signed ad hoc.

## Remaining work and handoff

- Repeat the clean Python 3.12 lock/build route on a builder with approved artifact
  access. Record the exact standalone download hash; supply all locked wheels and
  `setuptools==83.0.0` to an offline wheelhouse. Do not relax pins to fit this cache.
- If approach 1 succeeds, stop evaluating alternate freezers. Measure the actual
  core/extras selection, normalize all build paths, complete notices and sign the
  resulting native inventory. The diagnostic's 404.5 MiB includes optional extras
  and is not a proposed production footprint.
- The orchestrator owns app integration, permitted server/rendered checks, shared
  project/run logging and the Dev Dashboard update. Those shared writes were not
  performed by this worker under the brief's file/worktree scope.
- AJ's hands are only needed later for Developer ID/notarization credentials if
  not already provisioned and clean installed-app qualification. No password or
  permission was requested for this spike.
- No Playwright/rendered spec is appropriate to this doc-only packaging experiment.
  No npm typecheck/build, server launch, app launch, signing identity access,
  notarization upload, commit or other-worktree mutation occurred.

Local raw evidence is retained in ignored `.spike/logs/`: download/install errors,
source/lock fingerprints, CLI transcripts and mutation snapshots, Mach-O lists,
linkage/signature metadata, full file hashes, lock drift and license-metadata gaps.
The reproducible commands and decisive measurements are preserved in this document.

Final evidence reconciliation at 19:11:34 PDT (13 minutes 23 seconds after launch):
both CLI checks passed, all 71 signing/verification results passed, and all 14,667
post-signing inventory hashes still matched. No payload mutations or escaping/
broken symlinks were found. An initial reconciliation attempt preceded the final
probe JSON and failed with FileNotFoundError; the sequential rerun passed.
