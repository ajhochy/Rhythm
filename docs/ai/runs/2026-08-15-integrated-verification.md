
### 2026-08-15 Slice 8 — integrated verification GREEN (Milestone 1 complete)

Built directly by the orchestrator after three dispatched Codex units hung on Electron GUI launches
(0% CPU, zero file writes; a `codex exec` probe returned `PROBE_OK` in seconds, so the dispatch path
itself was healthy — the tasks were the problem).

Entrypoint: `node tools/validation/verify-all.mjs`. Contract: `docs/ai/contracts/integrated-verification.json`.

**Contract result — all five criteria, asserted against a single invocation of the runner:**

```text
ok 1 - slice-8-c1: one command runs every verification component and fails if any component fails
ok 2 - slice-8-c2: parity result is order-independent after the live/Playwright suites run
ok 3 - slice-8-c3: the run emits a machine-readable summary at a known path
ok 4 - slice-8-c4: the run leaves zero residue
ok 5 - slice-8-c5: the run refuses protected ports and fails loudly without the sandbox
# pass 5  # fail 0  # skipped 0
```

**Green run:**

```text
web:typecheck          pass    10.9s
web:build              pass    15.9s
web:fixture            pass     9.4s   14 passed
web:suite              pass   416.6s   254 passed, 0 failed
web:dist-smoke         pass     1.3s
web:gateway-sessions   pass     2.3s   4 passed
web:live-lifecycle     pass   231.4s   1 passed
electron:shell         pass     1.5s   5 passed
electron:packaged      pass    29.0s   6 passed
parity                 pass     8.1s   behaviors 17, reviewRequired 702, mappings 10893
residue: all zero · engine omlx/gpt-oss-20b-MXFP4-Q8, lmstudio absent · protectedPorts contacted []
```

**Three defects this gate found that slice-level gates structurally could not:**

1. **Leaked git worktree and branch.** When the create wait expires the test abandons the request,
   but the server completes anyway, creating the worktree AFTER the failure path began — and c9
   could not clean it because `localId` is never set when the response never arrives. Fixed by
   sweeping with the existing `removeStaleSmokeWorktrees()` helper (previously only called at
   startup) and asserting zero. This closes the c9 gap recorded during Slice 4.
2. **Load-sensitive create wait.** 90s was exceeded when the live spec runs immediately after the
   416s web suite. Raised to 180s with the budget to 600s. Measured progression: 3s isolated →
   22.8s cold → 61.1s under load → >90s in-suite.
3. **`tests/pages/tasks.spec.ts:94` exceeded the 20s global budget.** Failed 2/2 in isolation, not
   flake; measured 21.2s given headroom, on a machine at load average 27.3. Given a per-test
   `test.setTimeout(60_000)` rather than raising the global budget, so regressions in the other 257
   tests stay visible. Provenance reconciled: 144/144, root
   `7658590d08574a47c515a761c89b43aa19b7590a3e8ea674685b3126c402153e` →
   `0b2d3b22d0b9f75ea5b4c0a6962a24751637adf789f3d51b8944c07e418541a4`.

**Design decisions worth preserving:**
- Parity runs LAST, after the Playwright suites, so artifact contamination is caught rather than
  dodged. c2 asserts that ordering explicitly.
- The summary lands in `dist/verification/summary.json` — already gitignored via `**/dist/` and
  already in the parity exclusion set, so it cannot contaminate the corpus it reports on.
- The parity component names one spec file; `test/*.mjs` would re-enter this runner recursively.
- The contract invokes the expensive run exactly once and all five criteria assert against that one
  summary. Re-running per criterion would cost ~75 minutes for no added signal.
- A gate that hides its own failure reason is half a gate: the runner prints stdout as well as
  stderr, because Playwright reports failures on stdout while stderr carried only build warnings.

**Milestone 1 is COMPLETE — slices 0-8 all pass.** Nothing committed; all work remains uncommitted
on `codex/react-electron-live-suite` awaiting AJ's review.
