---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1427]
status: ready-for-verification
tags: [run, Rhythm, repair]
---

## Contract

AJ-authorized, narrowly-bounded credential-observer redesign on top of
`acaf6490` (the third D1.2 pass), after an independent agent (GPT)
reproduced a real-Docker acceptance/security failure: a `local-script`
candidate (`quiet-reader`) whose scenario invocation ran
`cat /vet/sentinel/aws_credentials >/dev/null 2>&1; exit 0` returned
`verdict: 'safe'`, `credentialAccessAttemptsCount: 0`. #1429/#1430 remain
out of scope. See the `repair_3` block in `docs/ai/contracts/issue-1427.json`
for full detail (root cause, redesign rationale, disclosed limitations,
judgment calls); this note covers the checks run.

### Root cause

Credential-access detection only ever counted a sentinel's marker text
appearing in captured install/invoke stdout/stderr — a channel the
candidate fully controls. Any redirection (`>/dev/null 2>&1`) makes the
read invisible to that detector, regardless of whether the read happens via
shell `cat` or a programmatic `fs.readFileSync`.

### Redesign (see `repair_3` for the full writeup)

Each credential sentinel is now written directly by the HOST (never by a
script running at the candidate's own privilege) into a directory
bind-mounted into the container as its own separate `:ro` mount at
`/vet/sentinel` — distinct from the pre-existing `:rw` `/vet` workspace. The
host records each sentinel's `atime` immediately after writing it, before
the container starts, and re-reads it entirely after the container exits,
from the host's own filesystem view: any advance proves a real
`open()`+`read()` happened, independent of what the candidate did with the
content. The `:ro` mount makes this evidence tamper-resistant — empirically
verified that `touch -a`, `rm`, and a programmatic `fs.unlinkSync` from
inside the container all fail `EROFS`.

A FIFO/named-pipe blocking-handshake approach was tried first and rejected
after hand-verification against this environment's actual Docker Desktop
(linuxkit VM, virtiofs-backed bind mounts) surfaced a false positive: a
container-side `ls` on the containing directory alone spuriously unblocked
a host-side FIFO writer with no candidate read at all. Plain regular files
+ `atime` do not share this problem (re-verified: `ls`/`stat` never
advances atime; only a real `open()`+`read()` does).

### RED confirmed before implementing

Added the exact quiet-shell-read reproducer to
`tool_sandbox_vetter.test.ts` FIRST and ran it alone against the
unmodified `acaf6490` tree:

```
npx vitest run src/services/__tests__/tool_sandbox_vetter.test.ts -t "QUIET shell read"
```

Result: **1 failed** — `expected 0 to be greater than 0`
(`credentialAccessAttemptsCount`), confirming the exact gap GPT reported.

### GREEN

Implemented the redesign (see `repair_3.files_changed`). First full run
surfaced a SECOND, self-inflicted false-positive class: the pre-existing
per-sentinel `sha256sum` content-integrity check (run at the candidate's
own privilege, inside the run script) was itself reading sentinel content
on every run — including well-behaved ones — advancing the same `atime`
the new host observer trusts, flipping 3 previously-passing real-Docker
tests to `unsafe`. Replaced that content-hash check with a metadata-only
existence check (`[ -e path ]`, a `stat()`-class syscall that never reads
file data) — content-tamper detection is no longer needed for its own sake
now that the `:ro` mount makes a successful content change structurally
impossible; only presence is checked, as a fail-safe.

## Files changed

- `apps/api_server/src/services/tool_sandbox_vetter.ts` — host-side sentinel setup/readback (`setupCredentialSentinels`, `computeCredentialAccess`, new `SandboxObserverError`/`sandbox_observer_unavailable`), `detectForbiddenWriteAttempts` (log-text-based blocked-write recognition), sentinel dir moved to its own `:ro` bind mount, `sha256sum` → `[ -e path ]` existence check, updated module doc comment.
- `apps/api_server/src/services/__tests__/tool_sandbox_vetter.test.ts` — quiet-shell-read reproducer (RED confirmed, then GREEN), quiet-programmatic-read case, read-then-tamper-attempt case, `SandboxObserverError` fake-runtime case, no-Docker unit suite for the new host-side observer functions.
- `docs/ai/contracts/issue-1427.json` — `repair_3` block, criteria `issue-1427-c11`/`c12`, `c9` mount-count note, `not_tested`/`judgment_calls` additions.
- `docs/ai/runs/2026-08-21-d1-credential-observer-redesign.md` (this file).

## Checks run

- RED: `cd apps/api_server && PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx vitest run src/services/__tests__/tool_sandbox_vetter.test.ts -t "QUIET shell read"` against unmodified `acaf6490` — **1 failed** (`credentialAccessAttemptsCount` 0, not > 0).
- GREEN, focused: `npx vitest run src/services/__tests__/tool_sandbox_vetter.test.ts src/services/__tests__/tool_sandbox_vetter_hardening.test.ts` — **56/56 passed** (verbose reporter confirmed the full real-Docker describe block ran live, non-skipped), including:
  - Quiet shell read (`cat ... >/dev/null 2>&1; exit 0`) → `credentialAccessAttemptsCount > 0`, `verdict: 'unsafe'`.
  - Quiet programmatic read (`node -e "require('fs').readFileSync(...)"`, output suppressed) → same.
  - Read, then attempted atime-reset + delete (all output suppressed) → `verdict: 'unsafe'`, never `safe`.
  - No credential read, successful install+scenarios → `verdict: 'safe'` (pre-existing fixture, still passes).
  - `SandboxObserverError` (fake runtime) → `unknown`/`sandbox_observer_unavailable`.
  - No-Docker unit suite: `computeCredentialAccess` throws on a vanished sentinel file; `setupCredentialSentinels` throws on an unwritable target directory; `detectForbiddenWriteAttempts` line-scoped matching.
  - Pre-existing forbidden-path-write test (`echo pwned >> /vet/sentinel/ssh_id_rsa`) still `verdict: 'unsafe'` — now via the write-attempt log signature (the write itself is blocked by the `:ro` mount) rather than a content-hash mismatch.
  - Pre-existing broken-tool/timeout/network-conditional/unsupported-method/unsafe-toolName real-Docker cases unchanged.
- GREEN, adjacent: `npx vitest run src/models/__tests__/tool_safety_report.test.ts src/repositories/__tests__/tool_safety_reports_repository.test.ts src/services/__tests__/tool_sandbox_vetter.test.ts src/services/__tests__/tool_sandbox_vetter_hardening.test.ts src/services/__tests__/tool_install_proposal_validator.test.ts src/__tests__/org_proposal_apply.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts` — **7 Test Files passed (7), 215 tests passed (215)**.
- Full repo suite: `npx vitest run` (no filter) — **595 files / 5718 tests passed, 17 failures**, all 17 confirmed PRE-EXISTING and unrelated (`TypeError: pool.connect is not a function` in Postgres-bootstrap schema-parity tests, reproduced identically against `git stash` of this pass's changes on the unmodified `acaf6490` tree).
- Container cleanup: `docker ps -a --filter "name=rhythm-d1-vet-"` — empty both before and after every run above (zero owned containers survive; teardown remains exact-name-only, never a `--filter`/prefix sweep).
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx tsc --noEmit` (apps/api_server) — passed, no output.
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build` (apps/api_server) — passed (incl. postbuild).
- `git diff --check --cached` — clean (exit 0).
- Added-line secret scan (`git diff --cached -U0 | grep '^+' | grep -Ei "sk-|api[_-]?key|secret|password|token|BEGIN .* PRIVATE KEY|postgres://...@|AKIA|ghp_|xox[baprs]-|Bearer "`) — only hit is a doc-comment describing the sentinel content as "non-secret-shaped"; no real secret, no realistic credential shape mounted or read (synthetic placeholders only).
- Empirical platform investigation (see `repair_3.redesign` and inline module doc comment) — hand-verified against this environment's actual Docker 29.2.1 (Docker Desktop, linuxkit VM, arm64) + already-pulled `node:22-alpine`, via disposable exact-owned probes, before writing any production code:
  - `mkfifo` + bind mount preserves the FIFO special-file type across the mount, but a container-side `ls` alone was observed to spuriously satisfy a host-side blocking FIFO write with no candidate read — rejected.
  - A regular file's `atime` is unaffected by `ls`/`stat`, but is reliably advanced by `cat` and by `node -e "fs.readFileSync(...)"`, both under a plain `:rw` mount and under the full production hardening flag set (`--network none --cap-drop ALL --security-opt no-new-privileges --pids-limit --memory --cpus --read-only --tmpfs /tmp ... --user node`) plus a nested `:ro` mount at `/vet/sentinel`.
  - Under the `:ro` mount, `touch -a`, `rm`, and Node `fs.unlinkSync` against a sentinel file all fail `EROFS`, with the exact path in the error text (used by `detectForbiddenWriteAttempts`).

## GitNexus

- No GitNexus MCP tools were available in this session, and `.gitnexus/run.cjs` does not exist in this worktree — consistent with every prior D1 run note (this worktree, `d1-tool-vetting`, has never been registered in the local GitNexus index). Recorded as **UNKNOWN**, not "no impact." `analyze`/`index` were not run (would risk rewriting `AGENTS.md`/`CLAUDE.md`); `git status` confirms neither file is modified.

## Residual risks

- The mechanism proves access to the THREE NAMED synthetic sentinels only — it is not a generic file-access auditor for arbitrary candidate-chosen paths. This is a disclosed, bounded limitation, not an oversight (see `repair_3.limitations_disclosed`).
- The forbidden-path WRITE-*attempt* signal (`detectForbiddenWriteAttempts`) is best-effort and log-text-based — a candidate that redirects that specific error text away is not caught by it, though the write itself still cannot succeed (the `:ro` mount is the actual control; the log signal only lets a non-suppressed attempt also surface as `unsafe` rather than a generic candidate failure).
- `credentialAccessAttemptsCount` now counts distinct sentinels accessed (0–3), not a raw repeat-read tally — a deliberate, disclosed judgment call (see `repair_3.judgment_calls`); `classifyVerdict` only ever needs `> 0`.
- All `not_tested` items already recorded in `issue-1427.json` (a real reachable-network install; a real-Docker OOM/corrupted-evidence-on-normal-exit case; D1.4/D1.5 sandbox-safety-gate wiring; the rejected FIFO approach; generic path auditing) remain not-tested, unchanged or newly-disclosed by this pass — out of scope by design, not a regression.

## Notes

- #1429/#1430 were not implemented, `api_server` was not started, and no production data/config was touched.
- No real host credentials were ever mounted or read — every sentinel is an explicit, fixed, non-secret-shaped synthetic placeholder (`RHYTHM_SYNTHETIC_SENTINEL:<label>`) written by the host into a disposable per-run scratch directory, torn down unconditionally in the same `finally` block as before.
