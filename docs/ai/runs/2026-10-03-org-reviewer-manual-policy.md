---
date: 2026-10-03
repo: rhythm
branch: fix/org-reviewer-manual-policy
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

# Org Reviewer manual policy repair

Base: `c55bc988ea9e82e2d8180a857ec4951429ba93b7`.

## Files

- `apps/api_server/src/services/org_reviewer_service.ts`: authorization now treats model choice and picker visibility as runtime metadata, while retaining exact grants, identity, enabled/agent/schedulable, default-permission, no-bypass, per-session MCP, and scheduled owner/binding checks. It also fails closed immediately for locked, image-enabled, auto-approve, or delegated profiles.
- `apps/api_server/src/services/org_reviewer_seed.ts`: reconciliation no longer hard-pins profile/task model metadata or picker visibility; it accepts `ocAgent: null` or `org-reviewer` and still rejects a foreign alias, unsafe profile settings, non-exact grants, or an incorrectly bound/scoped task. New-profile/task defaults are unchanged.
- `apps/api_server/src/services/__tests__/org_reviewer_service.test.ts`: synthetic in-memory regression for the exact intended manual profile with a current owner, foreign owner, and unowned legacy session. It verifies durable profile/engine identity, same-owner visibility/read, foreign-owner non-disclosure (404), legacy visibility, and profile MCP/skill/core-permission widening denials, alongside identity, bypass, profile-safety, and schedule owner/binding denials.
- `apps/api_server/src/__tests__/org_optimizer_seed_agent_binding.test.ts`: synthetic reconciliation regression preserves the manual profile, its canonical enabled schedule, a supported schedule model override, and all restrictive grants; foreign alias remains fail-closed.
- `apps/api_server/src/__tests__/org_optimizer_seed_reconciliation.test.ts`: corrected the existing widened-scope test description so it does not imply model metadata is disallowed.

## Checks

### Red evidence before implementation

```sh
cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism -t 'authorizes the intended manually selectable reviewer|fails closed for (a locked profile|an image-enabled profile|an auto-approve profile|a profile with delegates)'
```

**FAIL as expected**: 5 failures. The intended manual profile received `403 Org Reviewer profile is not in its least-privilege configuration`; locked/image/auto-approve/delegate profiles were incorrectly authorized.

```sh
cd apps/api_server && npx vitest run src/__tests__/org_optimizer_seed_agent_binding.test.ts --no-file-parallelism -t 'preserves the approved manual profile and canonical schedule runtime settings during reconciliation'
```

**FAIL as expected**: 1 failure. Startup returned `reviewer profile policy changed; disabled pending review` instead of preserving the canonical task.

### Focused green evidence after implementation

- `npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism -t 'authorizes the intended manually selectable reviewer|fails closed for (a locked profile|an image-enabled profile|an auto-approve profile|a profile with delegates)|denies mismatched trusted reviewer identities|denies a session with an explicit approval bypass|denies a scheduled reviewer session bound to another owner or profile'`: **PASS**, 8/8.
- `npx vitest run src/__tests__/org_optimizer_seed_agent_binding.test.ts --no-file-parallelism -t 'preserves the approved manual profile and canonical schedule runtime settings during reconciliation|preserves a foreign OpenCode alias for review but disables its profile and task'`: **PASS**, 2/2.
- `npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism`: **PASS**, 48/48.
- `npx vitest run src/__tests__/org_optimizer_seed_agent_binding.test.ts --no-file-parallelism`: **PASS**, 12/12.
- `npx vitest run src/__tests__/org_optimizer_seed_reconciliation.test.ts --no-file-parallelism`: **PASS**, 6/6.
- `npx vitest run src/__tests__/org_reviewer_routes.test.ts --no-file-parallelism`: **PASS**, 4/4.
- `npx tsc --noEmit`: **not a gate**. It attempted to resolve the separate `tsc` package from npm and failed offline with `ENOTFOUND registry.npmjs.org`; no dependency was installed or modified.
- `./node_modules/.bin/tsc --noEmit`: **PASS** (exit 0) using the existing read-only dependency symlink.
- `npm run build`: **PASS** (`tsc -p tsconfig.json`; postbuild copied the advisory fixture).
- `git diff --check`: **PASS**.

### Owner-bound security verification after Sol feedback

- `cd apps/api_server && ./node_modules/.bin/vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism`: **PASS**, 51/51 in 6.67s. The manual-profile fixture uses `openai/gpt-6.1-sol`, selectable/schedulable/own `ocAgent`, synthetic current and foreign users, same-owner and unowned legacy evidence, and a foreign-owner non-disclosing 404. It also proves exact profile MCP, skill, and core-permission scope widening is rejected.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/security/trusted_mcp_call.test.ts --no-file-parallelism`: **PASS**, 4/4 in 148ms. Exact signed tool/payload, freshness, nonce replay, key pinning, and fixed-boundary checks remain effective.

### GitNexus

Before edits, `impact` against the available Rhythm index returned LOW: `authorize` had zero indexed callers (the index is stale; focused source inspection found the four Org Reviewer controller methods), and each seed predicate had one direct caller/two total dependants. The final local command `gitnexus detect-changes --repo "$PWD" --scope compare --base-ref main --limit 30` exited 1 because this isolated checkout is not indexed. `detect-changes` against the only indexed Rhythm root reported a separate 272-file/1,855-symbol CRITICAL historical diff, so it is not evidence about this isolated patch; no reindex was run.

### Independent Sol final review

The production diff is limited to the two reviewer policy files. Signed engine/durable session/profile identity, owner filtering, exact tool/skill/core scope, safe session permissions, scheduled ownership, proposed-only submission and automatic-promotion denial remain in place. The intended behavior expansion is that correctly bound manual reviewer sessions and configured model selections can use the existing review operations; ordinary sessions gain no reviewer authority or extra data scope. No runtime activation occurred.

Sol corrected one negative test fixture after review: its MCP grant input now contains all four current reviewer tools plus `rhythm_create_task`, making it a true scope widening rather than simultaneously omitting two granted tools. The production implementation remains the Terra CLI's patch.

From `apps/api_server`, final source on `fix/org-reviewer-manual-policy`, base `c55bc988ea9e82e2d8180a857ec4951429ba93b7`:

```sh
./node_modules/.bin/vitest run src/services/__tests__/org_reviewer_service.test.ts src/__tests__/org_optimizer_seed_agent_binding.test.ts src/__tests__/org_optimizer_seed_reconciliation.test.ts src/__tests__/org_reviewer_routes.test.ts src/security/trusted_mcp_call.test.ts --no-file-parallelism
```

73 tests passed; the route fixture's four tests were skipped after a hook timeout caused by this shell sandbox's `listen EPERM` on its ephemeral loopback socket. This was an environment restriction, not a source failure. The existing fixture (already passing in the Terra session) was rerun through automatic approval review, with no new/custom runtime or live data:

```sh
./node_modules/.bin/vitest run src/__tests__/org_reviewer_routes.test.ts --no-file-parallelism
```

Exit 0, 4/4 passed. Together the final five affected suites passed 77 tests. `./node_modules/.bin/tsc --noEmit`, `npm run build`, and `git diff --check` also exited 0 from the final source. Full repository issue/PR checks and desktop packaging were not run in this source-only handoff; real engine/mobile behavior remains unverified.

## Notes

- No live database, credentials, user data, real org review, proposal submission, live API/engine runtime, app control, restart, or desktop build was used by the implementation session. Tests used repository-owned temporary managed-skills roots and SQLite `:memory:` fixtures; the ordinary route suite uses its existing synthetic HTTP fixture.
- **UNVERIFIED by explicit constraint:** the real signed engine/manual mobile Org Reviewer authorization check. It was not launched or simulated against a live service; the parent's prior read-only live diagnosis remains the only real-session evidence.
- No schema, MCP tool, engine-fork, UI, profile-projection, migration, dependency, or default-seed change was made. No commit, push, deploy, or project-state update was performed.
- Pre-existing `apps/api_server/node_modules` remains an unmodified, read-only symlink and is intentionally still untracked in this isolated checkout.
