---
date: 2026-07-03
repo: Rhythm
branch: workflow/run-2026-07-03
pr: []
issues: [881, 870, 880, 884, 885, 883, 874, 875, 876, 871, 872, 879, 873, 877, 878]
status: PR open, awaiting review (never auto-merge)
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-03 — Workflow run: 15-issue backlog sweep (setup agent, security, delegation, tooling)

Everything open except mobile (#418/#71). #881 fixed in-process; 8 parallel
worktree agents (contract-first, no-reinstall rule + root node_modules symlink
fix mid-run) covered the other 14; folded sequentially with checks between.

## Issues
- **#881** curated-registry c1 → subset assertion (green WITH the machine-local sidecar).
- **#870** `rhythm_create_issue` MCP tool (GitHub REST, env token never on disk, dev-role wildcard scope; #864 guard extended to 19 groups).
- **#880** agent-profile export/import API (versioned bundle v1, secret-scan at export, preset-protected, idempotent). CLI wrapper deferred (decision doc).
- **#884** Gemini 512-function-declaration cap at the wire choke point (`gemini_tool_cap.ts` in `createSession`/`updateSessionAllowlist`; deterministic trim + machine-readable warning).
- **#885** Memory Vault path = persisted setting → injected into spawned api_server env (auto-detect AGENT-MEMORY; external env wins; Settings UI section).
- **#883** secretary: `rhythm_delegate` granted; manager flag + 7-specialist roster now canonical in the role file with backfill-only seed.
- **#874/#875/#876** skills: `required_env` frontmatter + validation; toolset-conditional visibility (discovery gate composing with the execution allowlist); allowlisted venv-only lazy pip installs with audit log (hooked on session.idle).
- **#871/#872/#879** setup CLI: `rhythm doctor` (8 checks, ✅/❌ + remediation, exit codes), `rhythm setup` Quick/Full (PromptIO seam, atomic 0600 .env writes, Ctrl+C-safe), blank-slate mode (`rhythm-capabilities.json`, explicit-false survives updates). Sandboxed manual smoke caught 4 real stdin/fs bugs.
- **#873/#877/#878** security: context injection scan at the two model-loadable write chokepoints (5 high-confidence pattern classes; lookaround fix for `.env` false-positive); npm supply-chain advisory scanner (curated IOC JSON, startup banner + CI step + lockfile vitest, postbuild copy fix); shell command approval at the permission chokepoint (hardline blocklist → always-allowlist → mode dispatch, fail-closed timeout, positioned BEFORE bypassPermissions).

## Checks (integrated, post-fold)
api_server tsc clean + vitest **273 files / 2330 pass / 1 skip / 0 fail** (the #881
test now passes locally too); mcp_server build + **67 pass**; Flutter analyze 0
errors + format clean + **793 pass**.

## Notes
- Worktree provisioning gap: root `node_modules` symlink was missing (root-hoisted
  deps) — #880's agent found it; fixed across all worktrees mid-run. Extends the
  2026-07-02 worktree-deps decision.
- Cross-issue integration follow-ups (not expanded in-run): wire `rhythm doctor`
  to #874's `required_env` + #877's advisory acks (both landed this run in separate
  worktrees); `rhythm-capabilities.json` has no runtime enforcement reader yet;
  #878 bash-arg shape + #876 skill-part shape want a live-engine smoke.
