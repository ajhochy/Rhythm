---
date: 2026-07-27
repo: Rhythm
branch: feature/pexels-openmontage
pr: null
issues: []
status: verified-uncommitted
tags: [run, Rhythm]
---

# Pexels-first OpenMontage footage search

## Files

- Added a review-only `openmontage_prepare_zero_key_assets` MCP tool backed by
  OpenMontage's installed stock-source adapters.
- Pexels is preferred when `PEXELS_API_KEY` is present; Wikimedia, NASA, NARA,
  LOC, Archive.org, and Pond5 Public Domain remain bounded fallbacks.
- Added optional MCP environment interpolation, tests, and skill guidance.

## Checks

- Installed-runtime bridge tests: **6 passed**.
- Curated MCP config tests: **7 passed**.
- API TypeScript typecheck and production build: **passed**.
- Heavy OpenMontage contract: parsed and **3 skipped normally** behind its env
  gate.
- Direct MCP initialize/list/approval-guard exchange using the installed
  OpenMontage Python/runtime: **passed**.
- Installed OpenMontage provider presence and Pexels priority assertion:
  **passed**.
- Saved Pexels credential validated with the real API, configured in the
  gitignored API server `.env` at mode `0600`, and exercised through the new
  bridge with one approved review-only query: **Pexels candidate returned with
  provider, creator, license, original URL, and preview metadata**.
- Initial full API run was blocked by a local `better-sqlite3` Node ABI
  mismatch. After rebuilding it, the default run exposed a stale local MCP
  sidecar collision with the now-built-in Obsidian entry. With that unrelated
  sidecar disabled, the full suite reported **3245 passed, 56 skipped**.
- `git diff --check`: **passed**.
- GitNexus comparison against `origin/main`: **low risk**, no affected indexed
  execution processes.

## Notes

- No stock-source network request occurs before explicit script approval.
  Search returns provenance-rich review candidates only; it does not download,
  render, or publish.
- The heavy sandbox install test was not executed because OpenMontage was not
  installed in the sandbox and the managed install is roughly 500 MB. The same
  bridge was exercised directly against the already-installed OpenMontage
  runtime without touching the live Rhythm server.
- `PEXELS_API_KEY` is now configured locally. Public-domain fallback remains
  available if the key is absent or Pexels returns no usable candidate.
- Work is intentionally uncommitted and unpushed.
