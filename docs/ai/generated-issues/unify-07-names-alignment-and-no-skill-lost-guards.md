# Names-alignment + no-skill-lost guards (test + real-binary smoke)

**Order:** 7 · **Depends on:** #1, #2, #3 · **Milestone:** Unify skills source of truth

## Why

Two invariants make or break this work and are silent when violated:
1. **Names alignment** — `allowed_skills_json` names MUST equal the fork's `GET /skill` `name`s,
   or #775 scoping matches nothing.
2. **No skill lost** — registering the Rhythm-managed dir must be purely additive; a bug in the
   config writer could drop existing scan dirs and silently lose skills.

These need automated guards so a future change can't regress them unnoticed.

## What

Add an automated names-alignment test (api_server) and a real-binary no-skill-lost smoke
(mirroring `tools/release/smoke_skill_allowlist.sh` / `smoke_mcp_allowlist.sh`), wired into CI.

## Acceptance criteria

1. **Names-alignment test:** given a stored `allowed_skills_json`, every name in it exists in
   the `GET /skill` set (fails loudly if any name is absent). Covers the derived
   `agent_profile_sync` output too.
2. **No-skill-lost check:** the set of `GET /skill` names BEFORE registering the managed dir is
   a subset of the set AFTER (the only additions are managed skills) — no pre-existing skill
   disappears. Asserted against the **built** fork binary.
3. The real-binary smoke runs the PATCH→GET (or write→reload→GET) round-trip on the built
   binary and is wired into `desktop_release.yml` alongside the existing skill/mcp smokes.
4. **Done-definition:** both guards run green in CI; a deliberately-injected dead name or a
   dropped scan dir makes them fail.

## Likely files

- `tools/release/smoke_skill_alignment.sh` (new, or extend `smoke_skill_allowlist.sh`)
- `apps/api_server/src/**/__tests__/skill_names_alignment.test.ts` (new)
- `.github/workflows/desktop_release.yml` (wire the smoke)

## Required tests

- The guards themselves are the tests. Verify they fail on an injected violation and pass on
  the clean tree.

## Data-safety / out-of-scope

- Read/verify only; no production data. Real-binary smoke must use the built binary (re-sign
  ad-hoc if copied — `cp` breaks the signature).

## Verification

- Run the smoke locally against the built fork; confirm CI wiring with `gh run watch`.
