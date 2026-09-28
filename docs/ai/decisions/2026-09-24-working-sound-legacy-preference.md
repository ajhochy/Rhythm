---
date: 2026-09-24
status: accepted
tags: [decision, rhythm, mobile, issue-1510]
---

# Preserve stored working-sound choices

## Context

Routine processing audio now defaults off. Older preference snapshots may
contain an unmarked `workingSoundEnabled: true`; the persisted shape cannot
distinguish an old default from a user who intentionally selected a sound.

## Decision

Preserve every stored boolean, including an unmarked stored `true`, and stamp
the snapshot with `workingSoundDefaultMigrated: 1`. Only a snapshot with no
stored choice inherits the new default-off behavior. Explicit off and later
re-enables continue to persist across relaunch and host changes.

This matches `migrateWorkingSoundPreferences` and its #1510 contract coverage.
It does not claim audible physical-device or Electron verification.

## Alternatives

Resetting every unmarked `true` once was rejected because the data does not
prove that the value came from the former default; it could silently discard an
intentional user preference.

## Consequences

Existing users with a stored opt-in may continue hearing the processing sound
until they turn it off. New or choice-free snapshots remain quiet by default.
Physical iPhone and Electron attribution and audible verification remain
manual acceptance work for #1510.
