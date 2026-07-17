---
date: 2026-07-16
repo: Rhythm
branch: epic1116/cluster-b-org-library
tags: [decision, rhythm, org-skills, cluster-b]
index: "[[Rhythm]]"
---

# #1054/#1056 — skills.urls protocol correction, prodApiUrl reuse, and a new 'failed' proposal status

## Context

Building #1054 (wire the engine's `skills.urls` at the org index) on top of
#1053's already-committed `org_skills_routes.ts` surfaced a real protocol
mismatch, and both #1054 and #1056 needed a way for the LOCAL agent server to
reach "production" that didn't previously exist in my assigned file set.

## Decision 1 — fixed a #1053 route-path defect instead of working around it

Verified directly against `apps/opencode_fork/packages/opencode/src/skill/discovery.ts`
(`Discovery.pull`) and `skill/index.ts`'s `for (const url of cfg.skills?.urls ?? [])`
loop, then confirmed empirically with a standalone `node -e` URL-resolution
check:

- A `skills.urls` entry is treated as a BASE directory. `index.json` and every
  per-skill file are resolved relative to the SAME base:
  `<base>/index.json` and `<base>/<name>/<file>`.
- #1053 shipped `GET /org-skills/index.json` (correct) but
  `GET /org-skills/files/:name/:file` for file bodies — an extra `files`
  segment the real engine never requests. `index.json` would resolve fine,
  but every per-file download would 404, silently dropping every org skill
  (the fork's own `Discovery.pull` swallows the download failure and drops
  the skill's directory from the result — no crash, just an empty skill set).
- This was invisible in #1053's own tests because they called the shipped
  route directly (`/org-skills/files/doc-skill/SKILL.md`), never through the
  actual `Discovery.pull` resolution path.

Fixed by moving the route to `/org-skills/:name/:file` (no `files` segment)
and updating #1053's test assertions to match, rather than leaving the
original route in place and reverse-engineering a URL value that could
satisfy both `<base>/index.json` and `<base>/files/<name>/<file>` — which is
mathematically impossible with a single base value. Confirmed the fix with
the real forked engine binary: `GET /skill` lists a seeded org skill after
boot, downloaded to `~/.cache/opencode/skills/<name>/SKILL.md`.

**Alternative rejected:** add a NEW parallel route (`/:name/:file` alongside
`/files/:name/:file`) to avoid touching #1053's shipped test file. Rejected
as needless duplication — the `/files/` path would never be hit by anything
real (not the engine, not any other internal caller — grepped the whole
`api_server/src` tree), so keeping it around is dead surface, not
compatibility.

## Decision 2 — reused `env.prodApiUrl`/`env.prodAuthToken` instead of new env vars

Both features need the LOCAL agent server (spawned by Flutter, `AGENT_LOCAL=true`)
to reach the org's shared skill library, which lives on the SAME api_server
codebase running in the `'cloud'` deployment role. No existing mechanism
passed "the production URL" from Flutter into the local Node process (the
`ApiServerService`/`AgentServerController` spawn only sets `PORT`, `DB_PATH`,
`AGENT_LOCAL`, and optional memory-vault paths). Rather than invent a new
env var pair, found and reused `PROD_API_URL`/`PROD_AUTH_TOKEN`
(`env.prodApiUrl`/`env.prodAuthToken`) — already established by
`sync_orchestrator_service.ts` for mirroring production tasks into the local
DB, with the exact same "when absent, skip/no default" precedent for auth,
and a plain `fetch()` + `Authorization: Bearer` calling convention already in
use. `resolveProdApiBase()` (new, exported from `opencode_plugin_config.ts`)
is the one place both features derive `<prodBase>/org-skills` from, so they
can never drift.

One deliberate divergence from the `prodApiUrl` precedent: #1054's
`ensureOrgSkillIndex` falls back to the Flutter `apiBaseUrl` default
(`https://api.vcrcapps.com`) when `PROD_API_URL` is unset, rather than
skipping (task mirroring's documented behavior). Org-skill wiring is meant to
work out of the box on a fresh install without extra env configuration;
skipping silently would mean skills.urls is never set unless a developer
happens to export `PROD_API_URL` locally.

## Decision 3 — added a 'failed' proposal status (additive, one kind only)

#1056's acceptance requires a prod-down publish attempt to be "marked
failed, retryable" — not merely left at `proposed` (the default behavior of
any other applier's thrown error, per `org_proposal_apply_service.applyProposal`
propagating to the controller's generic catch). Added `'failed'` to
`AgentOrgProposalsRepository.ALLOWED_TRANSITIONS` (`proposed -> failed`,
`failed -> applied|failed`) and relaxed `org_proposals_controller.approve()`'s
guard to accept `'failed'` the same as `'proposed'`. Only
`publishToOrgApplier` ever writes `'failed'`, so this is a no-op for every
other proposal kind's existing flow — verified by the full existing
`org_proposal_appliers_wiring`/`org_proposals_routes` suites staying green
unmodified apart from one new additive test.

**Alternative rejected:** leave a prod-down publish attempt at `proposed`
(today's default for any thrown applier error) and call that "retryable" by
omission. Rejected because it gives the reviewer zero signal that an attempt
was even made — indistinguishable from a proposal nobody has looked at yet.

## Consequences

- Any future kind that wants the same "attempted, failed externally, human
  can retry" semantics can reuse the same `'failed'` status and the
  controller's relaxed guard without further repository changes.
- `resolveProdApiBase()` is now the shared seam for "where does the org
  skill library live" — a future change to the default or the resolution
  order only needs to happen once.
- Live-verified end-to-end against the real forked engine binary and a real
  (self-referential) running api_server instance; see
  `docs/ai/runs/2026-07-16-1054-1056-org-skills-wiring-publish.md` for the
  exact commands and observed output. The real `~/.config/opencode/opencode.json`
  was confirmed byte-identical (sha256 + mtime) before and after.
