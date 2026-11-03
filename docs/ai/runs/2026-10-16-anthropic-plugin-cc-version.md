---
index: "[[Rhythm]]"
date: 2026-10-16
repo: rhythm
branch: fix/anthropic-plugin-cc-version
pr: 1618
issues: []
status: draft-pr
tags: [run, rhythm]
---

# Anthropic model gate: vendored plugin claimed Claude Code 2.1.112

**Symptom.** Every agent session on current models failed with: "Claude Code 2.1.112 does not support this model; version 2.1.280 or newer is required." It looked system-wide.

**Root cause.** It isn't an installed `claude` binary (global CLI 2.1.296, desktop app 2.1.299). The opencode engine calls Anthropic through `apps/api_server/opencode_plugins/rhythm-anthropic-accounts`. Its `dist/model-config.js` hard-coded `ccVersion: "2.1.112"`, which the plugin sends as the `claude-cli/<v>` user-agent and the `cc_version=` billing header. Anthropic gates opus-5-5, sonnet-5-5 and fable-5-1 on that claimed version. All 17 local Rhythm builds and worktrees carry the same constant.

## Files

- `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/model-config.js`: `ccVersion` 2.1.112 → 2.1.296, plus a `// rhythm:` note on when to bump it
- `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/VENDORED.md`: records the local modification
- `apps/api_server/src/__tests__/anthropic_plugin_routing.test.ts`: regression test that the claimed version is ≥ 2.1.280

## Checks

- Live probe (a scratch script drives the plugin's real `fetch` → api.anthropic.com): 2.1.112 → 400 with the exact user error; 2.1.296 → 200 on all three models, with and without the `ANTHROPIC_CLI_VERSION` override
- The regression test fails on 2.1.112 (`2001112 < 2001280`) and passes on 2.1.296; plugin suites 26/26
- `ai-workflow checks --level pr`: flutter analyze/format/test, api_server tsc/lint/build, and mcp_server tsc/vitest/build pass
- Failure-triage (OUT OF SCOPE, environmental):
  - `native_runtime_guard.test.ts` fails because the local root `node_modules/better-sqlite3` is 12.8.0 while `package.json` requires `^13.0.3`. It fails identically on the untouched checkout. Fix locally with `npm install` in the main checkout.
  - Fork typecheck/session and mobile static/web-e2e didn't run because the worktree has no node_modules for those apps. PR CI is authoritative.
- gitnexus `detect_changes`: 3 files, `config` const only, risk low

## Notes

- Installed builds (`/Applications/Rhythm.app` and the `/private/tmp` candidates) stay broken until they are rebuilt from a branch with this fix. Stopgap without a rebuild: the engine inherits api_server's env, so `launchctl setenv ANTHROPIC_CLI_VERSION 2.1.296` followed by a Rhythm relaunch works.
- This will recur with the next model generation. Bump `ccVersion` to the installed `claude --version`.
- The mega branch (`mega/2026-09-29-consolidation`) has the same constant and needs this commit cherry-picked if it ships first.
