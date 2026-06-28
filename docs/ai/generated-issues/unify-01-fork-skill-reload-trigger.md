# Fork: `Skill.reload()` re-scan trigger + reload route

**Order:** 1 · **Depends on:** none · **Milestone:** Unify skills source of truth

## Why

Fork skill discovery is memoized in `InstanceState` (`skill/index.ts:242-261`): both the
`discovered` (disk scan) and `state` (parsed skills) caches are computed once per instance.
Newly written/edited/deleted `SKILL.md` files are therefore invisible until the engine
restarts. The unified store needs a way to force a fresh scan so api_server can surface
Rhythm-authored skills immediately after writing them.

## What

Add a `reload()` method to the `Skill` service interface that invalidates both memoized
caches (`InstanceState.invalidate`, see `effect/instance-state.ts:78`) for the current
directory and re-scans, then expose it over the instance HTTP API.

## Acceptance criteria

1. `Skill.Interface` gains `readonly reload: () => Effect.Effect<Info[]>` that invalidates the
   `discovered` and `state` `InstanceState` caches and returns the freshly-scanned list.
2. A new instance route (e.g. `POST /skill/reload`) is registered in
   `httpapi/groups/instance.ts` + `httpapi/handlers/instance.ts` (and `api.ts` if the group
   schema needs the endpoint declared), calling `skill.reload()`.
3. **Observable outcome (test):** with the instance already initialized, writing a new
   `SKILL.md` into a registered `config.skills.paths` dir and then calling `reload()` returns
   a list that includes the new skill — whereas `all()` without reload does **not**.
4. Reload re-reads `config.skills.paths` (a path added after init is picked up).
5. The built-in `customize-opencode` skill and the override-ordering (disk overrides built-in)
   still hold after reload.

## Likely files

- `apps/opencode_fork/packages/opencode/src/skill/index.ts` (add `reload` to interface + impl)
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts`
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/api.ts` (if needed)
- `apps/opencode_fork/packages/opencode/test/skill/*.ts` (new test)

## Required tests

- Fork unit test (`bun test`): init → `all()` (no skill X) → write `SKILL.md` for X into a
  registered path → `reload()` → `all()` now contains X. Assert reload also re-reads
  `skills.paths`.

## Data-safety / out-of-scope

- Read/re-scan only; no write API inside the fork (api_server owns writes — issue 2).
- Do not change discovery scope or external-skill flags. Additive reload only.

## Verification

- Verify against the **built** fork binary, not a mock (per project gotcha). `cp` breaks the
  signature — re-sign ad-hoc if copying.
