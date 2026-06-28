# Project State

## Current focus

**2026-06-28 — Issue #775 (per-agent skill scoping) resolved on a branch.**
Found the same false-green as #765: per-profile `allowed_skills_json` was inert
because the model's real skills come from the **opencode fork** (the `skill` tool
+ system-prompt listing), not from api_server's `buildSkillsPreface`. Fixed by
adding a per-session `skillAllowlist` to the fork (a 1:1 mirror of `mcpAllowlist`)
+ api_server push + a real-binary release guard. Verified against the BUILT binary.
See `docs/ai/decisions/2026-06-28-skill-scope-enforcement.md` and
`docs/ai/runs/2026-06-28-issue-775-skill-allowlist.md`.

Prior batch context: PR [#774](https://github.com/ajhochy/Rhythm/pull/774)
(`4fbfc059d`, v18.54) landed 9 issues incl. the #765 MCP-scoping re-fix.

## Active branch / PR

- **Branch:** `fix/issue-775-skill-allowlist-guard` (PR pending) — #775 skill scoping.
- **Ships only after a fork rebuild + signed release** (fork binary is bundled).

## Pending manual smoke (post-merge)

Everything below **landed (or is landing) and still needs a real UI/behaviour
smoke**. **MCP scoping (#765) is the only item already smoked — skip it.**

- **#720 — compaction divider:** run an agent session to compaction; the
  divider should render live in the chat (not only after reload).
- **#723 — MCP remove/sync:** remove an MCP server in settings; it should
  disappear and stay removed across an engine restart (no resurrection).
- **#731 — shell-runner removal (regression):** confirm normal agent runs still
  work end-to-end (vestigial `runShellCommand` path removed).
- **#736 — WS-gateway tool-gating backstop:** agent streaming works; a
  disallowed tool call on a role-scoped session is denied (Layer-2 backstop).
- **#755 — role separation:** locally `RHYTHM_ROLE` defaults to `all` → agents
  work (capabilities `opencode=true`). The `cloud`-role omission path is not
  exercisable from the desktop app.
- **#770 — Brain mirror-sync:** Memory-Vault (`~/Documents/Memory-Vault/*.md`)
  notes appear in the Rhythm Brain panel; sync runs on the cron (~10 min).
- **#737 — fence untrusted email content (prompt-injection, SF-4):** have an
  agent read email via `rhythm_read_email` / `rhythm_search_gmail`; confirm the
  email body is delivered fenced ("data, not instructions") and that injected
  instructions in an email do not get acted on.
- **#661 / #707:** no runtime UI surface — docs (#661) and a test-harness
  refactor (#707); covered by the green suite, no manual smoke needed.

- **#765 — MCP scoping:** ✅ already smoked end-to-end (real UI turn scoped
  Secretary to its 7 servers; DB `mcp_allowlist` confirmed). No action.

## Still outstanding

- **#775 manual smoke (live end-to-end):** the automated guards prove the
  allowlist persists on the real binary + the filter logic/wiring is correct, but
  NOT the live path. After a fork rebuild+release, confirm a restricted Secretary
  session's prompt omits out-of-scope skills and an out-of-scope `skill` load is
  refused.
- **Follow-up (file an issue):** the Flutter `_kAvailableSkills` picker is a
  hardcoded list; its names must match the fork's `SKILL.md` `name` or scoping
  matches nothing. Source it from the fork's `GET /skill` instead.

## Risks / known issues

- **Known limitation (#765):** switching from a restricted profile back to an
  unrestricted one mid-session leaves the last-set allowlist on the fork
  session. Acceptable for first-turn scope enforcement (the real app flow).
- Fork binary is gitignored and **per-branch**; release CI rebuilds it from
  `apps/opencode_fork` source and signs with a real Developer ID. Local dev
  must rebuild + ad-hoc re-sign after staging (launcher handles this).
- **#737 fencing scope:** only the gmail MCP tool results are fenced;
  calendar/PCO/web tools that surface external text are not yet fenced
  (governed by the decision doc, follow-up when they surface model-facing text).

## Test status (#775 branch)

- Fork `bun run typecheck` → exit 0; api_server `tsc --noEmit` → exit 0
- Fork `bun test` skill+mcp allowlist → 13 pass; api_server skill suites → 30 pass
- Built single fork binary (22 migrations bundled)
- `tools/release/smoke_skill_allowlist.sh` → PASS; `smoke_mcp_allowlist.sh` → PASS
  (both against the BUILT binary; #765 not regressed)

## Next step

Open the #775 PR, then on the next release work through the **Pending manual
smoke** list (incl. the #775 live skill-scoping check) against that build.
