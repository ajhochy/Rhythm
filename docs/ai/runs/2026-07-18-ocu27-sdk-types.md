---
date: 2026-07-18
repo: Rhythm
branch: refactor/1068-ocu27-sdk-types
pr: null
issues: [1068]
status: complete-with-documented-deviation
tags: [run, Rhythm]
---

# OCU-27 (#1068) — adopt regenerated SDK types in api_server

## Files changed

- `apps/api_server/src/@types/opencode-ai-sdk.d.ts` — added `Pty` type +
  `client.pty.{create,update,remove}` (sourced from the real installed
  `@opencode-ai/sdk@1.14.49`'s `dist/gen/*.d.ts`); added a new
  `declare module '@opencode-ai/sdk/v2/client'` block covering
  `question.{list,reply,reject}` and `app.skills()` (sourced from that same
  package's `dist/v2/gen/*.d.ts`).
- `apps/api_server/src/services/opencode_client_service.ts` — removed all 3
  `(client as any).pty.*` casts (createPty/resizePty/removePty now call
  `client.pty.*` directly); added a `v2Client()` helper (dynamic-import
  mirror of the existing v1 bridge) + `__setTestV2Client` test seam; converted
  `listSkills`, `listSkillsWithContent`, `listQuestions`, `replyToQuestion`,
  `rejectQuestion` from raw `fetch()` to typed v2 SDK calls; removed the
  now-dead `questionAction` private helper; added/fixed JSDoc notes on the
  shims confirmed to have NO SDK coverage (`updateSessionAllowlist`,
  `updateSessionSkillAllowlist`, `reloadSkills`, `reloadConfig`).
- `apps/api_server/src/__tests__/opencode_client_v2_wrappers.test.ts` (new) —
  contract tests for the 5 converted methods, asserting each v2 client call
  receives the same request shape (method params) the prior fetch sent.

## Checks run

- `cd apps/api_server && npx tsc --noEmit` — **clean**, run 3 times across
  the pty-only stage, the v2-conversion stage, and after adding the new test
  file. No errors.
- `grep -n "client as any" apps/api_server/src/services/opencode_client_service.ts`
  — **zero matches** (was 3: createPty/resizePty/removePty).
- `npx vitest run --no-file-parallelism` (full suite, twice — before and
  after the v2 conversion):
  - Before v2 conversion (pty-only): **3001 passed / 18 failed / 38 skipped**
    (3057 total) — exact match to the documented baseline
    (`docs/ai/project-state.md`), all 18 failures the known pre-existing
    `memory_*` vault ones.
  - After v2 conversion + new test file: **3010 passed / 18 failed / 38
    skipped** (3066 total) — same 18 known failures, +9 new passing tests
    (the new v2 contract test file), 0 regressions.
- `npx vitest run src/__tests__/pty_wrappers.test.ts src/__tests__/pty_routes.test.ts
  src/__tests__/opencode_client_typed_wrappers.test.ts
  src/__tests__/opencode_client_v2_wrappers.test.ts` — **64/64 passed**
  (targeted contract-test run for everything touched this issue).
- `mcp_Gitnexus_detect_changes` (unstaged) — 16 changed symbols, all in
  `opencode_client_service.ts`, **risk_level: low, affected_count: 0**.
- Sandbox live behavioral smoke (`tools/dev/sandbox.sh up`, API :4098, engine
  :4097, torn down cleanly both times with `down`):
  1. **PTY** (create → resize → remove) driven through the real HTTP routes
     (`POST /agent-sessions/:id/pty`, `PATCH /pty/:id`, `DELETE /pty/:id`)
     against the real built fork engine binary: created `pty_...`, resized
     200 OK, removed 204 OK. Confirms the new typed `client.pty.*` calls work
     end-to-end (identical to the pre-change `(client as any)` behavior).
  2. **`GET /opencode/skills`** (→ `listSkills` → v2 `client.app.skills()`)
     against the same live engine: returned the real discovered skill list
     (managed + external), confirming the v2 client wiring is genuinely
     functional against the built binary, not just mocks.
  3. **Question API** — no real pending question could be manufactured
     without a full LLM turn in the time available, so `client.question.list()`
     was exercised indirectly: `POST /agent-sessions/:id/question/bogus-call/reply`
     with no bridge-side pending record fell through to `listQuestions()`
     (the real `GET /question` call against the live engine), got a clean
     empty result, and the route correctly 404'd
     ("No pending question for that callId not found") — proving the v2
     `question.list()` call executes successfully end-to-end (a broken v2
     wiring would have thrown/500'd instead of reaching this clean
     domain-level 404).
  4. `updateSessionAllowlist`/`updateSessionSkillAllowlist` — NOT
     independently live-smoked. Zero logic changed in these methods this run
     (comment-only additions documenting the OCU-27 re-check); already
     covered green by the full vitest suite above, and AGENTS.md's own
     behavioral-gate exception applies verbatim ("pure refactors with no
     behavior change... doc-only changes... don't need a behavioral test").
     Substituted the more relevant live checks (2) and (3) above, which DO
     cover genuinely-changed logic.

## Notes

- Full reasoning for the `file:`-dep rejection, the full-re-export rejection
  (with the concrete tsc-probe evidence), and the narrow real-SDK adoption is
  in `docs/ai/decisions/2026-07-18-ocu27-sdk-types-adoption.md`.
- **Acceptance criterion not fully met (documented, not silently dropped):**
  the hand-written `opencode-ai-sdk.d.ts` grew rather than shrinking to a
  re-export shim. `tsc --noEmit` IS clean and the `(client as any)` criterion
  IS met. See the decision doc for why a wholesale swap was rejected as
  unsafe (concrete evidence: real generated schema is missing officially
  unlisted-but-real wire events the engine emits — `permission.asked`,
  `question.asked/replied/rejected`, `message.part.delta` — that Rhythm's
  hand types capture from live observation; blindly dropping them would be a
  #948-class regression).
- Good follow-up (not filed, flagged in the decision doc): migrate
  `api_server`'s opencode client wholesale to the `@opencode-ai/sdk/v2`
  export, which would let the remaining direct-fetch shims for
  skill/config-reload be considered again if/when the fork's own regenerated
  v2 schema (mcpAllowlist/skillAllowlist, skill.reload, config.reload) is
  ever built/published.
- Sandbox provider isolation note (per project-state.md) not relevant here —
  no live-e2e (LLM-in-the-loop) test was run, only HTTP-level engine smoke.
