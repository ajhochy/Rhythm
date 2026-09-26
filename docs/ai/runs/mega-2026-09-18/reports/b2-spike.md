## Summary

**NO-GO for Phase 2 on current evidence.** The clean Python 3.12 build was blocked by unavailable network/artifacts. A relocated Python 3.11 diagnostic passed both CLI checks and ad-hoc signing, but is not lock-qualified.

The diagnostic occupies **404.5 MiB**, contains **71 Mach-O files**, and runs without modifying payload files when bytecode writes are disabled.

## Files changed

- [docs/ai/spikes/2026-09-18-hermes-payload-spike.md](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-b2-hermes-spike/docs/ai/spikes/2026-09-18-hermes-payload-spike.md) — comparison table, measurements, signing risks, Phase 2 gates, complete reproducible commands and helpers.
- [REPORT.md](/Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-b2-hermes-spike/REPORT.md) — worker handoff, ignored by an existing repository exclusion.
- `.spike/` — ignored build copies, temporary homes, helpers and raw evidence; `.gitignore` contains `*`.

## Checks run

Branch: `mega/ws-b2-hermes-spike`; base: `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`. Launch branch/write checks passed. No commits made.

The spike document preserves exact environment prefixes and helper bodies. uv used `.spike/uv-cache`, `.spike/tmp`, and copy link mode.

- `/Users/ajhochhalter/.local/bin/uv python install 3.12 --install-dir .spike/python` — **FAIL**, exit 1: `failed to lookup address information` for GitHub.
- `/Users/ajhochhalter/.local/bin/uv pip install --offline --python .spike/payload/venv/bin/python --require-hashes -r .spike/requirements.lock.txt` — **FAIL**, exit 1: `annotated-doc==0.0.4 needs to be downloaded`.
- `/Users/ajhochhalter/.local/bin/uv build --offline --wheel --python .spike/payload/python/bin/python3.12 --out-dir .spike/wheels .spike/source` — **FAIL**, exit 2: `setuptools==83.0.0 needs to be downloaded`.
- `/Users/ajhochhalter/.local/bin/uv pip install --python .spike/payload/venv/bin/python .spike/source` — **FAIL**, exit 2: PyPI DNS failure. The same command with `pyinstaller` and then `shiv` replacing `.spike/source` also failed on DNS; neither freezer produced an artifact.
- `'.spike/relocated payload/python/bin/python3.12' -B .spike/probe-payload.py '.spike/relocated diagnostic 311' diagnostic311-final --no-bytecode` — **PASS**, exit 0: both Hermes commands exit 0; `Payload changes: {'created': 0, 'deleted': 0, 'changed': 0}`.
- `/usr/bin/codesign --force --sign - "$native"`, then `/usr/bin/codesign --verify --strict "$native"`, for every inventoried native file — **PASS**: `Ad-hoc signed: 71 / 71`; `Strict verification: 71 / 71`. The full loop is in the spike document.
- `'.spike/relocated payload/python/bin/python3.12' -B .spike/inventory.py '.spike/relocated diagnostic 311' diagnostic311-resigned` — **PASS**, exit 0: `macho_count: 71`, `allocated_kib: 414248`, `verify_failure_count: 0`.
- `rg -a -l --hidden --no-ignore -F "$PWD/.spike" '.spike/relocated diagnostic 311'` — expected exit 1, no matches. Separate scans found 261 files retaining original operator-install paths.
- `git diff --check` and `git diff --exit-code -- apps/electron/scripts/package-mac.mjs` — **PASS**, exit 0, no output. Embedded Python/shell syntax checks passed.

Final evidence validation passed: **2/2 CLI checks, 71/71 signing checks, 14,667/14,667 inventory hashes**, no payload mutations or escaping/broken symlinks. Evidence was captured within 14 minutes of launch, inside the 45-minute cap.

An early evidence-consistency check ran before the final probe JSON existed; it was retried after the probe completed. Nested `sandbox-exec` isolation was unavailable (`sandbox_apply: Operation not permitted`). No independently network-denied server-start claim is made. No socket-binding, browser, Electron, npm build or typecheck was run for this documentation-only spike.

## Acceptance criteria

- Correct branch, writable tree, isolated builds, no commits/other-worktree changes → **done**; launch checks and scoped working-tree status.
- Evaluate uv, then PyInstaller, then shiv → **partial**; attempted in order, clean installations blocked. Offline diagnostic preserved useful relocation evidence.
- Clean Python 3.12 Hermes version/help with temporary HOME and stripped PATH → **not done**; only the copied interpreter passed. The separate Python 3.11 diagnostic passed both requested commands.
- Size, native signing inventory, path leaks and notarization risks → **partial**; measured built diagnostics; unavailable artifacts explicitly marked N/A. Default startup created 254 bytecode files; cold bytecode-disabled startup created none.
- Comparison table, GO/NO-GO, manifest/hash/offline/license gates and reproducible commands → **done**; spike document. Full #1534 lookup failed, so its requirements are attributed to the supplied brief.
- Leave `package-mac.mjs` unchanged and write the report → **done**; empty packaging-script diff and these two documentation files.

## Decisions

- Used a copied local Python 3.12 interpreter after download failure; rejected changing the operator installation.
- Preserved pins and separated the Python 3.11 diagnostic; rejected treating its extra packages and nemo-relay version drift as a clean build.
- Used relative interpreter links and removed copied venv `home` entries; rejected relying on `--relocatable` alone.
- Kept signing ad hoc and local; rejected claiming Developer ID/notarization qualification.
- Left shared project/dashboard logging to the orchestrator under the worker's file/worktree scope.

## Follow-ups

- Retry approach 1 with approved artifact access or a complete locked wheelhouse, including the exact build backend. Re-measure the actual payload.
- Complete license notices, remove build-path metadata, then qualify manifest hashes, real offline server startup and the distribution-signed app.

## Needs a human

None for this spike. Later release qualification needs provisioned Developer ID/notarization credentials and manual installed-app validation.

<oai-mem-citation>
<citation_entries>
MEMORY.md:38-46|note=[kept local checks separate from signed release qualification]
</citation_entries>
<rollout_ids>
01a0b14b-8a39-7e61-9011-e48f01a9477f
</rollout_ids>
</oai-mem-citation>
