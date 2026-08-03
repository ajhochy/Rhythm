---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1286]
status: passed-local-device-pending
tags: [run, Rhythm]
---

# Issues #1285 and #1286 — integrated verification

## Files

- Integrated #1285 Agents overflow, session discovery, Review Queue, Gallery,
  catalog organization, and provider/model truthfulness changes.
- Integrated #1286 paired mobile first-turn profile scoping changes.
- Updated browser regressions for actions moved into the Agents menu.
- Added 390x844 visual checkpoints under `.proof/i1285/ui/`.

## Checks

- `ai-workflow checks --level pr` — PASS across Flutter analyze/format/tests,
  API TypeScript/lint/serial Vitest/build, MCP TypeScript/Vitest/build, fork
  typecheck/session tests, mobile static/contract/fake-server, and the complete
  mobile browser E2E suite.
- Focused moved-action Playwright suite — PASS, 35/35.
- Previously flaky permission flow repeated three times — PASS, 3/3.
- Mobile overflow/session discovery Jest — PASS, 2/2; mobile typecheck PASS;
  lint PASS with 0 errors and 3 existing warnings.
- Fresh real fork/API/gateway sandbox on isolated ports 4797/4798/4799 — build,
  binary smoke, health, and teardown PASS.
- Combined gated live behavior — PASS, 3 files / 6 tests: owner-only unscoped
  Chats discovery, paired Gallery metadata, and paired create-to-first-model-
  request profile scope (tools, skills, MCP/model/permissions, payload-size
  reduction, truthful returned profile, and no fallback warning).
- The first live attempt correctly failed closed at pairing with HTTP 503
  because the isolated server lacked verification credentials. Failure triage
  found the explicit configuration warning; the sandbox was recreated with a
  matching throwaway capability digest and test public key, and the unchanged
  six assertions then passed.
- #1285 visual Playwright — PASS, 2/2; screenshots were opened and inspected.
  The Agents capture shows Search as the only permanent control and the menu
  containing Chats, scheduled/background/activity views, workspace, terminal,
  new chat, project selection, and lifecycle filters. Review Queue, Gallery,
  Skills, MCP, Profiles, and Providers & Models are populated and organized.
- GitNexus `detect-changes` against
  `origin/codex/fix-session-isolation-runtime-performance` — MEDIUM aggregate
  rollup scope, 70 files / 167 symbols / 3 existing mobile-gateway flows; no
  HIGH/CRITICAL warning.

## Notes

- The physical iPhone was unplugged before final verification. No reload,
  install, build, or reconnect command was sent to it.
- Native-device smoke remains required before merge; this run establishes the
  local/browser and isolated real-engine evidence only.
