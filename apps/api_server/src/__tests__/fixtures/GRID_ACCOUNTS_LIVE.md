# SAFE LIVE G2 account proof — manager handoff, PR #1611

Scope is **only** the grid/account rows of
`docs/ai/contracts/2026-10-08-original-router-memory-dayflow-ledger.md` (read in full).
No overall router, Free Mode, Dayflow, memory, installed app, or delivery PASS follows.
All files in this slice are new test/fixture files. Existing G2/O1–O6 tests and router core
are preserved. Triage: old O1–O6 KEEP for legacy stand-in behavior; old G2 REDO-equivalent
via this new harness, **DO NOT EXECUTE**: native OAuth ignores its local baseURL and rewrites
to external Codex. It also records raw authorization. This slice does not edit that test.
No Playwright/CUA: the entry point is HTTP/WS, not a browser UI.

## Status and hard prerequisites

- Current revision syntax and scoped TypeScript check PASS; opt-ins unset: **13/13 SKIPPED**, no live proof. Prior 12/12 skip receipt below remains historical.
- Manager owns all fixture provisioning/process lifecycle/live execution. Writer did not
  inspect runtime account/auth files, contact any endpoint, launch/stop processes, run old
  tests, install, commit, push, or delete files. No cleanup APIs exist in the new harness.
- Existing manager sandbox remains API4398 / engine4397 / gateway4399 at
  `/private/tmp/sdmr-grid-sandbox`; do not run a second API or disturb that runtime.
- Initial manager run `988cf0c2` loaded BOTH guards and the OpenAI catalog, but all 12 cases
  were skipped after the overly narrow auth precondition rejected synchronized Anthropic.
  The precondition now requires OpenAI, allows only OpenAI/Anthropic entries, validates
  EVERY present entry as a matching exact synthetic OAuth token pair with finite future
  expiry, and validates OpenAI workspace (Anthropic has no workspace field). Boolean-only
  assertions prevent credential rendering. No proof/assertion was removed.
- **Current live revision NOT RUN; manager must reload the changed sources/config.**
  The already-running fixture/provider continues its old loaded source until manager reload.
  A preload cannot retrofit an already-running Node server. Manager must schedule an
  evidence-preserving integration of the wrapper/config before executing. Do not run the
  live command merely because the current sandbox is healthy.
- Generator is exclusive-create and preflights the complete write set. Existing auth,
  accounts or marker cause `GRID_EXISTING_EVIDENCE_PRESERVED`, before writes. In particular,
  an already-seeded `sdmr` auth file is a provisioning conflict, not permission to replace
  it. Manager must resolve provisioning under separate authorization while preserving it;
  this harness does not overwrite, rename, or delete existing evidence.
- Realpath HOME/TMPDIR must exactly equal `$SB/home` / `$SB/tmp`; DB must be
  `$SB/rhythm.db`, not a symlink. Synthetic public session fixture must already authenticate
  the API. No live database/auth/key/keychain input is allowed.
- API and engine must use default HOME-relative account/config paths, no account-store
  overrides. No default-plugin disabling, pure mode, ambient provider credentials,
  external plugins, network MCP commands, schedules, or business tools. Launcher already
  disables models fetch, autoupdate, project config, external skills, and online installs.
- Native router defaults/thresholds are under test. Use no custom router-grid override or
  stale cooldown from a prior run. This fixture never resets cooldown/evidence; a repeat
  run after the exhaustion case requires manager-provisioned fresh evidence scope.
- Manager must bind built API/fork source identity to final integrated PR #1611 source.

## Exact files/schema/config

`grid_sanitized_fixture.mjs` generates (without reading any auth JSON):

```
$SB/home/Library/Application Support/Rhythm/openai-accounts.json
$SB/home/Library/Application Support/Rhythm/anthropic-accounts.json
$SB/home/.local/share/opencode/auth.json
$SB/home/.syntheticgrid-approved
$FIXTURE/opencode.json
$FIXTURE/grid-node
```

Accounts schema: `{version:1, accounts:[...], defaultAccountId, routing:{}}`.
Each provider has exactly `syntheticgrid-<provider>-a` / `syntheticgrid-<provider>-b`,
labels `<provider>-a` / `<provider>-b`, access `<id>-access`, refresh `<id>-refresh`,
expiry `Date.now()+365 days`, status `ok`. OpenAI additionally has
`chatgptAccountId: <id>-workspace`; Anthropic `subscriptionType:'max'`.
Auth schema: `{openai:{type:'oauth',access,refresh,expires,accountId}}`, seeded from A.
Real API synchronization also adds `anthropic:{type:'oauth',access,refresh,expires}`
from its synthetic default; that is accepted, not evidence of real credentials.
All token values start `syntheticgrid-`; never substitute real OAuth/API credentials.

Exact generated configuration uses `enabled_providers:['openai','anthropic']`,
`model:'openai/gpt-6-luna'`, provider `openai` npm `@ai-sdk/openai`,
`options.baseURL:'http://127.0.0.1:7482/v1'`, IDs `gpt-6-luna`, `gpt-6-sol`,
`gpt-6.1-sol`, `gpt-6-astra`; each has reasoning true, tool_call false,
context128000/output4096 and explicit variants
`low:{reasoningEffort:'low'}`, `medium:{reasoningEffort:'medium'}`,
`high:{reasoningEffort:'high'}`. Requested max must clamp to genuine high.
`plugin` includes the absolute **file://** URLs to `grid_engine_transport.mjs` and the genuine
vendored `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/index.js`.
Anthropic uses npm `@ai-sdk/anthropic`, the same local `options.baseURL`, and models
`claude-sonnet-5-5` / `claude-haiku-5-5` (context128000/output32768). Their explicit variants
use `thinking:{type:'enabled',budgetTokens}`: low1024/medium8192/high16384. Capture maps
only the actual request's `thinking.type` and `thinking.budget_tokens` to effort; missing
or unrecognized thinking yields null and fails the HIGH proof. No route-derived effort.
The real fork reapplies configured provider options after native plugin auth loading, so
this explicit local baseURL must remain in the manager's integrated config. An external
Messages URL with `?beta=true` is deliberately refused, not silently rewritten.
Nonempty MCP map `grid-empty` is type local, command `[absoluteNode, absolutePathToGridEmptyMcp]`,
enabled true. Its protocol handshake/list returns zero tools, with no dependencies.
Do not add a replacement auth loader, account picker, provider hook, or chat.params hook.

## Manager-only preparation commands (not executed by writer)

From `apps/api_server`, with a new manager-approved fixture directory outside `$SB`:

```sh
SB=/private/tmp/sdmr-grid-sandbox
FIXTURE=/private/tmp/syntheticgrid-approved-1611
# Manager must create/approve FIXTURE; HOME/tmp already belong to the sandbox.
env -i HOME="$SB/home" TMPDIR="$SB/tmp" DB_PATH="$SB/rhythm.db" \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin \
  /Users/ajhochhalter/.local/bin/node src/__tests__/fixtures/grid_sanitized_fixture.mjs "$FIXTURE"
# Only after exclusive-create success:
chmod 500 "$FIXTURE/grid-node"
chmod 400 "$FIXTURE/opencode.json"
```

Wrapper content is exactly `exec '<generator process.execPath>' --require
'<absolute fixture path>/grid_api_preload.cjs' "$@"`. Manager selects
`RHYTHM_SANDBOX_NODE_BIN="$FIXTURE/grid-node"`; do not rely on ambient NODE_OPTIONS
(launcher uses env -i). Manager selects `RHYTHM_SANDBOX_OPENCODE_CONFIG="$FIXTURE/opencode.json"`
alongside its existing approved read-only DB fixture/root and unchanged SB/4398/4397/4399.
Do not run sandbox up/restart/down as part of this writer handoff; lifecycle requires manager approval.

The fake provider must be manager-held before guarded API/engine initialization:

```sh
env -i HOME="$SB/home" TMPDIR="$SB/tmp" DB_PATH="$SB/rhythm.db" \
  RHYTHM_API_BASE=http://127.0.0.1:4398 RHYTHM_OPENCODE_ENGINE_PORT=4397 \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin \
  /Users/ajhochhalter/.local/bin/node src/__tests__/fixtures/grid_fake_provider.mjs
```

Manager initializes real engine provider/plugin discovery before any session (e.g. the
existing refresh/provider-catalog flow), then checks localhost `/_grid/evidence`:
`guards` must equal `{api:true,engine:true}`. The test refuses before session creation
otherwise. Check both processes really use the planned HOME, ports, config/preload and
stores; handshakes are not attestation of process/source identity.

The transport guard installs during plugin **module evaluation**, before sessions, and
does not alter native loader/pick/body/effort code. Evidence: fork `plugin/index.ts`
152–233 initializes built-ins then external modules; `provider/provider.ts`1193–1194
loads plugins before auth loader at1354–1373; `plugin/codex.ts`454–460 resolves dynamic
global fetch after choosing bearer/workspace. Only these exact external URLs rewrite:

- `https://chatgpt.com/backend-api/codex/responses`
- `https://chatgpt.com/backend-api/wham/usage`
- `https://api.anthropic.com/v1/messages` (usage probe only)

Only the four exact synthetic access tokens are accepted; mismatched workspace, real/
unlisted credentials, other nonloopback URL, query-bearing external URL and redirects
throw. Loopback ports allow only4398/4397/4399/7482, never4001/4096.
The only provider query exception is ALREADY-local
`http://127.0.0.1:7482/v1/messages?beta=true`, with a whitelisted Anthropic synthetic
bearer; other provider queries and every query-bearing external URL remain refused.
Exception messages are constant. Capture stores only model/effort/accountLabel/turnTag/HTTPstatus;
guard evidence stores whitelisted integer counters, role, synthetic label only.
No headers, auth, prompt, system text or transcript is captured/logged. Test transcripts
are inspected in memory solely for harmless `SYNTHETICGRID_OK <turnTag>`.
This is a fetch seam, **not** an OS firewall for child processes or pre-plugin startup;
safe local MCP/offline launcher prerequisites are mandatory.

## Exact behavioral command (manager only)

```sh
env -i HOME=/private/tmp/sdmr-grid-sandbox/home \
  TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp \
  DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin \
  RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_GRID_ACCOUNTS=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4398 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4397 \
  /Users/ajhochhalter/.local/bin/node node_modules/vitest/vitest.mjs run \
  src/__tests__/router_grid_accounts_live_e2e.test.ts --no-file-parallelism
```

Expected proof: four tiers native model+effort+account at provider and matching session/
ledger trace, followup identical triple and exactly one classification; higher quota
wins; first-turn pin and same-ID automatic-to-pin survive reversal; malformed classifier
falls back to rules; unknown quota remains eligible; no route/headroom records none;
security-sensitive/no-route never contacts OpenRouter (unauthenticated OpenRouter in this
fixture; authenticated OpenRouter privacy precedence is not qualified here); native429 retry evidence and next-turn saved-classification
reroute. Capacity is intentionally ON to detect interference. Append-only evidence and
all sessions/profiles/temp dirs are retained; only the test-owned WS client closes.

The final cross-provider case now drives the real WS/API/engine/native account plugin.
Both OpenAI accounts have positive fresh usage evidence of zero headroom; Anthropic A/B
have known headroom, B highest. Tier2 must skip Sol and emit native Sonnet/HIGH on B,
matching provider capture, persisted session and ledger/trace. Follow-up repeats all
three and leaves exactly one classifier capture and one decision row. Fake Messages
stream emits message_start, content_block_start/delta/stop, message_delta, message_stop.
OpenAI Responses/native OAuth flow is unchanged. This replaces the explicit unverified
assertion with real behavioral assertions; it is still **NOT RUN**, not a PASS.

Separate explicit-pin/native429 case: pin B through the real session PATCH, prove first
turn, then make B actually return HTTP429. Every native attempt must stay B and the
session/ledger/classification must remain pinned. An output timeout is accepted ONLY
after the session becomes idle/error, observing a genuine B429, and proving no other
account request was captured. A still-running retry times out/fails the gate; native
retry must not silently switch A. Known preexisting native OAuth fallback may violate
this: report that assertion failure separately as a production/fork pin defect. Do not
change production/fork, the native chooser, or substitute manual spillover intake as proof.
The older manual-intake same-ID pin test remains and is not native429 coverage.

## Checks executed by writer

All commands from `apps/api_server`, clean env only HOME/TMPDIR/DB_PATH as above,
PATH as above, no live flags:

```sh
for f in src/__tests__/fixtures/grid_*.mjs src/__tests__/fixtures/grid_*.cjs; do node --check "$f" || exit; done
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --esModuleInterop \
  --moduleResolution node --module commonjs --target es2022 \
  src/__tests__/router_grid_accounts_live_e2e.test.ts
node node_modules/vitest/vitest.mjs run src/__tests__/router_grid_accounts_live_e2e.test.ts --no-file-parallelism
```

Observed: syntax/typecheck exit0, no output; Vitest4.1.1 `1 skipped`, `12 skipped`,
tests0ms. `grid_guard_selfcheck.cjs` is an additional manager-runnable deterministic
policy/body-preservation check, **not executed** (writer authorized only syntax/typecheck/skip).
GitNexus/workflow-orchestrator tools were unavailable in this subagent session; no existing
symbol was edited and no commit gate was attempted. Return this fixture receipt to manager/
verification-gate; manager must record actual behavioral command/output in `docs/ai/runs/`
without replacing the original full-scope ledger.

## Continuation receipt (2026-10-08)

- Edited only this existing NEW handoff, NEW live test and NEW fixture sources. No file
  deletion, process lifecycle, credentials/runtime-store inspection, endpoint access,
  online access, install, commit or push. GitNexus/workflow-orchestrator unavailable.
- Re-ran the three check commands above with `env -i`, fixed sandbox HOME/TMPDIR/DB_PATH
  and PATH, no live flags. Syntax exit0; scoped tsc exit0; Vitest4.1.1: 1 file skipped,
  **13 tests skipped**, tests0ms (final rerun171ms overall). Guard selfcheck updated but NOT RUN.
- Triage: existing real-boundary assertions KEEP; rejected auth-key precondition REDO;
  explicit cross-provider gap REDO into actual native Messages/account assertions. No
  browser/manual/CUA check needed for this API/WS boundary.
- `grid-proof-source-manifest.json` remains historical run binding `ae1e08dc`; writer did
  not modify it. Manager archives prior evidence, binds the next revision, integrates
  Anthropic native plugin/model variants/local baseURL into the sanitized config and
  reloads its owned fixture/backend. Generator cannot overwrite existing seeded files;
  do NOT rerun it against this existing HOME. Preserve all prior run evidence/cooldowns.
- Required live matrix and native pin defect result: **actual NOT RUN / UNVERIFIED**.
  Record actual command and sanitized output in the manager run log after reload; never
  log raw authorization, credentials, prompt bodies or complete engine/plugin logs.
