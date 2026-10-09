---
date: 2026-10-06
repo: rhythm
branch: isolated copy of f77b09c96cd72d098c3e7b31ed93182fe1635911
pr: none
issues: []
status: unverified
tags: [run, rhythm]
---

# Known coordinator conversation schema-4 client compatibility (SOURCE-ONLY)

Plan/review/fixtures: `task-4/coordinator-schema4-client-compatibility-{plan.md,astra-review.md,fixtures.json}`. Worked only in the clean isolated f77 copy `task-4/schema4-compatibility`; not committed; nothing built, packaged, restarted or installed; no normal API/engine/model call. Actual running f77 still has the blocker until the builder composes and installs this.

## Impact (GitNexus unavailable; Astra-approved direct-call fallback, done before edits)
`grep schemaVersion` over the six approved files found every gate: web `gateway/coordinator-conversations.ts` (union type, `isConversation`, status context flag, resolve and setup primary gates), `use-coordinator-conversation.ts` (2 plan/continue gates), `CoordinatorConversationCard.tsx` (2 Prepare/Continue visibility gates), `AgentsWorkspace.tsx` (Dayflow source eligibility + consent callback gate); mobile service (union type, `conversation`, status context flag, resolve and setup gates) and controller (2 plan/continue gates). Call graph: decoder → open/status/history/foreground/plan responses → hook/controller → card/workspace. No other file compares conversation `schemaVersion` to 3 in `apps/*/src|providers|components` or the existing tests (no pinned gate strings). No producer, route or API file touched.

## Changes (six production files)
- web/mobile decoders: conversation union `1|2|3|4`; `isConversation`/`conversation` accept literal 1–4. v4 goes through a strict branch: `primaryOwnerRoot` boolean, `ownerUserId` positive safe integer, `goals`/`commandDedupe`/`continuations` required arrays each ≤100, goal objective ≤4000, `createdAt`/`updatedAt` valid ISO strings (goals/continuation items still use the existing item validators). **Correction (see the dedicated section below): the first packet validated these with `Date.parse`, which is looser than the backend; it was replaced by exact canonical equality.** v1–3 branches are byte-for-byte as before.
- New exported literal predicate `isDedicatedCoordinatorSchema(version)` = exactly `3 | 4` (web gateway and mobile service). Used for the status "require complete current context" flag and the resolve/setup primary gates. Resolve/setup still require `primaryOwnerRoot === true`; legacy 1/2 stay readable but cannot enter the dedicated entry. Top-level 5/99/`"4"`/non-integer versions are held.
- Web hook, card, workspace and mobile controller: the literal gate is now explicit `=== 3 || === 4` (inline) combined with the unchanged `primaryOwnerRoot === true`, goal/control, live/auth/session/project and post-await currency conditions. Dayflow source recognition grants no consent and fetches no activity; consent/CAS/draft/epoch/client guards untouched. Nested continuation `schemaVersion: 5` metadata is not touched and not a conversation version. No command body gained a schema field.

## Tests (existing files extended; originals preserved)
- `apps/web/tests/coordinator-conversations.test.mjs` (+3): real decoder accepts v4 for replay/created/foreground/status(with complete context)/resolve/setup/history/planned plus nested-5 continuation metadata and keeps v1/v3; holds 25 mutations (unknown/string/fractional version, owner, primary, revision, foreign session/project, non-array collections, missing arrays, bad/missing timestamps, 101-item bounds, 4001-char objective), non-primary v4 resolve/setup, v5/legacy resolve, incomplete or null context for v4 status; predicate truth table; v4 foreground request body equals the existing exact shape with no schema field.
- `apps/web/tests/coordinator-conversation-controller.test.mjs` (+4, real decoder + real controller, transport faked): v4 open→status→history→foreground ack; malformed/unknown v4 responses (5 variants) hold the view and never reach the message wire; stale v4 open after the root changes neither retargets nor sends; v4 finite plan needs consent (rejected unacknowledged request never reaches the wire, exact request has no schema field) and non-primary v4 never reaches the prepare wire.
- `apps/mobile/tests/coordinator-conversation.test.ts` (+6): the same decoder, controller (real paired gateway decoder), stale-root, malformed and finite-consent cases for mobile.

## Checks (cwd schema4-compatibility)
- `node --experimental-vm-modules --test apps/web/tests/coordinator-conversations.test.mjs apps/web/tests/coordinator-conversation-controller.test.mjs`: 33 tests, 33 pass (baseline before edits: 26/26; +7 new).
- `npm --prefix apps/mobile test -- --runInBand tests/coordinator-conversation.test.ts`: 1 suite, 44 tests pass (38 existing + 6 new).
- `npm --prefix apps/web run typecheck` (`tsc -b`) exit 0; `npm --prefix apps/mobile run typecheck` exit 0.
- Not run: lint, broad suites, Playwright, any live/normal API call. Pre-change red for the new cases is by source reading (baseline unions admitted only 1/2/3 and gated on `=== 3`), not by executing the new tests against f77; I did not stash/revert to prove it.

## Correction: canonical timestamp equality (second narrow turn)
Packet `74c9798a…` was held only because `isIsoTimestamp` (web) / `isoTimestamp` (mobile) used `Date.parse`, so the clients accepted noncanonical `createdAt`/`updatedAt` such as `1` and `January 1, 2026` that the f77 backend rejects. My earlier statements in this record that v4 timestamps were "valid ISO"/"nonempty valid ISO strings" were wrong for that reason. Both helpers are now exactly the backend rule: `typeof value === 'string'`, `new Date(value)` valid, and `parsed.toISOString() === value`. Only those two functions changed (`apps/web/src/gateway/coordinator-conversations.ts`, `apps/mobile/providers/services/coordinator-conversations-service.ts`); no other production behavior, file, API or dependency. Import/caller impact: unchanged from the approved first-turn analysis — each helper is called only from its own schema-4 record validator (web `isSchema4Record`, mobile `schema4Record`), so the effect is limited to v4 `createdAt`/`updatedAt`.
- Tests: in the existing web decoder mutation list and the existing mobile decoder mutation list, added rejects for `createdAt` and `updatedAt` = `'1'` and `'January 1, 2026'`, plus `'2026-10-06T04:00:00Z'` and `'2026-10-06'` (valid dates that are not canonical `.sssZ`). Canonical `2026-10-06T04:00:00.000Z` positives remain in every v4 accept case; all earlier schema4, identity, context, controller and authority assertions are untouched.
- Checks after the correction: web decoder+controller node tests 33/33 pass (the rejects ride in the existing 25-mutation loop); mobile `coordinator-conversation.test.ts` 44/44 pass; `npm --prefix apps/web run typecheck` and `npm --prefix apps/mobile run typecheck` exit 0.
- Limit: Sol's artifact `coordinator-schema4-sol-evidence/actual-decoder-iso-negatives.test.cjs` is hard-wired to `…/chat-parity-sol-copy/apps/mobile/node_modules/typescript`, which does not exist from this checkout, and it must stay unedited, so I did not run it (`MODULE_NOT_FOUND`); Sol should run it against the frozen patch.

## Holds / limits
- Component gates (card, workspace, hook) are covered by typecheck and, for the hook/controller plan gates, by real controller behavior; the card and workspace literals themselves have no rendered test here.
- Dayflow source eligibility on v4 is recognized by the existing workspace gate only; not exercised end to end.
- Source-only: no installed/normal-app proof, no device proof. Builder composes these nine paths, packages under release controls, and verifies the existing normal root opens without mutation.
