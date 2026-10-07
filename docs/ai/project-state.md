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

Diagnostic desktop build (`~/Documents/Codex/2026-10-07/diagnostic-build/Rhythm.app`)
relaunched 2026-10-07 05:47Z with the identical captured env
(`~/Documents/Codex/2026-10-07/scratch-durable/relaunch-desktop.sh`): engine
`0.0.0-investigate/file-status-bound-202610062245` from the worktree dist via
`RHYTHM_OPENCODE_BIN`, `BUN_INSPECT` on 9230. api_server still runs from the signed
bundle. Simulator iPhone 17 Pro has the production app paired as "Rhythm iPhone"
(device 20aeb51a…). AJ's phone will show one `.invalid` blip from the restart and
must re-pair if its token was replicated against the old boot.

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

AJ smokes from his phone (open the Announcement Slides chat, send, see the reply).
Then build a signed desktop candidate from integration @ 42a0c299 and un-park #1607.
