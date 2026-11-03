---
date: 2026-10-22
tags: [decision, rhythm, tailscale-web]
index: "[[Rhythm]]"
---

# Browser parity scope confirmed at external Codex handoff

## Context

Resume `feat/tailscale-web-app-20261022` at `6081e4fd8101b9e532758b1930143a12e79ae0ea` in the existing eager-star worktree. AJ answered the handoff's scope questions in this chat before any build. The private tailnet remains the access boundary, with one validated existing owner and no browser login or bearer.

## Decision

AJ accepted all six recommendations:

- Include the six Coordinator/primary-chat/shared-agent cases in the browser bar; use the validated owner server-side for the existing local auth boundary.
- Exclude the twelve classifier cases with no renderer path from the browser bar.
- Row #55 pins a web-visible tool instead of the native Dayflow card.
- Row #48 requires a nonempty tool list containing `rhythm_ping`, rather than the moving count 114.
- Scripted loopback-provider substitutions count as UI/transport proof only, with this limit stated in results.
- Use `20471a238e` as the confirmed-working baseline for the broad prior selections; retain later per-row evidence where applicable.

AJ separately authorized: "Yes, run the required paid Grid checks" using the existing Decisions connection. After the audit resolved #118, AJ also authorized the three additional paid parity cases in isolated fixtures: #109 MCP profile scope, #110 Coordinator two-goal work, and #118 the existing snapshot scan. This does not authorize unrelated paid evaluation or agent runs.

AJ accepted the native exclusions for this phase: embedded Hermes Desktop, Colony/Bot Crossing scene, native Dayflow app, packaged stdio-MCP property, Hermes paid turn, and Electron notification overlay. AJ added: "eventually i will want the other services available, but for now thats fine."

The exact plan section 5 text shown to AJ was:

> Hide/disable only truly native controls: Electron window management, launching native Dayflow, embedded Electron Hermes/Colony views. Do not label those working in a browser. Keep ordinary workspace pages and the existing layout; no redesign.

## Alternatives

Requiring paid inference for every UI/transport check, rerunning the entire historical baseline first, retaining classifier-only checks in browser parity, or implementing all native companions in this phase. AJ chose the bounded scope above.

## Consequences

Every matrix result must identify actual proof and exclusions. #116 requires synthetic browser verification but the local route is not bearer-gated in AGENT_LOCAL mode; no auth change is justified by its old token assertion alone. #118's mapping is confirmed by the retained rerun log `/private/tmp/rhythm-org-evaluation-actual-secretary-3332856559-rerun-claude-20261021.log` (command at line 3, passing spec/title at line 9, total at line 11) and reporter identity/status metadata. It is a packaged scan-safety pass, not improvement proof or browser proof. Resolving it gives 118 previously confirmed packaged cases; the 13 native and 12 classifier exclusions leave 93 browser acceptance cases.

Candidate real-data launch still requires a read-only SQLite backup and the daily app quit, with one runtime owning ports 4001/4002/4096. Credential export is AJ's native host action; inspect only file metadata. Real-account writes retain the exact-ID, uniquely marked, AJ-only cleanup rules in `2026-10-22-web-cloud-test-records.md`. No permission to push, open a PR, merge, deploy, change networking/Tailscale, install a LaunchAgent, or delete preserved worktrees was added.
