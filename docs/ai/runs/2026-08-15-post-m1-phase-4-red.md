---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-4]
status: pending
tags: [run, Rhythm-react-electron-live-suite]
---

# Post-M1 Phase 4 acceptance RED

## Files

- `apps/web/tests/post-m1-phase-4-session-lifecycle.redspec.ts`
- `apps/web/tests/post-m1-phase-4-session-lifecycle.live.redspec.ts`
- `apps/web/tests/post-m1-phase-4-fixture-playwright.config.ts`
- `apps/web/tests/post-m1-phase-4-live-playwright.config.ts`
- `docs/ai/contracts/post-m1-phase-4.json`
- `docs/ai/runs/2026-08-15-post-m1-phase-4-red.md`

No product code was changed. Chromium was not launched. The two Playwright commands below used `--list` only.

## Checks

### Fixture Playwright collection

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-4-fixture-playwright.config.ts --list
```

Output:

```text
Listing tests:
  post-m1-phase-4-session-lifecycle.redspec.ts:12:1 › post-m1-p4-c1a: fixture lifecycle controls are deterministic and remain boundary-free
  post-m1-phase-4-session-lifecycle.redspec.ts:37:1 › post-m1-p4-c1b: repeated fixture composition and recovery has stable observable state
Total: 2 tests in 1 file
```

### Live Playwright collection

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-4-live-playwright.config.ts --list
```

Output:

```text
Listing tests:
  post-m1-phase-4-session-lifecycle.live.redspec.ts:157:1 › post-m1-p4-c2b: every canonical text delta accumulates before idle
  post-m1-phase-4-session-lifecycle.live.redspec.ts:168:1 › post-m1-p4-c2d: canonical structured parts retain their types live and after reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:191:1 › post-m1-p4-c2e: real selected files become canonical session.input.parts and survive reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:216:1 › post-m1-p4-c2f: older transcript pagination follows exclusive before cursors
  post-m1-phase-4-session-lifecycle.live.redspec.ts:239:1 › post-m1-p4-c3a: disconnect queues ordered input, reconnects, subscribes, and rehydrates
  post-m1-phase-4-session-lifecycle.live.redspec.ts:259:1 › post-m1-p4-c3c: cancel posts the local id and preserves partial transcript
  post-m1-phase-4-session-lifecycle.live.redspec.ts:273:1 › post-m1-p4-c3d: resume reattaches sdkSessionId and exposes HTTP 410 start-fresh state
  post-m1-phase-4-session-lifecycle.live.redspec.ts:290:1 › post-m1-p4-c3e: retrying status renders canonical attempt and reason then clears
  post-m1-phase-4-session-lifecycle.live.redspec.ts:302:1 › post-m1-p4-c2j: task child navigation keeps parent local and child SDK identities distinct
Total: 9 tests in 1 file
```

### Web TypeScript

Command:

```text
cd apps/web && npx tsc --noEmit
```

Output: empty; exit 0.

### Final collection after cursor/persistence harness repair

Command:

```text
cd apps/web
npx playwright test --config tests/post-m1-phase-4-fixture-playwright.config.ts --list
npx playwright test --config tests/post-m1-phase-4-live-playwright.config.ts --list
npx tsc --noEmit
```

Output:

```text
Listing tests:
  post-m1-phase-4-session-lifecycle.redspec.ts:12:1 › post-m1-p4-c1a: fixture lifecycle controls are deterministic and remain boundary-free
  post-m1-phase-4-session-lifecycle.redspec.ts:37:1 › post-m1-p4-c1b: repeated fixture composition and recovery has stable observable state
Total: 2 tests in 1 file
Listing tests:
  post-m1-phase-4-session-lifecycle.live.redspec.ts:185:1 › post-m1-p4-c2b: every canonical text delta accumulates before idle
  post-m1-phase-4-session-lifecycle.live.redspec.ts:196:1 › post-m1-p4-c2d: canonical structured parts retain their types live and after reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:219:1 › post-m1-p4-c2e: real selected files become canonical session.input.parts and survive reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:244:1 › post-m1-p4-c2f: older transcript pagination follows exclusive before cursors
  post-m1-phase-4-session-lifecycle.live.redspec.ts:267:1 › post-m1-p4-c3a: disconnect queues ordered input, reconnects, subscribes, and rehydrates
  post-m1-phase-4-session-lifecycle.live.redspec.ts:287:1 › post-m1-p4-c3c: cancel posts the local id and preserves partial transcript
  post-m1-phase-4-session-lifecycle.live.redspec.ts:301:1 › post-m1-p4-c3d: resume reattaches sdkSessionId and exposes HTTP 410 start-fresh state
  post-m1-phase-4-session-lifecycle.live.redspec.ts:318:1 › post-m1-p4-c3e: retrying status renders canonical attempt and reason then clears
  post-m1-phase-4-session-lifecycle.live.redspec.ts:330:1 › post-m1-p4-c2j: task child navigation keeps parent local and child SDK identities distinct
Total: 9 tests in 1 file
```

The final `npx tsc --noEmit` output was empty; exit 0.

### Final static/collection gate

Command (from `apps/web`):

```text
npx playwright test --config tests/post-m1-phase-4-fixture-playwright.config.ts --list
npx playwright test --config tests/post-m1-phase-4-live-playwright.config.ts --list
npx tsc --noEmit
node -e "const c=require('../../docs/ai/contracts/post-m1-phase-4.json'); if(c.criteria.length!==20) throw new Error('criterion count'); for (const x of c.criteria) if(!['red','pass','pending','not_tested'].includes(x.status)) throw new Error(x.criterion_id); console.log('contract: 20 criteria; statuses valid')"
if grep -qE 'apps/web/tests/post-m1-phase-4|apps/web/src/(gateway|pages)' SHA256SUMS; then echo 'SHA256SUMS: forbidden path overlap'; exit 1; else echo 'SHA256SUMS: no created test/config path overlap'; fi
git branch --show-current
git rev-parse HEAD
```

Output:

```text
Listing tests:
  post-m1-phase-4-session-lifecycle.redspec.ts:12:1 › post-m1-p4-c1a: fixture lifecycle controls are deterministic and remain boundary-free
  post-m1-phase-4-session-lifecycle.redspec.ts:37:1 › post-m1-p4-c1b: repeated fixture composition and recovery has stable observable state
Total: 2 tests in 1 file
Listing tests:
  post-m1-phase-4-session-lifecycle.live.redspec.ts:185:1 › post-m1-p4-c2b: every canonical text delta accumulates before idle
  post-m1-phase-4-session-lifecycle.live.redspec.ts:196:1 › post-m1-p4-c2d: canonical structured parts retain their types live and after reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:219:1 › post-m1-p4-c2e: real selected files become canonical session.input.parts and survive reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:244:1 › post-m1-p4-c2f: older transcript pagination follows exclusive before cursors
  post-m1-phase-4-session-lifecycle.live.redspec.ts:275:1 › post-m1-p4-c3a: disconnect queues ordered input, reconnects, subscribes, and rehydrates
  post-m1-phase-4-session-lifecycle.live.redspec.ts:295:1 › post-m1-p4-c3c: cancel posts the local id and preserves partial transcript
  post-m1-phase-4-session-lifecycle.live.redspec.ts:309:1 › post-m1-p4-c3d: resume reattaches sdkSessionId and exposes HTTP 410 start-fresh state
  post-m1-phase-4-session-lifecycle.live.redspec.ts:326:1 › post-m1-p4-c3e: retrying status renders canonical attempt and reason then clears
  post-m1-phase-4-session-lifecycle.live.redspec.ts:338:1 › post-m1-p4-c2j: task child navigation keeps parent local and child SDK identities distinct
Total: 9 tests in 1 file
contract: 20 criteria; statuses valid
SHA256SUMS: no created test/config path overlap
codex/react-electron-live-suite
9d8c4443f076756cec919e182222fdb45c39abcc
```

`npx tsc --noEmit` emitted no text and exited 0.

### Final re-collection after query-order robustness repair

Command:

```text
cd apps/web
npx playwright test --config tests/post-m1-phase-4-fixture-playwright.config.ts --list
npx playwright test --config tests/post-m1-phase-4-live-playwright.config.ts --list
npx tsc --noEmit
```

Output:

```text
Listing tests:
  post-m1-phase-4-session-lifecycle.redspec.ts:12:1 › post-m1-p4-c1a: fixture lifecycle controls are deterministic and remain boundary-free
  post-m1-phase-4-session-lifecycle.redspec.ts:37:1 › post-m1-p4-c1b: repeated fixture composition and recovery has stable observable state
Total: 2 tests in 1 file
Listing tests:
  post-m1-phase-4-session-lifecycle.live.redspec.ts:185:1 › post-m1-p4-c2b: every canonical text delta accumulates before idle
  post-m1-phase-4-session-lifecycle.live.redspec.ts:196:1 › post-m1-p4-c2d: canonical structured parts retain their types live and after reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:219:1 › post-m1-p4-c2e: real selected files become canonical session.input.parts and survive reload
  post-m1-phase-4-session-lifecycle.live.redspec.ts:244:1 › post-m1-p4-c2f: older transcript pagination follows exclusive before cursors
  post-m1-phase-4-session-lifecycle.live.redspec.ts:275:1 › post-m1-p4-c3a: disconnect queues ordered input, reconnects, subscribes, and rehydrates
  post-m1-phase-4-session-lifecycle.live.redspec.ts:295:1 › post-m1-p4-c3c: cancel posts the local id and preserves partial transcript
  post-m1-phase-4-session-lifecycle.live.redspec.ts:309:1 › post-m1-p4-c3d: resume reattaches sdkSessionId and exposes HTTP 410 start-fresh state
  post-m1-phase-4-session-lifecycle.live.redspec.ts:326:1 › post-m1-p4-c3e: retrying status renders canonical attempt and reason then clears
  post-m1-phase-4-session-lifecycle.live.redspec.ts:338:1 › post-m1-p4-c2j: task child navigation keeps parent local and child SDK identities distinct
Total: 9 tests in 1 file
```

The final `npx tsc --noEmit` output was empty; exit 0.

### API boundary preconditions — first run (harness failure, not RED)

Command:

```text
cd apps/api_server && npx vitest run src/__tests__/opc_m4_1_file_attachments.test.ts src/__tests__/opc_m3_6_child_sessions.test.ts src/__tests__/opc_m1_5_resume_contract.test.ts --no-file-parallelism
```

Output:

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/opc_m1_5_resume_contract.test.ts > issue-689-c1: POST create persists sdk_session_id matching mocked SDK id > c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

stderr | src/__tests__/opc_m1_5_resume_contract.test.ts > issue-689-c1: POST create persists sdk_session_id matching mocked SDK id > c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id
[WARN] [AgentSessionsController] session 6be38d2a-55f2-4d35-8feb-8c487d45d0f5 created unscoped (no mcpRole) — floor totalEstimatedTokens=1625 (actual total is higher once connected MCP servers are counted; see GET /agent-sessions/6be38d2a-55f2-4d35-8feb-8c487d45d0f5/tool-surface)

stdout | src/__tests__/opc_m1_5_resume_contract.test.ts > issue-689-c1: POST create persists sdk_session_id matching mocked SDK id > c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id
[INFO] [Opencode][timing] opencodeClient.createSession took 0ms for session 6be38d2a-55f2-4d35-8feb-8c487d45d0f5

stderr | src/__tests__/opc_m1_5_resume_contract.test.ts > issue-689-c1: POST create persists sdk_session_id matching mocked SDK id > c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id
[ERROR] Unhandled POST /agent-sessions [cid=315768d9-b5a6-4c21-8b2f-2794c610e799] {
  authUserId: 1,
  body: {
    agentId: 'claude-code',
    cwd: '/Users/ajhochhalter',
    name: 'c1 session'
  },
  params: {},
  error: {
    message: "EPERM: operation not permitted, open '/Users/ajhochhalter/Library/Application Support/Rhythm/anthropic-accounts.json.tmp-97288-1786848625476'",
    stack: "Error: EPERM: operation not permitted, open '/Users/ajhochhalter/Library/Application Support/Rhythm/anthropic-accounts.json.tmp-97288-1786848625476'\n" +
      '    at writeFileSync (node:fs:2430:20)\n' +
      '    at AnthropicAccountsStore.write (/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server/src/services/anthropic_accounts_store.ts:67:5)\n' +
      '    at AnthropicAccountsStore.setRouting (/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server/src/services/anthropic_accounts_store.ts:105:10)\n' +
      '    at AnthropicAccountsService.setRouting (/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server/src/services/anthropic_accounts_service.ts:70:16)\n' +
      '    at AgentSessionsController.create (/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server/src/controllers/agent_sessions_controller.ts:1037:34)\n' +
      '    at processTicksAndRejections (node:internal/process/task_queues:103:5)',
    name: 'Error'
  }
}

 ❯ src/__tests__/opc_m1_5_resume_contract.test.ts (4 tests | 1 failed) 289ms
     × c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id 98ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/opc_m1_5_resume_contract.test.ts > issue-689-c1: POST create persists sdk_session_id matching mocked SDK id > c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id
AssertionError: expected 500 to be 201 // Object.is equality

- Expected
+ Received

- 201
+ 500

 ❯ src/__tests__/opc_m1_5_resume_contract.test.ts:117:24
    115|     });
    116|
    117|     expect(res.status).toBe(201);
       |                        ^
    118|     const body = (await res.json()) as { id: string };
    119|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 15 passed (16)
   Start at  19:50:22
   Duration  3.38s (transform 1.44s, setup 0ms, import 2.12s, tests 994ms, environment 0ms)
```

Disposition: harness-only. The legacy suite defaulted `RHYTHM_ACCOUNTS_FILE` to the real Application Support directory. No criterion was marked RED from this output.

### API boundary preconditions — isolated repair run

Command:

```text
cd apps/api_server
phase4_tmp_dir=$(mktemp -d /private/tmp/rhythm-phase4-acceptance.XXXXXX)
trap 'rm -r "$phase4_tmp_dir"' EXIT
RHYTHM_ACCOUNTS_FILE="$phase4_tmp_dir/anthropic-accounts.json" npx vitest run src/__tests__/opc_m4_1_file_attachments.test.ts src/__tests__/opc_m3_6_child_sessions.test.ts src/__tests__/opc_m1_5_resume_contract.test.ts --no-file-parallelism
```

Output:

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server


 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  19:50:45
   Duration  2.87s (transform 1.22s, setup 0ms, import 1.78s, tests 859ms, environment 0ms)
```

These passing API tests validate server-side attachment forwarding, child SDK transcript lookup, persisted SDK resume, and honest 410 behavior. They do not satisfy the missing React behavior.

### Sandbox/model and residue

Command:

```text
tools/dev/sandbox.sh status
curl -fsS http://127.0.0.1:4097/config | jq '{localLeanModel: .agent["local-lean"].model, lmstudioProviderConfigured: (.provider.lmstudio != null)}'
phase4_db="${TMPDIR:-/tmp}/rhythm-dev-sandbox/rhythm.db"
printf 'rows='
sqlite3 "$phase4_db" "SELECT (SELECT count(*) FROM agent_sessions WHERE id LIKE 'phase4-%' OR name LIKE 'Phase 4 contract%') + (SELECT count(*) FROM agent_session_messages WHERE session_id LIKE 'phase4-%');"
printf 'sessions='
sqlite3 "$phase4_db" "SELECT count(*) FROM agent_sessions WHERE id LIKE 'phase4-%' OR name LIKE 'Phase 4 contract%';"
printf 'worktrees='
git worktree list --porcelain | awk '/^worktree / && /phase4/{n++} END{print n+0}'
printf 'branches='
git branch --format='%(refname:short)' --list '*phase4*' | awk 'NF{n++} END{print n+0}'
printf 'temp_dirs='
find /private/tmp -maxdepth 1 -type d -name 'rhythm-phase4-acceptance.*' | wc -l | tr -d ' '
```

Output:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 27366
engine :4097 listener: 27394
gateway :4099 listener: 27366
{
  "localLeanModel": "omlx/gpt-oss-20b-MXFP4-Q8",
  "lmstudioProviderConfigured": false
}
rows=0
sessions=0
worktrees=0
branches=0
temp_dirs=0
```

## Routes verified

- `GET /agent-configs` — `apps/api_server/src/routes/agent_configs_routes.ts:11`
- `GET /agent-sessions` — `apps/api_server/src/routes/agent_sessions_routes.ts:65`
- `GET /agent-sessions/:id` — `apps/api_server/src/routes/agent_sessions_routes.ts:66`
- `POST /agent-sessions/:id/cancel` — `apps/api_server/src/routes/agent_sessions_routes.ts:69`
- `GET /agent-sessions/:id/messages` — `apps/api_server/src/routes/agent_sessions_routes.ts:119`
- `POST /agent-sessions/:id/resume` — `apps/api_server/src/routes/agent_sessions_routes.ts:120`
- `GET /agent-sessions/:id/children/:childSdkId/messages` — `apps/api_server/src/routes/agent_sessions_routes.ts:128`
- `WS /ws/agents` — registered by `apps/api_server/src/services/ws_gateway.ts:128`; the HTTP route table does not own WebSocket upgrades.

## Notes

- All nine requested renderer gaps have one collected Playwright test ID.
- Because Chromium was not launched, their status is `pending`, not fabricated `red`.
- Nine broader contract criteria remain `not_tested` with explicit reasons; none was partially covered or weakened.
