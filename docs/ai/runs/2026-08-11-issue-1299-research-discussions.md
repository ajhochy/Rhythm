---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/research
pr: null
issues: [1299]
status: needs-orchestrator-smoke
tags: [run, Rhythm]
---

# Files

- Added owner/run-scoped frozen discussion snapshots, confined selected full-text reads, curated source/citation rules, missing-evidence behavior, budget gates, and durable Q&A-to-agent-session linkage.
- Extended the existing Q&A link schema additively in SQLite and Postgres; normal session/messages remain authoritative for conversation lifecycle and usage.
- Added the approval-gated MCP discussion tool and Flutter artifact selector/Discuss Report action that selects the linked normal Chats session.

# Checks

- API #1291/#1298/#1299 plus migration replay — 18/18 passed; API build passed.
- MCP typecheck and external-content role graph — 4/4 passed.
- Dart format clean; focused Dart analysis and full Flutter analyze exited 0 with info-only baseline.
- GitNexus: AgentRunner, controller, Flutter data/controller, MCP research registration, and API security action impacts LOW; migration surface was HIGH and was kept additive-only with replay/parity coverage; final cumulative compare LOW.
- Focused Flutter widget test — could not execute because `flutter_tester` cannot bind `127.0.0.1:0` (`EPERM`).

# Notes

- Discussion sessions receive the frozen report/source/full-text snapshot in their initial persisted prompt and have MCP/skill expansion disabled, preventing later-artifact context leakage.
- The real follow-up answer/citation/resume conversation is assigned to #1300's isolated sandbox E2E.
