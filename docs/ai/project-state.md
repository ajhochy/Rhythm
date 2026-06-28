# Project State

## Current focus

**2026-06-28 — Consolidated agent-stack batch merged to `main` and released.**
PR [#774](https://github.com/ajhochy/Rhythm/pull/774) (merge commit `4fbfc059d`)
landed 9 issues' worth of work. Release **v18.54** triggered
(`desktop_release.yml`, run 28312640618).

The #765 MCP-scoping regression was found and re-fixed in this batch (the
`PATCH /session/:id` write path had been deleted in favor of the wrong schema —
`UpdatedInfo` instead of `UpdatePayload`). It is **verified end-to-end** and is
guarded in release CI by `tools/release/smoke_mcp_allowlist.sh`.

## Active branch / PR

- **Branch:** `main` @ `4fbfc059d` (batch merged; consolidated branch deleted).
- No open PR for this work. Release v18.54 building.

## Pending manual smoke (post-merge)

Everything below **landed in v18.54 and still needs a real UI/behaviour smoke**.
**MCP scoping (#765) is the only item already smoked — skip it.**

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
- **#661 / #707:** no runtime UI surface — docs (#661) and a test-harness
  refactor (#707); covered by the green suite, no manual smoke needed.

- **#765 — MCP scoping:** ✅ already smoked end-to-end (real UI turn scoped
  Secretary to its 7 servers; DB `mcp_allowlist` confirmed). No action.

## Not in this batch — still outstanding

- **#737 — fence untrusted email content (prompt-injection, SF-4):** the
  email-fencing work (was PR #773) was **never merged** into the batch;
  `fix/issue-737-email-fencing` branch/worktree still exists. Issue is open —
  needs to land **and** be smoke-tested.
- **#775 — verify per-agent skill scoping:** new follow-up. `allowed_skills_json`
  exists per profile but `skill_retrieval.ts` shares skills instance-wide and
  ignores it — same gap class as #765. Audit + guard pending.

## Risks / known issues

- **Known limitation (#765):** switching from a restricted profile back to an
  unrestricted one mid-session leaves the last-set allowlist on the fork
  session. Acceptable for first-turn scope enforcement (the real app flow).
- Fork binary is gitignored and **per-branch**; release CI rebuilds it from
  `apps/opencode_fork` source and signs with a real Developer ID. Local dev
  must rebuild + ad-hoc re-sign after staging (launcher handles this).

## Test status (at merge)

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 156 files, 1330 tests, all passed
- `tools/release/smoke_mcp_allowlist.sh` → PASS on fixed binary, FAIL on a
  binary lacking the write path (guard validated both ways)
- E2e: real UI turn `agent=secretary` → DB `mcp_allowlist` = the 7-server set ✓

## Next step

Work through the **Pending manual smoke** list above against the v18.54 build,
then land #737 and start the #775 skill-scoping audit.
