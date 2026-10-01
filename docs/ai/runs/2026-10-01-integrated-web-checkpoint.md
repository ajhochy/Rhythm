---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: []
status: unverified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

### Integrated web major checkpoint

- `RHYTHM_LIVE_E2E` was unset. `cd apps/web && npm run build` exited 0 (TypeScript plus Vite, 1,758 modules). This build preceded the root-owned one-line C1 navigation change; its focused C1 retest is separate.
- `npm run test:list` exited 1: default Playwright discovery imports Node `*.test.mjs` files and executes their `node:test` suites while listing. The first failures included missing Playwright headless-shell revision 1234, `issue-1447-gateway.test.mjs` requiring a native approval capability that the unchanged HEAD test does not supply, and `issue-1558-collapsed-projects.test.mjs` asserting an obsolete literal implementation. Those tests, default config, and relevant HEAD source are unchanged by this integration. A filtered intended browser discovery, `npx playwright test spec.ts --list`, found 881 tests in 114 files.
- Installed Chrome was used for browser checks through temporary `/private/tmp` config overrides that imported the real configs and set only `use.channel: 'chrome'`, absolute `testDir`, and web-server cwd. No product CSP change or browser download occurred. One default smoke case passed. The full default spec run was interrupted after the first 14 cases because the first nine dedicated Hermes-account tests, which require their own config, failed with `useFixtures must be used within FixtureProvider`; continuing 881 cases would have repeated the same config mismatch. Its bounded output is `/private/tmp/rhythm-web-default-specs-20261001.log`.
- Bucket A dedicated config with installed Chrome: 14 passed, 3 failed in 49.8 s. Failures: 5% screenshot drift in issue-1477 constrained header; Email signal option absent; Agent settings expected seven sections but rendered eight. These are outside the current recovery edits; the test and relevant source are unchanged HEAD. This is not a green gate.
- Session opening dedicated config with installed Chrome: 11 passed, 2 failed in 18.5 s. Both zero-mutation assertions observed startup `POST /opencode/mcp/rhythm/ensure`; that call is unchanged HEAD `apps/web/src/main.tsx:91` and `gateway/mcp.ts:92-99`. This is not a green gate.
- Electron slice manifest started with installed Chrome, one worker per config: E13 3/3 passed; E14 4 passed, 1 skipped, 5 failed; E15 11/11 passed; E16 8 passed, 2 failed; E20 16 passed, 15 failed. E14/E20 denied-request failures arise from unchanged HEAD startup MCP ensure and OpenAI account fetches (`store.tsx:251`). E16's binary attachment assertion expects a fabricated `file:archive.bin` URL but A1 intentionally sends actual selected bytes as `data:application/octet-stream;base64,...`; its managed-skills assertion expects an element hidden in live mode by unchanged HEAD `Profiles.tsx:368`. The sweep was stopped before a broad repeated fixture-denial cascade. Per-slice logs are `/private/tmp/rhythm-web-slice-*-20261001.log`.
- `lsof` after stopping showed no test listener on 4173, 4174, or 4175. No API/engine lifecycle, provider mutation, signed approval, or repository source edit was performed for this checkpoint. Tracked app/web screenshot outputs were not changed by these runs.
- The separate real E1 queue-read pass and empty-transcript banner repair are in `docs/ai/runs/2026-10-01-e1-empty-transcript-live-repair.md`. Its native signer and installed-package gates remain open.
