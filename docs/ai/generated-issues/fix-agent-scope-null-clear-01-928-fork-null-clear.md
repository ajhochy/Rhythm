---
date: 2026-07-07
repo: Rhythm
branch: fix/agent-scope-null-clear
status: ready-for-coding
issues: [928]
order: 1
depends_on: []
tags: [issue, Rhythm, mcp-scope, fork]
---

# #928 — Fork PATCH allowlist null-clear contract

## Summary

Vendored opencode fork's session PATCH handler does not treat `null` as a
clear for `skillAllowlist` (and possibly `mcpAllowlist`). Result: callers
that send `null` to relax a restricted session leave stale allowlists in
place. Establish the contract `null` clears / `undefined` no-op /
`[]` deny-all for both allowlist keys in the fork PATCH path.

## Scope (in)

- Accept `null` in the fork session PATCH body for `skillAllowlist` and
  `mcpAllowlist` (whichever is not yet `Schema.NullOr(...)`).
- When the key is present and `null`, call the existing session setters so
  storage and projectors persist/return a cleared (unrestricted) state.
- Preserve existing `undefined` (omit = no change) and `[]` (deny-all)
  behavior exactly.

## Non-goals (out)

- No api_server changes (that is #923).
- No UI/logging changes (that is #931).
- No `apps/opencode_fork` additions to `apps/api_server/tsconfig.json` or any
  api_server build pipeline.
- No upstream subtree sync, no rebase onto newer opencode tag.
- No provider/auth lifecycle, no delegation security, no live data cleanup.
- No runtime restart to verify; static + focused test only.

## Likely files

- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `apps/opencode_fork/packages/opencode/src/session/session.ts`
- `apps/opencode_fork/packages/opencode/src/session/projectors.ts`
- Fork session/allowlist test files (co-located in the fork package)

> Run GitNexus `impact({target: "updateSessionAllowlist", direction: "upstream"})`
> and `updateSessionSkillAllowlist` before editing. Report blast radius; halt
> and surface if HIGH/CRITICAL.

## Acceptance criteria

- [ ] PATCH `{ "skillAllowlist": null }` on a previously restricted session
      clears the skill scope (subsequent reads return unrestricted/null).
- [ ] PATCH `{ "mcpAllowlist": null }` clears MCP scope the same way, if the
      fork currently accepts/guards this key (verify presence first; if the
      key is not in the PATCH schema, document and skip with a note — do not
      invent a new field).
- [ ] PATCH that omits both keys leaves prior values unchanged.
- [ ] PATCH `{ "skillAllowlist": [] }` remains deny-all (no regression).
- [ ] No change to `undefined` handling.
- [ ] `cd apps/opencode_fork/packages/opencode && bun run typecheck` exits 0.
- [ ] Focused fork test(s) for clear / no-change / deny-all pass.

## Tests / validation

```bash
# from repo root
cd apps/opencode_fork/packages/opencode
bun run typecheck
bun test src/session              # targeted; expand path if tests live elsewhere
```

- Add/extend the existing fork allowlist test with three cases: null clears,
  omitted preserves, `[]` deny-all. One small test file; no new framework.
- No app/API/MCP runtime restart for verification.

## Safety notes

- Vendored fork only. Do not touch api_server tsconfig or build.
- Draft PR only. No merge, no `main` push.
- No production/live data edits, no profile row edits.
- If `mcpAllowlist` is not in the current PATCH schema, do not add it — note
  the finding and leave #923 to handle the API side.

## Dependencies

- None. This is batch order 1; #923 depends on this landing.

## Out-of-scope exclusions (explicit)

- #917 / #915 — excluded unless verification proves a one-line missing fix
  in this same fork file. If found, note in PR description but do not bundle.
- No delegation security (#914/#920), no provider/auth lifecycle
  (#922/#927), no large features (#929/#930, #418/#71).
