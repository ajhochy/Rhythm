---
date: 2026-10-09
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

# Pin-preserving account fallback repair

## Scope / approvals

Sole successor to idle account-provenance session 5e8ab3de; parent explicitly approved this fork defect repair, overriding the MCP-only fork restriction for this change only. Worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`. Only writer; substantial inherited dirty/untracked work was preserved. Approval covers the optional shared-store pin field, callers, both native account resolvers, necessary same-provider intake protection, tests, and vendored local-modification receipt. No renewed approval needed for unchanged scope.

Excluded: runtime/live tests, API/engine/sandbox launch, Postgres, signals/PIDs/sockets/ports, network/model calls, keys/private data, installs, commits/pushes, deletion and destructive cleanup. `/private/tmp/sdmr-grid-sandbox` was not accessed. Existing live pin assertions and all other tests' assertions are untouched. Production store temp+rename write is unchanged. In-memory provenance functions are unchanged from the inherited state. No other docs changed except the explicitly requested VENDORED.md line. Acceptance contract is recorded here, rather than creating a separate docs/ai/contracts file, to respect the one-run-note constraint.

## Phase 0 — RED acceptance evidence

Loaded acceptance-contract first, then coding-agent; read AGENTS.md, project-state, current-plan, testing-guide, regression registry. Before implementation:

- Codex contract: 2 assertion failures / 2 passes. Pinned B incorrectly returned A in fallbacks; same-mtime override selected A instead of B.
- Shared store + Anthropic contract: initial harness error because Vitest aliases fs/node:fs; unified the boundary mock before implementation. Corrected RED: 4 assertion failures / 2 passes. Missing normalized pin map, pin options ignored, surviving pins lost on account removal, Anthropic override selected A with B as fallback.
- Caller contract: 7 assertion failures / 0 passes. All expected third-argument pin classifications were absent.
- Additional fail-closed edge contract: Codex 1 failure / 4 passes and API 1 failure / 7 passes, EXIT=1 each. An unusable pinned B silently selected A. Fixed within the pin-preserving resolver scope; unpinned behavior unchanged.

The SUTs (store read/mutate methods, resolvers, controller, grid/capacity functions, registered spillover handler) are real. Only filesystem, engine/service boundary, and cascade boundary dependencies are fake. Store filesystem is an in-memory map; no actual rename/unlink. Caller DB is SQLite `:memory:`; no initDb or Postgres. Handler is invoked directly without any listener/server/socket. Fetch notifications are intercepted and never sent. These are unit contracts, NOT runtime/live proof.

### Acceptance coverage

| ID | Contract / regression caught | Evidence |
|---|---|---|
| c1 | Codex pinned B supplies no fallback A | exact account and empty fallbacks |
| c2 | Codex same-mtime override cannot beat pin | account B |
| c3 | Codex automatic routing/override fallback preserved | exact selected/fallback accounts |
| c4 | Codex no-session behavior preserved | default A, fallback B |
| c5 | Missing/legacy store normalizes pins without losing original fields | empty pins, exact original accounts/default/routing |
| c6 | Pin true sets, omitted preserves, false clears | next real store reads show exact routing/pins |
| c7 | Account removal removes only corresponding routing/pins | remaining B account/default/routing/pin |
| c8 | Anthropic pinned B ignores override and has no fallback | exact account B, undefined fallback |
| c9 | Anthropic automatic routing/override fallback preserved | exact selected/fallback accounts |
| c10 | Anthropic no-session behavior preserved | default A, fallback B |
| c11 | Requested/profile choices pin, store-default choices auto | both providers' in-memory provenance and store-boundary args |
| c12 | PATCH pins and same-id grid reapply retains pin | both providers' explicit provenance and pin=true |
| c13 | Automatic grid/capacity switches clear pins | both providers' pin=false and final DB account |
| c14 | Unusable pinned account cannot silently select another | both resolvers return no account/fallback |
| c15 | Service forwards options to actual shared store | next read observes pin and routing |
| c16 | Stale same-provider spillover cannot move explicit pin | both providers: 202, unchanged DB account, no routing write |
| c17 | Auto spillover persists unpinned provenance | both providers: final DB account, auto marker, pin=false |
| c18 | Pinned Anthropic exhaustion still reaches cascade | exhaustion signal forwarded; no account-routing write |

All listed automated cases PASS (25 expanded cases). Original native 429 response preservation is statically reviewed, not runtime tested: codex.ts iterates an empty fallbacks array, so it retains the original response and never calls markCodexSpillover. Runtime/live pin proof remains UNVERIFIED/NOT RUN pending a compliant runtime guard; the existing router_grid_accounts_live_e2e.test.ts pin assertion remains unchanged.

## Phase 1 — impact and complete caller classification

**Impact: UNKNOWN.** gitnexus_list_repos enumerated all 30 registered repos; this worktree is not registered. Main Rhythm and another worktree are not valid substitutes. No impact score or API-impact report is claimed; no gitnexus analyze/reindex was run. Used exact-string grep caller review as authorized. Relevant consumers: shared OAuth store/service for both providers; controller create/PATCH; capacity switch; grid apply; spillover intake; Codex resolver at codex.ts 468/488; Anthropic resolver at dist/index.js 255/379/421; native retry loops and cross-provider cascade.

Risk review: shared persistence could strip pins during refresh/mutation; automatic routing could accidentally clear an explicit pin; native stale override could defeat persisted intent; exhausted pinned Anthropic could accidentally alter account identity. Proportionate in-memory tests cover each relevant boundary. No graph HIGH/CRITICAL rating exists; do not mistake UNKNOWN for low risk.

Literal `setRouting(` search found 12 non-test sites: nine production calls, the service/store declarations, and service-to-store forwarding. Table locations use pre-edit line numbers from caller review:

| Site | Classification | Flag |
|---|---|---|
| controller 1157 Anthropic create | requested/profile default explicit; capacity/store default automatic | true iff requested/profile default |
| controller 1160 OpenAI create | requested/profile default explicit; capacity/store default automatic | true iff requested/profile default |
| controller 1343 Anthropic PATCH | explicit choice; revokes auto provenance | true |
| controller 1360 OpenAI PATCH | explicit choice; revokes auto provenance | true |
| capacity_router 588 Anthropic | automatic only, gated by isAutoAccountSession | false |
| capacity_router 594 OpenAI | automatic only, gated by isAutoAccountSession | false |
| router_grid_turn 42 | automatic grid choice OR reapply existing same-account pin | false for auto; true for explicit same-id pin |
| spillover route 123 OpenAI | automatic persistence; explicit current account refused | false |
| spillover route 126 Anthropic | automatic persistence; explicit current account refused | false |
| OAuthAccountsService declaration 96 | provider-agnostic forwarder | optional opts, no classification |
| OAuthAccountsService call 97 | provider-agnostic forwarder | pass opts unchanged |
| OAuthAccountsStore declaration 108 | shared persistence primitive | true=set; false=clear; undefined=preserve |

Anthropic dist/index.js 367–370 still calls markAccountsExhausted when no fallback remains. opencode_spillover_routes.ts exhausted branch invokes advanceFallbackCascade; turn_redispatch.ts defaultCascadeDeps persists only providerId/modelId/routerVariant, not account IDs or store routing. Thus a pinned provider account stays pinned while existing cross-provider model-cascade semantics remain intact. Same-provider stale reports are now declined for an explicit/unknown existing account, consistent with the conservative in-memory provenance contract. No changes to either provider's request/retry implementation or cross-provider cascade were needed.

## Phase 2 — implementation / validation

Additive optional pinned map is normalized on read (missing/invalid container -> empty), existing fields preserved. Routing options propagate through shared service. Account removal drops corresponding pins. Plugins ignore overrides for pins, offer no fallback, and fail closed if the pinned account is unusable. Automatic/no-session selection remains unchanged. Necessary caller flags and stale same-provider intake guard implemented. Grid reapplying a pinned account retains pin=true.

### Exact guarded commands

Every terminal invocation used this exact kernel/environment prefix (including git and hashes):

```sh
/usr/bin/sandbox-exec -f /private/tmp/no-unlink-enforcement-20261009/deny-unlink.sb env -i HOME=/private/tmp/strict-unit-probe-20261009/home TMPDIR=/private/tmp/strict-unit-probe-20261009/tmp DB_PATH=/private/tmp/strict-unit-probe-20261009/tmp/unit.db PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin
```

In commands below, `G` denotes exactly that prefix; final exit capture used `G /bin/sh -c '<command>; result=$?; printf "EXIT=%s\n" "$result"; exit "$result"'`.

| Working directory | Command after G | Result |
|---|---|---|
| worktree root | `bun test ./apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.pinned.test.ts` | initial RED 2 failed/2 passed; edge RED 1 failed/4 passed EXIT=1; final GREEN 5 passed/0 failed EXIT=0 |
| apps/api_server | `npx --no-install vitest run src/services/pinned_accounts_contract.test.ts --pool=threads --no-file-parallelism` | corrected RED 4 failed/2 passed; edge RED 1 failed/7 passed EXIT=1 |
| apps/api_server | `npx --no-install vitest run src/controllers/__tests__/pinned_account_callers.test.ts --pool=threads --no-file-parallelism` | RED 7 failed/0 passed |
| apps/api_server | `npx --no-install vitest run src/services/pinned_accounts_contract.test.ts src/controllers/__tests__/pinned_account_callers.test.ts --pool=threads --no-file-parallelism` | first GREEN 13 passed/0 failed before supplementary edge/intake cases |
| apps/api_server | `npx --no-install vitest run src/services/pinned_accounts_contract.test.ts src/controllers/__tests__/pinned_account_callers.test.ts --pool=threads --no-file-parallelism --silent` | final GREEN 20 passed/0 failed; 2 files; EXIT=0; 2.84s |
| apps/api_server | `npx --no-install tsc --noEmit -p .` | initial pass before supplementary tests; supplementary handler typing EXIT=2, two bounded typing repairs; final EXIT=0 |
| apps/api_server | `npx --no-install tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --types node --skipLibCheck ../opencode_fork/packages/opencode/src/plugin/codex-accounts.ts` | scoped fork production module EXIT=0; full fork typecheck/build NOT RUN |
| worktree root | `git --no-optional-locks diff --check` | EXIT=0; inherited tracked files included |

Vitest emitted `error during close Error: EPERM: operation not permitted, rmdir ...` in every run. Expected enforcement; never suppressed or weakened. Final tests exited 0 despite that teardown warning. No successful deletion. Initial guarded `git status --short` attempted index.lock cleanup and it was denied; lock was preserved. Subsequent Git reads used `--no-optional-locks`. Apple git's xcrun cache rename warnings were also denied by the unchanged guard; read-only Git results remained available. No lock/cache cleanup attempted.

Two implementation validation repair attempts were used solely for supplementary Express handler test typing (missing layer guard/next argument, then partial request cast). No production assertion or security safeguard weakened. No full-suite, runtime, installation, merge, or delivery completion claim.

## Files / source freeze

Owned source files (hashes include preserved inherited content where present):

```text
e7fcc9730f2fc6738734c8a7bd735457338267727ca0b3577297da28bdeb4ede  apps/api_server/src/services/anthropic_accounts_store.ts
a3ba980461f2d661aec185356eecd3fbd62c522c32125372a469af326b4dc79e  apps/api_server/src/services/anthropic_accounts_service.ts
f09bb01149fa98c156828934a6c37e2e5617573c47ee3b0df78294e5917ea3a5  apps/api_server/src/controllers/agent_sessions_controller.ts
a7d4c58c1deadf3b2c2f5d1db01e407af4b70dda0fb29ecf86f25f7faf22e314  apps/api_server/src/services/decision/capacity_router.ts
65928332f541c94590b1e20a33a924b097721f92186508ab818866bdbbce0eb9  apps/api_server/src/services/decision/router_grid_turn.ts
9e306b94693e70508f7979a0ef4319301e96a9184448619b3f11017b94446dfd  apps/api_server/src/routes/opencode_spillover_routes.ts
d77042e8110e81d685b8b34cc886188c8261b3c086ce6a619661a94112069a35  apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.ts
e9648ba079ca4c5f8616ba0e8ddb98128e5e453ab885d4df508648846fb9bbe7  apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/accounts.js
722f4014bcf1124bbc146117e9e360b52741698b40dfb6925060e635fa3a3449  apps/api_server/opencode_plugins/rhythm-anthropic-accounts/VENDORED.md
db92d9c2992738f6ba1b0d5161ce36af5876487f9760094a9e8fce00ee5ffa8c  apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.pinned.test.ts
f968ec89ef4220d458a7a53362525321ab8c69dad3f3a90f7b730d8a8721a957  apps/api_server/src/services/pinned_accounts_contract.test.ts
deb989a090bc05901c1dcfde15edd7c2b6f88b6ea4dec0a02cefbfcc801b9eb4  apps/api_server/src/controllers/__tests__/pinned_account_callers.test.ts
```

Hash command: G `shasum -a 256` followed by the twelve paths above, in order. This run note's final hash is supplied in the handoff (self-hashing inside itself is impossible). Tracked owned-path `git diff --stat`: **8 files, 77 insertions(+), 23 deletions(-)**; includes inherited controller/capacity/intake changes and excludes already-untracked router_grid_turn, three new tests, and this note. Do not interpret that as this stage's isolated diff.

New contract files: Codex 38 lines; shared-store/Anthropic 79 lines; caller/intake 102 lines (219 total added). The inherited untracked router_grid_turn.ts is 146 lines; this stage changes only its routing call. Owned untracked whitespace check PASS for that file, all three new tests, and this note. Read-only check command after G:

```sh
node -e 'const fs=require("node:fs"); const paths=["apps/api_server/src/services/decision/router_grid_turn.ts","apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.pinned.test.ts","apps/api_server/src/services/pinned_accounts_contract.test.ts","apps/api_server/src/controllers/__tests__/pinned_account_callers.test.ts","docs/ai/runs/2026-10-09-pinned-account-fallback.md"]; for(const p of paths){const text=fs.readFileSync(p,"utf8"); if(/[\t ]+$/m.test(text))throw new Error("trailing whitespace: "+p); console.log(text.split("\n").length-1,"lines; whitespace PASS;",p)}'
```

Other read-only diagnostic commands after G: initial `git status --short`; `git --no-optional-locks branch --show-current`; `git --no-optional-locks diff --stat --` followed by the eight tracked production/document paths above plus router_grid_turn.ts; `git --no-optional-locks diff --` followed by those same tracked paths (excluding the untracked grid file). Final whitespace/hash checks repeat the recorded commands after this note is finalized. All diagnostics used the worktree root; no Git index write was requested beyond initial status's optional refresh, and its cleanup was kernel-denied.

## Handoff

READY_FOR_VERIFICATION — exact owned source frozen by hashes above. Runtime/live proof is **NOT RUN pending the compliant runtime guard**. Next verifier must keep the preserved live pin assertion, qualify original 429/no same-provider switch against real guarded runtime only after separate compliant authorization, and account for legacy files lacking pins (no live-data backfill performed). Existing unknown in-memory provenance stays conservative after restart; this patch does not reconstruct historical intent or alter cross-provider model cascade policy. No project-state update, commit, push, install, or cleanup was performed.
