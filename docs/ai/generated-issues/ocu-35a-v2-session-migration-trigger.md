# OCU-35A — Adopt OpenCode v2 sessions only after upstream lifecycle parity

**Type:** architecture / engine integration · **Priority:** deferred
**Supersedes:** the v2-session portion of #1076
**Depends on:** a future `apps/opencode_fork` subtree rebase where upstream
`session.create`, `session.prompt`, `session.shell`, `session.compact`, and
`session.wait` are implemented rather than placeholder casts

## Summary

Replace Rhythm's v1 session stream bridge with OpenCode's v2 `/api` session
surface and `session.next.*` event stream only after the upstream lifecycle is
complete and demonstrably preserves every behavior Rhythm relies on. The
migration must be evidence-driven and reversible; the existence of v2 types or
routes alone is not an adoption trigger.

## Adoption trigger

At every fork subtree rebase:

1. Inspect `packages/opencode/src/v2/session.ts` and its upstream tests.
2. Record whether create, prompt, shell, compact, wait, abort, reconnect, and
   terminal/error paths execute real implementations.
3. Keep this issue blocked if any required operation remains a placeholder,
   unsafe cast, or untested facade over v1.
4. When all operations are real, attach the upstream commit/tag and a live
   behavior transcript, then schedule the migration.

## Acceptance criteria

1. A checked-in compatibility matrix maps every Rhythm v1 session operation and
   event consumer to its v2 equivalent, including permissions, questions,
   retries, compaction, tool parts, cancellation, and reconnect semantics.
2. The api_server can select v1 or v2 through one explicit rollout flag; v1
   remains the default until the complete live matrix passes.
3. SDK types are generated from the rebuilt fork and no hand-authored v2 event
   shapes are introduced.
4. A real engine/api_server behavioral suite proves create → prompt → streamed
   response, shell, compact, abort, reconnect/resume, and failure recovery under
   both bridges with equivalent user-visible results.
5. Existing desktop and mobile sessions remain readable during rollback; no
   destructive transcript or schema migration is permitted.
6. The decision and exact upstream trigger commit are recorded under
   `docs/ai/decisions/`, and the fork rebase/build/signing procedure is recorded
   in the run log.

## Likely files

- `apps/opencode_fork/packages/opencode/src/v2/session.ts`
- `apps/opencode_fork/packages/opencode/src/v2/`
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/api_server/src/services/opencode_event_service.ts`
- `apps/api_server/src/services/opencode_session_stream_service.ts`
- `apps/api_server/src/__tests__/`
- `docs/ai/architecture.md`
- `docs/ai/decisions/`

## Required tests / evaluation

- Rebuild the vendored fork binary and regenerate/check the SDK contract.
- Run v1/v2 parity tests against the real rebuilt engine through the sandbox.
- Run complete api_server, Flutter, mobile contract, and reconnect suites.
- Exercise rollback from v2 to v1 against sessions created before and during
  the rollout.
- Run GitNexus compare-to-main and review every changed execution flow.

## Safety / out of scope

- Do not adopt v2 merely because upstream exposes route stubs or types.
- Do not remove the v1 bridge in the first rollout.
- Do not alter persisted transcripts destructively.
- Do not edit the vendored fork beyond the minimal Rhythm patch or bypass its
  rebuild/signing gate.
