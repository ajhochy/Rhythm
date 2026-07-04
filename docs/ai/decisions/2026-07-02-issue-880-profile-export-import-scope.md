---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# #880 implemented as an Agent Profile HTTP API, not a `rhythm profile` CLI

## Context

Issue #880's body (`gh issue view 880`) describes a `hermes claw migrate`-style
CLI: `rhythm profile export <filename>` / `rhythm profile import <filename>`,
depending on `setup-02` (`rhythm setup`) and `setup-01` (`rhythm doctor`) —
neither of which exist anywhere in this repo. A repo-wide search confirmed:
no `apps/api_server/src/cli/` directory, no `rhythm` CLI binary, no `doctor`
or `setup` subcommand. The issue's "likely files" section
(`apps/api_server/src/cli/profile.ts`, `profile_exporter.ts`,
`profile_importer.ts`, `profile_schema.ts`) names files in a directory that
does not exist. This issue was filed as part of a batch of 10 aspirational
"setup agent" issues (#871–#880) modeled on a different project's CLI
(NousResearch/hermes-agent) rather than derived from Rhythm's actual
architecture.

The dispatching orchestrator's instructions for this worktree, however,
explicitly redefined the deliverable in terms of Rhythm's real primitive: the
`agent_configs` table / Agent Profile designer (`is_manager`,
`allowed_mcps_json`, `allowed_skills_json`, `allowed_delegates_json`,
`oc_agent`, `system_prompt` — the fields that already exist on
`AgentConfig`), calling out `agent_configs_repository.ts`,
`agent_configs_controller.ts` (with #858's PATCH route), and
`agent_profile_sync.ts` as the required reading, and asking for
`GET /agent-configs/export` / `POST /agent-configs/import` on the local
agent-server router.

## Decision

Implemented the dispatched scope, not the issue body's literal scope:
- `GET /agent-configs/export[?ids=...]` returns a versioned JSON bundle
  (`AGENT_CONFIG_BUNDLE_VERSION = 1`) of `agent_configs` rows, field-enumerated
  (not spread) so a future secret-bearing column addition to `AgentConfig`
  cannot silently leak into an export without a code change to the bundle
  shape.
- `POST /agent-configs/import` validates the bundle version/shape,
  upserts by `id`, skips preset rows (never overwrites `claude-code`/`codex`/
  `gemini-cli`/`opencode` identity), calls `writeAgentProfileFile` per
  imported row, and triggers `syncOpencodeAgentProfiles()` once at the end.
- No `rhythm doctor` / `rhythm setup` integration, no interactive secret
  prompting, and no cross-OS CLI portability claim — those depend on
  artifacts (`rhythm doctor`, `rhythm setup`) that do not exist yet
  (tracked separately as `setup-01`/`setup-02`, both still unimplemented
  in this repo as of this run).
- No Flutter UI. The dispatch explicitly scoped this as optional/small and
  the API is the core deliverable; no profiles-management UI screen exists
  yet in `apps/desktop_flutter` to hang export/import buttons off of.

## Alternatives considered

1. **Implement the issue literally** (new `apps/api_server/src/cli/` +
   `rhythm` binary + stub `doctor`/`setup` commands). Rejected: this would
   require inventing three new subsystems (a CLI entry point, a `doctor`
   diagnostic, a `setup` wizard) that are themselves separate, larger,
   unimplemented issues (#871 `rhythm doctor`, #872 `rhythm setup`) — far
   outside "smallest correct change" and outside this worktree's assignment.
2. **Refuse the ticket and ask for re-scoping.** Considered, but the dispatch
   prompt already resolved the ambiguity by pointing at the real
   `agent_configs` primitives and file set — treating that as the operative
   spec (source-of-truth rule: an inlined/explicit dispatch scope wins over
   re-deriving intent from a possibly-stale issue body).
3. **Secret remapping instead of upsert-by-id on import collision.** Rejected
   per the dispatch's explicit instruction to "upsert by id (or remap
   colliding ids — follow the issue body's choice)" — the issue body does not
   specify a remap policy (it assumes a fresh machine with no prior state), so
   upsert-by-id (matching the existing PATCH route's identity model) was the
   natural choice; a colliding preset id is protected by the same
   `PRESET_PROTECTED_FIELDS`-equivalent skip the PATCH route already enforces.

## Consequences

- `#880` as filed will likely need to be re-triaged/re-scoped or split: the
  literal CLI acceptance criteria (bundle importable macOS→Linux via a
  `rhythm` binary, `rhythm doctor` auto-run at the end of import, secure
  interactive key prompts) remain unimplemented and should not be considered
  closed by this change without a maintainer decision on whether the
  HTTP-API version satisfies the issue's intent or whether the CLI is still
  wanted once `setup-01`/`setup-02` land.
- Future readers of `#880`'s GitHub thread should be pointed at this decision
  doc to understand why the shipped implementation doesn't match the issue's
  literal file list.
