---
date: 2026-06-28
repo: Rhythm
branch: feature/unify-mcp-source-of-truth
status: planning
issues: [783, 781]
tags: [plan, Rhythm]
---

# Plan — Unify MCP servers onto the opencode engine (single source of truth)

Companion to the skills-unification work (#778 / PR #778, decision
`2026-06-28-unify-skills-source-of-truth.md`). Subsumes **#781** (MCP picker
name alignment). Builds on **#765** (per-session `mcpAllowlist` enforcement).

## Intent (one sentence)

Make the opencode engine's MCP config (`opencode.json` `mcp` block, surfaced
live via `GET /opencode/mcp`) the **single source of truth** for which MCP
servers exist, demote the hardcoded curated catalog to an explicit
install-template/enrichment layer that materializes into the engine, guarantee
persisted `allowed_mcps_json` names are a subset of the live engine ids, and add
the missing alignment guard — so per-profile MCP scoping (#765) can never
silently match nothing because of name drift.

## What changed since the issue was written (ground-truth from this worktree)

Verified by reading the live code — **most of the "target design" is already
true**; this is a reconcile/align/guard effort, not a build-new-store effort:

- **Both Flutter MCP surfaces already read the live engine list.**
  - Settings MCP UI: `features/settings/data/mcp_data_source.dart` lists from
    `GET /opencode/mcp` (`AppConstants.agentLocalBaseUrl`); the curated catalog
    is used **server-side only** to enrich `requiredEnv`/credentials, not as a
    display source.
  - Agent Profile MCP picker: `features/agents/data/opencode_mcp_data_source.dart`
    + `_agent_profile_sheet.dart` were made live in the skills-unification work
    (`unify-05`). The hardcoded `_kAvailableMcps` array is **already gone**
    (grep finds zero occurrences).
- **The fork already matches names correctly** — `session/mcp_allowlist.ts`
  uses a `keyToServer` map (not string-splitting), and `mcp_allowlist_expander.ts`
  emits raw server names into `servers[]`. So an aligned name enforces correctly;
  the hazard is a **stale persisted name** that no longer matches a live id.
- **The curated catalog is already template-shaped**, not a display list. Its 3
  consumers are: the route (`requiredEnv`/OAuth-url enrichment + `/credentials`),
  the client service (`ensureCuratedMcps`), and itself.
- **The drift names from #781 (`ableton` vs `ableton-mcp`, `nfl-mcp` vs
  `nfl_mcp`, the `foo` test server) are runtime data**, not repo literals — they
  live in the developer's actual `opencode.json`, persisted into some
  `allowed_mcps_json` rows. They are a data-hygiene + guard problem, not a
  code-literal removal.

The remaining real gaps, therefore, are: (1) **no alignment guard** (skills got
`smoke_skill_alignment.sh`; MCP has none); (2) **no provenance flag** on
`GET /opencode/mcp` distinguishing template/curated vs ad-hoc discovered (skills
got `managed`); (3) **name-drift hygiene** for persisted `allowed_mcps_json`
(#781); (4) the curated catalog's template-only role is **implicit, not
documented/enforced**; (5) **auto-installer fate** undecided.

## In scope

- A names-alignment **test** + a real-binary **smoke** (MCP analogue of
  `smoke_skill_alignment.sh` / `smoke_mcp_allowlist.sh`): persisted
  `allowed_mcps_json` ⊆ live `GET /opencode/mcp` ids, and a no-server-lost check.
- A **provenance flag** on `GET /opencode/mcp` entries (`curated: boolean`, or
  `source: 'curated' | 'rhythm' | 'adhoc'`) so the catalog is provably a
  template layer, not a parallel display source.
- **Name-drift reconciliation**: an alignment/normalizer pass so a persisted
  `allowed_mcps_json` containing a stale display name (`ableton`, `nfl-mcp`) is
  surfaced/repaired against the live id; the `foo` test server is excluded from
  template install and flagged by the guard.
- **Document + enforce** the curated catalog as an install-template/enrichment
  layer (the materialize-on-install analogue of skills' materialize-on-publish).
- **Decide and record the fate of the two client-side auto-installers**
  (`curated_mcp_auto_installer.dart`, `rhythm_mcp_auto_installer.dart`).
- Update `agent_profile_sync` MCP default derivation to validate
  `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON` (`["rhythm"]`) and any derived MCP scope
  against the live engine ids.

## Out of scope / non-goals

- **No new MCP store.** The engine `opencode.json` `mcp` block is already the
  store; do not build a DB-backed MCP catalog.
- **No fork write API.** Reads use `GET /opencode/mcp`; writes already go through
  api_server's `addMcp`/`removeMcp` (which edit `opencode.json` directly —
  decision `2026-06-13-removemcp-edits-opencode-json-directly`).
- **Do not touch the OAuth/DCR+PKCE flow** (`mcp_oauth_engine.ts`,
  `mcp_oauth_service.ts`, `mcp_auth_store.ts` → `mcp-auth.json`). It is a known
  workaround for the broken SDK auth (memory: opencode MCP remote-OAuth broken).
  It must keep working unchanged.
- **Do not change #765 enforcement semantics** in the fork. Names must stay
  aligned; the matching logic stays as-is.
- **No new DB columns.** `allowed_mcps_json` already exists in SQLite + Postgres
  (`migrations.ts`, `postgres_bootstrap.ts`). If any column is added, backfill in
  `postgres_bootstrap.ts` (memory: Postgres/SQLite schema drift).
- **No fork rebuild required to land code.** Fork logic (if touched) is covered
  by `bun test` + the real-binary smoke; shipping live needs a signed release
  (same constraint noted for #765/#778).

## Hard constraints (from AGENTS.md / CLAUDE.md / memory)

- Agent MCP traffic targets `http://localhost:4001` (`AppConstants.agentLocalBaseUrl`)
  only; never coupled to `serverConfigService.url`.
- `apps/opencode_fork` is a vendored subtree — edit only when working fork
  scoping; do not add it to any TS build. Prefer api_server-side changes.
- `dart format .` + `flutter analyze --no-fatal-infos` clean before PR; api_server
  `tsc --noEmit` + `vitest run` green.
- Real-binary smokes run against the **built** binary; `cp` breaks the signature
  (re-sign ad-hoc) — memory `opencode fork rebuild + cp/AMFI resign gotcha`.

## Design tensions

- **Additive reconcile vs. clean rewrite** — engine already owns MCP config, so
  prefer additive guards/flags over restructuring. (Chose additive.)
- **Repair vs. surface** name drift — auto-rewriting a user's persisted
  `allowed_mcps_json` could silently change scope; surfacing + a guard is safer.
  (Chose: normalize the *default/derived* names against live ids, and a guard
  that fails loudly on a stale name, rather than silently rewriting user rows.)
- **Keep vs. remove client-side auto-installers** — they call the server-side
  template ensure endpoints (they are not a parallel display list), so they are
  the materialize-on-install trigger, not a drift source. (Lean: **keep**, but
  document; see open question.)

## Cheapest version that proves the idea

Ship the **alignment guard** (issue: names-alignment test + real-binary smoke)
first against the current code. Because both pickers already read live, the
guard alone proves the single-source-of-truth invariant and catches the #781
drift. Everything else (provenance flag, catalog docs, auto-installer decision)
is hardening on top.

## Prior Art

Direct in-repo precedent — the **skills unification** (#778, decision
`2026-06-28-unify-skills-source-of-truth.md`, issues `unify-01..07`). Pattern to
mirror, layer-for-layer:

| Skills (#778) | MCP analogue (this plan) |
|---|---|
| `GET /opencode/skills` proxy of fork `GET /skill` | `GET /opencode/mcp` proxy (already exists) |
| `managed: boolean` provenance flag | `curated`/`source` provenance flag (new) |
| Pickers read live, de-hardcode `_kAvailableSkills`/`_kAvailableMcps` | already done for MCP (`unify-04/05`) |
| `agent_profile_sync` derives against live skill set | validate MCP defaults against live ids (new) |
| Materialize-on-publish (DB → SKILL.md) | Materialize-on-install (curated template → `opencode.json`) — already exists via `ensureCuratedMcps`; document it |
| `smoke_skill_alignment.sh` + names-alignment test | `smoke_mcp_alignment.sh` + names-alignment test (new) |

No external prior-art swarm needed: the pattern is established in-repo and the
constraints (vendored fork, OAuth workaround, #765 enforcement) are all
documented in `docs/ai/decisions/`.

## Clarification interview

Skipped a live `AskUserQuestion` round — this is a planning-only delegation with
issue #783 already specifying acceptance criteria, and the orchestrator/user will
review the generated issues before any are created. The two genuine decisions
(auto-installer fate; repair-vs-surface for drift) are recorded under
**Known Ambiguities / Open Questions** for the orchestrator rather than guessed.

## Known Ambiguities / Open Questions (for orchestrator/user)

1. **Auto-installer fate (W4).** `curated_mcp_auto_installer.dart` +
   `rhythm_mcp_auto_installer.dart` trigger the server-side template ensure on
   launch. Keep (documented as the materialize-on-install trigger), or fold their
   trigger into a single server-side ensure-on-ready? Plan assumes **keep +
   document**; issue 04 is written to be a no-op-if-keep / small-refactor-if-fold.
2. **Drift repair policy.** For an existing persisted `allowed_mcps_json` row that
   contains `ableton` while the engine id is `ableton-mcp`: should the guard
   **fail CI** (forcing manual cleanup), **auto-normalize** the stored name, or
   **surface** it as a warning? Plan defaults to: normalize *derived/default*
   names; guard **fails loudly** on a stale name in any fixture/derived output;
   user-entered rows are surfaced, not silently rewritten.
3. **`foo` test server.** Confirm it only exists in the dev machine's
   `opencode.json` (not seeded by any Rhythm code). If Rhythm never installs it,
   the fix is purely the guard excluding/flagging it. (Grounding found no repo
   literal that installs `foo`.)

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
| ----- | ----- | ---- | ------------ | ------------------ | ------------ |
| 1 | Names-alignment + no-server-lost guards (test + real-binary smoke) | The core invariant guard: persisted `allowed_mcps_json` ⊆ live `GET /opencode/mcp` ids; no-server-lost; `foo`/stale names fail loudly | `apps/api_server/src/**/__tests__/mcp_names_alignment.test.ts`, `tools/release/smoke_mcp_alignment.sh`, `.github/workflows/desktop_release.yml` | the guards are the tests; verify they fail on an injected stale name | — |
| 2 | `GET /opencode/mcp` provenance flag (`curated`/`source`) | Prove the catalog is a template layer, not a parallel display source; tag each entry curated/rhythm/adhoc | `opencode_mcp_routes.ts`, `opencode_client_service.ts`, `__tests__/opencode_mcp*.test.ts` | vitest: entries carry correct provenance; no display regression | — |
| 3 | Document + enforce curated catalog as install-template/enrichment layer | Make the template-only role explicit (header docs + a test asserting no display-list use); align with skills materialize-on-publish | `curated_mcp_servers.ts`, `opencode_mcp_routes.ts`, `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` (new) | vitest: catalog consumed only for enrichment/template; decision doc written | — |
| 4 | Decide + record auto-installer fate; validate MCP defaults against live ids | Resolve open question 1; make `agent_profile_sync` MCP default/derived names validate against live engine ids | `agent_profile_sync.ts`, `curated_mcp_auto_installer.dart`, `rhythm_mcp_auto_installer.dart`, `agent_server_controller.dart` | vitest: default `["rhythm"]` validated against live set; flutter analyze clean | 2 |
| 5 | Name-drift reconciliation for persisted `allowed_mcps_json` (subsumes #781) | Normalize derived/default names; surface stale user names; ensure `ableton`→`ableton-mcp`, `nfl-mcp`→`nfl_mcp` resolve; exclude `foo` | `mcp_allowlist_expander.ts` or a new `mcp_name_alignment.ts`, `agent_profile_scope.ts`, `__tests__/*` | vitest: stale alias resolves/surfaces per policy; expander still feeds #765 correctly | 1, 2 |

## Verification

- api_server: `tsc --noEmit` 0 errors; `vitest run` green (existing + new).
- Fork (only if touched): `bun test` mcp_allowlist green; real-binary
  `smoke_mcp_alignment.sh` passes against the built binary.
- Flutter: `dart format .`; `flutter analyze --no-fatal-infos` 0; `flutter test`.
- CI: new smoke wired into `desktop_release.yml` next to the skill/mcp smokes
  (`gh run watch` in background).

## Next in chain

Hand to `issue-writer` (done — issue files under `docs/ai/generated-issues/`),
then the orchestrator reviews the `gh issue create` block and creates the issues.
