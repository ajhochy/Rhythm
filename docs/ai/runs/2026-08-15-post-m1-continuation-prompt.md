# Continuation prompt — post-M1 React/Electron parity program

Paste everything below the line into a clean session.

---

Resume the Rhythm React/Electron parity program as ORCHESTRATOR. You coordinate, audit, and gate.
Dispatch implementation and test-execution to Codex (`codex exec`, model gpt-5.6-sol) with focused,
self-contained prompts. Do not implement product code yourself except trivial evidence/bookkeeping
repairs, or when a dispatch proves unreliable (see "Codex dispatch reality" below).

## Source of truth

**`docs/ai/plans/2026-08-15-post-m1-parity-phases.md` is the authoritative plan.** Read it first.
It contains: the 16 in-scope behaviors, 11 dependency-ordered phases, per-phase contract skeletons
with criterion IDs and required evidence, the risk register, the progress weighting table, and the
stale-reference warning. Do not re-derive the plan; extend it.

Supporting truth:
- `docs/ai/contracts/` — one contract JSON per slice/phase; statuses are the gate's ledger
- `docs/ai/coverage/react-electron/` — the parity corpus (behaviors.json, mappings.csv)
- `docs/ai/runs/` — run notes; the newest are the working history
- `docs/ai/project-state.md` — lean snapshot, overwrite (never append)

## Repository facts

- Worktree: `/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite`
- Branch: `codex/react-electron-live-suite`; ALL work is UNCOMMITTED vs `origin/main`
- NEVER use or absorb the dirty canonical checkout at `/Users/ajhochhalter/Documents/Rhythm`
- No commits, pushes, PRs, merges, deploys, or destructive cleanup without AJ's explicit approval
- GitNexus: pass `repo: "/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite"` (the bare
  name `Rhythm` is ambiguous across 45 indexed repos). MUST `impact` before editing an existing
  symbol; MUST `detect_changes` before any done claim.

## Current state (verified 2026-08-15, do not re-litigate)

**Milestone 1 is COMPLETE — slices 0–8 all pass.** React renderer imported, fixture/live gateways,
live Task lifecycle, live engine-session lifecycle, hardened Electron shell, parity matrix +
validator, unsigned macOS package, and an integrated verification gate.

Single verification entrypoint:

```bash
node tools/validation/verify-all.mjs        # all 10 components, exits non-zero on any failure
node --test tools/validation/test/integrated-verification.test.mjs   # the Slice 8 contract, 5/5
```

Last green run: web suite 254 passed, live lifecycle 1 passed (231s), packaged Electron 6 passed,
parity 17 behaviors / 702 review rows / 10,893 mappings, zero residue, summary at
`dist/verification/summary.json`.

Provenance root: `0b2d3b22d0b9f75ea5b4c0a6962a24751637adf789f3d51b8944c07e418541a4`
(`apps/web/SHA256SUMS`, exactly 144 entries, must verify 144/144).

## Sandbox (non-negotiable)

All server-dependent work runs against the isolated sandbox ONLY:

```bash
tools/dev/sandbox.sh up|down|status     # API :4098, engine :4097, gateway :4099
```

- NEVER hand-start api_server/engine. NEVER target :4001 or :4096 — AJ's live desktop app runs there
  and killing it is the worst possible outcome.
- The sandbox engine pid changes across runs (supervised respawn after profile patches). That is NOT
  failure — check `curl http://127.0.0.1:4097/global/health` before concluding breakage.
- If `sandbox.sh status` says "live-artifact storage root is missing", the whole sandbox root was
  reaped by macOS — run `sandbox.sh up`, don't debug the message.
- Live env for web live specs:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098
   RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097
   RHYTHM_LIVE_DB_PATH=$TMPDIR/rhythm-dev-sandbox/rhythm.db`
- Always leave the engine restored to `local-lean` / `omlx` / `gpt-oss-20b-MXFP4-Q8` with no
  `lmstudio` auth entry.

## Workflow rules (rigid)

1. **Acceptance-first.** Contract JSON in `docs/ai/contracts/` + genuinely failing tests BEFORE any
   product edit. Red evidence captured verbatim in the run note at capture time. A skipped test or a
   harness error is NOT red.
2. **Behavioral gate.** Live proof through the real API+engine before any "done" claim.
3. **Never weaken an assertion to reach green.** Strengthening is allowed and encouraged. If an
   assertion seems wrong, STOP and escalate — one was authorized for correction in Slice 4, only
   after independently verifying it contradicted the schema.
4. **Provenance.** Any changed file under `apps/web` that appears in `SHA256SUMS` must be reconciled:
   keep exactly 144 entries, verify 144/144, extend the `apps/web/PROVENANCE.md` chain preserving all
   historical roots, and record the new root (root = `shasum -a 256 SHA256SUMS`) in the contract and
   run note. Verify whether a file is covered — don't assume.
5. **Parity.** After any file addition/UI change: `node tools/validation/generate-desktop-parity-matrix.mjs`
   then `node --test tools/validation/test/desktop-parity-matrix.test.mjs`. Behaviors must stay 17.
6. **Every phase ends with `verify-all.mjs` green** before moving on.
7. **Logging.** Run notes `docs/ai/runs/YYYY-MM-DD-<slug>.md`; decisions in `docs/ai/decisions/`;
   overwrite `docs/ai/project-state.md` as a lean snapshot.
8. Audit the worktree after EVERY dispatched unit. Never trust a report absent from the worktree.

## Dashboard procedure (MANDATORY after every unit result and phase transition)

AJ's Dev Dashboard artifact has a state-driven "React/Electron Live Suite" tracker.
Standing permission granted 2026-08-15. Update via the sanctioned script ONLY:

1. Edit `/Users/ajhochhalter/Documents/dev-dashboard/.tracker-state.json` — DATA ONLY.
   Schema: `updatedAt`, `master{label,percent}`, `milestone1{label,percent}`,
   `slices[]{id,label,percent,status:pass|repairing|pending,note?}`,
   `recentRuns[]{at,agent,session,task,status,note?}` — cap 10, newest first.
   No instruction prose, no `agentInstructions` key (the script refuses it).
2. Run:
   ```bash
   cd /Users/ajhochhalter/Documents/dev-dashboard && node publish-to-rhythm.mjs tracker
   ```

**NEVER** read or write this artifact via rhythm/MCP live-artifact tools: reads are permanently
blocked by the injection scanner and writes exceed tool payload limits. The script auto-fetches
revisions and merges safely. If it returns `500 Live artifact content unavailable`, that is
server-side — keep the local state file correct and retry later.

Stamp `updatedAt` from the real clock (`datetime.now(timezone.utc)`), never by hand — hand-typed
values drifted an hour once.

**Progress weighting is volume-based, not task-count.** M1/post-M1 split is 36/64. Post-M1 is 839
weighted units: 689 real review rows + 50 each for P2, P8, P11 (zero mapped rows, real work).
Phase 10 alone is 48% of the remaining program. Do NOT re-weight to make numbers look better; AJ
explicitly wants volume weighting and has rejected inflation.

## Asynchronous work streams (strong preference)

**AJ prefers parallel streams. Saturate them whenever it is safe.** Dispatch background units and
audit on completion rather than working serially.

Safe to parallelize: work in different directories with no shared runtime — e.g. planning/analysis
docs, contract authoring, API-only work, and mobile work can often run alongside each other.

Conflicts that force serialization — check before dispatching two units:
- **Port 4173** — two Playwright suites collide
- **The sandbox engine config** — live specs patch profiles/credentials; two live runs corrupt each other
- **The parity generator** — concurrent regeneration races
- **Global residue assertions** — `verify-all.mjs` c4 asserts zero temp Electron userData dirs, zero
  smoke worktrees/branches, no `apps/web/test-results`. ANY concurrent unit creating those makes the
  integrated run fail spuriously. Do not run other units during `verify-all.mjs`.
- **Files scanned by parity** — adding files under `docs/` (except `docs/ai/runs/` and
  `project-state.md`), `tools/`, `apps/**` mid-run can break the hermetic byte-match.

Practical pattern that worked: dispatch 2–3 background units in disjoint areas, stage the next
prompts while they run, audit each on completion, dispatch immediately.

## Codex dispatch reality (learned the hard way)

- `codex exec --model gpt-5.6-sol --sandbox danger-full-access --skip-git-repo-check "<prompt>"`
- Output is BUFFERED until exit. Judge progress by **file mtimes**, not stdout.
- **Units hang on GUI work.** Packaged Electron launches block indefinitely when a window never
  closes; one unit sat 44 minutes at 0% CPU with zero file writes. Two more hung the same way.
  Detect with: `ps -eo pid,etime,%cpu | grep codex` plus a recent-mtime scan. If a unit is idle with
  no writes, kill it and do the work directly. A trivial `codex exec` probe returning `PROBE_OK`
  confirms the dispatch path itself is healthy.
- Give each unit explicit stop conditions and a repair-loop cap; they honour them.
- Tell each unit what the OTHER concurrent units are touching, and forbid those paths.

## Known traps (all previously paid for)

- **Waits tuned for a fast machine.** Every "missing behavior" in Slice 4 was a too-short wait:
  `createWorktree` measured 3s isolated → 22.8s cold → 61.1s under load → >90s in-suite. Measure
  before implementing; raising a wait is patience, not weakened strictness.
- **Assertions encoding wrong schema literals.** c7 queried `role='assistant'`; the canonical
  persisted role is `output` (engine `assistant` → DB `output`).
- **Mutable evidence contaminating the hermetic parity scan** — `test-results`, `playwright-report`,
  `.agent-stack` are now excluded at `generate-desktop-parity-matrix.mjs:19`. Don't undo that.
- **"Zero leaks" checks that miss git worktrees.** A timed-out create still completes server-side and
  leaves an orphan worktree/branch after the test gave up.
- **Electron userData.** `package.json` `name` is `rhythm-electron-shell`, so un-redirected launches
  write to `~/Library/Application Support/rhythm-electron-shell`. Always redirect via
  `RHYTHM_SHELL_USER_DATA` and reap AFTER process exit (Chromium recreates dirs before exit).
  `~/Library/Application Support/Rhythm` is AJ's LIVE app data — never touch it.
- **macOS `find -newermt` is a silent no-op** here (bfs shim rejects relative timestamps, exits 0).
  Use `stat -f '%m %Sm %N'` and sort numerically — string-sorting times breaks across midnight.
- **`node --test tools/validation/test/*.mjs`** now includes the integrated-verification spec, which
  invokes the runner. Name single files when you don't want that.

## The plan says re-scan before every phase

The corpus was scanned at `9d8c4443`; `origin/main` has already moved with a commit touching 17
`apps/desktop_flutter` files (+1341 lines), and Flutter is the parity REFERENCE. Before each phase:
re-base onto current `main`, re-run the generator, diff the corpus, and treat new Flutter behavior as
new parity work. Phases 2 and 8 must BUILD inventory for behaviors the matrix is blind to
(zero mapped rows ≠ covered).

## Queued work, in order

1. **`createWorktree` timing investigation** (AJ queued this explicitly). Sessions take 20–90s to
   create; the engine's own worktree create is 0.15s, so the cost is in the API path around it.
   Warm-up curve (22.8s → 6.7s → 1.9s) suggests lazy init; load sensitivity suggests contention.
   Unverified suspect: session creation enumerating/connecting MCP servers for the tool surface.
   Instrument `createWorktree`, get a timing breakdown, report before fixing.
2. **`POST /agent-sessions` raw `SDK_ERROR` when the engine is mid-bounce** — filed follow-up; a user
   who changes a credential then immediately creates a session hits an unhandled error.
3. **Phase 1** — Desktop entry and host trust (29 units). Contract first, red first.

## Start here

1. `tools/dev/sandbox.sh status` (bring it up if needed)
2. Read `docs/ai/plans/2026-08-15-post-m1-parity-phases.md` in full
3. Read the newest `docs/ai/runs/` notes for working history
4. Confirm the baseline is still green: `node tools/validation/verify-all.mjs`
5. Publish a tracker update reflecting what you find
6. Then start item 1 above, dispatching parallel streams wherever the conflict list allows
