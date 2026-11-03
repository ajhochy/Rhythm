---
date: 2026-10-10
repo: Rhythm
branch: documentation-only
pr: null
issues: []
status: stopped-handoff
tags: [run, rhythm, sandbox, handoff]
---

# Reuse the working sandbox; stop rediscovering it

AJ stopped implementation, testing, packaging and probing at 04:18:53 UTC. Nothing below authorizes a launch now. Files, failed cohorts and receipts are retained. The installed Electron API/engine was not killed or restarted.

## Minimum prerequisites

Use **only `tools/dev/sandbox.sh`**, from the owning worktree. A manually started API can default to live engine **4096** and reclaim it, killing the session hosting the agents. Explicit API, engine and gateway ports are required together.

Use one owner, a current frozen source/dependency handoff, sanitized read-only fixtures outside the runtime directory, and the same directory/environment for every lifecycle command. Never infer current code from an old binary or overwrite an old failed cohort to retry. A fresh `up` root must be absent. Do not rebuild the engine repeatedly if its complete attested source closure is unchanged.

The scripts are reusable. The concrete retained roots, hashes and PID archive scripts below are **historical evidence, not a copy-paste-ready new cohort**. A future authorized run needs a fresh root and current frozen handoff. The current worktrees contain later unfinished edits.

## Coordinator API/engine sandbox — verified lifecycle

Detailed exact environment, profile, fixes and receipts:
[Coordinator lifecycle runbook](/Users/ajhochhalter/Documents/Codex/2026-10-09/native-build-prerequisite/coordinator-sandbox-reuse-runbook.md).

Worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-repair-first-20261009`.
Reusable wrapper: `/Users/ajhochhalter/Documents/Codex/2026-10-09/native-build-prerequisite/coordinator_qualification_execution.py`.

For a **future reviewed current handoff**, the minimum command shapes are:

```bash
cohort_handoff=/absolute/path/to/new-reviewed-execution-handoff.json
runner=/Users/ajhochhalter/Documents/Codex/2026-10-09/native-build-prerequisite/coordinator_qualification_execution.py
export RHYTHM_QUALIFICATION_HANDOFF="$cohort_handoff"
/usr/bin/python3 -I -B "$runner" runtime    # stock up --foreground; keep its session alive
/usr/bin/python3 -I -B "$runner" status     # separate call, identical handoff
/usr/bin/python3 -I -B "$runner" restart-api # only if API-only continuity is required
/usr/bin/python3 -I -B "$runner" down
```

Required handoff environment includes `DB_CLIENT=sqlite`, the four fixture/path variables (`RHYTHM_APPROVED_FIXTURE_ROOT`, `RHYTHM_LIVE_DB_PATH`, `RHYTHM_SANDBOX_OPENCODE_CONFIG`, `RHYTHM_SANDBOX_DIR`), explicit engine/API/gateway **4797/4798/4799**, current launcher manifest and intake paths **plus their hashes**, and `RHYTHM_SANDBOX_PRESERVE_FILES=1`, `RHYTHM_SANDBOX_PRESERVING_API_RECOVERY=1`, `RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1`. Skip-build requires validated intake; it is not a standalone shortcut. The runbook contains the full recorded environment.

Non-obvious prerequisites that actually mattered:

- Exact service Node **22.23.0**, not Node26; the native SQLite addon must match it.
- Validated prebuilt engine/store intake, with strict detached signature and complete source/dependency bindings. This is sandbox-only qualification, not shipping signing.
- Fresh API/MCP payload builds need both package-local and root-hoisted dependency links.
- Persistent synthetic engine DB uses empty `MEMORY` initialization followed by **WAL**; persistent operation is not in-memory mode.
- The preserving/offline guard allows only the three owned loopback ports and the exact fresh synthetic Dayflow config/ledger replacement and lock paths. API → engine → MCP descendants inherit it. Broad unlink/network allowance is not needed.
- Real readiness means API `/opencode/health` is `ready` with `bridgeLive:true`, plus engine `/global/health`; a listening port alone is insufficient.

**Restart is a two-action workflow.** Stock `restart-api` verifies ownership and holds briefly for a separately reviewed, exact-generation `renameatx_np(RENAME_EXCL)` archive of the old API PID record. The historical archive script is hardcoded to its old root and must not be reused on a new root. Preserve any failed generation; do not blindly repeat restart. Validated attachment URL handling prevents fallback to 4096; strict CLI PID normalization and the engine-observed canonical holder seal fix earlier real defects.

**Stop:** stock `down`, then wait for the original foreground session to exit, check ports free and retain stop/ACK receipts. The dead-API path requests normal holder shutdown with exclusive `shutdown.requested`, receives ACK and preserves records. Do not manually kill the holder.

Actual evidence: GREEN02 startup, three 401/no-inventory-change refusals, API-only restart continuity, normal holder shutdown, and four native ownership-negative cases passed. The runbook evidence index pins 12 files; all 12 matched on this handoff. Full model-backed A6 and different-UID behavior were not established.

## Router/Memory/Dayflow sandbox — verified historical recipe

Detailed runbook:
[Router stop handoff](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008/docs/ai/runs/2026-10-10-router-sandbox-stop-handoff.md).

Worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`.
The recorded working **retained-cohort** restart used:

```bash
SB=/private/tmp/sdmr-grid-sandbox
PROFILE=/private/tmp/no-unlink-enforcement-20261009/runtime-fresh-cohort-v4.sb
NODE=/private/tmp/original-dayflow-runtime-final-r4/grid-node-workstreams
/usr/bin/sandbox-exec -f "$PROFILE" env -i \
  HOME=/Users/ajhochhalter \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  RHYTHM_SANDBOX_DIR="$SB" \
  RHYTHM_SANDBOX_API_PORT=4398 RHYTHM_SANDBOX_ENGINE_PORT=4397 \
  RHYTHM_SANDBOX_GATEWAY_PORT=4399 RHYTHM_SANDBOX_PRESERVE_FILES=1 \
  RHYTHM_SANDBOX_NODE_BIN="$NODE" tools/dev/sandbox.sh restart
```

This assumes the retained fixture DB, HOME and vault already exist. It is **not** a new-agent fresh-root bootstrap recipe. The wrapper supplies `RHYTHM_WORKSTREAMS_ENABLED=true`, `RHYTHM_MANAGED_CONTEXT_EXPORTS=1` and the exact grid transport preload. Missing managed-context export caused actual `proof_unavailable` holds. Fake-provider ports 7481/7482 require their exact finite transport identity rules; no real credentials are needed.

Readiness: use stock `status` with identical SB/port variables, API `4398/health`, engine `4397/global/health`, and the existing descendant attestation script bound to actual PID/start identity. Bind runtime proof to current compiled modules, engine, config and test hashes.

Normal preserving stop uses the **same env without `sandbox-exec`**, because this historical ownership checker needs host process visibility:

```bash
env -i HOME=/Users/ajhochhalter \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  RHYTHM_SANDBOX_DIR="$SB" RHYTHM_SANDBOX_API_PORT=4398 \
  RHYTHM_SANDBOX_ENGINE_PORT=4397 RHYTHM_SANDBOX_GATEWAY_PORT=4399 \
  RHYTHM_SANDBOX_PRESERVE_FILES=1 RHYTHM_SANDBOX_NODE_BIN="$NODE" \
  tools/dev/sandbox.sh down
```

Preserve auth snapshots and restore parsed-equal through the supported engine API; do not edit credential files by hand. Wait for fake-account cooldowns naturally. Use preserving test configs and narrowly reviewed fresh synthetic cleanup paths; do not delete earlier evidence.

Historical r26 grid13 and affected203 checks passed, but **r26 is not complete acceptance**: review found cold-start listener, failed durable pin and ambiguous legacy receipt defects. Newer audit179 edits stopped with two focused fixture/expectation failures and are not qualified. Public coding remains fail-closed/unsupported after removal of unsafe Node VM execution; old positive cases 3/4/9 are invalid. Electron packaging/activation did not occur.

## Strict C3 evaluator — unresolved, separate from both working API sandboxes

The API preservation/offline guard is not a candidate read-confinement boundary. Applying C3's strict child profile under the inherited guard fails `sandbox_apply: Operation not permitted` before Node. Applying it once independently aborts the exact service Node before startup; crash evidence points to dyld shared-cache initialization. Changing pipes to DEVNULL did not fix it. The DYLD-private probe failed before Node and is inconclusive. No additional denied read path was proved.

Broad-read diagnostic profiles start Node but do **not** protect candidate evaluation. No supported single-boundary evaluator has been qualified here. Do not substitute unsafe VM, unguarded execution, guessed wider reads, SIP changes or guard escape. Equivalent probes have stopped. C3 remains unverified; it is not a prerequisite to rediscovering the already working API lifecycle recipe.

## Stop custody and references

STOP replaced all previous completion/repair directives. Router and Coordinator sampling turns were interrupted only after no active tool was present, then received documentation-only requests (audits183/184). Coordinator parent acknowledged no child resume (audit185). Existing executor and reviewer stopped; all sources/evidence remain retained. Historical descendants were not awakened.

Full-ID roster: `/Users/ajhochhalter/Documents/Codex/2026-10-09/rhythm-watch/AJ-stop-parent-descendant-roster.json`.
Stop dispatch: `AJ-stop-owners-and-documentation-dispatch.json` in that directory.
Current state: `watcher-current-verified-checkpoint.json` in that directory.

The roster includes 41 Router descendants and 29 Coordinator descendants. At capture all were idle/error except the original Coordinator source owner finishing documentation. Older queued implementation directives are superseded by STOP; no automation or future launch was created by this watcher.

Final stop-confirmation exception at 04:33 UTC: Router, Coordinator parent, other descendants, executor and reviewer are quiescent. Coordinator source owner `a92190e6-9a4c-4916-9b46-eef9e30ea9f3` still reports native `busy` with **no active tool**, despite supported API cancel 204 and native abort 200. An acknowledgement-only final STOP was accepted as audit186. Local database `error` is not proof of native quiescence. No further work is authorized. Exact state is retained in `AJ-stop-remaining-Coordinator-native-state.json`; the parent must not mistake successful cancellation responses for verified idle. The read-only watcher observer itself has been stopped.
