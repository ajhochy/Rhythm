---
date: 2026-07-02
tags: [decision, rhythm, security]
issues: [873, 877, 878]
---

# Adapt security issues #873/#877/#878 from their Python prior art to Rhythm's Node/TypeScript stack

## Context

Issues #873, #877, and #878 were filed with "likely files" and prior-art
references (`hermes_cli/security_advisories.py`, `tools/approval.py` in
NousResearch/hermes-agent) that assume a Python/pip codebase: `context_loader.ts`
and `shell_tool.ts` (named but non-existent), `rhythm doctor`/`rhythm_config.ts`
(no such CLI exists), and a `pip install` remediation format. Rhythm's
`apps/api_server` is Node/TypeScript with npm, no Python, and no CLI entrypoint
beyond the Express server.

## Decision

Implement the acceptance criteria against real Rhythm chokepoints, adapting
format/tooling to the actual stack, not the prior art's literal shape:

**#873 (prompt-injection scanning)** — no `context_loader.ts` exists. Traced
where file content actually becomes model-loadable:
- `rhythm_managed_skills.writeManagedSkill()` writes `SKILL.md` bodies the
  opencode engine loads via `config.skills.paths`.
- `opencode_agent_writer.writeAgentProfileFile()` projects an Agent Profile's
  `systemPrompt` into a `~/.config/opencode/agents/<id>.md` file the engine
  loads as that agent's system prompt.

Both are Rhythm-owned write points (not inside `apps/opencode_fork`, which is
out of scope). `writeManagedSkill` throws a new `ContextInjectionBlockedError`
(mirroring the existing `InvalidSkillNameError` pattern already handled by its
callers); `writeAgentProfileFile` skips the write and logs, preserving its
documented "never throws" contract.

**#877 (supply-chain advisory scanner)** — the advisory shape (id, package,
affected_versions, description, remediation, severity) is unchanged from the
Python prior art; only the ecosystem and remediation command changed
(`npm install` instead of `pip install`). The scanner reads
`apps/api_server/package-lock.json` directly (stdlib `fs`/`JSON.parse`, no
network) rather than shelling out to `npm ls`, keeping it fast and dependency-free.
`rhythm doctor` (setup-01) does not exist yet, so only the startup-banner half
is wired into `server.ts`; `runAdvisoryCheck()` / `formatDoctorReport()` /
`AdvisoryAckStore` are built and unit-tested so `doctor` can call them directly
once that CLI lands.

**#878 (command approval)** — no `shell_tool.ts` exists; the agent's actual
bash execution lives inside `apps/opencode_fork` (out of scope). The correct
Rhythm-owned interception point is `opencode_stream_bridge.ts`'s
`permission.asked`/`permission.updated` handling — the same chokepoint the
existing #736 MCP dispatch guard uses, confirmed to fire for the `bash` tool.
The classification runs BEFORE the `bypassPermissions`/`acceptEdits`
auto-accept logic so a hardline-blocked or high-risk command can never be
waved through by a permissive session mode. "smart" mode's risk assessment is
a local deterministic heuristic classifier (`command_risk_classifier.ts`), not
an LLM call — required by the issue's own data-safety section ("must be a
local classifier... not a separate network call").

## Two bugs found only by running the app, not by the first unit-test pass

1. **`.env` pattern false-positive.** `#873`'s `secrets-dotenv` pattern
   (`\.env\b`) matched `.env` inside ordinary `process.env.X` property access.
   Manually running the built server surfaced a real false-positive: the
   `acceptance-contract` skill's own body (`if (!process.env.TEST_DB_URL)`)
   got blocked at skill-materialization time. Fixed with a negative
   lookbehind/lookahead so `.env` must look like a file reference, not a
   property chain. Regression test added in `context_scanner.test.ts`.

2. **Frozen `env.approvalsMode` snapshot.** `#878`'s config followed the
   flat-export `env.ts` pattern, computing `approvalsMode` once at module
   import. A test that mutated `process.env.APPROVALS_MODE` per-test to
   exercise `smart`/`off` modes had no effect — the value was already frozen.
   Fixed by adding `resolveApprovalsMode()` (reads `process.env` fresh per
   call), matching the existing live-read convention already used elsewhere in
   `env.ts` for exactly this reason (`resolveMemoryVaultPath()`,
   `isSkillInjectionEnabled()`). The dispatch site in
   `opencode_stream_bridge.ts` calls the live resolver, not the frozen
   `env.approvalsMode` snapshot.

Both were caught before commit (manual `dist/server.js` smoke for #1; a
failing integration test for #2) and are now regression-tested, but neither
would have been caught by `tsc` or a superficial "does it compile and do the
happy-path tests pass" check — both required exercising the real
integration surface.

## Alternatives considered

- **Vendor the Python prior art's file layout literally** (e.g. write a
  `context_loader.ts` stub just to match the issue's suggested path). Rejected:
  would create a second, unused code path alongside the real integration
  points, and the issue's acceptance criteria are behavioral, not path-literal.
- **Add a full `rhythm doctor` CLI as part of #877** to satisfy the "likely
  files" list completely. Rejected: out of scope — `setup-01` is a separate,
  unassigned issue that owns the CLI; #877's own text says "startup banner
  integration may be independent," and building a CLI here would be scope
  creep into another issue's ownership.
- **Route #878's "smart" mode through the model's own session** (as the issue
  allows: "or use the already-authenticated session provider"). Rejected for
  this pass: added complexity and a second decision path (model call latency,
  prompt-injection surface via classifying attacker-controlled command text)
  for a first implementation; the local heuristic classifier meets the
  low/high/uncertain contract and escalates uncertain cases to a manual ask,
  which is the safe fallback either way.

## Consequences

- `apps/api_server/src/security/` is now the home for all three security
  modules — a natural landing spot for future security work (e.g. the
  eventual `rhythm doctor` CLI, or a future non-bash tool's approval gate).
- The advisory list (`advisories.json`) and blocklist/risk patterns are
  data-driven files, reviewable and extensible without touching control flow,
  per each issue's explicit "maintainable list" requirement.
- `resolveApprovalsMode()` sets the precedent that any FUTURE `approvals.*`
  config field needing runtime reconfigurability (not just process-start
  config) should follow the same live-read pattern, not the frozen `env.X`
  snapshot.
