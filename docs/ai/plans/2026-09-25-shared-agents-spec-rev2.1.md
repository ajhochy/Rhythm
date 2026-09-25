---
date: 2026-09-25
repo: Rhythm
pr: 1544
status: frozen
tags: [plan, rhythm, hermes]
---

# Shared agents SA-v1 — revision 2.1 amendments

Amends `2026-09-24-shared-agents-interface-spec.md` (rev 2). Everything not listed here is
unchanged. Issued by the parent orchestrator after implementation surfaced two interface gaps.

## A1. `projection.check` returns `ownerId`

**Gap.** S3's resume path (`_restore_session_policy`) requires the owner id bound at issue time,
but the frozen `POST /agent-bridge/v1/projections/:projectionId/check` response only carried
`{ok, snapshot?}`. The S5 provider could only keep `ownerId` in process memory, so a
cross-process resume could not recover it.

**Amendment.** The `check` success response becomes
`{ ok: true, ownerId: "<local user id as a string, exactly as returned by projections.issue>", snapshot?: <N1 snapshot> }`.
`ownerId` is always present on success. A mismatch between the stored projection owner and the
requesting grant's `localUserId` is `403 projection_owner_mismatch` (no body beyond the error code).

- Owner: **S1** (bridge `projections.ts` / `projections_repository.ts`), test `SA-PROJ-11` extended.
- Consumer: **S5** provider uses the returned `ownerId` on restore; **S3** unchanged beyond reading it.

## A2. Policy-scoped plugin tools are hidden from sessions without a v2 policy

**Gap.** RP-4 requires the five Rhythm bridge tools (`rhythm_shared_agent_*`, `rhythm_delegate_*`,
`rhythm_memory_search`) to be absent from the offered schemas of ordinary Hermes sessions. The
staged S3 exposes no session-scoped schema seam, so S5 could only refuse at dispatch.

**Amendment.** Tool registration gains an optional boolean `policy_scoped` (default `false`).
When `true`, `_compute_tool_definitions` (and every other schema-offering path, including
deferred/tool-search catalogs and compute-host frames) omits the tool unless the session has a
bound **v2** frozen policy whose tool allowlist includes it; dispatch of a `policy_scoped` tool
without such a policy is refused before the handler runs (fail closed, bounded error
`policy_scoped_tool_unavailable`). Standalone sessions are otherwise unchanged.

- Owner: **S3** (`model_tools.py` / `agent/tool_executor.py` / `agent/session_policy.py`), new test
  `N1-AC17` (schema absent for unbound session, present for a v2 session that allows it, refused
  at dispatch without policy — including the direct `model_tools` dispatch path).
- Consumer: **S5** registers its five tools with `policy_scoped=True`; `RP-4` then passes.

## Contract impact

The rev-2 contracts keep their exact 98-id inventories (their inventory tests parse the rev-2
spec). `N1-AC17` is tracked in this amendment and recorded as extra evidence on the Hermes
`shared-agent-n1.json` S3 entries; `SA-PROJ-11` and `RP-4` keep their ids and their evidence must
cover the amendments.
