---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [engine-session-live-lifecycle, electron-m1-slice-4]
status: in-progress
tags: [run, Rhythm]
---

# Engine session live lifecycle — Slice 4

## Files

- `docs/ai/contracts/engine-session-live-lifecycle.{json,md}`
- `apps/web/tests/gateway/sessions-gateway.spec.ts`
- `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts`

## RED Checks

Command (before product edits):

```bash
cd apps/web && npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1
```

Observed verbatim summary:

```text
Running 4 tests using 1 worker
4 failed
tests/gateway/sessions-gateway.spec.ts:13:1 › engine-session-live-lifecycle-c1: typed gateway keeps local and SDK session identities separate
tests/gateway/sessions-gateway.spec.ts:21:1 › engine-session-live-lifecycle-c2: fixture sessions gateway is network-free and live never falls back
tests/gateway/sessions-gateway.spec.ts:32:1 › engine-session-live-lifecycle-c3: hydration boundary consumes structured API and WS payloads
tests/gateway/sessions-gateway.spec.ts:40:1 › engine-session-live-lifecycle-c10: live failures are bounded and redact response secrets
```

All four failures were contract assertions (`the typed live sessions gateway must exist`, received `null`), not a test-harness error.

## GREEN Checks

```bash
cd apps/web && npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1
# 4 passed (941ms)

cd apps/web && npm run typecheck
# PASS

cd apps/web && npx playwright test tests/sessions.spec.ts tests/conversation.spec.ts --workers=1
# 7 passed (9.1s)
```

## Notes

Sandbox confirmed running at API `:4098`, engine `:4097`, and gateway `:4099`. No direct server process was started.

## Impact warning/results

- `GatewayDomainContracts` upstream: **CRITICAL**, 3 direct / 228 total. Change is additive only; no existing domain was removed or renamed.
- `FixtureProvider`: LOW, 1 direct (`main.tsx`). No store change was made.
- `SessionRail`: LOW, 3 total. No rail change was made.

`gitnexus_detect_changes(scope=all)` reports the pre-existing worktree/API changes (11 files, medium) and no indexed Slice 4 symbols yet; it must be re-run after a complete implementation.

## Blocker

The initial gateway seam is present, but the required live store/UI lifecycle has not been implemented. Therefore c4–c9 have not been run and this slice is not ready for verification. Inventory/provenance and parity artifacts were intentionally not regenerated because the required implementation and final check suite are incomplete.

### 2026-08-14 Slice 4 dispatch preflight

Before replacing the live-test placeholder or editing product code, the required existing
sandbox preflight was run from this exact worktree:

```bash
tools/dev/sandbox.sh status
```

Observed verbatim output:

```text
sandbox: live-artifact storage root is missing
```

This is an infrastructure/harness failure, not the required genuine failing c4–c9 product
assertion. Per the dispatch, the acceptance test must run against the existing sandbox and
must not be recorded red for a skip or harness error. No store/UI, backend/fork/Electron, test,
contract-status, inventory, or parity edit was made from this dispatch. Sandbox restart was not
attempted because the request limits it to the final clean rebuild/restart after validation.

### 2026-08-14 Sandbox preflight repair (orchestrator)

Diagnosis: the sandbox root itself was gone (macOS reaped the `$TMPDIR` tree), not merely the
live-artifact subdirectory. `status` checks `$SB/live-artifacts` first, so a fully absent sandbox
reports as `live-artifact storage root is missing`. Confirmed by `ls` (no such directory) and by
zero listeners on :4098/:4097/:4099. The prebuilt fork engine binary was intact, so no ~10 min
rebuild was required.

Repair (sanctioned sandbox only; no hand-started servers, no :4001/:4096 traffic):

```bash
tools/dev/sandbox.sh up
# ... building opencode-darwin-arm64
# Smoke test passed: 0.0.0-codex/react-electron-live-suite-202608150543
# Sandbox ready: http://127.0.0.1:4098 (engine :4097)

tools/dev/sandbox.sh status
```

Observed verbatim status output after repair:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 98680
gateway :4099 listener: 98629
```

Preflight is restored. Slice 4 Unit 2 (c4–c9) may now be dispatched: the live spec at
`apps/web/tests/sessions/session-live-lifecycle.live.spec.ts` is still the placeholder and must be
replaced with genuine c4–c9 assertions, captured RED here before any product edit.

### 2026-08-14 Slice 4 Unit 2a — c4–c9 RED capture

The placeholder was replaced with one env-gated Playwright journey whose named `test.step`s map
directly to c4–c9. It seeds a nonce identity, temporarily points one real profile at the Slice 0
`lmstudio` / `qwen/qwen3-coder-30b` delayed loopback provider, drives the advanced React form and
composer, asserts the intermediate working/partial-stream state, observes a fresh detail GET after
reload, verifies local+SDK hard deletion, and uses nested `finally` blocks for restoration and zero
count assertions.

Exact live command, first capture:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

Observed verbatim first failure:

```text
Running 1 test using 1 worker

[1/1] tests/sessions/session-live-lifecycle.live.spec.ts:157:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
  1) tests/sessions/session-live-lifecycle.live.spec.ts:157:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session

    Error: protected live desktop API port must not be touched by this test

    expect(received).toBe(expected) // Object.is equality

    Expected: 0
    Received: 1

      160 |   expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engineBase);
      161 |   expect(dbPath).toMatch(/\/rhythm\.db$/);
    > 162 |   expect(listenerCount(4001), 'protected live desktop API port must not be touched by this test').toBe(0);
          |                                                                                                   ^
      163 |   expect(listenerCount(4096), 'protected live desktop engine port must not be touched by this test').toBeGreaterThanOrEqual(0);
      164 |   expect(listenerCount(providerPort), 'Slice 0 deterministic provider port must be free before setup').toBe(0);

  1 failed
    tests/sessions/session-live-lifecycle.live.spec.ts:157:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
```

This was **not** accepted as RED: AJ's already-running desktop API legitimately owns `:4001`, so
listener absence was an invalid harness precondition rather than a missing Slice 4 product behavior.
The one allowed focused repair replaced it with before/after protected-listener ownership snapshots
plus browser-request assertions that the journey never requests `:4001` or `:4096`.

Exact live command after that single repair (identical command):

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

Observed verbatim second failure, captured from Playwright's generated error context:

```text
Test info

- Name: sessions/session-live-lifecycle.live.spec.ts >> engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
- Location: tests/sessions/session-live-lifecycle.live.spec.ts:162:1

Error details

Test timeout of 45000ms exceeded.

Error: apiRequestContext.get: Target page, context or browser has been closed

> 341 |             const restored = await json<Profile>(await request.get(`${apiBase}/agent-configs/${profile.id}`, { headers: authHeaders(identity.token) }), 200);
      |                                                                ^ Error: apiRequestContext.get: Target page, context or browser has been closed
```

This was also **not** accepted as genuine product RED. The missing live create path sent the test
into cleanup, but profile/auth restoration exhausted the 45-second test budget; Playwright then
closed its request context before the final restoration assertion. That is a harness timeout, not a
c4–c9 product assertion, and it produced no skip. Per the dispatch's stop condition, no second
harness repair and no product edit was attempted. Therefore this unit is **blocked without a
genuine c4–c9 RED capture**; the exact blocker is cleanup/restoration exceeding the per-test timeout.

Sandbox status command:

```bash
tools/dev/sandbox.sh status
```

Observed verbatim after the stopped run:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 11720
gateway :4099 listener: 98629
```

Post-failure cleanup inspection observed `local-lean` restored exactly to
`omlx` / `gpt-oss-20b-MXFP4-Q8`, zero nonce users, zero nonce agent sessions, and zero listeners on
`:1234` and `:4175`. The timed-out engine auth cleanup was completed explicitly with
`curl -sS -X DELETE http://127.0.0.1:4097/auth/lmstudio`; it returned `true`, and the subsequent
`GET /opencode/auth/` omitted `lmstudio`.

Suite-list command:

```bash
cd apps/web && npm run test:list
```

Observed verbatim summary:

```text
Total: 259 tests in 41 files
```

### 2026-08-14 Slice 4 Unit 2a-repair — genuine c4–c9 RED

The requested timeout-only repair was applied first:

```ts
test.setTimeout(180_000);
```

Preflight commands:

```bash
tools/dev/sandbox.sh status
sqlite3 /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  "SELECT id, model_provider, model_id, oc_agent FROM agent_configs WHERE id='local-lean';"
curl -sS http://127.0.0.1:4097/config | \
  jq -c '.agent["local-lean"] // .agent["local_lean"] // empty'
```

Observed before the live run:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 13008
gateway :4099 listener: 98629
local-lean|omlx|gpt-oss-20b-MXFP4-Q8|local-lean
{"model":"omlx/gpt-oss-20b-MXFP4-Q8","prompt":"Local assistant. Answer directly and briefly. No tools available.","description":"Local Lean","mode":"all","options":{"mcpAllowlist":{"servers":[],"tools":[]},"skillAllowlist":{"skills":[]},"effort":"low"},"permission":{"bash":"deny","edit":"deny","write":"deny","patch":"deny","read":"deny","glob":"deny","grep":"deny","list":"deny","webfetch":"deny","websearch":"deny","task":{"*":"deny","explore":"allow","general":"allow"},"todowrite":"deny","todoread":"deny","skill":"deny","question":"deny","rhythm_delegate_async":"deny"},"name":"local-lean"}
```

Exact live command, run once after the timeout change and once after the single allowed focused
cleanup repair:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

The first post-timeout run reached c9 cleanup but the engine was between credential-driven restarts,
so the final `/config` request failed with `ECONNREFUSED 127.0.0.1:4097`. Per the allowed repair,
cleanup was moved to a standalone `playwright.request.newContext()`, individual restore failures no
longer abort later cleanup, and a primary c4–c8 failure is rethrown instead of being masked by a
secondary cleanup failure. The c9 zero-leak equality assertion remains unchanged and asserted in the
spec.

Verbatim genuine failing output from the final capture (primary Playwright failure block):

```text
  1) tests/sessions/session-live-lifecycle.live.spec.ts:162:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session 

    TimeoutError: page.waitForResponse: Timeout 4000ms exceeded while waiting for event "response"

      229 |       if (await profilePicker.count()) await profilePicker.selectOption(profile!.id);
      230 |
    > 231 |       const createResponsePromise = page.waitForResponse((response) =>
          |                                          ^
      232 |         response.url() === `${apiBase}/agent-sessions` && response.request().method() === 'POST',
      233 |         { timeout: 4_000 },
      234 |       );
        at /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:231:42
        at /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:222:5

    Error Context: test-results/sessions-session-live-life-41891-ard-deletes-a-nonce-session/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/sessions-session-live-life-41891-ard-deletes-a-nonce-session/trace.zip
    Usage:

        npx playwright show-trace test-results/sessions-session-live-life-41891-ard-deletes-a-nonce-session/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  1 failed
    tests/sessions/session-live-lifecycle.live.spec.ts:162:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session 
```

This is a genuine **c4 product-behavior RED**. The advanced-create UI was submitted, but no real
`POST http://127.0.0.1:4098/agent-sessions` response occurred within the c4 response boundary. The
missing behavior is therefore the advanced form creating a real session and receiving the required
`201`; the failure is not the 180-second test timeout, a closed Playwright page/request context, a
skip, or a teardown exception. A secondary cleanup PATCH timed out while the engine was bouncing,
but the cleanup wrapper reported it separately and rethrew the c4 failure shown above.

An out-of-order cleanup line introduced while adding that wrapper prevented the final run's database
cleanup block from executing. It was removed without another live run (the one permitted focused
repair loop was exhausted), and the one exact nonce identity left by that failed cleanup was removed
manually after identifying it as user `6` / the generated `smoke-session-*@example.invalid` address:

```bash
sqlite3 /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  "BEGIN IMMEDIATE; DELETE FROM sessions WHERE user_id = 6; DELETE FROM users WHERE id = 6 AND email = 'smoke-session-fda5ab85-1085-4827-b391-58be629a4f99@example.invalid'; COMMIT; SELECT 'users', COUNT(*) FROM users WHERE email LIKE 'smoke-session-%@example.invalid'; SELECT 'authSessions', COUNT(*) FROM sessions WHERE user_id = 6; SELECT 'agentSessions', COUNT(*) FROM agent_sessions WHERE owner_user_id = 6 OR name LIKE 'smoke-session-%'; SELECT 'messages', COUNT(*) FROM agent_session_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE owner_user_id = 6 OR name LIKE 'smoke-session-%'); SELECT 'tasks', COUNT(*) FROM tasks WHERE owner_id = 6; SELECT 'artifacts', COUNT(*) FROM live_artifacts WHERE owner_user_id = 6;"
```

Observed zero nonce-owned rows:

```text
users|0
authSessions|0
agentSessions|0
messages|0
tasks|0
artifacts|0
```

Final listener/auth/profile checks:

```bash
jq -c 'keys' /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/home/.local/share/opencode/auth.json
curl -sS --max-time 10 http://127.0.0.1:4097/global/health
curl -sS --max-time 10 http://127.0.0.1:4097/config | jq -c '.agent["local-lean"] // empty'
for port_number in 1234 4175; do
  printf 'port %s listeners=' "$port_number"
  lsof -tiTCP:$port_number -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' '
done
tools/dev/sandbox.sh status
```

Observed at the end:

```text
["anthropic","google","ollama-executor","ollama-planner","openai","openrouter"]
{"healthy":true,"version":"0.0.0-codex/react-electron-live-suite-202608150543","pid":21743,"bootId":"ff742a04-6a2b-4f4a-ba6c-8ce5d1dd75b5"}
{"model":"omlx/gpt-oss-20b-MXFP4-Q8","prompt":"Local assistant. Answer directly and briefly. No tools available.","description":"Local Lean","mode":"all","options":{"mcpAllowlist":{"servers":[],"tools":[]},"skillAllowlist":{"skills":[]},"effort":"low"},"permission":{"bash":"deny","edit":"deny","write":"deny","patch":"deny","read":"deny","glob":"deny","grep":"deny","list":"deny","webfetch":"deny","websearch":"deny","task":{"*":"deny","explore":"allow","general":"allow"},"todowrite":"deny","todoread":"deny","skill":"deny","question":"deny","rhythm_delegate_async":"deny"},"name":"local-lean"}
port 1234 listeners=0
port 4175 listeners=0
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 21743
gateway :4099 listener: 98629
```

`lmstudio` is absent from the sandbox auth-provider keys. The database profile and live engine
config are both restored to `local-lean` / `omlx` / `gpt-oss-20b-MXFP4-Q8`. No nonce-owned rows or
provider/Vite listeners remain.

Suite-list command:

```bash
cd apps/web && npm run test:list
```

Observed summary:

```text
Total: 259 tests in 41 files
```

### 2026-08-14 Orchestrator audit — c4 RED independently reproduced

The Unit 2a-repair child edited the spec (cleanup-wrapper typo removal) AFTER capturing its red
output, so the recorded evidence did not correspond byte-for-byte to the spec on disk. The
orchestrator re-ran the unchanged current file to confirm the red still reproduces:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

Observed verbatim (identical to the child's capture):

```text
  1) tests/sessions/session-live-lifecycle.live.spec.ts:162:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session

    TimeoutError: page.waitForResponse: Timeout 4000ms exceeded while waiting for event "response"

      > 231 |       const createResponsePromise = page.waitForResponse((response) =>
            |                                          ^
      232 |         response.url() === `${apiBase}/agent-sessions` && response.request().method() === 'POST',

  1 failed
```

Why this is a genuine c4 product assertion and not a harness error: the step reached
`waitForResponse` only after `new-session-advanced`, `advanced-name`, `advanced-cwd`,
`advanced-isolate-worktree`, `advanced-worktree-name` and `advanced-create` all resolved and the
submit click landed. A missing or mis-targeted selector would have thrown a locator error at the
fill/click, not a response-wait timeout. The form exists and is clicked; the UI simply never issues
`POST /agent-sessions`. That is precisely the absent live-create behavior c4 specifies. The run
budget is 180s, so this is also not the previous timeout/teardown masking.

Post-run leak check (c9 cleanup verified by the orchestrator, independent of the spec's own asserts):

```text
users|0
agentSessions|0
port 1234 listeners=0
port 4175 listeners=0
```

Sandbox remained healthy throughout; AJ's live desktop on :4001/:4096 was never touched. The engine
pid changes across runs (13008 → 21743 → 25740) are the API server's supervised respawn after each
profile patch/restore, not sandbox restarts — `/global/health` reports `healthy:true` on the fork
build `0.0.0-codex/react-electron-live-suite-202608150543`.

**Slice 4 c4–c9 is now RED-first satisfied. Unit 2b (store/UI implementation) may proceed.**

### 2026-08-14 Slice 4 Unit 2b — BLOCKED at c4

Product files changed additively during the Unit 2b attempt:

- `apps/web/src/gateway/sessions.ts`
- `apps/web/src/gateway/context.tsx`
- `apps/web/src/store.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/SessionRail.tsx`

The mandated live spec was not edited. `useFixtures` retained all existing fields and meanings and
only gained live-session fields/actions.

GitNexus upstream impact results captured before edits:

- `useFixtures`: CRITICAL, 37 impacted / 34 direct callers, 5 modules, one affected process
  (`PlannerPage → QueryParams`). The user supplied this warning and the local analysis reproduced it.
- `FixtureProvider`: LOW, one direct caller (`main.tsx`).
- `SessionRail`: LOW, three upstream symbols (`AgentsWorkspace → App → main.tsx`).
- `Composer`: LOW, three upstream symbols (`AgentsWorkspace → App → main.tsx`).
- `EnvironmentReceipt`: LOW, two upstream symbols (`App → main.tsx`).
- New gateway symbols were absent from the index and therefore reported UNKNOWN / zero indexed callers.

Checks completed before the live blocker:

```text
cd apps/web && npm run typecheck

> rhythm-desktop-agents@1.0.0 typecheck
> tsc -b

Process exited with code 0
```

```text
cd apps/web && npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1

Running 4 tests using 1 worker
4 passed (1.8s)
```

The focused live command was:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

The final focused run reproduced:

```text
Running 1 test using 1 worker

TimeoutError: page.waitForResponse: Timeout 4000ms exceeded while waiting for event "response"

  > 231 |       const createResponsePromise = page.waitForResponse((response) =>
        |                                          ^

engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
engine-session-live-lifecycle secondary cleanup error: PATCH agent-configs/local-lean timed out after 10000ms
1 failed
```

The API log isolates the lowest failing layer:

```text
[INFO] [AuthCredentialWatcher] .../auth.json changed — bouncing engine to reload credentials
[INFO] [OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json
[ERROR] Handled SDK_ERROR POST /agent-sessions — createWorktree threw: fetch failed { authUserId: 12 }
```

This is a repeatable real-system race: setup changes the disposable credential/profile, the API
completes its first supervised engine restart, then `AuthCredentialWatcher` begins a second restart
while the UI's real create request is inside `createWorktree`. The UI now issues the POST, but the
backend cannot return the required 201. The user prohibited restarting/rebuilding the already-running
sandbox, and the focused repair budget was exhausted, so c4 remains failing and c5–c8 were not
reached. c9's cleanup count was zero, but its profile PATCH timed out, so it also remains failing.

No GREEN section, provenance root, parity regeneration, full verification results, or passing
contract status was recorded because the unit did not reach green.

Exact restoration verification after stopping:

```text
DELETE /auth/lmstudio HTTP 200
response: true
{"healthy":true,"version":"0.0.0-codex/react-electron-live-suite-202608150543","pid":45772,"bootId":"ae8fde67-123b-47e3-8aa1-69407cb01272"}
{
  "model": "omlx/gpt-oss-20b-MXFP4-Q8",
  "lmstudioAuth": null
}
{
  "id": "local-lean",
  "modelProvider": "omlx",
  "modelId": "gpt-oss-20b-MXFP4-Q8"
}
```

Final sandbox/auth/listener status:

```text
["anthropic","google","ollama-executor","ollama-planner","openai","openrouter"]
{"healthy":true,"version":"0.0.0-codex/react-electron-live-suite-202608150543","pid":45772,"bootId":"ae8fde67-123b-47e3-8aa1-69407cb01272"}
{"model":"omlx/gpt-oss-20b-MXFP4-Q8","lmstudioAuth":null}
port 1234 listeners=0
port 4175 listeners=0
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 45772
gateway :4099 listener: 98629
```

### 2026-08-14 Orchestrator ruling — Unit 2b blocker is a harness race, narrow spec edit authorized

Unit 2b was dispatched with an absolute "do not edit the spec" rule and correctly refused to touch
it, reporting BLOCKED. Audit confirms the spec is untouched (365 lines, all six c4–c9 steps,
37 assertions) and that no provenance/parity/contract-status edits were made. Five web source files
carry a partial additive implementation: `src/gateway/context.tsx`, `src/store.tsx`,
`src/components/SessionRail.tsx`, `src/components/Composer.tsx`, `src/gateway/sessions.ts`.

Observed failure:

```text
[INFO] [AuthCredentialWatcher] .../auth.json changed — bouncing engine to reload credentials
[INFO] [OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json
[ERROR] Handled SDK_ERROR POST /agent-sessions — createWorktree threw: fetch failed { authUserId: 12 }
```

Root cause (verified in product source, not inferred from the child's report):
`apps/api_server/src/services/auth_credential_watcher.ts:287` bounces the engine whenever
`auth.json` changes. The spec must write a disposable `lmstudio` credential at line 211 to stand up
the Slice 0 deterministic provider required by c5. It then starts Vite, loads the page, and drives
the advanced-create form with **no barrier waiting for the bounced engine to return healthy**. The
create therefore races the restart and `createWorktree` fails with `fetch failed`.

Ruling: this is a setup-ordering defect in the test harness, not a product defect in scope for
Slice 4, and not an over-strict assertion. Unit 2b-repair is authorized to make exactly ONE
narrowly-scoped spec change — inserting an engine-readiness barrier after the credential write and
profile patch, before the UI is driven (poll `/global/health` until healthy with a NEW `bootId`,
proving the bounce completed). Every c4–c9 assertion, its wording, and its strictness remain
untouched and unwaived. Any other spec edit remains prohibited.

Separately noted as OUT OF SCOPE and filed as follow-up work: `POST /agent-sessions` surfaces a raw
`SDK_ERROR ... fetch failed` when the engine is mid-bounce. A real user who changes a credential and
immediately creates a session would hit the same unhandled error in the desktop app. That is a
product-robustness gap worth its own issue; it is deliberately NOT folded into Slice 4.

Correction to this run's earlier audit method: the orchestrator's initial product-edit checks used
`find -newermt`, which the local `bfs` shim rejects (`Invalid timestamp`) while exiting 0 with no
output — a silent no-op that proved nothing. Re-verified with `stat` mtimes. The conclusions held
(Units 2a and 2a-repair made no product edits; no `apps/web/src` file has an mtime inside their
windows), but the original method was not evidence and is not relied upon.

### 2026-08-14 Slice 4 Unit 2b-repair — BLOCKED after one repair loop

Files changed in this repair:

- `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts` — the sole authorized spec change.
- `apps/web/index.html` — removed the redundant explicit WebSocket CSP source so the frozen
  two-origin gateway contract passes.
- `docs/ai/contracts/engine-session-live-lifecycle.json` — retained c4–c9 as failing with current
  evidence.
- `docs/ai/project-state.md` and this run note — honest blocked handoff.

The readiness-barrier diff was setup-only and changed no c4–c9 assertion, wording, order, skip, or
the frozen `4_000` create-response window:

```diff
+    const engineBeforeCredentialWrite = await json<{ healthy: boolean; bootId: string }>(
+      await request.get(`${engineBase}/global/health`), 200,
+    );
     await request.post(`${apiBase}/opencode/auth/lmstudio`, ...);
     await request.patch(`${apiBase}/agent-configs/${profile!.id}`, ...);
+    await expect.poll(async () => {
+      try {
+        const health = await json<{ healthy: boolean; bootId: string }>(
+          await request.get(`${engineBase}/global/health`), 200,
+        );
+        return health.healthy && health.bootId !== engineBeforeCredentialWrite.bootId;
+      } catch {
+        return false;
+      }
+    }, {
+      message: 'engine must return healthy with a new bootId after the auth/profile bounce',
+      timeout: 20_000,
+    }).toBe(true);
```

Impact evidence before existing-symbol edits:

- `useFixtures`: CRITICAL — 37 impacted, 34 direct, 5 modules, one `PlannerPage` process. Its
  signature and existing field meanings were not changed.
- `FixtureProvider`: LOW — 1 direct caller.
- `SessionRail`: LOW — 3 impacted, 1 direct.
- `Composer`: LOW — 3 impacted, 1 direct.
- `EnvironmentReceipt`: LOW — 2 impacted, 1 direct.
- `createLiveSessionsGateway` and `toSessionViewModel`: UNKNOWN / absent from the current index.
- `createLiveGateway`: LOW — 2 impacted, 1 direct. The attempted warm-up was reverted after the
  repair live run failed before c4.

First full check run:

```text
tools/dev/sandbox.sh status
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 45772
gateway :4099 listener: 98629
```

```text
cd apps/web && npm run typecheck
> tsc -b
exit 0
```

```text
cd apps/web && npm run build
vite v5.4.21 building for production...
✓ 1630 modules transformed.
dist/index.html                   0.84 kB │ gzip:   0.47 kB
dist/assets/index-D57FhDJJ.css  257.29 kB │ gzip:  35.51 kB
dist/assets/index-S3oXgj8L.js   724.53 kB │ gzip: 180.08 kB
✓ built in 1.27s
```

```text
cd apps/web && npm run test:fixture
1 failed: tests/gateway/gateway.spec.ts c19
13 passed (3.4s)
```

```text
cd apps/web && npm run test:list
Total: 259 tests in 41 files
```

```text
cd apps/web && npm test
2 failed: gateway c19; invalid-live c5-ui
4 skipped
253 passed (6.3m)
```

```text
cd apps/web && npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1
4 passed (1.8s)
```

```text
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
TimeoutError: page.waitForResponse: Timeout 4000ms exceeded while waiting for event "response"
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
1 failed
```

Focused isolation timed the same stable engine path: direct engine worktree create `HTTP=200
TIME=0.150666`; first API session create `HTTP=201 TIME=22.836977`; second `HTTP=201
TIME=6.680577`; third `HTTP=201 TIME=1.894534`. All three diagnostic sessions, worktrees, auth
session, and user were deleted; final diagnostic counts were `USERS=0`, `SESSIONS=0`.

Single repair-loop results:

```text
cd apps/web && npm run test:fixture
14 passed (3.8s)
dedicated invalid-live: 1 passed (3.0s)
```

```text
live c4–c9 command
Expected receipt substring: "Live"
Received: "Environment: Connecting · API :4098 checking · Engine :4097 checking"
Timeout: 5000ms
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
1 failed
```

The warm-up experiment was reverted. Per the one-loop stop rule no second repair was attempted.
The default-config `invalid-live.spec.ts` overlap was not edited because all spec content except the
authorized lifecycle barrier was frozen; its dedicated config passes.

c4–c9 remain failing. c5–c8 were not reached. c9's in-test PATCH timed out even though final state
was restored. Provenance reconciliation, the 144/144 checksum root, parity regeneration/validation,
and a GREEN heading were deliberately not produced because the live contract did not pass.

Final restoration/status:

```text
profile={"id":"local-lean","modelProvider":"omlx","modelId":"gpt-oss-20b-MXFP4-Q8","ocAgent":"local-lean"}
auth.providers=["openrouter","anthropic","openai","google","ollama-planner","ollama-executor","opencode"]
engine={"localLeanModel":"omlx/gpt-oss-20b-MXFP4-Q8"}
health={"healthy":true,"pid":80322,"bootId":"e06c85bd-795b-4be7-8934-c5866345e5b7"}
api :4098 listener: 98629
engine :4097 listener: 80322
gateway :4099 listener: 98629
```

### 2026-08-15 Orchestrator rulings — create-wait patience, and a standing npm-test failure

**Audit of Unit 2b-repair.** The authorized barrier landed correctly and nothing else was loosened:
spec 365 → 379 lines (+14, the barrier only), assertion count unchanged at 37, all six c4–c9 steps
present, `bootId` compared against a pre-write snapshot so a stale pre-bounce engine cannot satisfy
it. Contract statuses were left honestly `failing`. No provenance/parity/GREEN claims were made.

**Ruling 1 — the 4s create wait is unrealistic and may be raised.** The child's timing isolation
measured the real cost of the create path against the live sandbox:

```text
direct engine worktree create   HTTP=200 TIME=0.150666
first  API session create       HTTP=201 TIME=22.836977
second API session create       HTTP=201 TIME=6.680577
third  API session create       HTTP=201 TIME=1.894534
```

`POST /agent-sessions` genuinely returns 201 — it just takes ~22.8s cold, ~6.7s warm, ~1.9s hot,
against a `waitForResponse` window of 4_000ms. The previous dispatch forbade widening that window
because, at the time, it would have masked the engine-bounce race. With the barrier now proving the
engine is healthy before the UI is driven, that reason is gone and the measurement stands on its own.

A wait timeout is harness PATIENCE, not assertion STRENGTH. Raising it changes nothing about what is
asserted: `status === 201`, local id present, SDK id present and distinct, real profile retained,
isolated worktree cwd exposed, rail entry matching the POST local id — all unchanged and unwaived.
Unit 2b-repair-2 is authorized to raise the create-response wait (and any other provably-too-tight
wait it can justify with a measurement) to a realistic bound. Softening, deleting, or reordering any
assertion remains prohibited.

Noted as OUT OF SCOPE: a ~22.8s cold create is a real user-facing latency concern. Slice 4's contract
says nothing about latency, so it is not folded in here.

**Ruling 2 — `tests/gateway/invalid-live.spec.ts` fails under the default config, and always has.**
Verified by the orchestrator, independent of the child's report:

```text
npm test  →  1 failed, 4 skipped, 254 passed (5.4m)
  tests/gateway/invalid-live.spec.ts:3:1 › slice-2-c5-ui: invalid requested-live startup renders a
  fatal error instead of fixtures
    await expect(page.getByRole('alert')).toContainText('Live gateway could not start')
```

This is NOT a Slice 4 regression. `apps/web/playwright.config.ts` (mtime 08-12, untouched by any
Slice 4 unit) ignores only `electron/**` and `issue-0-live-mode.spec.ts`. The spec and its dedicated
`invalid-live-playwright.config.ts` were both created 08-14 15:43 during Slice 2. The dedicated
config supplies the invalid-live env; under the default config the app boots in fixture mode, so no
fatal alert renders and the assertion fails. `test:fixture` passes because it invokes the dedicated
config explicitly.

Consequence worth stating plainly: earlier verification passes that reported a green `npm test` did
not actually have one. The suite has carried this failure since 08-14 15:43. Unit 2b-repair-2 is
authorized to add `**/invalid-live.spec.ts` to the default config's `testIgnore`, alongside the
existing `issue-0-live-mode.spec.ts` precedent, since the spec is fully covered by `test:fixture`
via its dedicated config. The spec's own content stays frozen.

### 2026-08-15 Slice 4 Unit 2b-repair-2 — repair cap reached, c4–c9 remain RED

Files changed in this unit:

- `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts`: raised harness patience only;
  assertions, ordering, wording, and all c4–c9 steps remain unchanged.
- `apps/web/playwright.config.ts`: added `**/invalid-live.spec.ts` to the default-config ignore list;
  the dedicated invalid-live spec/config remain unchanged.
- `docs/ai/contracts/engine-session-live-lifecycle.json`: retained honest failing c4–c9 statuses and
  updated reasons with this run's evidence.

Wait changes and measurements:

- Create response: `4_000` → `60_000` ms. Prior measured cold API create was 22.836977s, versus
  direct engine create 0.150666s, warm API 6.680577s, and hot API 1.894534s.
- Per-test budget: `180_000` → `300_000` ms, allowing the 60s create window plus staged provider
  streaming, reload, delete, and cleanup without reducing any assertion.
- Cleanup request context and individual cleanup DELETE/PATCH calls: `10_000` → `60_000` ms. The
  pre-edit baseline measured the cleanup profile PATCH exceeding 10s; after supervised respawn,
  `/config` later required 18.902519s and 31.863889s, and API auth required 13.532493s and
  11.289710s.

Impact results before edits:

```text
useFixtures       CRITICAL  impacted=37 direct=34 processes=1 modules=5
                  process: PlannerPage → QueryParams
FixtureProvider   LOW       impacted=1 direct=1
SessionRail       LOW       impacted=3 direct=1
pausedLiveSpecs   LOW       impacted=0 direct=0
```

`useFixtures`, `FixtureProvider`, and `SessionRail` were not edited in this unit.

Pre-edit contract baseline:

```text
Running 1 test using 1 worker
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
engine-session-live-lifecycle-c9 secondary cleanup error: apiRequestContext.patch: Timeout 10000ms exceeded.
TimeoutError: page.waitForResponse: Timeout 4000ms exceeded while waiting for event "response"
1 failed
```

Focused repair loop 1:

```text
Running 1 test using 1 worker
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
engine-session-live-lifecycle-c9 secondary cleanup error: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:4097
TimeoutError: page.waitForResponse: Timeout 60000ms exceeded while waiting for event "response"
1 failed
```

Between loops, readiness converged without restarting the sandbox:

```text
ENGINE_CONFIG HTTP=200 TIME=18.902519
API_AUTH HTTP=200 TIME=13.532493
model=omlx/gpt-oss-20b-MXFP4-Q8
lmstudio auth absent
```

Focused repair loop 2 (final allowed loop):

```text
Running 1 test using 1 worker
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
engine-session-live-lifecycle-c9 secondary cleanup error: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:4097
TimeoutError: page.waitForResponse: Timeout 60000ms exceeded while waiting for event "response"
1 failed
```

c5–c8 were not reached. No criterion was changed to pass. The two-loop stop condition was reached,
so the remaining required commands, checksum/provenance reconciliation, parity regeneration, and
GREEN evidence heading were not run or claimed. The default-config `npm test` count after the
authorized ignore change is therefore not yet verified.

Final safety read-back (sandbox was not restarted):

```text
api :4098 listener: 98629
engine :4097 listener: 4412
gateway :4099 listener: 98629
ENGINE_CONFIG HTTP=200 TIME=31.863889
API_AUTH HTTP=200 TIME=11.289710
FINAL_AGENT={"model":"omlx/gpt-oss-20b-MXFP4-Q8"}
FINAL_AUTH={"providers":["openrouter","anthropic","openai","google","ollama-planner","ollama-executor","opencode"],"ready":true}
```

### 2026-08-15 Orchestrator diagnosis — c4 is blocked by an auth-watcher feedback loop

Unit 2b-repair-2 applied both authorizations correctly (create wait 4s → 60s, test budget 180s →
300s, cleanup timeouts 10s → 60s, `**/invalid-live.spec.ts` added to the default `testIgnore`) with
the assertion count unchanged at 37 and all six c4–c9 steps intact. It still failed, so after three
consecutive BLOCKED implementation attempts the orchestrator stopped dispatching and diagnosed.

**The UI is not the problem.** Playwright trace extraction proves the browser issues the request:

```text
"method":"POST","url":"http://127.0.0.1:4098/agent-sessions"     status=-1 (never completed)
"method":"GET","url":"http://127.0.0.1:4098/agent-sessions?scope=chats"
```

**The API server log gives the mechanism** (`$SB/api_server.log`, repeated across runs):

```text
[AgentSessionsController] session fd92d276-b736-43fa-9250-f8a36b0188a3 created unscoped
[AuthCredentialWatcher] .../auth.json changed — bouncing engine to reload credentials
[OpencodeClientService] reloadCredentials: bouncing engine to pick up changed auth.json
[WARN] [OpencodeClientService] dispose() called — status was reloading
[ERROR] Handled BAD_REQUEST POST /agent-sessions — Failed to create Opencode session — check your
        AI account is authorized
```

Root cause: creating an engine session against the lmstudio provider causes the ENGINE to write
`auth.json`. `AuthCredentialWatcher` observes that write and bounces the engine — destroying the
in-flight create that triggered the write. The local Rhythm session row is created first, so the
failure lands after partial success. This is a self-inflicted loop: the create causes the write, the
write causes the bounce, the bounce kills the create.

`apps/api_server/src/server.ts:733` already recognises this class of problem for boot — "server-owned
writes belong to this initialization pass and must not bounce the engine that was just spawned" — but
the suppression covers only the boot window. At runtime any write bounces, and
`auth_credential_watcher.ts` exposes no disable flag or self-write suppression.

Why no earlier slice hit it: Slice 0 exercised the deterministic provider without creating engine
sessions, and Slice 3's task lifecycle never reaches the engine. Slice 4 is the first work to combine
an lmstudio credential with engine session creation.

Consequence for scope: the previously-filed follow-up (raw `SDK_ERROR` when the engine is mid-bounce)
is the same defect family, and it is now a HARD BLOCKER for Slice 4 rather than an adjacent nicety.
Slice 4 cannot pass while a session create reliably destroys its own engine.

Also repaired during this diagnosis: two disposable git worktrees leaked from failed live runs
(`smoke-53e08757`, `smoke-a6098f46`) plus their `opencode/smoke-*` branches were removed. c9 asserts
zero leaked rows/files/listeners but does NOT check git worktrees — a genuine coverage hole in the
criterion that let real leakage past a "zero leaks" report. c9 should be extended to assert worktree
cleanliness once the slice is unblocked.

### 2026-08-15 Slice 4 Unit 3 — auth-watcher bounce characterization

Scope was diagnosis only. No source, test, config, contract-status, checksum, provenance, or parity
file was edited. The already-running sandbox was not restarted, rebuilt, or torn down.

Baseline and final-state commands:

```bash
tools/dev/sandbox.sh status
sqlite3 "$SB/rhythm.db" "SELECT id,model_provider,model_id,oc_agent FROM agent_configs WHERE id='local-lean';"
curl -sS --max-time 60 http://127.0.0.1:4097/config | jq -c '.agent["local-lean"] | {model}'
jq -c '{providers:(keys),lmstudioPresent:has("lmstudio")}' "$SB/home/.local/share/opencode/auth.json"
git worktree list
git branch --list 'opencode/unit3-*' 'opencode/smoke-*'
```

Core measurement command (the script sampled auth SHA, engine health/identity, and newly appended
API-log lines every 20 ms, issued exactly one API create for the named case, and emitted only
redacted credential structure):

```bash
TOKEN="$(<"$SCRATCH/lmi-token")"
node "$SCRATCH/measure-auth-bounce.mjs" lmstudio-isolated "$TOKEN" \
  "$SCRATCH/lmi-measurement.json" true
jq '{label,started,before,events,outcome,after,contentIdentical,diff,finished}' \
  "$SCRATCH/lmi-measurement.json"

TOKEN="$(<"$SCRATCH/default-token")"
node "$SCRATCH/measure-auth-bounce.mjs" default "$TOKEN" \
  "$SCRATCH/default-measurement.json"
jq '{label,started,before,events,outcome,after,contentIdentical,diff,finished}' \
  "$SCRATCH/default-measurement.json"
```

The users and bearer sessions were seeded directly in the sandbox SQLite DB with UUID nonces. Each
create used `profileId=local-lean`, the repo root as `cwd`, a nonce name, and no browser. The
lmstudio measurement additionally used `isolateWorktree=true` and a nonce worktree name, matching
the failing advanced-create path. Setup used:

```bash
curl -sS --max-time 30 -X POST http://127.0.0.1:4098/opencode/auth/lmstudio \
  -H 'Content-Type: application/json' --data '{"apiKey":"<redacted throwaway nonce>"}'
curl -sS --max-time 60 -X PATCH http://127.0.0.1:4098/agent-configs/local-lean \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"modelProvider":"lmstudio","modelId":"qwen/qwen3-coder-30b"}'
```

Q1 — the captured create did not change credential content. Immediately before the exact isolated
lmstudio create and after the 30.586 s observation window:

```text
before sha256=1b165d09692714fe0f8027da2675bb2421d588a2089b3ed96bebb7a4e9e1c100
after  sha256=1b165d09692714fe0f8027da2675bb2421d588a2089b3ed96bebb7a4e9e1c100
contentIdentical=true
diff=[]
```

Redacted structure at both snapshots:

```text
openrouter:      {type,key}
anthropic:       {type,refresh,access,expires}
openai:          {type,refresh,access,expires}
google:          {type,refresh,access,expires}
ollama-planner:  {type,key}
ollama-executor: {type,key}
lmstudio:        {type,key}
```

No secret value was printed or retained in the run note. A non-isolated lmstudio control also
returned 201 and was byte-identical before/after (`sha256`
`26f118a1c3d8ea75e6d9de53a654f13e301323f961bcc4e34e04193c16f2ac79`). Neither create produced an
auth-write hash transition or watcher line. Therefore there is no new post-watcher snapshot in this
run: the watcher did not fire. This result does not invalidate the already-captured historical
bounce; it narrows it to a transient credential-write race rather than a deterministic write on
every settled lmstudio session create. It also means a raw content-hash no-op would correctly ignore
the measured creates, but cannot by itself explain or fix the historical event. The current watcher
already compares `authIdentityFingerprint`, which is stricter than raw mtime and ignores volatile
access/expiry rotations.

Q2 — one exact isolated lmstudio create triggered zero bounces. Ordered measured timeline (UTC):

```text
07:35:09.772Z  t+0.000s   POST /agent-sessions started
07:35:09.870Z  t+0.098s   local row logged "created unscoped"
07:35:24.165Z  t+14.393s  POST completed HTTP 201 with distinct local and SDK ids
07:35:40.237Z  t+30.466s  observation ended; same PID 21861 / bootId
                           8008413b-6ceb-4690-800c-2977eba69deb throughout
```

There was no auth write, watcher fire, dispose, restart, or unavailable interval. Bounce count was
0 and measured engine unavailability was 0 ms. The historical failing log contains exactly one
ordered watcher/reload/dispose/restart chain, not a repeating loop:

```text
session ... created unscoped
AuthCredentialWatcher ... changed — bouncing engine
reloadCredentials: bouncing engine
dispose() called — status was reloading
Handled BAD_REQUEST POST /agent-sessions
createOpencode (engine spawn) took 902ms
total _initializeImpl took 1054ms
reloadCredentials: engine restarted
```

That prior event is one-shot; its log has no wall-clock timestamps, but its internal timings bound
the dispose-to-ready outage at approximately 1.05 s. The in-flight create failed after 1.289 s. The
term “loop” is therefore misleading for the observed mechanism: it is a single self-bounce/race,
not repeated oscillation.

Q3 — the default profile did not write auth.json and did not bounce. Before and after the create:

```text
profile=local-lean model=omlx/gpt-oss-20b-MXFP4-Q8 lmstudioPresent=false
before sha256=79c1b1d8929d282cc4b321df0c0534bb2a642aae33e9b6692e652e7d68f9f4ab
after  sha256=79c1b1d8929d282cc4b321df0c0534bb2a642aae33e9b6692e652e7d68f9f4ab
contentIdentical=true diff=[]
07:32:44.492Z POST started
07:32:44.524Z local row logged (+32.5ms)
07:32:45.408Z HTTP 201 (+916.3ms)
```

There was no watcher/dispose/restart log and the engine retained PID 19616 / bootId
`25a04faa-a91e-4bb8-b8d5-a3860913553a`. One 177 ms health request missed the sampler's aggressive
200 ms timeout 7.57 s after the successful create; the same PID/bootId immediately returned, so it
was endpoint latency, not a bounce. In the settled state tested here, the defect is not general to
session creation and does not affect shipping desktop users on the default `omlx` profile.

Ranked recommendation (state only; nothing implemented):

1. **Option 2 — suppress engine-owned credential writes, with narrowly-scoped attribution. This is
   the recommended fix.** Preserve external credential-change reloads, but do not let an engine-owned
   auth normalization/restore write tear down an in-flight engine call. This directly targets the
   historical self-bounce while leaving real desktop re-auth functional. Because settled creates
   wrote nothing, attribution must cover the actual engine auth-write transaction/race rather than
   blanket-suppressing every session create.
2. **Option 3 — bounded create resilience.** Wait for readiness and retry the engine create once
   after an observed boot change, while reusing/cleaning the already-created local row. This protects
   real desktop users from any legitimate mid-flight auth bounce, but changes a broader user-facing
   controller path and must avoid duplicate SDK sessions or partial rows.
3. **Option 1 — content-hash no-op.** Low blast radius, but insufficient as the primary fix: all
   measured creates were already content-identical and already did not bounce, while the current
   `authIdentityFingerprint` comparison already provides content-based no-op behavior. It would miss
   a transient engine-owned write that genuinely changes identity-bearing fields.
4. **Option 4 — test-only disable flag.** It would unblock a harness by hiding the race, but fixes no
   shipping behavior and would reduce live-test fidelity. It should not be the product fix.

GitNexus was up to date at commit `9d8c444`; exact upstream impact results for proposed symbols:

```text
decideReload                       LOW  impacted=4 direct=2 processes=0 modules=1 (Services)
AuthCredentialWatcher.recheck      LOW  impacted=4 direct=1 processes=0 modules=1 (Services)
OpencodeClientService.reloadCredentials LOW impacted=2 direct=2 processes=0 modules=0
AgentSessionsController.create     LOW  impacted=0 direct=0 processes=0 modules=0
```

The controller result reflects the indexed call graph's route-binding limitation, not proof that
the live HTTP path has no behavioral blast radius. Option 2 has the smallest real-user blast radius;
option 3 is broader but provides defense in depth.

Cleanup/final verification commands and observed output:

```bash
curl -X DELETE "$API/agent-sessions/$LOCAL_ID/hard" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"removeWorktree":true}'
git worktree remove "$WORKTREE"                 # only if the API left it registered
git branch -d "$BRANCH"                         # only if the API left the branch
curl -X PATCH "$API/agent-configs/local-lean" ... \
  --data '{"modelProvider":"omlx","modelId":"gpt-oss-20b-MXFP4-Q8"}'
curl -X DELETE http://127.0.0.1:4097/auth/lmstudio
tools/dev/sandbox.sh status
```

```text
delete_local_http=204 delete_engine_http=404
worktree_present=no branch_present=no
users=0 authSessions=0 agentSessions=0
diagnostic_users=0 diagnostic_agent_sessions=0 diagnostic_branches=0
db_profile=local-lean|omlx|gpt-oss-20b-MXFP4-Q8|local-lean
engine_config={"model":"omlx/gpt-oss-20b-MXFP4-Q8"}
auth={"providers":["anthropic","google","ollama-executor","ollama-planner","openai","openrouter"],"lmstudioPresent":false}
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 25621
gateway :4099 listener: 98629
```

No `smoke-*` or `unit3-*` worktree/branch remains. The engine is restored to
`local-lean` / `omlx` / `gpt-oss-20b-MXFP4-Q8`, with no `lmstudio` auth entry.

### 2026-08-15 CORRECTION — the auth-watcher feedback loop was NOT the cause

Unit 3's controlled measurement refutes the orchestrator's previous diagnosis. Recording the
correction because the wrong cause was already acted on.

Measured, isolated, against this sandbox:

- **Q1** — an lmstudio session create left `auth.json` BYTE-IDENTICAL (same sha256 before/after, no
  keys or values changed). Creates do not write credentials.
- **Q2** — the isolated lmstudio create triggered ZERO bounces and returned **HTTP 201 in 14.393s**.
  No auth write, no watcher fire, no dispose, no restart through 30.466s of observation. The single
  historical bounce chain in the log was one-shot, ~1.05s of engine downtime — not a repeating loop.
- **Q3** — the default `omlx/gpt-oss-20b-MXFP4-Q8` create also returned 201 with no auth write and no
  bounce. This is NOT a general session-creation defect for default-profile desktop users.

Where the previous diagnosis went wrong: `$SB/api_server.log` accumulates across many runs, and the
orchestrator read a `session created` line, a later `auth.json changed` line, and a later
`BAD_REQUEST POST /agent-sessions` line as one causal chain. They are from different runs. The
watcher writes were the TEST's own setup/cleanup credential operations, not engine-owned writes
caused by session creation. The log lines quoted earlier are real; the causation asserted between
them was not established.

What still stands: the Playwright trace evidence that the browser DOES issue `POST /agent-sessions`
and the request never completes (`status=-1`). That is unchanged and remains the live symptom.

What this means: `POST /agent-sessions` succeeds in ~14s via direct API calls but hangs past 60s on
the browser path. The divergence is therefore in the browser-path request itself, not in the engine
or the watcher. Two candidate causes, neither yet measured:

1. The UI's create payload includes `isolateWorktree` + `worktreeName`, so the API performs a real
   `git worktree add` in this repo. Concurrent git activity (other agents, worktree cleanup, index
   locks) can block that indefinitely. The two leaked `smoke-*` worktrees prove creates do reach the
   worktree stage. The direct-curl diagnostics that returned 201 may not have exercised this path.
2. `apps/web/src/gateway/index.ts:70` probes with `AbortSignal.timeout(4_000)`. A slow engine can fail
   that probe and flip the app out of live mode — consistent with the earlier observed receipt
   "Environment: Connecting · API :4098 checking · Engine :4097 checking". The create POST itself
   carries no abort signal (`gateway/sessions.ts:109`), so it is not client-aborted.

Unit 4 must measure which of these it is before any further implementation. Three implementation
attempts and one wrong root cause have now been spent guessing at this symptom.

### 2026-08-15 Slice 4 Unit 4 — browser-path create isolated

Result: neither proposed hypothesis held as stated. The exact trace payload was:

```json
{"name":"smoke-session-53e08757-c7f9-4dab-a8e4-2861c4e5bb7f","cwd":"/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite","profileId":"local-lean","isolateWorktree":true,"worktreeName":"smoke-53e08757"}
```

H1 exact replay did not hang. With zero smoke worktrees/branches, zero `.git/*.lock`, and no git
worktree process, curl returned:

```text
H1 curl status=201 total=2.997513s starttransfer=2.997459s
H1 curl exit=0
cleanup rows users=0 sessions=0 agent_sessions=0
cleanup worktree=smoke-u497986c2a branches=0
```

A mounted Chromium replay with the live app, WebSocket, hydration, and exact payload also succeeded:

```text
receipt=Environment: Live · API :4098 healthy · Engine :4097 healthy
browser response observed=2026-08-15T07:49:06.293Z status=201
browser exact status=201 total=1.581s
browser cleanup users=0 sessions=0 agent_sessions=0 branches=0
```

H2 did not hold. The failing trace itself recorded the engine probe twice at 200 in 5.897ms and
3.683ms, followed by API/engine probes at 200 in 6.606ms and 7.428ms; the receipt was `Live` before
click. Five current direct samples per endpoint were 0.000803–0.002578s. `gateway.mode` is fixed at
construction; probe failure changes only the receipt state.

What actually happened: in both lifecycle runs the API stayed inside
`await opencodeClient.createWorktree(...)` until after the old 60s browser wait. Repair loop 1 issued
the POST at `07:51:10.210Z`; the controller inserted the post-worktree session row at
`07:52:11.361Z`, a measured 61.151s. Cleanup then started, removed the test credential, and the
subsequent 338ms engine session create lost its engine. The engine's worktree implementation shows
the synchronous setup is `git worktree add --no-checkout -b`; checkout/bootstrap is forked later.
No lock/process was captured, so this establishes the stalled stage but not a persistent git lock.

Minimal fix: add preflight removal of only leaked `opencode/smoke-*` worktrees/branches, raise only
the create response observation window from 60s to 90s based on the 61.151s measurement, and retry
the existing `/config` read across the supervised cleanup respawn. Product API/store behavior was
not changed. The 37 literal assertions, their text/order, and c4–c9 markers are unchanged.

GitNexus impact output:

```text
useFixtures: CRITICAL, impacted=37, direct=34, processes=1, modules=5
FixtureProvider: LOW, impacted=1, direct=1
SessionRail: LOW, impacted=3, direct=1
live-spec helpers/test callback: UNKNOWN, impacted=0 (apps/web is untracked and absent from index)
```

Focused repair outputs:

```text
# loop 1
TimeoutError: page.waitForResponse: Timeout 60000ms exceeded
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}

# loop 2
Error: c5 provider must receive one real engine request
Expected: 1
Received: 0
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":1,"listeners":0}
1 failed
```

The final loop genuinely passed every c4 assertion and advanced to c5, so only c4 was flipped to
`pass`; c5–c9 remain `failing`. The two-repair-loop stop condition then fired. The green-only full
command matrix, SHA256SUMS/PROVENANCE reconciliation, and desktop parity generation were not run.

Final cleanup/state output:

```text
remaining smoke agent sessions:
remaining smoke users:
remaining smoke worktrees/branches:
disposable listeners:
engine model="omlx/gpt-oss-20b-MXFP4-Q8"
auth={"lmstudio":false,"providers":["anthropic","google","ollama-executor","ollama-planner","openai","openrouter"]}
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
api :4098 listener: 98629
engine :4097 listener: 43378
gateway :4099 listener: 98629
assertions=37
```

### 2026-08-15 Slice 4 Unit 5 — c5–c9

Result: stopped after two focused c5 repair loops. c4 continued to pass; c5 still fails; c6–c8 were
not reached; c9 now passes on the failure path. No existing c4–c9 assertion was softened, removed,
reordered, or reworded; the contract remains at 37 assertions and all six criterion steps remain.

Routing measurement immediately after create:

```text
apiSession profileId=local-lean agentKind=local-lean opencodeAgentId=local-lean providerId=null modelId=null
engineAgent=local-lean engineAgentModel=lmstudio/qwen/qwen3-coder-30b
engine session GET=200 id=ses_ffb88b051ffeSaZrsJfbVXxme9 cwd=.../smoke-1958d245
```

This ruled out the proposed wrong-model hypothesis. The first transport capture instead showed
`sent=[]`, `received=[]`, and engine messages `200 []`. Chromium had rejected the socket because
`connect-src` allowed only HTTP `:4098/:4097`, while the typed gateway opens
`ws://127.0.0.1:4098/ws/agents`.

GitNexus impact results before edits:

```text
useFixtures: CRITICAL, impacted=37, direct=34, processes=1, modules=5
FixtureProvider: LOW, impacted=1, direct=1
sendLiveInput/createLiveSessionsGateway/live-spec helpers: UNKNOWN (individual nested/untracked symbols not found)
```

The CRITICAL boundary was extended additively only: no `useFixtures` signature, field, or meaning was
removed or renamed. Repair 1 added only the exact loopback WS origin to CSP and forced removal of the
nonce worktree/branch before c9 counts. The focused CSP suite passed:

```text
Running 7 tests using 1 worker
7 passed (2.8s)
```

Repair 1 live result:

```text
sent=[{"v":1,"type":"session.input","id":"c7147bbe-5ddc-4c80-b6f3-ee24b1345c5d","data":"nonce prompt 174975b5-2475-4d53-b494-8a2b51a36ee0"}]
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
Error: c5 provider must receive one real engine request
Expected: 1
Received: 0
1 failed
```

The sent frame plus API `session.updated` for the same local id proved gateway acceptance. API logs
then resolved `routing turn to lmstudio/qwen/qwen3-coder-30b`, but the provider still saw no request.

Repair 2 supplied the selected live profile through the existing WS `modelOverride` seam. The
captured frame contained `modelOverride={providerId:lmstudio, modelId:qwen/qwen3-coder-30b}`;
subsequent API frames persisted those exact fields, transitioned the session to `working`, and engine
message GET returned one user message. The provider nevertheless remained at zero requests:

```text
engineMessageCount=1
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
Error: c5 provider must receive one real engine request
Expected: 1
Received: 0
1 failed
```

Commands run before the stop:

```text
cd apps/web && npm run typecheck
> tsc -b
exit 0 (run before each live repair)

cd apps/web && npx playwright test tests/gateway/gateway.spec.ts --workers=1
7 passed (2.8s)

cd apps/web && RHYTHM_LIVE_E2E=1 ... npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
repair 1: 1 failed (c5 provider requests 0)
repair 2: 1 failed (c5 provider requests 0)
```

Because c5–c9 did not all reach green, the green-only full command matrix, SHA256SUMS/PROVENANCE
reconciliation, and desktop parity generation/validation were not run.

Final safety read-back:

```text
sandbox API :4098 listener=98629 engine :4097 listener=67692 gateway :4099 listener=98629
local-lean|omlx|gpt-oss-20b-MXFP4-Q8|local-lean
smoke agent sessions=0
smoke users=0
engine config={"model":"omlx/gpt-oss-20b-MXFP4-Q8"}
auth={"providers":["openrouter","anthropic","openai","google","ollama-planner","ollama-executor","opencode"],"lmstudioPresent":false}
smoke worktrees=0
port 1234 listeners=0
port 4175 listeners=0
assertions=37
```

### 2026-08-15 Orchestrator ruling — c5's 5s poll is the same patience defect that blocked c4

Unit 5 result: **c9 now passes** (all cleanup counts zero across both loops) and c4 did not regress.
c5 remains red. Assertions unchanged at 37; zero leaked rows, worktrees, branches, or listeners.

Two genuine defects were found and fixed by Unit 5 on the way:
1. CSP blocked `ws://127.0.0.1:4098/ws/agents`, so no prompt frame was ever sent. After adding the
   exact WS origin the nonce frame is sent and accepted.
2. With an explicit `modelOverride` the API persists `lmstudio/qwen/qwen3-coder-30b`, the session
   transitions to `working`, and the engine stores one user message.

Routing was measured and cleared as a cause: API session reported `profileId=local-lean`,
`agentKind=local-lean`, `providerId=null`, `modelId=null`, while engine config resolved
`local-lean → lmstudio/qwen/qwen3-coder-30b`. The prompt is accepted and persisted; the engine simply
does not issue a `/v1/chat/completions` request to the deterministic provider within the observed
window.

Ruling: that window is **five seconds**, and it is almost certainly the whole problem.
`apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:357` calls
`expect.poll(() => provider!.requests.length, { message: ... }).toBe(1)` with NO timeout option, so it
inherits `expect: { timeout: 5_000 }` from `apps/web/playwright.config.ts:15`. This is the identical
defect that blocked c4 for three units: in a system where `createWorktree` legitimately takes 61.151s,
allowing the engine five seconds to cold-start a model and dispatch to a provider is not a realistic
bound.

Unit 6 is authorized to raise the c5–c8 poll/wait timeouts to realistic values. This is harness
PATIENCE, not assertion strength — `.toBe(1)`, the nonce-body check, the protected-port checks, and
every c6/c7/c8 assertion stay exactly as written. If the provider still receives zero requests after a
genuinely long window, the cause is elsewhere and must be measured from the engine side rather than
patched by further waiting.
### 2026-08-15 Slice 4 Unit 6 — c5–c8

#### Scope and impact

- Changed only `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts`: the c5 provider poll now has `timeout: 120_000`. The prior inherited bound was `expect.timeout = 5_000`; the existing c4 worktree observer had already measured 61.151s on this sandbox, so five seconds was not a realistic cold engine/provider dispatch budget. Repair loop 2 proved patience was sufficient: the provider request arrived within the next 30-second reporter observation interval after the c5 transport diagnostic and every unchanged c5 assertion passed.
- The per-test budget remained 300,000ms. No c6/c7/c8 wait or assertion was changed. The file retains 40 `expect` sites (required minimum: 37).
- GitNexus file impact for `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts`: LOW, 0 direct, 0 processes, 0 modules. `freshDetail`: LOW, 1 direct file caller, 0 processes.
- c7 diagnosis exposed a locked-assertion/data-model mismatch. `AgentSessionMessage`: HIGH, 131 impacted / 17 direct. `rowToModel`: HIGH, 9 impacted / 3 direct / 1 process. `OpencodeStreamBridge.streamSession`: HIGH, 3 direct and the `create`, `resume`, and `fork` processes. No HIGH-risk product symbol was edited.

#### Repair loop 1

Command:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

Observed verbatim result:

```text
Running 1 test using 1 worker
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
TimeoutError: page.waitForResponse: Timeout 90000ms exceeded while waiting for event "response"
  1 failed
    tests/sessions/session-live-lifecycle.live.spec.ts:214:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
```

This run did not reach c5. The c4 wait was not changed because Unit 6 authorized c5–c8 patience only. A worktree finished late after cleanup began; exact disposable cleanup was then performed:

```text
Deleted branch opencode/smoke-69dbf7d0 (was 9d8c4443).
```

The post-cleanup worktree/branch checks returned no matches.

#### Repair loop 2

Same command as repair loop 1.

Observed routing/transport evidence (verbatim key lines):

```text
engine-session-live-lifecycle-c5 routing after create={"apiSession":{"profileId":"local-lean","agentKind":"local-lean","opencodeAgentId":"local-lean","providerId":null,"modelId":null},"engineAgent":"local-lean","engineAgentModel":"lmstudio/qwen/qwen3-coder-30b","engineSession":{"id":"ses_ffb7350eaffeWvan704T7mzcOq","slug":"nimble-orchid","projectID":"a4784d9c54aa2929a09fdab2213ff827a3cb60a5","directory":"/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/home/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/smoke-886094e9","path":"","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"title":"smoke-session-886094e9-56d9-401d-a6bc-b6eac1c639a8","version":"0.0.0-codex/react-electron-live-suite-202608150543","time":{"created":1786782723861,"updated":1786782723861}}}
engine-session-live-lifecycle-c5 transport={"sent":["{\"v\":1,\"type\":\"session.input\",\"id\":\"b516cf59-4af3-4634-a378-3aab23006124\",\"data\":\"nonce prompt 886094e9-56d9-401d-a6bc-b6eac1c639a8\",\"modelOverride\":{\"providerId\":\"lmstudio\",\"modelId\":\"qwen/qwen3-coder-30b\"}}"],"receivedFrameCount":56,"apiEvents":["GET /agent-sessions 200","GET /agent-sessions 200","GET /agent-sessions/4df1668f-7e55-48ec-862a-5f325fafe4d7 404","POST /agent-sessions 201"],"engineMessagesStatus":200,"engineMessageCount":1}
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
Error: c7 assistant text must exist in agent_session_messages
Expected: > 0
Received:   0
  1 failed
    tests/sessions/session-live-lifecycle.live.spec.ts:214:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
```

c4, c5, and c6 passed and execution entered c7. Within c7, the fresh detail GET returned the same local ID and full assistant output, and the rail/transcript rehydrated after reload. The final unchanged DB assertion failed, so c8 was not reached.

#### c7 engine/database measurement and stop

Command and verbatim output:

```bash
sqlite3 /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  "SELECT role, COUNT(*) FROM agent_session_messages GROUP BY role ORDER BY role;"
```

```text
input|8319
output|47951
system|667
```

The bridge maps engine role `assistant` to canonical DB role `output`; `AgentSessionMessage.role` is typed as `output | input | system`. The locked c7 assertion queries `role = 'assistant'`, so additional waiting cannot satisfy it. Changing persistence semantics is HIGH risk and outside a wait-only repair, and the already-running sandbox may not be rebuilt/restarted. Failure-triage classification: recon/contract mismatch; no assertion was weakened and no product workaround was added. The third focused loop was not spent on a knowingly impossible retry.

#### Final safety state

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
api :4098 listener: 98629
engine :4097 listener: 91938
gateway :4099 listener: 98629
local-lean: omlx/gpt-oss-20b-MXFP4-Q8
lmstudio auth: absent
opencode/smoke-* worktrees: 0
opencode/smoke-* branches: 0
provider :1234 listeners: 0
Vite :4175 listeners: 0
```

Full green-only verification, provenance/SHA reconciliation, and parity generation were not run because c7 remained red and c8 was not reached.

### 2026-08-15 Orchestrator ruling — c7's DB predicate is mis-specified, not the product

**c5 and c6 now PASS.** c5 went green by raising ONLY its provider poll from the inherited 5s to
120s — confirming the orchestrator's ruling that this suite was written with fast-system assumptions.
c6 passed unchanged. c9 still passes with zero leaks. Contract: c1–c6, c9, c10, c11 pass; c7, c8 open.

c7 blocks on its final assertion, `session-live-lifecycle.live.spec.ts:390`:

```sql
SELECT COUNT(*) FROM agent_session_messages WHERE session_id = ? AND role = 'assistant'
```

Measured role distribution in the sandbox DB:

```text
input|8319
output|47951
system|667
```

Verified independently by the orchestrator: `apps/api_server/src/models/agent_session.ts:157` types
the canonical persisted role as `'output' | 'input' | 'system'`. `'assistant'` is the ENGINE's role
name; the bridge deliberately maps engine `assistant` → canonical `output`. The c7 predicate therefore
cannot match any row, no matter how long the test waits or how correct the product is.

Note c7's OTHER assertions already pass: the fresh detail GET returns the same local ID and the full
assistant output (line 386), and the transcript rehydrates after reload (line 388). The criterion's
intent — assistant text persisted in `agent_session_messages` and rehydrated from persistence rather
than retained WS state — is already demonstrated. Only the role literal is wrong.

Ruling: Unit 7 is authorized to change that literal from `'assistant'` to `'output'`. This is a
correction of a factually incorrect predicate, NOT a weakening: the assertion keeps its
`.toBeGreaterThan(0)` strength and stays scoped to the session's `localId`. Nothing else in c7 changes.

The alternative the child correctly refused — migrating persisted role semantics so `'assistant'` is
stored literally — carries `AgentSessionMessage` impact of **131 impacted / 17 direct**, requires a
sandbox rebuild, and delivers zero user benefit. Rejected. The child was right to stop and ask rather
than spend its last loop on a knowingly impossible retry, and right to refuse to weaken the assertion
on its own authority.

### 2026-08-15 Slice 4 Unit 7 — c7, c8, and full verification

#### c7 predicate correction and impact

Changed exactly one executable-contract literal in
`apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:390`: the localId-scoped persisted-row
predicate now queries canonical role `'output'` instead of engine role `'assistant'`. The SQL shape,
session scope, message table, and `.toBeGreaterThan(0)` assertion are unchanged. The file retains
exactly 37 `expect(` sites and all c4–c9 lifecycle stages.

The local GitNexus CLI could not resolve the anonymous Playwright `test(...)` callback as a named
symbol. Its exact targeted result was:

```text
{
  "error": "Target 'engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session' not found",
  "target": {
    "name": "engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session"
  },
  "direction": "upstream",
  "impactedCount": 0,
  "risk": "UNKNOWN"
}
```

This unit did not edit a production function, class, or method. In particular, HIGH-impact
`useFixtures` (37 impacted / 34 direct callers) was not edited. The rejected persistence migration
remained rejected.

#### Focused live c7/c8 carry

Both focused attempts used:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

Loop 1 failed before c7/c8 at c4's unchanged 90-second create observer. Verbatim result:

```text
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
TimeoutError: page.waitForResponse: Timeout 90000ms exceeded while waiting for event "response"
  1 failed
    tests/sessions/session-live-lifecycle.live.spec.ts:214:1 › engine-session-live-lifecycle-c4-c9: real UI creates, streams, reloads, and hard-deletes a nonce session
```

The late POST briefly produced `opencode/smoke-5a642264` after cleanup had already run. The next
exact invocation's existing stale-smoke preflight removed it. Sandbox health was 200/healthy,
`local-lean` had already restored to `omlx/gpt-oss-20b-MXFP4-Q8`, and `lmstudio` auth was absent.
Failure-triage classified this as existing c4 environment/timing flake; no code or timeout changed.

Loop 2 passed the complete journey. Verbatim key output:

```text
engine-session-live-lifecycle-c5 routing after create={"apiSession":{"profileId":"local-lean","agentKind":"local-lean","opencodeAgentId":"local-lean","providerId":null,"modelId":null},"engineAgent":"local-lean","engineAgentModel":"lmstudio/qwen/qwen3-coder-30b","engineSession":{"id":"ses_ffb656d7dffeXDCo7Aum38E1gv","slug":"swift-circuit","projectID":"a4784d9c54aa2929a09fdab2213ff827a3cb60a5","directory":"/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/home/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/smoke-e460a4a6","path":"","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"title":"smoke-session-e460a4a6-940c-4123-abe0-1507a9ca2b04","version":"0.0.0-codex/react-electron-live-suite-202608150543","time":{"created":1786783634050,"updated":1786783634050}}}
engine-session-live-lifecycle-c5 transport={"receivedFrameCount":56,"apiEvents":["GET /agent-sessions 200","GET /agent-sessions 200","GET /agent-sessions/4df1668f-7e55-48ec-862a-5f325fafe4d7 404","POST /agent-sessions 201"],"engineMessagesStatus":200,"engineMessageCount":1}
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
  1 passed (3.2m)
```

c7 therefore passed its unchanged fresh-detail same-local-ID, full-output, rail, transcript, and
direct persisted-row assertions. c8 required no repair or extended wait: the same passing step asserts
`DELETE /agent-sessions/:localId/hard` returned 204, rail absence survived reload, local lookup
returned 404, and the SDK/engine lookup returned 404.

#### Full verification matrix

All commands ran in the requested order against branch `codex/react-electron-live-suite`, commit
`9d8c4443f076756cec919e182222fdb45c39abcc`.

1. `tools/dev/sandbox.sh status`

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 4840
gateway :4099 listener: 98629
```

2. `cd apps/web && npm run typecheck`

```text
> rhythm-desktop-agents@1.0.0 typecheck
> tsc -b
```

Exit 0.

3. `cd apps/web && npm run build`

```text
> rhythm-desktop-agents@1.0.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming...
✓ 1630 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.84 kB │ gzip:   0.47 kB
dist/assets/index-D57FhDJJ.css  257.29 kB │ gzip:  35.51 kB
dist/assets/index-JGMCKJ5B.js   724.67 kB │ gzip: 180.16 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.08s
```

4. `cd apps/web && npm run test:fixture`

```text
> rhythm-desktop-agents@1.0.0 test:fixture
> playwright test tests/gateway/gateway.spec.ts tests/gateway/receipt.spec.ts tests/gateway/tasks-gateway.spec.ts tests/gateway/sessions-gateway.spec.ts --workers=1 && playwright test --config tests/gateway/invalid-live-playwright.config.ts

Running 14 tests using 1 worker
  14 passed (1.8s)
Running 1 test using 1 worker
  1 passed (1.6s)
```

Counts: 15 passed, 0 failed.

5. `cd apps/web && npm run test:list`

```text
> rhythm-desktop-agents@1.0.0 test:list
> playwright test --list
Total: 258 tests in 40 files
```

6. `cd apps/web && npm test`

```text
> rhythm-desktop-agents@1.0.0 test
> npm run build && playwright test
✓ 1630 modules transformed.
✓ built in 1.12s
Running 258 tests using 1 worker
  4 skipped
  254 passed (5.0m)
```

Counts: 254 passed, 4 skipped, **0 failed**, 258 total.

7. `cd apps/web && npm run test:dist-smoke`

```text
> rhythm-desktop-agents@1.0.0 test:dist-smoke
> node tests/dist-smoke.mjs

dist smoke passed: index and 2 relative assets verified
```

8. `cd apps/web && npx playwright test tests/gateway/sessions-gateway.spec.ts --workers=1`

```text
Running 4 tests using 1 worker
[1/4] tests/gateway/sessions-gateway.spec.ts:13:1 › engine-session-live-lifecycle-c1: typed gateway keeps local and SDK session identities separate
[2/4] tests/gateway/sessions-gateway.spec.ts:21:1 › engine-session-live-lifecycle-c2: fixture sessions gateway is network-free and live never falls back
[3/4] tests/gateway/sessions-gateway.spec.ts:32:1 › engine-session-live-lifecycle-c3: hydration boundary consumes structured API and WS payloads
[4/4] tests/gateway/sessions-gateway.spec.ts:40:1 › engine-session-live-lifecycle-c10: live failures are bounded and redact response secrets
  4 passed (1.8s)
```

9. Final live command:

```bash
cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db \
  npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1
```

```text
Running 1 test using 1 worker
engine-session-live-lifecycle-c5 routing after create={"apiSession":{"profileId":"local-lean","agentKind":"local-lean","opencodeAgentId":"local-lean","providerId":null,"modelId":null},"engineAgent":"local-lean","engineAgentModel":"lmstudio/qwen/qwen3-coder-30b","engineSession":{"id":"ses_ffb5c5738ffe7W8tt9oupz5q4Q","slug":"jolly-wizard","projectID":"a4784d9c54aa2929a09fdab2213ff827a3cb60a5","directory":"/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/home/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/smoke-bf804194","path":"","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"title":"smoke-session-bf804194-3fa6-43a7-8ebb-7a53968fb1cf","version":"0.0.0-codex/react-electron-live-suite-202608150543","time":{"created":1786784229576,"updated":1786784229576}}}
engine-session-live-lifecycle-c5 transport={"receivedFrameCount":52,"apiEvents":["GET /agent-sessions 200","GET /agent-sessions 200","GET /agent-sessions/4df1668f-7e55-48ec-862a-5f325fafe4d7 404","POST /agent-sessions 201"],"engineMessagesStatus":200,"engineMessageCount":1}
engine-session-live-lifecycle-c9 cleanup counts={"users":0,"authSessions":0,"agentSessions":0,"messages":0,"tasks":0,"artifacts":0,"files":0,"listeners":0}
  1 passed (3.0m)
```

The final live run passed c4, c5, c6, c7, c8, and c9 together; no criterion regressed.

#### Provenance reconciliation

The pre-reconciliation check retained 144 paths and identified exactly six changed imported paths:

```text
index.html: FAILED
package.json: FAILED
playwright.config.ts: FAILED
src/components/Composer.tsx: FAILED
src/components/SessionRail.tsx: FAILED
src/store.tsx: FAILED
shasum: WARNING: 6 computed checksums did NOT match
```

Only those six hashes were updated. `PROVENANCE.md` records their prior and current hashes and
preserves every historical root, including prior root
`1239de54c04c1bad045527e044e680a22c53fabc773f51b6f56cf4fb8d922b49`.

```text
verified=144/144
entries=     144
7658590d08574a47c515a761c89b43aa19b7590a3e8ea674685b3126c402153e  SHA256SUMS
```

New reconciled root:
`7658590d08574a47c515a761c89b43aa19b7590a3e8ea674685b3126c402153e`.
The same root is recorded in `docs/ai/contracts/engine-session-live-lifecycle.json`.

#### Desktop parity regeneration and validation

Commands:

```bash
node tools/validation/generate-desktop-parity-matrix.mjs
node tools/validation/validate-desktop-parity-matrix.mjs
node --test tools/validation/test/desktop-parity-matrix.test.mjs
```

Verbatim output:

```text
sources=10869 mappings=10869 behaviors=17 review_required=689
sha256=0740fef17f5640ee8767c55b1ca5adf1644d851913d33359760765b1d68a3810
limitations=Counts are unique records only; surfaces overlap by design and are not summed as a census.
sources=10869 mappings=10869 behaviors=17 review_required=689 errors=0
TAP version 13
ok 1 - Slice 6 coverage matrix artifacts and validator are published
ok 2 - validator accepts a complete matrix
ok 3 - validator catches duplicate, unknown, missing, invalid, rationale, and Terminal failures
ok 4 - generator is deterministic across two scans
ok 5 - fresh scan byte-matches the published hermetic corpus
ok 6 - published matrix validates and rejects malformed CSV completion
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1105.572208
```

#### GitNexus detect_changes and final safety state

Command:

```bash
node .gitnexus/run.cjs detect_changes --scope compare --base-ref main \
  --repo /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite
```

Verbatim result:

```text
Changes: 14 files, 43 symbols
Affected processes: 4
Risk level: medium

Affected execution flows:
  • Update → GetDb (4 steps) — changed: findById, findByIdAsync
  • Update → TaskSelectForUser (4 steps) — changed: findById, taskSelectForUser, findByIdAsync
  • Update → AppError (4 steps) — changed: findByIdAsync
  • Update → GetPostgresPool (4 steps) — changed: findByIdAsync
```

The compare-to-main result includes pre-existing unrelated dirty-worktree API/docs changes. This unit
edited no symbol-bearing production file and introduced no HIGH/CRITICAL warning.

Final exact checks:

```text
branch=codex/react-electron-live-suite
commit=9d8c4443f076756cec919e182222fdb45c39abcc
assertion_sites=37
criteria_pass=11/11
smoke_worktrees=0
smoke_branches=0
port_1234_listeners=0
port_4175_listeners=0
local_lean=local-lean|omlx|gpt-oss-20b-MXFP4-Q8
lmstudio_auth=absent
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
api :4098 listener: 98629
engine :4097 listener: 8233
gateway :4099 listener: 98629
```

### 2026-08-15 Slice 4 VERIFICATION GATE — PASS (orchestrator-run, independent of child claims)

Every check below was re-run by the orchestrator against the live sandbox, not accepted from Unit 7.

```text
npm run typecheck                  exit 0
npm test                           254 passed, 4 skipped, 0 failed (5.1m), exit 0
npm run test:list                  Total: 258 tests in 40 files
npm run test:fixture               14 passed + dedicated invalid-live 1 passed
npm run test:dist-smoke            dist smoke passed: index and 2 relative assets verified
playwright sessions-gateway.spec   4 passed (1.7s)
live session-live-lifecycle        1 passed (3.7m)
shasum -a 256 -c SHA256SUMS        144/144 OK, 144 entries
node --test tools/validation/test  6/6 pass
contract criteria                  11/11 pass
assertion sites                    37, all six c4–c9 steps present
smoke worktrees / branches         0 / 0
```

The independent live run's own telemetry confirms real end-to-end behavior, not a mocked path:

```text
apiEvents: ["GET /agent-sessions 200","GET /agent-sessions 200",
            "GET /agent-sessions/4df1668f... 404","POST /agent-sessions 201"]
engineAgentModel: lmstudio/qwen/qwen3-coder-30b
engineSession.id: ses_ffa2e7fe1ffey88w8duysxUK9S   (distinct from local id 6b84e11e-...)
worktreePath: .../worktree/a4784d9c.../smoke-4a38618a   worktreeBranch: opencode/smoke-4a38618a
status transitions observed: starting → working
receivedFrameCount: 60   engineMessageCount: 1
c9 cleanup counts: users/authSessions/agentSessions/messages/tasks/artifacts/files/listeners all 0
```

Provenance: new root `7658590d08574a47c515a761c89b43aa19b7590a3e8ea674685b3126c402153e`, recorded in
both `apps/web/PROVENANCE.md` and the contract JSON, with the prior root
`1239de54c04c1bad045527e044e680a22c53fabc773f51b6f56cf4fb8d922b49` preserved in the chain (36 distinct
roots retained). Parity: 10,869 mappings, 17 behaviors, validator 6/6.

`test:list` moved 259/41 → 258/40. That is exactly the authorized `**/invalid-live.spec.ts`
`testIgnore` addition removing one spec file from the default run; it remains covered by
`test:fixture` through its dedicated config. Not a lost test.

**Finding — parity hermetic check is contaminated by Playwright artifacts.** The orchestrator first
measured 5/6, with `fresh scan byte-matches the published hermetic corpus` failing. Cause was
self-inflicted: `apps/web/test-results/**` is written by any Playwright run and is NOT in the
generator's `excluded` set (`tools/validation/generate-desktop-parity-matrix.mjs:19`), so the scan
picked up live-run artifacts. After `rm -rf apps/web/test-results` the suite is 6/6. Unit 7's 6/6
claim was therefore accurate and made against a clean tree.

This must be fixed before Slice 8, which runs live and parity checks in the same pass and would fail
spuriously depending on execution order. Filed as the next unit.

**Slice 4 is COMPLETE and verified.** Nothing is committed; all work remains uncommitted on
`codex/react-electron-live-suite` pending AJ's review.

### 2026-08-15 Parity hermetic-scan determinism fix (orchestrator-applied)

The dispatched Codex unit for this fix hung: ~40 minutes with zero file changes on disk and the
exclusion never applied (`generate-desktop-parity-matrix.mjs:19` unchanged), while the process stayed
alive. This matches the known Codex zombie pattern — detectable by mtimes, not by the process being
gone. It was killed and the one-line fix applied directly rather than spending another dispatch.

Change (`tools/validation/generate-desktop-parity-matrix.mjs:19`), extending the existing exclusion
set rather than adding a new mechanism:

```js
// test-results/playwright-report are written by any Playwright run and would otherwise make the
// hermetic-corpus check order-dependent; .agent-stack holds postmortems written mid-verification.
const excluded = new Set([..., 'test-results', 'playwright-report', '.agent-stack']);
```

This follows the precedent already in the generator at line 98, which excludes `docs/ai/runs/` and
`docs/ai/project-state.md` as mutable run evidence.

Proof of determinism — the entire point of the fix:

```text
clean tree                                        6 pass, 0 fail
contaminated (apps/web/test-results + playwright-report + .agent-stack/postmortems/zz-probe.json)
                                                  6 pass, 0 fail
cleaned again                                     6 pass, 0 fail
```

Before the fix the same contamination produced 5/6 (`fresh scan byte-matches the published hermetic
corpus` failing), which is what made Slice 4's verification briefly look red.

Corpus regenerated after the change (required, since excluding `.agent-stack` and editing a scanned
tools file both alter the scan):

```text
sources=10863 mappings=10863 behaviors=17 review_required=689
sha256=026ecb5b3934d4c2c2e27d777059b0cb612ab5bf846f8a1c0fd68688589f4011
```

Mapping count moved 10,869 → 10,863. The delta of 6 is fully accounted for: 6 of the 119 scannable
`.agent-stack` files previously matched the manual/declaration patterns and produced mappings.
`behaviors=17` and `review_required=689` are unchanged, so no behavior coverage was lost.

`tools/validation/**` is not covered by `apps/web/SHA256SUMS` (144 apps/web entries), so no provenance
reconciliation applies to this change — confirmed, not assumed.

Slice 8 can now run the live suite and the parity check in the same pass without order-dependent
failures.
