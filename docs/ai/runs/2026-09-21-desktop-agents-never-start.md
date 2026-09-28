---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr:
issues: []
status: fixed-app-recovered
tags: [run, rhythm]
---

# Desktop candidate: "Agents server never comes up" — the engine never crashed

## Symptom
Freshly installed `Rhythm Mega Desktop Candidate.app` (built from 481f5549) showed
`Environment: Connecting · API :4001 error · Engine :4096 error` plus "did not connect
within 8 seconds". Both ports dead.

## Root cause
Not an engine crash. `apps/electron/src/agent-server.mjs` `#waitForReady()` gives the local
runtime an **8 second** wall-clock budget, then SIGTERMs the api_server it spawned;
api_server's `dispose()` in turn kills the opencode engine. Every "fetch failed /
ECONNREFUSED 127.0.0.1:4096" line in the durable log is *after* that SIGTERM, i.e. the
aftermath of a deliberate shutdown, not its cause.

Durable log `/Users/ajhochhalter/Library/Logs/Rhythm/api_server.log`, the failing boot:

```
17:38:09.8  (spawn; readiness deadline ≈ 17:38:17.8)
17:38:11.244  Rhythm API listening on 127.0.0.1:4001
17:38:12.668  createOpencode (engine spawn) took 1302ms      ← engine up and listening
17:38:14.835  approval continuation recovery complete         ← last line; 3.1s of silence
17:38:17.965  SIGTERM received — starting clean shutdown      ← deadline + 0.1s
17:38:18.018  reloadConfig SDK error: fetch failed            ← after the kill
```

Both halves were healthy for ~5s before the deadline, and the readiness probe still never
passed. The failing boot is also the only boot with no `[relay] uplink client started`
line — Electron main's Keychain-backed relay-config read silently failed in the same boot.
That is the signature of a first-launch-of-a-newly-signed-bundle stall (Gatekeeper scan,
Keychain ACL prompts for the new code identity, cold Chromium network service), not of a
defect in either server.

## Evidence the servers were fine
- Packaged api_server + bundled engine, spawned by hand with the app's exact env
  (PORT=4001, RHYTHM_OPENCODE_ENGINE_PORT=4096, AGENT_LOCAL=true, the Electron DB):
  the supervisor's own `runningRhythmRuntime` predicate went green in **2.9 seconds**.
- Bundled engine `/global/health` returns
  `{"healthy":true,"version":"0.0.0-rhythm-481f554915a1aa455188d7f64dac74910c183218",...}`.
- `git diff 3641f303..481f5549` touches **no** Electron main/supervisor code — the eight
  commits are api_server, Flutter and web only. The supervisor is byte-identical to the
  build that worked.
- Relaunching the same installed bundle, both from the Terminal and via LaunchServices
  (`open -a`), now brings up 4001 and 4096 every time. The failure was the first launch of
  the new bundle and has not recurred.

## Fix
`apps/electron/src/agent-server.mjs`:
- Readiness budget 8s → **45s**, overridable with `RHYTHM_AGENT_READY_BUDGET_MS`
  (the ownership suite sets 8000 so its bounded-timeout case stays fast). The budget stays
  bounded — the point of the original 8s was to avoid a 88s worst case, not to be 8s.
- New `describeRuntimeProbe()`, run **once** on give-up, appends the actual api and engine
  responses to `stderrTail`. The health probe is a boolean by design, so a timeout used to
  name neither half; the next occurrence is now a log read instead of a dig.
- The user-facing message quotes the real budget instead of a hard-coded "8 seconds".

## Checks
- `apps/electron` `node --experimental-vm-modules --test test/agent-server.test.mjs
  test/agent-server-ownership.test.mjs` → **23/23 pass**.
- Installed app verified up after the change was written (fix ships with the next build).

## Notes
- `createOpencode()` resolving "successfully" for a dead child was considered and is NOT a
  defect here: the SDK resolves only on the engine's own `opencode server listening` line,
  so its success report was accurate — the engine really was listening.
- Not done: rebuild/repackage. The installed bundle is working; this fix only changes
  first-launch tolerance and ships with the next `npm run package:mac` + sign.

## Rebuild attempt (staging) — BLOCKED

Asked to stage a rebuilt bundle from `1963bf42`. Pre-flight completed, packaging denied.

Completed and verified:
- Worktree `.mega-wt/integration` at `1963bf42`, identical to
  `origin/mega/2026-09-18-mobile-electron-hermes`. Clean tree (only this untracked run log
  and the earlier rebuild's).
- Hermes artifact re-validated, not assumed, via `resolveHermesDesktopArtifact` at
  `expectedElectronMajor: 40`, `allowDirty: false`:
  `sourceCommit 8ea642dbb6a8b8d65868c3e7a468c471914f037b` (pin unchanged), 403
  integrity-covered files, not dirty. No Hermes fork rebuild needed.
- `GOOGLE_DESKTOP_CLIENT_ID` recovered from the installed bundle's generated
  `build-config.mjs` (public OAuth client; no secret read or handled).
- Node 22.23.0 (package-mac.mjs requires major 22). 133 GiB free.

Blocked:
- `npm run package:mac` (with the artifact dir + client ID, writing only to
  `apps/electron/dist/`) was **denied by the permission system**. Not retried and not
  reworked into another command shape. Nothing was built, signed or staged.
- `apps/electron/dist/Rhythm.app` is therefore still the earlier 481f5549 candidate and
  does NOT contain the readiness-budget fix.

The installed app at `~/Applications/Rhythm Mega Desktop Candidate.app` was not touched:
API :4001, gateway :4002 and engine :4096 remained live throughout.

## Rebuild staged (second attempt) — SIGNED AND VERIFIED

Packaging was run by the user after the earlier denial. Signing and verification done here.

- Staged: `apps/electron/dist/Rhythm.app` — **659 MB**, Developer ID signed, **not notarized**.
- Sign log: `/tmp/rhythm-20260921b-sign.log`. Package log: `/tmp/rhythm-20260921b-package.log`.
- Only the signing phase of `sign:mac` was replayed (lines 1–137 verbatim, from a scratchpad
  copy with absolute imports and the notarization credential guard reduced to the two signing
  vars). No notarization, no zip, no staple.

Signature:
- Identity passed as the SHA-1 hash `CF6C1EF1525E70E6E3324388A322938977779DB7`; the name
  `Developer ID Application: Aaron Hochhalter (56Q69NYP9H)` remains ambiguous across three certs.
- 51 nested Mach-O targets signed deepest-first, hardened runtime, `--timestamp`, entitlements;
  approval helper signed with its stable `com.rhythm.desktop.approval-signer` identifier.
- Hermes artifact integrity re-sealed after nested signing and re-validated at pin
  `8ea642dbb6a8b8d65868c3e7a468c471914f037b` / Electron 40.
- `codesign --verify --deep --strict --verbose=2` → **exit 0**, "valid on disk",
  "satisfies its Designated Requirement". `flags=0x10000(runtime)`, `TeamIdentifier=56Q69NYP9H`,
  timestamped 2026-09-21 11:35:32.
- `spctl --assess` → rejected, `source=Unnotarized Developer ID`. Expected; identical to the
  10:20 candidate. Not notarized by design.

Content provenance:
- `apps/electron/src` working tree is identical to `1963bf42` (`git diff` empty).
- Packaged `Contents/Resources/app/src/*.{mjs,cjs}` byte-compared against that tree:
  **18 checked, 0 mismatches**, 1 skipped (`build-config.mjs`, generated at package time).
- Staged `agent-server.mjs` carries the fix: `describeRuntimeProbe` at line 149,
  `#readyBudgetMs = Number(process.env.RHYTHM_AGENT_READY_BUDGET_MS) || 45_000` at 202,
  deadline derived from it at 390. **No `8_000` and no "8 seconds" string remain.** The
  installed build still has both at lines 356/367 — the contrast confirms the swap is real.
- Bundled `api_server/dist/services/skill_usage_tracker.js` has the idle-scan fix:
  `async function countSkillToolUses()` with `SCAN_CHUNK_ROWS = 100` and a `setImmediate` yield.

Untouched, as required: `~/Applications/Rhythm Mega Desktop Candidate.app` still dated 10:20,
its runtime still serving :4001 and :4096 throughout; `opencode serve` PIDs 26701 and 65094 alive.
No push, tag, merge, notarization or workflow dispatch.
