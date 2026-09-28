# Colony (Bot Crossing) Opt-In Rollout

Rhythm Electron's Colony workspace ("Bot Crossing" in the product UI, route
`/colony`) lets a profile see its local coding-agent work — Hermes, Codex,
Claude Code, OpenCode, Rhythm, Kilo Code, Cursor, Antigravity — drawn as a
shared local scene, plus a keyboard-operable list fallback. This document is
the release packet for approving it as an **opt-in** feature for all Rhythm
Electron users. See [Colony M1–M4 issue #1525](https://github.com/ajhochy/Rhythm/issues/1525)
for the full implementation plan; the twelve COL-01..COL-12 issues are the
individual gates this packet links together.

**Closing issue #1525, or any single COL issue, does not publish a release.**
A release is a human decision made after every gate below has receipts (see
"Approval checklist").

## Data model

Colony's data model is strictly local and read-only against its sources:

- Discovery reads existing local task stores (each harness's own home
  directory or database) to build an in-memory inventory. It never writes to
  a harness's own records, and it never uploads paths, history or task
  content to Rhythm's hosted API.
- The only data Colony writes is its **own** profile-scoped preferences and
  cache, under the signed-in Rhythm profile's `userData` directory — which
  sources are enabled, per-profile view preferences (quality, sound,
  reduced-motion), and the local archive/viewed state produced by
  `state.mark` actions (see "Archive semantics").
- Nothing Colony stores is synced to production Postgres or any other
  Rhythm profile; it is deleted with the local profile.

## Harness/action matrix

| Harness | Source path kind | Exact "Open" | Archive/restore | Notes |
|---|---|---|---|---|
| Rhythm | local SQLite database | Opens the matching Agents session | Yes | Native destination; no external app required |
| Codex | CLI home directory | Opens in the Codex desktop app when installed | Yes | Reports "unavailable" honestly when Codex is not installed |
| Hermes | CLI home directory | Opens in Hermes when installed | Yes | |
| Claude Code | config dir + optional desktop sessions | Opens in Claude Code when installed | Yes | |
| OpenCode, Kilo Code, Cursor, Antigravity | database or project directory | Observation only (`canOpen: false`) | Yes | Selection, filter, archive, restore, Finder-reveal and copy-path all work even when exact open is unsupported |

Select, filter, open (where supported), reveal in Finder, copy path, archive
and restore all work through the keyboard-operable list, independent of
whether the 3D scene is available (see COL-08's list-fallback mode).

## Permissions

- Discovery is **read-only**: Colony never deletes, renames or modifies a
  source record.
- No automatic agent turns, prompts or API calls are ever issued by Colony;
  every action is a direct response to an explicit local user action.
- The embedded scene runs sandboxed and network-isolated (no access to
  Rhythm's bearer tokens, parent DOM, arbitrary URLs, or filesystem/process
  APIs beyond the one local worker process Colony itself owns).
- Enabling Colony, and choosing which sources it may read, is an explicit
  per-profile opt-in; it is off by default for every new profile.

## Archive semantics

"Archive" and "restore" (and "mark viewed") only ever change Colony's own
local state — never a source's underlying record. Archiving a task hides it
from the default view and answers `getInventory` as archived; restoring
reverses that. Because this state lives entirely in Colony's own
profile-scoped store, it survives across enable/disable cycles but does not
follow a task if its source is later disabled and a different source is
enabled in its place, and it is never uploaded or shared across profiles.

## Import/backup

A profile can import a previously exported Colony state file (`Import
Bot Crossing state` in Settings): the app dialog picks a `.json` file, a
preview step reports the archived/viewed/group counts it would apply without
committing, and a separate commit step applies them. Import always previews
before committing, and a cancelled or failed import leaves existing state
untouched. Colony also keeps its own periodic local backups
(`state-<timestamp>.json` under the profile's Colony data directory) that the
rollback procedure below can restore from.

## Disable

Disabling Colony (the toolbar "Disable" action, or Settings) immediately:

- tears down the native scene/worker for that profile (no orphaned process),
- stops all scheduled scanning,
- and leaves local preferences, archive/viewed state and backups **in
  place** — re-enabling does not lose prior state, and disabling never
  affects any other Rhythm feature, agent session, or the ongoing API/engine
  processes.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "Bot Crossing could not open. Rebuild the pinned artifact and retry." | The packaged Colony artifact is missing, corrupt, or from an unverified build | Reinstall from a signed release candidate (see COL-09/COL-10); do not attempt a source checkout |
| 3D scene never appears, but the task list works | WebGL is unavailable or was lost | This is the intended list-fallback (COL-08); Bot Crossing remains fully usable via the list. "Retry 3D scene" attempts the scene again |
| A harness shows "Not found on this Mac" | That harness isn't installed or its expected path differs | Verify the harness is installed at its default location; Colony does not search custom install paths |
| "Open unavailable" for a task | That harness doesn't support exact native opening | Use "Show in Finder" / "Copy path" instead; this is a capability gap, not a bug |
| Inventory load never finishes | A slow or stalled source scan | After 60 seconds Colony offers Cancel/Retry; Retry re-issues only the one stalled request |

## Updates (manual ZIP replacement)

Rhythm Electron does not yet have an automatic updater. Updating to a new
signed build is a manual ZIP replacement: download the new
`Rhythm-<arch>.zip` release candidate, verify its SHA-256 against the
published manifest, quit the running app, and replace the installed `.app`
with the extracted one. This is the same update path the rest of the
Electron host uses; Colony does not introduce a separate update mechanism,
and this document does not assert automatic-updater coverage that does not
exist.

## Rollback

If a Colony release causes a regression, rollback has two independent parts
that can be used together or separately, and neither touches harness
records:

1. **Disable Colony** for the affected profile(s) (Settings → Disable). This
   is immediate and reversible, and preserves local preferences/archive
   state.
2. **Restore the previous compatible signed host build** via the same
   manual ZIP replacement described above, pointed at the prior release's
   ZIP. Local Colony preferences and its own state backups are unaffected by
   which host build is installed, since they live in profile `userData`, not
   inside the `.app` bundle.

Rehearsing this procedure against a preserved preference fixture is part of
the COL-12 approval checklist below.

## Approval checklist

One required row per COL-01..COL-11 receipt. **Missing arm64, x64, signing,
or installed evidence keeps the release blocked** — no row here may be
marked passed without a linked receipt path.

| Issue | Gate | Receipt | Status |
|---|---|---|---|
| COL-01 | Pinned upstream source + sealed embedded artifact | `docs/ai/plans/2026-09-18-electron-colony-tracking.md` | pending link |
| COL-02 | Artifact verification + isolated embedded bridge | `apps/electron/test/colony-desktop-artifact.test.mjs` | pending link |
| COL-03 | Owned local scanner + source discovery | `apps/electron/test/colony-sources.test.mjs`, `colony-multisource-contract.test.mjs` | pending link |
| COL-04 | Rhythm-native workspace/menu design | `docs/ai/decisions/2026-09-25-colony-workspace-design.md` | pending link |
| COL-05 | Native tab, task rail, inspector | `apps/web/tests/pages/colony.spec.ts`, `colony-rail.spec.ts` | pending link |
| COL-06 | Exact task actions + native menus | `apps/web/tests/pages/colony-actions.spec.ts` | pending link |
| COL-07 | Opt-in, persistent preferences, reversible import | `apps/web/tests/pages/colony-settings.spec.ts` | pending link |
| COL-08 | Resource behavior, accessibility, failure recovery | `apps/web/tests/pages/colony-fallback.spec.ts`, `apps/electron/test/colony-headless-contract.test.mjs` | pending link |
| COL-09 | Sealed artifact staged in the Mac package | `apps/electron/test/colony-package.test.mjs` | pending link |
| COL-10 | Release CI is the Colony artifact producer | `apps/electron/test/runtime-config.test.mjs`, actual signed arm64+x64 CI runs | **release-gated — requires AJ to dispatch `electron_release.yml`** |
| COL-11 | Installed signed qualification, both architectures | `docs/ai/contracts/colony-installed.json`, `apps/electron/test/colony-installed/` | **physical-hardware — requires real disposable-account runs on both architectures** |

**This checklist alone never authorizes a release.** The Electron
replacement of Flutter, the production provider migration, and the Flutter
retirement gate are independent decisions that stay separate from Colony's
approval — Colony can be approved for opt-in rollout without any of those
other gates having passed, and none of those other gates are satisfied by
approving Colony.
