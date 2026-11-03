---
date: 2026-10-11
repo: Rhythm
branch: codex/rhythm-deliverables-completion-20261010
pr: null
issues: []
status: partial
tags: [run, Rhythm]
---

# Four repaired product defects; live chain blocked on human sign-in

Took over the failed deliverables run. Verified each observed failure against
current source before changing anything, rather than trusting the prior
report.

## Environment

One isolated sandbox via `tools/dev/sandbox.sh`, API `:4098`, gateway `:4099`,
engine `:4097`. Fixture from `tools/dev/sandbox_fixture.mjs` (synthetic users,
token `e02-synthetic-session-not-a-secret`). Engine binary reused from the
0.18.69 candidate; it self-reports
`0.0.0-rhythm-a426383e08ea4a665837b1d2dea85c94563393cd`, which is a real
identity (unlike `/health`, which reports `commit: "dev"` always).

The prior session's app on `:4001/:4002/:4096` was deliberately torn down
first; those ports are now free. Its isolated stores were genuinely isolated —
an earlier flag that the Electron `--user-data-dir` looked like the default
profile was about the renderer profile only, not the DB or engine home.

## Files

- `apps/api_server/src/services/coordinator_coding_execution_service.ts` —
  project `sessionId`/`projectId`/`sdkSessionId` instead of spreading the
  7-field foreground binding into the 22-key exact proposal schema.
- `apps/api_server/src/middleware/auth_middleware.ts` — resolve the sole
  signed-in local user for AGENT_LOCAL no-bearer requests; ambiguity still
  fails closed.
- `apps/api_server/src/services/auth_credential_watcher.ts` — watch the parent
  directory until a missing `auth.json` appears; honest start log.
- `apps/api_server/config_seeds/skills/{workflow-orchestrator,acceptance-contract,coding-agent,verification-gate}/SKILL.md`
  plus `CONFIG_SEEDS_MARKER` → `config_seeds_v4` for backfill.
- Three new guards under `apps/api_server/src/__tests__/`.
- `tools/dev/sandbox.sh` — bash 3.2 unset-array abort in the engine build path.

## Checks

- `tsc --noEmit` clean.
- New guards 12/12. Coordinator coding set + bounded workflow contract 93/93.
- Full api_server suite 8993 passed / 36 failed / 385 skipped. The 36 are
  pre-existing: the four most-suspect files were A/B'd against the pre-change
  middleware and failed identically (12), and the other ten reference neither
  changed symbol.
- Engine skill inventory 16 → 20 live; all six required workflow rules present
  in the content the engine serves.
- Ownership demonstrated live through the ordinary API: no-bearer create went
  NULL → 1, and NULL again with a second signed-in user.
- Credential watcher demonstrated live: creating `auth.json` on a profile that
  had none logged "bouncing engine to reload credentials"; previously silent.

## Notes

Blocked, with the precise missing action:

- The Coordinator happy path needs a real model turn (the proposal envelope is
  bound to the engine's pinned signing key and a live tool call — correctly not
  forgeable) and then a human approval inside Rhythm. Not fabricated.
- Desktop UI checks are blocked at "Sign in to Rhythm — Continue with Google"
  in the isolated shell profile. An interactive-smoke instance is running
  (pid 17397, userData `/private/tmp/rhythm-fix-shell`) attached to the
  sandbox, awaiting that sign-in.

Two stale facts found: `CLAUDE.md` says `apps/web` is a non-shipping prototype,
but the shipped Electron bundle serves it from `Resources/app/web/dist`; and
the canonical routing policy is `GridCategory × GridTier 1–4` with ordered
`{model, effort, cost_per_task}` candidates — the labels "Simple/Routine/
Complex/Demanding" appear nowhere in the repo.
