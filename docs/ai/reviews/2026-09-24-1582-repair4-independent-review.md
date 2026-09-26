# Independent review — issue #1582 StrictMode contract

Review date: 2026-09-24
Checkout: `/private/tmp/rhythm-swarm-1582`, branch `swarm/issue-1582`, HEAD `a47ef2218eed629e7f3068d44e55fe2fc86ee6ff`.

## Result

The prior StrictMode duplicate-delta blocker is **not reproduced in the tested live-store flows**. The new Playwright contract navigates through the real `apps/web/src/main.tsx` app entry, whose root wraps the app in `React.StrictMode` (lines 47–51). It routes the app's websocket and API boundary to synthetic fixture events, then checks user-visible transcript text. The recorded command output `/private/tmp/rhythm-repair4/1582-buffered-contract-final.log` reports 3/3 passing:

- two ordered `message.part.delta` events after part metadata render exactly once in one message/part;
- returning to the session after switching restores the two fragments exactly once and in order;
- two deltas before the part metadata, followed by an empty `message.part.updated`, render both fragments exactly once.

This is meaningful counter-evidence to the prior static hypothesis: `store.tsx` still calls `reduceSessionTranscript()` from the functional `setSessions` updater, and `reduceSessionTranscript()` mutates `transcriptStatesRef`; yet under this real StrictMode UI and these actual subscription-event sequences the observed output is correct. Do not describe the suspected duplicate as a reproduced user-visible bug or make a product change solely to satisfy the static concern. This does not establish that every updater path or event interleaving is safe: `replaceLiveSession()` and `loadOlder()` also update transcript refs from state updaters, and older-page/load/reconciliation interleavings are not exercised by this new contract.

This contract addresses only the runtime concern. The original #1582 still requires real-engine and broader acceptance evidence for live reasoning, tools/permissions/questions, compaction, interruption/errors, scroll behavior, and timestamp rendering. The new test fakes only the gateway transport and uses a Vite development server; it is not real-engine qualification. The existing contract retains `issue-1582-s1-manual-live` as `not_tested` and correctly says timestamp integration is owned by #1565. No product source changed in this acceptance-contract update.

No tests, servers, or other processes were started during this independent review. No source, test, or contract files were edited. SHA-256 values captured before and after review matched:

- `apps/web/src/main.tsx`: `c5a618fef1a48a762731fd8ec1eee8cd2fb0c729de548b7287733cb35f0e70f3`
- `apps/web/src/store.tsx`: `620a36100bf173d1beb3356b78bbae434f8ae96fece0d2b3d817115fcfe28afb`
- `apps/web/src/gateway/transcript-reducer.ts`: `3c71c1591401d844522d11920eaefb7660e7ae6de0d2e59c026e8a731cc8446b`
- `apps/web/tests/contract/issue-1582.spec.ts`: `6c092e5e2c40c4428c605a6104a090f1482fa4009a046da58857e8e5d1d52570`
- `apps/web/tests/contract/issue-1582-playwright.config.ts`: `fd29e051bf9cd83fc838723ca62dd24ba5317383be2f0a088d777c1a61afc454`
- `docs/ai/contracts/issue-1582.json`: `5903793f2596cf48cfa88e34e3e094e81091f1c14090870425bb349b995bcff9`
