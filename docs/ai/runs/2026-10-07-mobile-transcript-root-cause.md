---
date: 2026-10-07
repo: Rhythm
branch: investigate/mobile-transcript-regression
pr: 1607
issues: []
status: fixed, simulator-verified, awaiting AJ phone smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Mobile transcript regression — root cause found and fixed

## Root cause (measured, not inferred)

The engine's `File.status` (`apps/opencode_fork/packages/opencode/src/file/index.ts`)
read **every untracked file in full** with `readFileString` and `split("\n")` to count
lines. The active chat's cwd (`Obsidian Vault/Areas/worship-ministry/Announcement Slides`)
has 1,842 untracked files, 3,173,533,525 bytes (2.9 GB `.png`, 213 MB `.mp4`).

- Direct measurement on the unpatched engine: `GET /file/status?directory=<that dir>`
  = **71.5 s**, HTTP 200, 434 KB.
- Both JSC CPU profiles from the night before (97.6% / 95.0% native `decode`, 2%
  `stringSplitFast`, every sample under a `readFile` callback) are exactly this loop
  decoding PNG bytes as UTF-8.
- The mobile app calls `client.file.status()` in `refreshServerFeatures` on every
  connect/project change; the desktop Inspector and api_server `GET /:id/files/status`
  call it too. So opening that chat from the phone pinned the engine for minutes →
  gateway identity check timed out → paired-host store dropped to disconnected →
  `https://paired-mac.invalid` sentinel → instant "network error".

Second finding: 654 legacy sessions have `cwd=/Users/ajhochhalter` (old Flutter desktop
defaulted `cwd` to `$HOME`; last one 2026-09-17; 523 still `idle`). The api_server
opens an engine instance for every active-session directory on boot, so the engine
started a recursive fs-events watcher over HOME (~400k files) every launch. The server
itself never substitutes HOME (`agent_sessions_controller.ts` rejects a blank cwd).

## Fix — commit d69ad22e (engine)

- `File.status`: never read non-text mimes; per-file cap 1 MiB; aggregate budget
  64 MiB; files over budget report `added: 0`. Line-count semantics unchanged.
- `FileWatcher`: no recursive watcher for HOME or `/`.
- Tests: `bun test test/file/index.test.ts test/file/watcher.test.ts` → 59 pass.
  Both new tests were shown failing with the guard removed (mutation proof).

Codex ran on `gpt-5.6-sol` (`gpt-6.1-sol` is rejected for ChatGPT-account Codex);
the watcher guard was an Opus subagent. No failure-triage round was needed.

## Verification on the simulator (real transport path, no stubs)

iPhone 17 Pro simulator, production variant (`org.visaliacrc.rhythm.agents`, Release,
built from this branch), signed in as AJ's real cloud account, paired through
`https://api.vcrcapps.com/relay` with a pairing code minted directly in
`mobile_pairing_codes` (device `20aeb51a…`, "Rhythm iPhone", 2026-10-07T05:52Z).
Settings showed "Connected securely to your Mac through Rhythm Cloud Gateway".

Patched engine (`0.0.0-investigate/file-status-bound-202610062245`, relaunched with
the identical captured env incl. `BUN_INSPECT`):

| check | result |
|---|---|
| `GET /file/status` on the 3 GB dir | 0.21–0.31 s (was 71.5 s) |
| open "Hyperframes vs announcement slides" chat from the simulator | transcript rendered in 6 s |
| 3 sends under load (176 concurrent file-status calls, p50 0.226 s) | own message rendered 5–6 s; replies PONG1/PONG2/PONG3 rendered 11–12 s |
| engine CPU during the run | max 29.8%, never above 50% |
| HOME watcher | `skipping watcher for home directory` logged; no HOME `init` |

Screenshots: `~/Documents/Codex/2026-10-07/scratch-durable/round{1,2,3}.png`.
Tooling: AXe CLI (`~/Documents/Codex/2026-10-07/tools/sim.sh`) — the Xcode MCP tap
tools are not enabled in this host and the simulator MCP needs an attended session.

## Files

- `apps/opencode_fork/packages/opencode/src/file/index.ts`, `src/file/watcher.ts`
- `apps/opencode_fork/packages/opencode/test/file/index.test.ts`, `test/file/watcher.test.ts`
- `docs/ai/regression-registry.md` (new entry 3c), this run log, `docs/ai/project-state.md`

## Notes / follow-ups

- Simulator pairing trap: a stale pairing makes a new pair roll itself back
  ("previous Mac could not be revoked"); use Settings → "Forget the paired Mac" first.
  iOS smart quotes break typed JSON payloads; the `rhythmagents://pair?payload=` deep
  link works (uninstall any other app sharing the scheme first).
- Settings → Connection still displays `https://paired-mac.invalid` as the address
  while unpaired (lying indicator; cosmetic).
- The dev simulator app was uninstalled; rebuild with `expo run:ios` if needed.
- AJ's phone still has to be smoke-tested by him on his own schedule; everything the
  simulator can prove is proven.
