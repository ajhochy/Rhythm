# Colony (Bot Crossing) Support Guide

Companion to [`colony-rollout.md`](colony-rollout.md), which is the release
packet of record. This document is for whoever fields a user-reported Colony
problem after rollout.

## First questions to ask

1. **Which profile and which Mac architecture (Apple Silicon / Intel)?**
   Colony state is per-profile and per-install; it never crosses profiles.
2. **Is this the signed release build, or a local/dev checkout?** Only the
   signed release build is supported; a dev checkout has different
   (`RHYTHM_COLONY_ARTIFACT_DIR`/`RHYTHM_COLONY_NODE`) requirements.
3. **Which harnesses are enabled for this profile?** (Settings → Bot
   Crossing.) Most "task looks wrong/missing" reports trace to a source
   being disabled, not installed, or scanning a different home directory
   than the user expects.

## Common reports and the fix

- **"Bot Crossing won't open at all."** Check for the artifact-missing error
  text ("Rebuild the pinned artifact and retry"). This means the packaged
  Colony resources are missing or failed verification — reinstall from a
  signed release candidate. It is never fixed by anything the user can do
  inside the app.
- **"I don't see the 3D scene."** This is the list-fallback working as
  designed when WebGL is unavailable (older/unsupported GPU, or a transient
  WebGL loss). Confirm the task list itself works — select, filter, open,
  archive, restore. If the list also fails, that's a different, real bug —
  escalate with the exact error text shown.
- **"A task I archived came back."** Archive state is local to the source
  configuration active when it was archived. If the user disabled that
  source and enabled a different one (or the same source with different
  paths), that's expected — archive state is not preserved across a source
  reconfiguration. Restoring the original source configuration should
  restore the prior archive state.
- **"Import didn't do anything."** Import always previews before committing.
  Confirm the user completed both the file picker step and the follow-up
  "commit" confirmation — a preview alone changes nothing.
- **"Colony is using a lot of memory/CPU."** Ask whether the tab has been
  open and idle for a long time, or has been backgrounded/foregrounded
  repeatedly (tab switches, minimizing). COL-08 requires no growing worker
  or listener count across repeated switches; if resource use keeps growing,
  file a bug with a repro (approximate switch count, inventory size) rather
  than working around it locally.

## Escalation

If the issue isn't covered above, capture:

- Rhythm version (Settings → About), macOS version, CPU architecture.
- Which harnesses are enabled, and roughly how many local tasks exist.
- The exact on-screen error text, if any (Colony's errors are written to be
  specific — "Rebuild the pinned artifact" and "This version of Rhythm does
  not include the Bot Crossing host" mean different things).

Do not ask a user to share their harness task history or file contents —
Colony's whole design point is that this data never has to leave their Mac.
