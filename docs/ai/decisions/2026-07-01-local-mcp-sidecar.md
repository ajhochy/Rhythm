---
date: 2026-07-01
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Machine-local MCP sidecar

## Context

Personal MCP definitions and API keys should not be added to the shared curated
registry, but local development still needs a supported way to materialize those
servers through the existing curated install path.

## Decision

Load optional definitions from the gitignored
`src/config/curated_mcp_servers.local.json` file. Validate the complete array
before merging it into `CURATED_MCP_SERVERS`; ignore invalid files with a
warning. Allow `RHYTHM_LOCAL_MCP_SERVERS_PATH` to override the default path for
compiled or packaged runtimes.

## Alternatives

- Commit personal definitions to the shared registry: rejected because secrets
  and machine-specific services do not belong in source control.
- Parse the sidecar without validation: rejected because malformed JSON or
  invalid shapes could crash startup or fail later in MCP installation.
- Use only an environment variable containing JSON: rejected because large
  structured definitions are difficult to maintain safely in shell state.

## Consequences

- Missing sidecars preserve existing behavior.
- Valid local definitions use the same materialization and enrichment paths as
  curated definitions.
- A malformed or invalid sidecar cannot prevent API startup.
- Operators must secure the local file and keep it out of source control.
