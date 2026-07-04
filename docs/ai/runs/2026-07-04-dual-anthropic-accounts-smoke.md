---
date: 2026-07-04
repo: Rhythm
branch: feature/dual-anthropic-accounts
pr: 898
issues: [899, 900]
status: manual smoke passed — PR still draft, awaiting merge decision
tags: [run, Rhythm]
---

# Manual smoke of dual Anthropic accounts (PR #898)

Follow-up to the overnight implementation run (`docs/ai/runs/2026-07-04-dual-anthropic-accounts.md`).
AJ ran the PR's smoke checklist live; this run covers the checklist execution,
two unrelated bugs surfaced along the way, and the definitive spillover proof.

## Checks

All 4 checklist items passed:
1. Simultaneous sessions — confirmed via the plugin's own `CLAUDE_AUTH_DEBUG=1`
   log, not just the UI: `fetch_credentials` events alternated `personal, team,
   personal, team, team...` matching the accounts-file routing map exactly.
2. Profile default account — pass.
3. Tappable header-badge account switcher — pass (feature added mid-smoke, see below).
4. Live spillover drill — full pipeline traced end to end:
   ```
   fetch_forced_spillover {from: team, to: personal}
   fetch_credentials      {accountId: personal, modelId: claude-haiku-4-5}
   fetch_response         {status: 200}
   [Spillover] session <id> (<sdk-session>) moved team → personal (rate_limited)
   ```
   Real Anthropic 200 on Personal's token, routing persisted, WS event fired.

## Follow-up feature added mid-smoke

AJ's first pass found the new-session dialog's account dropdown wasn't reachable
from the quick-create buttons. Added (commit `b6470f92c`, pushed to #898):
- `PATCH /agent-sessions/:id` accepts `anthropicAccountId` (validates, updates
  routing, broadcasts).
- Plugin freshness fix: spillover overrides now carry the store's mtime at
  write time; a fresh api_server write (e.g. a manual switch) always beats a
  stale auto-spillover override.
- Flutter: session header badge is now tappable — `PopupMenuButton` listing
  connected accounts, check mark on current, optimistic update + PATCH.

## Two bugs found, both confirmed unrelated to #898

Confirmed via the account plugin's debug log: both crashes happened with zero
`fetch_credentials` entries, meaning the failure is upstream of any
token/network call the accounts feature owns.

- **#899** — new agent profile can't set `defaultAnthropicAccountId` until a
  save→edit round trip (profile sheet's create-mode body omits it). Known
  simplification from the original plan, now tracked as a real issue.
- **#900** — pre-existing orphaned duplicate `agent_configs` row (two rows
  labeled "AI Trend Researcher", one with a UUID id and no `.md` agent file on
  disk). Any session routed to it throws `UnknownError: UnknownError` (the
  fork's `NamedError.Unknown.toString()` swallows the real "Agent not found"
  message) before any provider call. Root cause: `agent_profile_sync.ts:754`
  only re-projects `secretary`'s agent file every sync tick; no self-heal for
  other profiles' missing files. Workaround applied live: repointed AJ's
  `SharedPreferences` `default_agent_ocagent` from the broken UUID to the
  working duplicate via `defaults write org.visaliacrc.rhythm ...`.

## Notes / process learnings

- **The env-mismatch trap bit twice tonight.** A bare `node dist/server.js`
  with no env defaults to a scratch DB (`process.cwd()/rhythm.db`) and the
  legacy Memory-Vault. The app health-checks `:4001` and reuses ANY server
  already there, so a misconfigured manual server makes the whole app look
  like it lost data. Fixed by always launching with the app's own env
  (`DB_PATH` → Application Support, `MEMORY_VAULT_PATH` → Obsidian
  AGENT-MEMORY, `MEMORY_VAULT_SUBDIR=""`). Documented in
  `memory-vault-env-required-at-launch` (updated, was stale re: #885 having landed).
- Scripting raw WS `session.input` frames to drive test prompts was unreliable
  (model-override field shape didn't match the real composer, requests fell
  through to Gemini via most-recently-used-model twice) and polluted app state
  (leftover demo sessions, MRU model). Abandoned in favor of driving the real
  UI / reading logs directly — the right call for anything touching a user's
  live app state.
- `RHYTHM_FORCE_SPILLOVER` and `CLAUDE_AUTH_DEBUG=1` are effective, low-risk
  verification knobs — both used only against throwaway/live-but-safe state
  and always torn back down to a clean server afterward.
