---
date: 2026-10-05
repo: rhythm
branch: main
pr: null
issues: [renderer-transcript-cpu-repair]
status: in-review
tags: [run, rhythm, web, renderer, transcript]
---

# Renderer transcript CPU repair

## Scope

Desktop web renderer source only. The shared React store previously fed every incoming
transcript frame back through the complete `session.messages` history before applying the
frame. This repair seeds a per-session reducer cache only when absent, applies live frames
directly to that cache, and retains explicit REST page/detail replacement as the reconciliation
boundary.

The only local optimistic-write boundary (`sendLiveInput`, including attachments) now merges its
single optimistic row into the same cache. Initial selected-session detail hydration also uses
the explicit merge boundary, so a REST detail that resolves after a WebSocket frame cannot
discard the fresher cached transcript.

## Files

- `apps/web/src/gateway/transcript-reducer.ts` — adds cache-aware seed/page/event helpers while
  retaining the existing ordering, alias, delta-buffer, terminal-part, tombstone, and page merge
  rules.
- `apps/web/src/store.tsx` — routes live frames directly to the cache, explicitly merges REST
  detail/pages, and synchronizes optimistic sends.
- `apps/web/tests/contract/transcript-cache-event-reducer.test.mjs` — actual reducer-cache
  regressions for aliases/order, out-of-order deltas, stale REST/live precedence, explicit
  replacement, and bounded source-history iteration under a frame flood.
- `docs/ai/runs/2026-10-05-renderer-transcript-cpu-repair.freeze.json` — exact source freeze
  and red/green witness metadata.

## Checks

- Baseline deterministic source witness (before the patch): 257 cached-history rows × 96 live
  frames iterated 24,672 source rows (`257 × 96`); final streamed text was 96 characters.
- Fixed deterministic source witness: the same case iterated 257 source rows exactly once and
  produced the same 96-character streamed text.
- `python3 ../../bounded-serialized-validation.py --label renderer-transcript-cache-focused --cwd "$PWD/apps/web" --timeout 60 --log <owned-temp>/focused.log --receipt <owned-temp>/focused.receipt.json -- node --test tests/contract/transcript-cache-event-reducer.test.mjs tests/contract/issue-1582-transcript-reducer.test.mjs tests/contract/transcript-optimistic-user-replay.test.mjs` — pass, 38/38; the receipt records `normalRuntimeTouched: false`.
- `npm run typecheck` — blocked before changed-file errors by pre-existing frozen-composition
  module-resolution failures: `electron/src/rhythm-agent-tools.mjs`, `@ajhochy/rhythm-workspace-ui`,
  and `shared/production-api-base.mjs` are absent from this isolated snapshot. No dependency or
  frozen-source workaround was applied.
- `git diff --check` — pass.
- Bounded GitNexus impact attempts for `reduceSessionTranscript`, `mergeSessionTranscript`, and
  `mergeTranscriptPage` — UNKNOWN: this snapshot is not registered in the available GitNexus
  repositories. No index registration or rebuild was performed. Manual caller/path review was
  limited to the store cache lifecycle, live optimistic send, REST detail/page reconciliation,
  removal/delete cleanup, effect disposal, and the focused reducer tests.

## Protected boundaries and remaining verification

- No API, engine, Electron, Shell/styles, mobile, dependency, protocol, permission, database,
  runtime, browser, phone, model, capture, or live-session source/action changed.
- This is desktop renderer code only. Expo uses `providers/services/agent-chat-service.ts` and
  `lib/opencode/transcript-events.ts`; it does not import this web store/reducer. No mobile
  performance result or inference about the original mobile reconciliation intent is claimed.
- The live research renderer was not reloaded, restarted, sampled, or exercised. The source
  witness proves removal of the repeated full-history seed; it does not prove a live CPU result
  or establish the sampled V8 function attribution beyond the handoff's medium-confidence
  evidence.
- No commit was created. Root retains integration, application/runtime, and physical-device
  acceptance responsibility.
