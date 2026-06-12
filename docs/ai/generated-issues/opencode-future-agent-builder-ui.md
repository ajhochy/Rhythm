# OPC-FUTURE — Custom assistant builder UI (define personas inside Rhythm)

**Milestone:** none — future feature, deliberately unscheduled (post-M4 at the earliest)
**Depends on:** OPC-M4-4 (#703) — the agent *selector* must exist before authoring does

## Summary

A Settings surface where staff define custom AI assistant personas inside Rhythm — name,
instructions (system prompt), default model, permission defaults (e.g. read-only), color/icon —
which Rhythm persists into OpenCode's **global** config (`~/.config/opencode/opencode.json`
`agent` map, or the SDK config-PATCH endpoint if it proves writable) so they appear in the
per-session agent selector shipped by OPC-M4-4.

Example target user story: a "Bulletin Writer" persona with church-specific instructions that
any staff member can pick for a session, without anyone hand-editing JSON config files.

## Why this is split out (decision 2026-06-12)

OPC-M4-4 ships the realistic parity version: render whatever agents the SDK reports, no
authoring. Authoring is a real product feature — persona design, permission UX for
non-technical staff, where definitions live (per-machine global config vs synced), name
collisions with built-ins — and deserves its own design pass rather than riding on a parity
issue. User confirmed: keep #703 as-is, file this for the future.

## Design questions to settle before implementation (not now)

1. **Storage target:** global opencode config (per-machine; simplest) vs Rhythm production DB
   with per-machine sync-down (personas shared across staff — likely the actual want, since
   per-user/per-machine personas defeat the "Bulletin Writer for everyone" story).
2. **Permission presets:** expose OpenCode's full permission ruleset or a 2-3 choice radio
   ("Can edit files" / "Read-only" / "Ask every time")? Lean: the radio — staff are not
   developers.
3. **Prompt authoring help:** free-text instructions only, or template/starter library
   (mirroring the starter-packs pattern from the staff guide)?
4. **Validation:** prevent shadowing built-in agent names (build/plan/general); preview a
   persona against a scratch session before saving.
5. **SDK surface check at implementation time:** v1.14.49 exposes `GET/PATCH /config`; verify
   the embedded server honors an `agent` map PATCH at runtime (or whether a restart/reload of
   the opencode engine is required) before committing to live-apply semantics.

## Sketch acceptance criteria (to be firmed when scheduled)

1. Settings → "Custom assistants": list, create, edit, delete personas (name, instructions,
   model default, permission preset).
2. A saved persona appears in the OPC-M4-4 session agent selector without app restart (or with
   a documented, user-visible "restart agents engine" affordance if the SDK requires it).
3. A session run with the persona demonstrably uses its instructions (vitest spy on the prompt
   call / SDK config fixture) and its permission preset (plan-style deny honored).
4. Deleting a persona never deletes built-ins; name-collision with built-ins is rejected at
   save time.
5. Personas survive app restart; storage location documented in architecture.md.
6. `ai-workflow checks --level pr` green; vitest + flutter test cover the above.

## Likely files (sketch)

- `apps/api_server/src/services/opencode_client_service.ts` (config read/patch wrapper)
- `apps/api_server/src/routes/` (persona CRUD route, or production-API table + sync if design
  question 1 lands on shared storage)
- `apps/desktop_flutter/lib/features/settings/widgets/custom_assistants_section.dart` (new)
- `apps/desktop_flutter/lib/features/agents/` (selector refresh hook)

## Out of scope

- Anything in the M1-M4 parity sequence. This issue must not block or expand #703.
