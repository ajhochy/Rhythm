---
date: 2026-09-24
repo: Rhythm
pr: 1544
issues: [1569]
status: pending
tags: [run, rhythm]
---

# #1569 main Accounts acceptance supplement

Base `1b13bca1f5a69b916e73a1cb6f5324ade0684cf3`. Acceptance only; no product edits or servers. Original `docs/ai/contracts/issue-1569.json` has 28 unchanged criteria. Supplemental `issue-1569-s4-main-supplement.json` covers S4-W1–W4,W6,W7 with one test ID per bounded outcome. Existing S2 tests remain unchanged.

## Exact proposed adapter signatures

`createHermesAccountsMain({osHome, hermesHome, grantsPath, getAuthState, getDocumentState, confirmNative, disposeOwnedBackend})` in new `src/hermes-accounts-main.mjs`:

- `getAuthState()` returns main-owned `{authenticated, serverOrigin, userId, authGeneration}`. Null/unauthenticated fails closed. userId is validated string form; generation is random metadata, never a credential fingerprint.
- `getDocumentState()` returns main-owned `{contents, frame, url, epoch}` or null. Actual IPC event sender/frame references must match; only `rhythm://app/index.html` with permitted app fragment is eligible. Do not equate opaque URL origin with production API origin.
- `confirmNative(exactMutation, verifiedDocument)` is the single main-owned asynchronous dialog boundary; the second argument may hold only private main object references. Re-read both getters after it resolves; stale immutable snapshots are not proof.
- `getStatus(event, ...extra)` returns value-free DTO with `availability`, source states, `providers[provider].grantEnabled`, `providers[provider].applicationState`, `childMayRetainCredential`, and disabled memory. Unknown/nonowner calls return unavailable, no store reads.
- `setGrant(event, {action:'enable'|'disable', provider, source:'opencode-auth-json'}, ...extra)` returns `{accepted:boolean}` with optional bounded status/reason. Additional args/keys reject. Compose real S1/S2; do not mock/replace broker behavior.
- `createBackendAttempt({attemptId, profile})` is MAIN-ONLY and returns `{backendEnv(frozenRequest), record({phase:'spawned'|'failed'|'exited', owned, acceptedEnvNames})}`. Opaque attempt IDs come from the owned host, never renderer. The frozen S3 callback request/value result stays unchanged; callbacks are per-attempt closures. Variable names are the four approved names only, and must be a subset actually returned for that attempt. Empty/borrowed/failed/expired/stale/duplicate evidence never proves application. Returned env is private main-to-child only.
- `identityChanged()` immediately blocks new starts, disposes outstanding/active owned attempts, and awaits their stop evidence without holding a queue that their `record(exited)` requires. Disposal failure retains unavailable/possible-retention state. Ordinary exit clears application but preserves reference consent.

The existing `validateGrantMutationRequest` supplemental tests propose main-only optional `trustedDocumentUrl` and `revalidate()` arguments, preserving old caller compatibility while the new main adapter always supplies them. Main must call its fresh getter revalidation; it must not construct truthy sender snapshots in place of real checks. Parent may choose an equivalent dedicated validator only by preserving these concrete security outcomes and explicitly reviewing contract changes.

`createAccountsAuthState({safeStorage,loadEncrypted,saveEncrypted,clearEncrypted,validateSession})` in new `src/hermes-accounts-auth.mjs`:

- `signIn({serverOrigin,userId,sessionToken})`, `restore({serverOrigin})`, `invalidate()` asynchronous; `documentChanged()` and `getSnapshot()` synchronous.
- Snapshot: `{authenticated, serverOrigin, userId, authGeneration, documentEpoch}`; no token. Stable random auth generation is encrypted with the existing auth envelope, survives validated restoration/reload, rotates on new authentication. Document epoch changes independently. `validateSession` is the injected existing main authentication policy, including any existing offline-session semantics; it is not a new mandatory server request. Mere renderer claims are not authentication.
- Persistence dependencies operate on Buffer ciphertext only. Production integration must reuse the existing auth session store, not create a parallel auth database/token store. Test encryption/validation are synthetic boundaries; helper's generation and state logic stay real. Missing encryption/corrupt data/wrong server/rejected session cannot restore sharing authority.

## Fork event alignment

Coordinated with native_policy_live_contract: proposed fork callback is main-only synchronous `onOwnedBackendAttempt({attemptId, phase:'starting'|'accepted'|'retired', profile:'default', acceptedEnvNames})`. Starting creates this adapter's private per-attempt closure before env resolution; accepted maps to private `record(spawned)`; retired maps to private failed/exited based on prior accepted state. The fork callback must never await a broker serial queue; main identity barriers await host disposal and all attempt retirement. No callback for borrowed/nondefault runtimes. Private phase naming here is not a second public fork protocol.

## RED evidence

Command from worktree root:

`node --test --test-concurrency=1 apps/electron/test/hermes-accounts-main-contract.test.mjs apps/electron/test/hermes-accounts-auth-contract.test.mjs`

Exit 1; **15 failed, 0 passed, 0 skipped**, all assertion failures, no loader/test discovery error. Two existing-validator behavioral failures: legitimate rhythm:// document yields accepted=false; revalidation closure switched false during dialog still yields accepted=true. Thirteen assertions identify missing main adapter/auth helper before executing their detailed outcome cases. This proves runnable RED contracts, not existing implementation coverage for the absent modules. Log `/private/tmp/rhythm-s4-contract-red.log`.

Synthetic temporary directories only; no real stores, sockets, subprocess backends, UI or fork edits. No dependency installation needed for Node built-in tests. No GitNexus product impact needed because only new tests/docs added; no existing symbol edited. No commit/push.

## Remaining boundaries

This supplement does not prove actual main.mjs/preload/view event wiring or fork spawn callback provenance, nor UI/packaged/live behavior. Those remain mandatory follow-on acceptance. S4-W5/W8/W9/W10 intentionally remain outside this bounded contract, not waived from the full feature. Original frozen 28 criteria remain unchanged and authoritative.


## Implementation candidate after parent contract review

Added `hermes-accounts-main.mjs` composing real S1/S2 inspection/grant handling with owning-document validation, native confirmation, fresh document/auth checks, per-provider references and a synchronous attempt ledger. Added `hermes-accounts-auth.mjs` to enrich/reuse the existing safeStorage envelope with random auth-generation metadata and separate document epoch; it owns no files/network and exposes no token snapshot. Existing user metadata and numeric user identity are preserved. Main must inject its actual existing auth policy (offline behavior included); no new forced online authentication flow was added.

Broker changes are narrow: optional exact custom-protocol document/revalidation seam, provider-specific reference status, and conservative no-injection when Hermes auth/env precedence is unreadable/malformed/unknown. Existing S1/S2 tests remain unchanged. Registered both new test files in Electron npm test.

Parent review prompted four additional RED regressions before repair: empty legitimate child receipt was rejected; identity disposal skipped env-pending attempts; empty receipt did not seal late env completion; lifetime attempt cap prevented ordinary restarts. `/private/tmp/rhythm-s4-review-red.log`: 4 failures. Repaired: synchronous accepted[] succeeds without marking keys applied; late env discarded after receipt; identity disposal includes all pending/active attempts; active attempts removed on retirement, with bounded recent retired-ID replay window. Old closure stays terminal after replay-window eviction. Active attempt cap is 128; retired ID window 1024.

`attempt.record` returns a synchronous boolean (await-compatible with tests), not a Promise: fork observer must check/throw before publishing connection. Only host-owned callbacks may call it. Signed-out/nondefault/borrowed main integration must omit credential observer or handle normal uncredentialed startup separately; this helper never grants keys without trusted auth. Actual main.mjs/preload/hermes-view wiring is still pending and not claimed tested.

GitNexus lookup before changes returned UNKNOWN for new broker symbols (200-commit stale index, targets absent). No indexed production callers were reported; no zero-risk inference. No commits or pushes.

First implementation replay confirmed 15 RED assertions (`/private/tmp/rhythm-s4-impl-red.log`). Final focused command:

`node --test --test-concurrency=1 apps/electron/test/hermes-accounts-main-contract.test.mjs apps/electron/test/hermes-accounts-auth-contract.test.mjs apps/electron/test/hermes-credential-broker.test.mjs apps/electron/test/hermes-accounts.test.mjs`

48/48 pass (`/private/tmp/rhythm-s4-reviewed-focused.log`). Typecheck `npm run typecheck --prefix apps/electron` exit 0 (`/private/tmp/rhythm-s4-reviewed-typecheck.log`). First full Electron run 241 pass/6 fail because this fresh worktree lacked built web dist; failure-triage identified all six shell errors as missing built assets. Built candidate web with `npm run build --prefix apps/web` (exit 0, existing chunk-size warning). Full Electron replay before final review corrections passed 249/249; final reviewed full-suite receipt follows below. No assertions weakened. Generated shell screenshot is copied to /private/tmp/rhythm-s4-electron-m1-shell.png and restored, not included in source.

No real credential store/provider or actual API/engine runtime was used. Full Electron tests include existing synthetic shell fixtures. Verification-gate does not emit aggregate/live PASS: main integration, actual owned receipt wiring, UI and S7 remain parent work.

Final reviewed full Electron command `npm test --prefix apps/electron`: **253/253 passed**, exit 0 (`/private/tmp/rhythm-s4-electron-reviewed.log`). All evidence is uncommitted candidate at base 1b13bca1. Original 28-criterion file remains byte-unchanged.

## Parent integration review

Parent read all product changes and the added regression cases, copied only the eight slice-owned files, and reran the four focused suites: 48/48 passed. Electron typecheck passed. This accepts the helper foundation only; actual main/preload/view wiring, Accounts UI and real provider consumption remain pending. Current pre-slice PR head 27c61758 passed all six remote CI checks, including desktop.

Parent GitNexus staged detection reported no changes despite eight staged files; the index is stale and lacks these symbols. Exact staged file review supplies the scope check; this output is not evidence of zero impact.
