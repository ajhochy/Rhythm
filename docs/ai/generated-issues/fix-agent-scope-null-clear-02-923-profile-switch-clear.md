---
date: 2026-07-07
repo: Rhythm
branch: fix/agent-scope-null-clear
status: ready-for-coding
issues: [923]
order: 2
depends_on: [928]
tags: [issue, Rhythm, mcp-scope, api_server]
---

# #923 — Profile switch PATCHes null to clear stale scope

## Summary

Switching a session from a restricted Agent Profile to an unrestricted one
either omits the allowlist fields or sends `undefined`, so the fork (post-#928)
never sees an explicit `null` clear and the stale `skillAllowlist` /
`mcpAllowlist` persists on the existing session. Fix the api_server WS/service
path so an unrestricted profile switch resolves to explicit `null` for both
PATCH fields; restricted → restricted still sends concrete arrays.

## Scope (in)

- In the WS input / profile-switch path, when the resolved profile is
  unrestricted, PATCH both allowlists as explicit `null`.
- When restricted, PATCH concrete expanded arrays (deny-all stays `[]`).
- If Org Optimizer scope-shape normalization is a tiny pure-parser fix
  (malformed input → normalized shape), include it as idempotent input
  normalization only. No live data rewrite, no migration.

## Non-goals (out)

- No fork PATCH schema changes (done in #928).
- No UI/logging (that is #931).
- No live profile cleanup, no profile row edits, no migration.
- No provider/auth lifecycle, no delegation security.
- No runtime restart to verify; mocked unit tests only.

## Likely files

- `apps/api_server/src/services/ws_gateway.ts` (input frame handling,
  profile switch)
- `apps/api_server/src/services/opencode_client_service.ts` (PATCH call site)
- `apps/api_server/src/services/agent_profile_scope.ts` (scope resolution)
- `apps/api_server/src/services/mcp_allowlist_expander.ts` (expansion)
- Co-located vitest test files

> Run GitNexus `impact` on `handleInputFrame`, the scope resolver, and the
> PATCH call site before editing. Halt and surface on HIGH/CRITICAL.

## Acceptance criteria

- [ ] Restricted → unrestricted profile switch: next WS input triggers a
      PATCH with `skillAllowlist: null` AND `mcpAllowlist: null`.
- [ ] Restricted → restricted switch: PATCH sends concrete expanded arrays;
      empty allowed set remains `[]` (deny-all), not `null`.
- [ ] Unrestricted → restricted switch: PATCH sends concrete arrays.
- [ ] Malformed/empty profile scope does NOT accidentally resolve to
      unrestricted (fail-closed preserved).
- [ ] `cd apps/api_server && node_modules/.bin/tsc --noEmit` exits 0.
- [ ] Focused vitest(s) with mocked opencode client/fetch for the
      switch paths pass.

## Tests / validation

```bash
cd apps/api_server
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run src/services/<scope|ws_gateway|opencode_client>
```

- Mock the opencode client/fetch; assert the PATCH body shape for each
  switch direction. One focused test file; no new harness.
- No live WS connection, no real opencode fork runtime.

## Safety notes

- No live profile cleanup, no `UPDATE` on profile rows.
- No provider/auth or session runtime repro required.
- Draft PR only. No merge, no `main` push.
- Fail-closed behavior for malformed scope must remain — do not relax to
  unrestricted to "make the clear work."

## Dependencies

- #928 must land first (fork must accept `null` as a clear). If #928 is not
  merged, this ticket's PATCH `null` will be a no-op at the engine; flag
  before coding.

## Out-of-scope exclusions (explicit)

- #917 / #915 — excluded unless verification proves a one-line missing fix
  in the same api_server file. If found, note in PR description; do not bundle.
- No delegation security (#914/#920), no provider/auth lifecycle
  (#922/#927), no large features (#929/#930, #418/#71).
