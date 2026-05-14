# M1-3 — Backend: auto-assign project on session create (cwd prefix match)

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** M1-2

## Summary

When `POST /agent-sessions` is called without an explicit `projectId`, look up the project whose `cwd` matches (or is a prefix of) the session's `cwd` and auto-assign it. Falls back to `NULL` if no project matches. Removes the need for the client to know the project id in M1-5's "new session" button.

## Motivation

The sidebar's new-session shortcut (M1-5) creates a session with the currently selected project's cwd. The cleanest contract is "post a session with a cwd, get a `projectId` back if one fits." This keeps the backend the single source of truth for the cwd→project mapping and avoids client-side guessing.

## Likely files

- `apps/api_server/src/repositories/projects_repository.ts` — new `findByCwdPrefix(cwd): Project | null`
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — auto-assign branch in `create`
- `apps/api_server/src/__tests__/agent_sessions.test.ts` — extend

## Behavior

In `agent_sessions_controller.create`:

```
if (!body.projectId) {
  const match = projectsRepository.findByCwdPrefix(expandedCwd);
  body.projectId = match?.id ?? null;
}
```

`findByCwdPrefix(cwd)` rules:
1. Normalize: expand `~`, resolve trailing slashes.
2. Find all non-archived projects.
3. Return the project whose `cwd` is an **exact match or a path-prefix** of the session cwd (i.e. `session.cwd === project.cwd` OR `session.cwd.startsWith(project.cwd + '/')`).
4. If multiple match (nested projects), prefer the **longest** project cwd.
5. If none match, return `null`.

Auto-assignment is **only** invoked when the client omits `projectId`. Explicit `projectId: null` is honored (means "intentionally unassigned").

## Acceptance criteria

1. POST `/agent-sessions` with `cwd: "/Users/x/Documents/Rhythm/apps/api_server"` and no `projectId` auto-assigns the project whose cwd is `/Users/x/Documents/Rhythm`.
2. POST with `cwd: "/Users/x/elsewhere"` and no matching project → `projectId === null` in response.
3. POST with explicit `projectId: null` keeps NULL even when a prefix match exists.
4. POST with explicit `projectId: "<id>"` honors that id without re-checking.
5. Nested projects: when two projects exist (`/Users/x/A` and `/Users/x/A/sub`), a session at `/Users/x/A/sub/inner` matches `/Users/x/A/sub` (longest prefix).
6. Archived projects are NOT considered.
7. `ai-workflow checks --level pr` exits 0.

## Required tests (vitest)

Extend `agent_sessions.test.ts`:
- Exact-cwd-match auto-assigns.
- Prefix-match auto-assigns.
- No-match returns `projectId: null`.
- Explicit `projectId: null` not overridden.
- Explicit `projectId: "<id>"` not overridden.
- Longest-prefix wins with two candidates.
- Archived project is skipped.

## Data safety / out of scope

- Do NOT mutate existing session rows retroactively — auto-assign only fires on `POST`, never on session list / get.
- Do NOT consult `agent_sessions` from `projectsRepository` (no reverse dependency).
- Path comparison is string-based with trailing-slash normalization; do NOT resolve symlinks (would surprise the user and could match across mount boundaries).
- No Flutter changes.

## Notes

- The longest-prefix tie-breaker matters even for non-nested projects if someone creates `~/Documents/Rhythm` and later `~/Documents/Rhythm-fork`. Without it, both would match a `/Users/x/Documents/Rhythm/...` session.
- This logic lives in the controller, not the repository, so the auto-assignment is observable in one place during smoke debugging.
