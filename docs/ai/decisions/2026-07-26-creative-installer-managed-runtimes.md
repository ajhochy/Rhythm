---
date: 2026-07-26
repo: Rhythm
tags: [decision, Rhythm]
---

# Creative installers own their runtimes and launch paths

## Context

Creative-tool installation ran from a macOS GUI process, where the interactive
shell's PATH and Python/npm versions are not reliable. The old generic recipe
could mark an install successful even when it had not produced the executable
path used by the curated MCP catalog.

## Decision

Each creative capability has a fixed installer recipe and a shared on-disk
layout contract. Python recipes bootstrap a checksum-verified, pinned `uv`
distribution and create managed Python 3.11 virtual environments. Node recipes
run a checksum-verified, pinned npm CLI through Rhythm's current Node runtime.
All downloads, commands, package names, checksums, and destinations are
code-owned rather than caller-controlled.

Installation occurs in a staging directory. The installer verifies required
files, rewrites staging paths embedded in virtual-environment console scripts,
then atomically promotes the directory. Capability status and curated MCP
commands use the same final paths; a sentinel alone is never treated as proof
of installation.

## Alternatives

- Depending on Homebrew or the user's shell PATH was rejected because it is not
  dependable from the signed desktop application.
- Using system Python was rejected because supported Macs may expose an old
  Apple Python or an incompatible newer Python.
- Running `npx`/`uvx` on every MCP launch was rejected because it reintroduces
  network and environment variability after installation.
- Keeping generic artifact-plus-command recipes was rejected because different
  upstream package formats require different extraction and verification steps.

## Consequences

- Installs are larger, but repeatable and locally launchable.
- Reviewed release pins and checksums must be updated intentionally.
- Recipe versions must change whenever installed layout or launcher relocation
  behavior changes.
- Status checks fail closed when any required runtime path is missing.
- Blender's current reviewed application artifact supports Apple silicon only;
  adding Intel support requires a separately reviewed artifact and checksum.
