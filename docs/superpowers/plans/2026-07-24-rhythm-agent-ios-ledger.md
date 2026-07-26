# Rhythm Agent iOS Implementation Ledger

**Plan:** `docs/superpowers/plans/2026-07-24-rhythm-agent-ios-roadmap.md`

**Active Rhythm worktree:** `/Users/ajhochhalter/Documents/rhythm-worktrees/run0724-mobile-1172`

**Local branch:** `codex/mobile-1172-agents-activity`

**Draft PR:** `#1165` from remote branch `feat/rhythm-agent-ios-roadmap`

**Shipping location:** `apps/mobile` inside the Rhythm monorepo. Do not open a
PR from the separate mobile source repository.

| Task | Repository | Status | Review status | Current evidence / blocker |
| --- | --- | --- | --- | --- |
| 1 Foundation verification | Rhythm `apps/mobile` | complete | clean | Foundation/static/browser gate integrated |
| 2 Transport contracts | Rhythm `apps/mobile` | complete | clean after fix | Cloud and paired-host credential isolation integrated |
| 3 Rhythm account shell | Rhythm `apps/mobile` | complete | clean after corrective review | OAuth/sign-out/SecureStore findings resolved |
| 4 Pairing persistence | Rhythm | complete | clean | Verifier-only, replacement, rollback, and live behavior covered |
| 5 Gateway auth/project scope | Rhythm | complete | clean | Owner/project/auth negative cases covered |
| 6 HTTP proxy/compatibility | Rhythm | complete | clean | Focused behavior and direct live containment pass on the plan-mandated `4098/4097` sandbox |
| 7 SSE/PTY proxy | Rhythm | complete | clean after corrective review | Real SSE and PTY behavior pass in an isolated rebuilt stack |
| 8 Desktop mobile access | Rhythm | complete | clean | Human-capability administration and safe diagnostics covered |
| 9 iOS pairing | mobile | complete | clean | Native simulator replacement/revocation smoke and contracts pass |
| 10 Information architecture | mobile | complete | clean | Exactly Agents, Tools, and Settings |
| 11 Chats/recovery | mobile | complete | clean | Chat lifecycle, cache, reconnect, and nested sessions covered |
| 12 Activity feed | both | complete | clean after corrective review | Live aggregation/deep links pass; maximum-Dynamic-Type native corrective smoke passes |
| 13 Core tools | mobile | complete | clean after corrective review | Brain, Research, Scheduled Jobs, and Webhooks lifecycle covered |
| 14 Admin tools | mobile | complete | clean after corrective review | Profiles, Cookbook, Review Queue, and Report Card covered |
| 15 Integration/local tools | mobile | complete | clean after corrective review | Email, Gallery, Skills, Playbooks, MCP, and Models covered |
| 16 OpenCode parity | mobile | complete | clean | Generated `1.14.49` contract, classifications, gateway parity, and rebuilt-engine live test pass |
| 17 Final regression/review | both | source gates complete | Important findings corrected and re-tested | Full issue/PR gates, current-head live gaps, GitNexus scope, and focused audits pass; push/CI and immutable human whole-branch review remain |
| 18 Live/EAS/device release | both | human-gated | automated exact/alternate-port live matrices pass | Apple login/signing, registered physical iPhone smoke, production build, and TestFlight require the human release gate |

## Current stop boundary — 2026-07-25

The source implementation and automated isolated live matrix, including the
exact `4098/4097` rerun, are complete. PR #1165 stays draft and must not merge.
The release phase stops at the human-controlled whole-branch PR review, Apple
credentials/device registration, physical-iPhone smoke, subjective acceptance,
and TestFlight gates. Current commands and evidence live in
`docs/ai/runs/2026-07-25-mobile-roadmap-finalization.md`.
