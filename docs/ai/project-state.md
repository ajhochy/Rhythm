# Project state

## Current focus

Mobile transcript regression: **root cause found and fixed in the engine** (2026-10-07,
run log `docs/ai/runs/2026-10-07-mobile-transcript-root-cause.md`, registry entry 3c).
`File.status` read every untracked file in full; the active chat's cwd holds 3.0 GB of
untracked PNGs, so every mobile connect pinned the engine for ~71 s and the paired-host
store fell to `paired-mac.invalid`. Fix `d69ad22e` bounds those reads and stops the
HOME watcher. Verified on the iOS simulator over the real relay path: 3 sends, 3
rendered replies, engine ≤30% CPU under concurrent file-status load.

## Active branch / PR

`investigate/mobile-transcript-regression` @ d69ad22e (pushed) → merged into
`integration/2026-10-07-combined` @ 42a0c299, draft PR #1607 → mega. Parked: not for
merge until AJ smokes it on his phone. The earlier resume lineage (PR #1604 →
main) is unchanged.

## Installed / running

Signed sign-only candidate from `investigate/mobile-transcript-regression` @ 8f9be4ab is
running on AJ's normal profile: `~/Documents/Codex/2026-10-07/signed-desktop-build-investigate/signed-apps/8f9be4ab/Rhythm.app`
(bundled engine `0.0.0-rhythm-8f9be4ab…`, api_server with the mirror bound, mobile contract
`7d073feb…` = AJ's phone). Launch it with `~/Desktop/Open Rhythm (patched engine).command`
(sets the normal profile; a bare Finder launch starts a signed-out default profile).
Build recipe + receipts in that directory (`pipeline.sh`, `run-normal-package.py`, headers
pinned at `~/Documents/Codex/2026-10-07/node-headers-22.23.0`). `/Applications/Rhythm.app` is
still 0.18.67 (unfixed). Simulator iPhone 17 Pro paired as "Rhythm iPhone" (20aeb51a…).

**Contract trap:** `integration/2026-10-07-combined` @ 42a0c299 reconciled the mobile
contract fingerprint to `dbe19d8f…` (eb7baeef). A Mac built from it hard-blocks any phone
app pinned at `7d073feb…` ("incompatible agent protocols") — verified on the simulator.
Ship that Mac build only together with a TestFlight build from the same commit. That
staged build exists at `~/Documents/Codex/2026-10-07/signed-desktop-build/signed-apps/42a0c299/Rhythm.app`.
## In progress

- AJ's own phone smoke of PR #1607 (the only remaining check the simulator cannot do).
- Signed desktop rebuild so the bundled engine/api_server carry d69ad22e and the
  earlier mirror bound `20554dad`.

## Risks / known issues

- Settings → Connection shows `https://paired-mac.invalid` as the address while unpaired.
- 654 legacy sessions still have `cwd=/Users/ajhochhalter`; the engine no longer watches
  HOME, but tools in those sessions can still read anything under HOME (containment is
  `ctx.directory`). Consider archiving them.
- `ai-workflow checks --level issue` in this worktree needed `npm ci` in apps/mcp_server.
- Prior risks (G2 live loop unproven, Research B captures, router Shadow, pre-existing
  CI reds) carry over from the 2026-10-06 snapshot.

## Test status

Fork: `bun test test/file/index.test.ts test/file/watcher.test.ts` 59/59; `tsgo` clean.
api_server tsc clean; flutter analyze + dart format clean (issue-level checks).
Live: file-status 0.21 s on the 3 GB dir (was 71.5 s); simulator rounds 1–3 pass.

## Next step

AJ smokes from his phone on the running 8f9be4ab build (open the Announcement Slides chat,
send, see the reply). Decide: keep the Mac on the investigate lineage (phone-compatible), or
ship integration @ 42a0c299 Mac + TestFlight together. PR #1607 stays parked until that call.
