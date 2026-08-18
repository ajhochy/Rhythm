---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm]
---

# Parity Flutter reference ref

## Change

`tools/validation/generate-desktop-parity-matrix.mjs` now resolves
`RHYTHM_PARITY_FLUTTER_REF` (default `origin/main`) to a commit, archives only
`apps/desktop_flutter` from that commit, extracts it into a temporary directory, and scans the
extracted tree with the existing directory exclusions, text-extension filter, and sorting. Every
other surface still scans the working tree. Paths remain repo-relative
`apps/desktop_flutter/...`; the temporary directory cannot enter paths, source IDs, mappings, or
rationales. The temporary directory is removed in `finally` on success or failure.

The generator runs `git rev-parse --verify <ref>^{commit}` before archiving. Any unresolvable ref
throws `Unable to resolve Flutter parity ref ...`; archive/extraction failure also throws with the
ref and resolved commit. There is no working-tree fallback, so a stale or missing reference cannot
silently produce a false parity baseline.

The generated `behaviors.json` records:

```json
{
  "flutterReference": {
    "ref": "origin/main",
    "commit": "9fa2761ed78159f83f56982c03fcd85dc035039a"
  }
}
```

The first CLI output line also prints
`flutter_ref=origin/main flutter_sha=9fa2761ed78159f83f56982c03fcd85dc035039a`.

## Measured delta

The Flutter working tree was clean and matched
`HEAD=9d8c4443f076756cec919e182222fdb45c39abcc`, so a temporary scan with
`RHYTHM_PARITY_FLUTTER_REF=HEAD` measured the working-tree baseline. A second temporary scan used
the default `origin/main`. The canonical corpus under `docs/ai/coverage/react-electron/` was not
modified.

| Flutter input | Source rows | Mappings |
|---|---:|---:|
| Working tree / `HEAD` | 679 | 679 |
| `origin/main` | 685 | 685 |
| Delta | +6 | +6 |

Behavior taxonomy row changes (`origin/main` minus working tree):

- `empty-loading-error-offline-forbidden`: +5
- `memory-research-gallery-playbooks-cookbook-schedules-run-quality`: +1
- Lost rows: none

This is new parity work exposed by the newer Flutter reference, not drift to normalize away.

## Focused test

Command:

```text
node --test tools/validation/test/desktop-parity-flutter-ref.test.mjs
```

Verbatim output:

```text
TAP version 13
# Subtest: Flutter parity rows come from origin/main rather than the working tree
ok 1 - Flutter parity rows come from origin/main rather than the working tree
  ---
  duration_ms: 1451.991292
  type: 'test'
  ...
# Subtest: an unresolvable Flutter parity ref fails loudly
ok 2 - an unresolvable Flutter parity ref fails loudly
  ---
  duration_ms: 250.396625
  type: 'test'
  ...
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1757.74175
```
