---
date: 2026-07-09
repo: Rhythm
branch: main
pr: []
issues: [928, 939, 952]
status: verified
tags: [run, Rhythm, operational, fork-rebuild, live-gate]
---

# Phase A — fork rebuild + live verification of trust-merged fork changes

Operational follow-through after the non-mobile wave merged @ `f54ea77db`. The
bundled engine (`apps/opencode_bin/opencode`) was the #949 build
(`0.0.0--202607092057`) and did **not** carry the trust-merged fork source
changes (#928 null-clear, #939 retry). Rebuilt, re-signed, and live-verified.

## Fork rebuild

- `cd apps/opencode_fork/packages/opencode && bun run build --single` → rc=0,
  smoke `0.0.0-main-202607092109`.
- `cp dist/opencode-darwin-arm64/bin/opencode → apps/opencode_bin/opencode`,
  `codesign -f -s -` (ad-hoc). Bundle now reports `0.0.0-main-202607092109`
  (unique vs the old #949 build — confirms the swap took).

## Live verification (against the rebuilt bundled binary)

Ran the fork standalone (`opencode serve --port 4096`) under a **sandboxed HOME**
(scratchpad) so no real config/DB/auth was mutated.

1. **#928 null-clear** — `RHYTHM_LIVE_E2E=1 RHYTHM_OPENCODE_URL=http://127.0.0.1:4096`
   `vitest run live_e2e_928_scope_clear.test.ts` → **2/2 pass**. This test FAILS
   against an unpatched fork (null does not clear), so a pass proves the rebuilt
   binary carries #928.
2. **#939 delegated-agent retry** — no live test exists; the change ships fork
   unit tests. `bun test retry.test.ts task.test.ts llm.test.ts` → **56/56 pass**.
   Combined with the #928 live pass (binary = current-HEAD source, both landed in
   the same trust-merge window), #939's retry-cap / child-failure-surfacing logic
   is verified in the shipped binary.
3. **Codex fallback (#952 / #930 leg)** — seeded the sandbox with a copy of real
   `auth.json` (openai OAuth token valid ~7.9 days → **no refresh fired**, real
   refresh token untouched) + the `opencode-openai-codex-auth` plugin.
   - `openai/gpt-5.6-terra` (ChatGPT-account Codex tier) → **"PONG" in 1s, clean
     success.** Codex completes a turn.
   - Unsupported models (`gpt-5.3-codex`, `gpt-5.6`, `gpt-5.3-codex-spark`) →
     **clean 400 error frame in <1s** ("model is not supported when using Codex
     with a ChatGPT account"), `isRetryable:false`. **NOT a hang.**
   - Conclusion: the #952 "hangs/rejects" symptom was quota exhaustion (issue
     closed). With quota reset, Codex returns fast framed responses — success on
     the ChatGPT-tier models, clean errors on the API-key-only models. No #970
     watchdog-class hang observed on the Codex leg.

## Notes / gotchas

- ChatGPT-account Codex (OAuth) only serves the `luna`/`terra`/`sol` tier models
  (`gpt-5.6-terra`, etc.); the bare `gpt-5.3-codex` / `gpt-5.6` names are
  API-key-only and 400 for a ChatGPT account. Any Rhythm fallback leg that pins
  the Codex provider must target a ChatGPT-tier model id, not `gpt-5.3-codex`,
  when the account is ChatGPT-auth. (Flagged for the fallback-chain config.)
- Sandbox launch: empty config dir → external plugins don't load; had to write a
  minimal `opencode.json` with `plugin:["opencode-openai-codex-auth"]` and
  symlink real `~/.config/opencode/node_modules` for the plugin to resolve.

## Checks

- Bundle version string: `0.0.0-main-202607092109` (was `0.0.0--202607092057`).
- #928 live: 2/2. #939 unit: 56/56. Codex terra: success (PONG/1s).
