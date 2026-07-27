# Project State

## Current focus

MEM-OKF memory format, lifecycle, trust, provenance, navigation, links, and
audit history for issues #1187–#1196 are implemented and live-smoked.

## Active branches / PRs

- `codex/mem-okf`: draft PR
  [#1205](https://github.com/ajhochy/Rhythm/pull/1205), required CI green.
- `codex/1186-sandbox-foreground`: draft PR
  [#1204](https://github.com/ajhochy/Rhythm/pull/1204), clean to merge after
  human review.
- `codex/418-quick-add-rollover`: draft PR
  [#1203](https://github.com/ajhochy/Rhythm/pull/1203), clean to merge after
  human review.
- Creative installer PR
  [#1202](https://github.com/ajhochy/Rhythm/pull/1202) is merged.

## In progress

- Draft PR #1205 is ready for human review; no repository-owned check failures
  remain.
- Keep #1187–#1196 issue-atomic commits in their required sequence.
- Tool count is 82 (one new `rhythm_verify_memory` MCP tool); the MCP monolithic
  index file was not edited.

## Risks / known issues

- `buildMemoryPreface` and the audit enqueue path have broad upstream blast
  radii; targeted, full-memory, full-API, and live sandbox gates passed.
- Mechanical consolidation/revert has no public HTTP, WebSocket, or MCP trigger,
  so those behaviors are real-filesystem/SQLite integration-tested rather than
  live-route tested.
- Exact caller-controlled `(by, at)` lifecycle replay and authenticated
  owner/cross-owner verification have no credential-free live surface; their
  integration coverage is recorded in the verification contract.
- Flutter analyze is blocked before analysis by the host Dart 3.5.4 runtime;
  current dependencies require Dart 3.7 or newer. Dart formatting passes.

## Test status

- API TypeScript build/typecheck: PASS.
- Full API suite: PASS, 384 files and 3,380 tests; 34 files/61 tests skipped.
- MCP build/tests: PASS, 101 passed and 1 skipped.
- Combined live sandbox: PASS twice, 5/5 tests through real HTTP, WebSocket,
  built MCP stdio, copied SQLite, sandbox vault, and fork engine.
- Sandbox isolation: PASS; :4098/:4097 removed and live PIDs 965 (:4001) and
  1011 (:4096) unchanged.
- Agent-stack PR check: Dart format, API typecheck, and API suite PASS; Flutter
  analyze blocked only by the documented host SDK mismatch.
- GitHub CI: Type-check and build PASS; server-checks PASS.
- GitNexus compare against `origin/main`: LOW risk, zero affected indexed
  execution processes.
- Evidence:
  `docs/ai/runs/2026-07-26-mem-okf.md` and
  `docs/ai/contracts/issue-1187-1196.json`.

## Next step

Human review of draft PRs #1203, #1204, and #1205. Do not merge automatically.
