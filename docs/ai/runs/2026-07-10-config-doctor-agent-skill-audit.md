---
date: 2026-07-10
repo: rhythm
branch: null
pr: null
issues: []
status: applied-live-complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Config Doctor session — agent-profile/skill role-workflow audit + Hermes skill migration

## Context

AJ asked Config Doctor to audit all Rhythm agent profiles + skills for the
convention "agent profiles define roles, skills define workflows," and to
make sure agents have access to the scripts their granted skills call. This
expanded into a live-fix session (all changes applied through the REST API
at `localhost:4001`, no source-code edits, no branch).

## Findings

- **Hermes → Rhythm skill gap**: several active agent profiles referenced
  skills by name that only existed under `~/.hermes/profiles/.../skills/`,
  never copied into `~/.config/opencode/skills/` (unlike `ffb-consolidated-operations`,
  `ministry-*`, `good-friday-binder-reminder`, `rms-podcast-ingest`, which
  were already migrated this way in a prior session).
- **`rhythm-managed-skills/` is retired**, confirmed from source
  (`rhythm_managed_skills.ts` / its test suite): `managedSkillsRoot()` now
  resolves to `~/.config/opencode/skills` itself. The harvester writes fresh
  drafts to `~/.config/opencode/skills/drafts/`. A stored memory entry
  claiming rhythm-managed-skills/ was still the live managed dir was stale —
  corrected.
- **`fantasy-gm`** systemPrompt routed to 8 `ffb-*` skills but
  `allowedSkillsJson` only granted 1 (`ffb-consolidated-operations`).
- **`Theological-Researcher.md`** had broken YAML frontmatter (`bash: ask`
  immediately followed by a nested `"*": deny` — invalid YAML), from a
  `corePermissionsJson` value that collided with the default template merge.
- **`rhythm-setup`** had a full 7-step onboarding procedure embedded directly
  in its systemPrompt instead of a skill (role/workflow convention
  violation), with `allowedSkillsJson: null`.
- **`AI-Trend-Researcher`** systemPrompt referenced "the `AI-Trend-Researcher`
  skill" for its daily scan, but that skill name was neither in its own
  `allowedSkillsJson` nor present anywhere on disk. Production worked around
  this by inlining the full workflow directly into the `MarcoKaz YouTube
  Monitor` scheduled task's prompt instead.
- Widespread `AgentRunner: failed to create opencode session` errors across
  nearly every scheduled task (Obsidian Nightly Maintenance, FFB Daily
  Dashboard, FFB Podcast Ingest, Memory Consolidation, MarcoKaz Monitor) —
  flagged to AJ as a likely deeper app-level bug, out of scope for this
  session (needs Claude Code/Codex, not a config fix).

## Changes applied (all live via REST API)

1. Copied 13 Hermes-only skills into `~/.config/opencode/skills/`:
   `daily-morning-briefing`, `daily-email-triage`, `monday-worship-planning`,
   `pco-song-usage-sync`, `monthly-gc-report`, `ableton-setlist-build`,
   `ffb-daily-dashboard-update`, `ffb-tuesday-refresh`, `ffb-podcast-vibes`,
   `ffb-roster`, `ffb-trades`, `ffb-dynasty`, `ffb-tff-vibes`. Additive only —
   Hermes originals untouched.
2. `fantasy-gm`: PATCH `allowedSkillsJson` to all 8 `ffb-*` skills + resync.
3. `Theological-Researcher`: PATCH `corePermissionsJson` to
   `{"skill":"allow","read":"allow","bash":{"*":"ask"}}` (explicit nested
   shape, no collision with template) + resync. Verified projected
   `Theological-Researcher.md` frontmatter is now valid YAML.
4. Wrote new skill `rhythm-onboarding` (pure procedural, extracted from
   `rhythm-setup`'s inline steps). PATCHed `rhythm-setup` systemPrompt down
   to role/identity only + granted the skill + resync.
5. Wrote new skill `ai-trends-daily-scan` (MarcoKaz monitor + broad
   discovery via `agent-reach`/`duckduckgo`/`searxng-search`/`defuddle` +
   newsletter pull). PATCHed `AI-Trend-Researcher` systemPrompt to reference
   the real skill name, granted `ai-trends-daily-scan` + `defuddle` +
   `searxng-search` + resync.
6. Created scheduled task "AI Trends Daily Scan" (daily 09:00, references
   the new skill) and disabled the old inlined-workaround task "MarcoKaz
   YouTube Monitor — AI Trend Researcher" (id `b4e02690-...`).
7. Corrected stale memory entry on `rhythm-managed-skills/` (see id
   `fa207d6e-...`) with the source-confirmed architecture.

## Newsletter sources (for `ai-trends-daily-scan`)

Personal Gmail: `daily@mail.theaigent.xyz`, `hyperautomationaireport@mail.beehiiv.com`,
`info@hyperautomationlabs.co`, `jordan@creatorincome.co`.
Work Gmail: `kenny@aiforchurchleaders.com`.

7. `Theological-Researcher`: PATCHed systemPrompt to stop referencing the
   phantom `Theological-Researcher` skill (option B — wording fix only, no
   scan content invented since no sources/cadence/output were specified).
   Ad-hoc mode is now stated as primary; daily scan is explicitly "not yet
   built," with instruction to ask AJ for scope before building it. Resynced.

8. **Playwright fix (root cause, not just the cosmetic symptom)**: confirmed
   `playwright`/`playwright-trace` were dead references — not wired as an MCP
   server anywhere, not present as a skill in any Rhythm-reachable location
   (only found unrelated Claude Code / Codex vendor copies, neither used by
   Rhythm). Added a real `playwright` MCP server entry to `opencode.json`
   (`npx @playwright/mcp@latest`, matching the official Playwright MCP
   config). Moved `playwright` from `allowedSkillsJson` → `allowedMcpsJson`
   (correct scope layer per rule 3) for `Theological-Researcher` and
   `AI-Trend-Researcher`; dropped `playwright-trace` (not a separate MCP —
   tracing is part of the same server's toolset).
9. Wrote a new consolidated skill `archive-research-sources` — chains
   `defuddle` (default clean-markdown fetch) → `playwright` (fallback for
   JS-heavy/dynamic pages) → structured Obsidian entry save. Replaces two
   thinner harvested draft skills (`archive-research-sources-to-obsidian-database`,
   `archive-research-session-sources-to-obsidian-database`), both deleted.
10. Created `Templates/AI Trends - Research Entry.md` in the vault (based on
    `Templates/Theology - Research Entry.md`, minus theological-only fields,
    with a "Application Ideas for Rhythm" section replacing "Theological
    Anchors").
11. Wired destinations: theological entries → matching numbered category
    subfolder under `Resources/theological-study/Research Database/Entries/`;
    AI-trends entries → `Resources/theological-study/Research Database/AI + Technology/`
    (corrected from an initial `Podcast Episodes/` misdirection — that folder
    is reserved for podcast transcript ingestion, unrelated; `AI + Technology/`
    is where this exact entry type already lives).
12. Granted `archive-research-sources` to both research agents; referenced it
    from both systemPrompts and from `ai-trends-daily-scan` (new Step 5.5).

13. Built a new specialist subagent `podcast-ingest` (mode: subagent, curl+
    python3-only bash, minutes/rhythm/obsidian MCP scope) and a generic
    `podcast-ingest` skill — given any podcast link/feed, downloads +
    transcribes locally via `minutes`, saves the raw transcript, archives a
    structured entry (reusing the `archive-research-sources` domain-selection
    logic), and only offers (never assumes) a recurring watch on the feed.
    Granted `Theological-Researcher` and `AI-Trend-Researcher` delegation to
    it via `allowedDelegatesJson`; incidentally also enabled
    `AI-Trend-Researcher`'s pre-existing (but never-actually-granted)
    delegation to `workflow-orchestrator`/`graphic-designer` — its
    systemPrompt already claimed this delegation, `allowedDelegatesJson` was
    just null.

## Open follow-up (not yet applied)

- **Real code gap found (not a config issue):** `writeAgentProfileFile()` in
  `apps/api_server/src/services/opencode_agent_writer.ts` only projects
  `allowedDelegatesJson` into the opencode agent file's `task:` permission
  block when `config.isManager === true` (`injectManagerPreamble`, called
  with `config.isManager === true` as the gate — see ~line 400-405). For
  non-manager profiles (both research agents here), the frontmatter `task:`
  block is hand-seeded once and never kept in sync with `allowedDelegatesJson`
  by any code path. Confirmed via `curl` + direct GET that the DB field
  persists correctly and `/system/refresh` + resync do not change this — the
  code simply never writes it for non-managers. **Not worked around** (no
  hand-edit of the `.md` frontmatter, per rule 6) since the actual runtime
  delegation authorization (`agent_delegation_service.ts`) reads
  `allowedDelegatesJson` straight from the DB at call time for the
  `rhythm_delegate` MCP tool path — that path is live and correct. The stale
  `task:` YAML block only affects opencode's native in-engine `task` tool, a
  separate mechanism. Worth a real code fix later: extend
  `injectManagerPreamble`'s condition (or add a parallel `task:` block
  writer) to cover non-manager delegate rosters too, so the two delegation
  surfaces don't drift. Not filed as a GitHub issue yet.
- The `AgentRunner: failed to create opencode session` scheduled-task failure
  is unresolved and unrelated to the fixes above — flagged for a Claude
  Code/Codex session, not addressed here.

## Addendum — Theological-Researcher missing from agent picker

AJ reported not seeing `Theological-Researcher` in the agent profile picker.
Root cause: `sessionSelectable` was `false` on the canonical profile (had been
since before this session — contradicts the earlier memory note claiming the
canonical slug profiles were "active/selectable"). PATCHed to `true`.

While diagnosing, AJ also flipped `isManager` to `true` on the same profile
(via the app) so it could route to `podcast-ingest` through opencode's native
`task` tool. This had an unwanted side effect: `isManager: true` triggers
`injectManagerPreamble` (see the code-gap note above), which unconditionally
injects a "you are a routing hub, do not attempt domain work yourself"
preamble — directly contradicting this profile's actual design (do research
directly; only delegate podcast links). Confirmed delegation to
`podcast-ingest` already works without `isManager` via `rhythm_delegate`
(server-side auth reads `allowedDelegatesJson` directly, independent of the
manager flag) — so reverted `isManager` back to `false`. Final state:
`sessionSelectable: true`, `isManager: false`, `allowedDelegatesJson:
["podcast-ingest"]`. Resynced and verified the hub preamble is gone and the
profile's own systemPrompt is intact.

**Still not visible in picker after this** — re-checked and `sessionSelectable`
had reverted to `false` again between the fix and AJ's next look (cause
unconfirmed; not chased further, low value). Re-PATCHed `sessionSelectable:
true` alone (isManager untouched, stayed `false`), verified it held on a
follow-up GET, refreshed cache, resynced — `mode: primary` confirmed in the
file. Root cause of the picker still not showing it live: the Flutter desktop
app's `sessionSelectableAgents` getter (`agent_configs_controller.dart`)
filters an in-memory config list the app already loaded, not a live query —
there's a refresh button in the agent profiles view
(`agent_profile_refresh_button_test.dart` confirms one exists) for exactly
this. AJ confirmed after using it: **resolved, Theological-Researcher is
live in the picker.**

## Verification

- `curl .../resync-agent-file` returned success (no error) for `fantasy-gm`,
  `Theological-Researcher`, `rhythm-setup`, `AI-Trend-Researcher`.
- Read back the projected `.md` files for `fantasy-gm` and
  `Theological-Researcher` to confirm frontmatter is valid YAML.
- Read back `rhythm-setup.md` to confirm the systemPrompt slimmed correctly
  and the skill reference is present.
- Did not run `npm run doctor` or any live behavioral test against the
  engine — all changes are DB-config-only (per the project's dbClient gate
  for the local-only opencode agent-file projection), not source-code
  changes, so the repo's behavioral-verification-gate rule (source-code
  features) does not apply here.
</content>
