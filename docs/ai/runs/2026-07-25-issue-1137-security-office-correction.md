---
date: 2026-07-25
repo: Rhythm
branch: codex/1137-final-corrective
pr: null
issues: [1137, 1169]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1137 mobile security and Office-reader correction

## Files changed

- `apps/api_server/src/services/mobile_opencode_proxy.ts`
  - Validate every `session.prompt` and `session.prompt_async` file part before
    forwarding: accept canonical contained `file:` URLs and valid `data:` URLs;
    reject missing, malformed, non-file/data, outside-root, traversal, and
    symlink-escape targets.
- `apps/opencode_fork/packages/app/src/components/prompt-input/files.ts`
  - Inspect complete bytes for every non-image/non-PDF attachment, including
    declared text MIME, using fatal UTF-8 decoding plus control-byte checks.
- API, browser, mobile-real-engine, and DOCX live regressions.
- `apps/mobile/contracts/rhythm-opencode-contract.json`
  - Regenerated the OpenAPI fingerprint after the cumulative fork SDK changes.
- `apps/api_server/src/__tests__/issue_723_mcp_remove_reconcile.test.ts`
  - Use the existing v2 SDK test seam so the full Vitest VM never invokes the
    production dynamic-import loader.
- `docs/ai/contracts/issue-1137.json`
  - Added and passed criteria c9-c11.

## Checks run

- Red-first evidence:
  - `bun test src/components/prompt-input/attachments.test.ts` — five new
    delayed NUL/invalid-UTF-8 text-MIME cases failed before implementation.
  - `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts`
    — service forwarding and HTTP boundary both failed before implementation.
- Focused/static:
  - App `bun run typecheck` and attachment suite — 16 passed.
  - API build and mobile proxy suite — 11 passed.
  - Fork `bun test test/session/prompt.test.ts` — full file passed.
- Live sandbox, freshly built branch engine and API on dedicated loopback ports:
  - `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy_live.test.ts`
    — 1 passed; rejected `/etc`, outside-root, symlink, remote-file-host,
    localhost HTTP, and malformed URLs left the engine session empty; contained
    native and browser data attachments then persisted their markers.
  - `RHYTHM_LIVE_E2E=1 DB_PATH=<sandbox-db> ... npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts`
    — 2 passed; independent native/browser reader discovery plus a valid
    minimal DOCX whose hidden marker appeared in assistant output after the
    installed `document-creation` / `read_office_docs.py` reader ran.
  - `tools/dev/sandbox.sh down` — dedicated sandbox removed and ports free.
- Canonical gates:
  - `VITEST_MAX_WORKERS=4 ai-workflow checks --level issue` — passed.
  - `VITEST_MAX_WORKERS=4 ai-workflow checks --level pr` — passed: Flutter
    analyze/format/tests, API lint/full Vitest/build, MCP tests/build, fork
    typecheck/session tests, mobile static/contract/fake-server/web E2E.
- Mobile focused gates after `npm ci`:
  - static suite passed, contract tests passed, Playwright 15/15 passed.
- GitNexus:
  - Compare to `main`: CRITICAL cumulative branch scope, 460 files / 2,329
    symbols / 21 flows (the inherited #1076-#1175 integration delta).
  - Unstaged corrective delta: LOW, 9 files / 12 symbols / 0 flows.

## Notes

- The first live launch was reaped when its non-interactive shell exited.
  Failure triage classified this as environment/flake; relaunching the same
  isolated sandbox through a persistent terminal produced the green evidence.
- The first PR gate exposed three pre-existing environment/harness problems:
  missing mobile dependencies, a stale generated contract hash, and an
  issue-723 test that bypassed the class's v2 test seam. `npm ci`, contract
  regeneration, and the intended test seam resolved them; the canonical gates
  then passed from the top.
- No follow-up issue was filed; no production database or foreign listener was
  touched.
