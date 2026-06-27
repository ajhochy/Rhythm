# Project State

## Current focus

**2026-06-27 — Agents Terminal / session-startup reliability in release builds.**

Just fixed the Agents → Terminal "connection failed" bug (a release-only
code-signing issue). A related "session stuck on Starting" bug is diagnosed and
filed. Underlying theme continues: defects that only appear at real runtime
seams (notarized binary, hardened runtime, opencode child sessions) and are
invisible to local test suites.

## Active branch / PR

- **Branch:** `main` (PR [#752](https://github.com/ajhochy/Rhythm/pull/752) merged → `9a0618dde`).
- **Release in flight:** **v18.52** (run 28295115213) — validates the terminal fix; the only way to confirm Bug A end-to-end.
- **Related open PRs:** [#749](https://github.com/ajhochy/Rhythm/pull/749) (agent-scheduler, smoke partly blocked), [#734](https://github.com/ajhochy/Rhythm/pull/734) (Odysseus port; needs packaged-runtime validation).

## In progress

- v18.52 release build (sign + notarize); validate Agents → Terminal once published.
- Manual smoke / merge readiness for #749.

## Risks / known issues

- **Issue [#751](https://github.com/ajhochy/Rhythm/issues/751) — agent session stuck on "Starting"** when the turn runs in a delegated child/sub-agent session. Status events from child sessions aren't mapped to the parent in `opencode_stream_bridge.ts`. Deferred; needs a state-machine fix.
- **Release-only signing class of bug.** PTY failure was invisible to `flutter run` and CI; hardened-runtime library validation only bites the notarized build. Treat opencode native-lib behavior as release-validate-only.
- **Verification weak at real runtime seams** (SDK shape drift, packaged path drift, stale backends, Postgres bootstrap drift) — unchanged from prior runs.

## Test status

- Desktop CI on #752 — PASS (run 28294948919)
- `plutil -lint` / strict plist parse / `bash -n` on the signing change — PASS
- PTY-works-in-release — **pending v18.52** (cannot verify locally)
- (Prior full suite on `main`: `flutter analyze`, `dart format`, api_server `tsc`/`vitest`, `flutter test` — PASS)

## Next step

1. When v18.52 publishes, install and confirm Agents → Terminal opens a working shell (validates #752).
2. Schedule the #751 fix (child→parent status attribution) — design before coding; release-validate.
3. Resume blocked #749 smoke items.
