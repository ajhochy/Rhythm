---
date: 2026-08-15
repo: rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-2]
status: partial
tags: [run, rhythm]
---

# Post-M1 Phase 2 canonical profile identifiers

## Files

- `apps/web/tests/post-m1-phase-2-profiles.redspec.ts` — replaced the renderer-only
  `window.__phase2CanonicalProfiles` injection with live-gateway HTTP interception at
  `/agent-configs` and `/agent-sessions`.
- `apps/web/tests/post-m1-phase-2-fixture-playwright.config.ts` — uses the existing live gateway
  environment variables and loopback ports.
- `apps/web/src/types.ts`, `apps/web/src/gateway/sessions.ts`, `apps/web/src/store.tsx` — carry
  canonical profile and session identity/model fields through the renderer gateway.
- `apps/web/src/components/Profiles.tsx`, `apps/web/src/components/Inspector.tsx`,
  `apps/web/src/fixtures.ts` — use canonical model identifiers while retaining fixture display
  labels and behavior.
- `apps/api_server/src/controllers/agent_configs_controller.ts` — preserves create `sortOrder`
  when constructing the repository input.

Manifest-covered files touched (reported only; `SHA256SUMS` and `PROVENANCE.md` were not edited):

```text
apps/web/src/types.ts
apps/web/src/fixtures.ts
apps/web/src/store.tsx
apps/web/src/components/Profiles.tsx
apps/web/src/components/Inspector.tsx
```

## Checks

### RED before — focused API contract

Command:

```bash
cd apps/api_server && npx vitest run src/__tests__/post_m1_phase_2_profile_contract.test.ts --no-file-parallelism
```

Observed output (verbatim):

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stderr | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
[WARN] [AgentConfigsController] agent-profile config reload did not complete

stdout | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

 ❯ src/__tests__/post_m1_phase_2_profile_contract.test.ts (2 tests | 1 failed) 1564ms
     × post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id 1504ms

⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
AssertionError: expected { …(30) } to match object { …(18) }
(12 matching properties omitted from actual)

- Expected
+ Received

@@ -13,8 +13,8 @@
    "modelId": "claude-sonnet-4-6",
    "modelProvider": "anthropic",
    "modelTierHint": null,
    "ocAgent": "phase-2-canonical-create",
    "sessionSelectable": true,
-   "sortOrder": 42,
+   "sortOrder": 0,
    "systemPrompt": "Preserve canonical identity.",
  }

 ❯ src/__tests__/post_m1_phase_2_profile_contract.test.ts:108:21
    106|     expect(response.status).toBe(201);
    107|     const created = await response.json() as Record<string, unknown>;
    108|     expect(created).toMatchObject({ ...body, id: 'phase-2-canonical-cr…
       |                     ^
    109|     expect(created).not.toHaveProperty('provider');
    110|     expect(created).not.toHaveProperty('model');

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  15:30:53
   Duration  1.69s (transform 1.12s, setup 0ms, import 41ms, tests 1.56s, environment 0ms)
```

### GREEN after — focused API contract

Same command. Observed output (verbatim):

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  15:36:25
   Duration  1.68s (transform 1.11s, setup 0ms, import 39ms, tests 1.56s, environment 0ms)
```

### Web typecheck after

Command:

```bash
cd apps/web && npm run typecheck
```

Observed output (verbatim):

```text
> rhythm-desktop-agents@1.0.0 typecheck
> tsc -b
```

### Phase 2 c1 Playwright collection after

Command:

```bash
cd apps/web && npx playwright test --config tests/post-m1-phase-2-fixture-playwright.config.ts tests/post-m1-phase-2-profiles.redspec.ts --list
```

Observed output (verbatim):

```text
Listing tests:
  post-m1-phase-2-profiles.redspec.ts:56:1 › post-m1-p2-c1a: list and selection preserve canonical profile and model identifiers
  post-m1-phase-2-profiles.redspec.ts:68:1 › post-m1-p2-c1b: create posts canonical modelProvider/modelId and adopts the server id
  post-m1-phase-2-profiles.redspec.ts:104:1 › post-m1-p2-c1c: edit patches canonical nullable model fields without display aliases
  post-m1-phase-2-profiles.redspec.ts:153:1 › post-m1-p2-c1d: selected profileId stays distinct from local and SDK session ids
Total: 4 tests in 1 file
```

Chromium was not launched. Per the dispatch constraint, collection and typechecking are the only
renderer execution evidence from this unit; c1a-c1d remain RED/pending orchestrator execution.

### API build after

Command:

```bash
cd apps/api_server && npm run build
```

Observed output (verbatim):

```text
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json

> rhythm-api-server@0.1.0 postbuild
> node -e "require('fs').mkdirSync('dist/security',{recursive:true});require('fs').copyFileSync('src/security/advisories.json','dist/security/advisories.json')"
```

## SortOrder root cause and callers checked

`apps/api_server/src/controllers/agent_configs_controller.ts:365-402` constructs the shared
`AgentConfigInput` for `POST /agent-configs` but omitted `body.sortOrder`. The repository was not
coercing the value: `apps/api_server/src/repositories/agent_configs_repository.ts:392-395` already
persists `config.sortOrder ?? 0`. The missing controller property therefore made every create request
arrive at the repository as `undefined`, selecting the documented repository default `0`.

The controller create method has one HTTP caller: `apps/api_server/src/routes/agent_configs_routes.ts:24`
binds it to `POST /agent-configs`. `AgentConfigsRepository.insert` callers were also inspected before
deciding not to change that HIGH-impact shared repository method; its existing repository test proves
non-zero `sortOrder` persistence. This was not deliberate create behavior: Flutter serializes
`sortOrder`, the API input declares it, and the repository explicitly persists it.

The repair is at `apps/api_server/src/controllers/agent_configs_controller.ts:380`, where the shared
HTTP create funnel now copies numeric `body.sortOrder` into `AgentConfigInput`.

## Cleanup and handoff state

Observed residue:

```text
rows=0
sessions=0
worktrees=0
branches=0
```

The managed sandbox remained up. Final state:

```text
db_profile=local-lean/omlx/gpt-oss-20b-MXFP4-Q8
engine_profile=omlx/gpt-oss-20b-MXFP4-Q8
lmstudio_auth=false
```

No commit, push, branch switch, worktree creation, Electron launch, packaged launch, or protected-port
contact occurred.
