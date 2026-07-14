---
date: 2026-07-13
repo: Rhythm
tags: [decision, Rhythm, mcp, openmontage]
---

# OpenMontage via a constrained local MCP wrapper

## Context

Graphic Designer was intentionally shell-denied, while OpenMontage is agent-first
and normally expects a coding agent to run local Python/Node tools. AJ approved a
tighter integration rather than granting the profile raw Bash access.

## Decision

Install OpenMontage separately at `/Users/ajhochhalter/Documents/OpenMontage` and
register a machine-local stdio MCP wrapper at
`/Users/ajhochhalter/Documents/OpenMontage-mcp/openmontage_mcp_server.py`.

Graphic Designer remains shell-denied (`corePermissionsJson: null`; generated
agent file has `bash: {"*": "deny"}`) and is limited to seven wrapper tools:
capability reporting, script-review creation, explicitly approved vertical
text-motion rendering, zero-key narration/footage candidate preparation,
explicitly approved local documentary-montage rendering, metadata-gated local
music listing, and draft-status inspection.

The wrapper does not expose arbitrary shell execution, credentials, provider
configuration, publishing, sharing, export, deletion, unrestricted music, or AI imagery.
It can generate narration only with a fixed downloaded Piper model and can
retrieve review candidates only through its fixed no-key public-source adapter
set. It writes an OpenMontage script checkpoint as `awaiting_human`, then an
asset/narration checkpoint as `awaiting_human`; it creates a new render on each
approved revision.

### Caption and music extension (2026-07-13)

Install the keg-only Homebrew `ffmpeg-full` binary and pin the wrapper to
`/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; it includes `libass`, unlike the
existing minimal system `ffmpeg`. The wrapper creates an SRT from the approved
script and burns it in with a fixed FFmpeg command after composition.

Music remains local-only: it is exposed only from
`OpenMontage/music_library/` when an adjacent JSON file declares title, license,
and source. A requester must select that returned ID and explicitly set
`music_approved: true`; only then is the immutable project copy mixed under
Piper narration with sidechain ducking. No track is downloaded or selected
automatically.

### Fast first-pass footage retrieval (2026-07-13)

Zero-key footage retrieval is limited to three search phrases, one candidate per
phrase, and a 75-second wall-clock deadline. This fits interactive MCP calls and
avoids treating a multi-minute batch download as an adapter outage. The wrapper
retains OpenMontage's partial timeout results for human review; if none arrive,
it returns an explicit human-decision state rather than throwing a generic
failure. Once acquisition starts, a durable project marker rejects a
text-motion render for that same project.

## Alternatives

- Grant `bash: ask` to Graphic Designer: rejected because every approved shell
  command would retain broad filesystem/process access and the existing profile
  was deliberately sandboxed.
- Pretend OpenMontage is an MCP server: rejected because it is not MCP-native.
- Expose the whole OpenMontage tool registry: rejected because it would re-create
  raw orchestration/publishing risk under another surface.

## Consequences

- Social posts can start as reviewable local text-motion drafts or use the
  review-gated zero-key Piper/public-footage montage route. Paid/AI-generated
  visuals remain a separately approved expansion with explicit cost disclosure.
- The current Homebrew FFmpeg build lacks the `subtitles` filter. The wrapper
  was replaced in the wrapper only by keg-only `ffmpeg-full`; captions now burn
  locally without changing the system `ffmpeg` used by other projects.
- OpenMontage is AGPLv3; retain this separation and review licensing before any
  redistribution or product bundling.
