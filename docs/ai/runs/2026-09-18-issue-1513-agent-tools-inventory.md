---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1513-agent-tools
pr: null
issues: [1513]
status: partial
tags: [run, rhythm]
---

# Issue #1513 Agent Tools inventory

Agents → Tasks remains the visual and interaction baseline. The shared
`ListInspector` owns compact rows, selection semantics, URL persistence,
responsive pane switching, and missing-item handling. Domain behavior stays in
`ToolWorkspace.tsx`.

| Tool | Old presentation | New presentation | Functions preserved |
| --- | --- | --- | --- |
| Brain | Expandable memory rows; live mode used a flat list | Compact memory title/source rows with full metadata and fixture edit/delete actions in the inspector | Fixture/live refresh and search, live source/verification metadata, fixture edit/delete |
| Deep Research | Bespoke project rail and report detail | Project rows with the complete run report, evidence tabs, run controls, export, magazine, discussion, archive, and retry in the inspector | Fixture/live create, start/cancel/resume, archive, copy, magazine, export, discussion, legacy research dialog |
| Tasks | Shared list-and-inspector reference | Unchanged shared baseline | Scheduling, enable/disable, edit/delete, trigger-now, and run history |
| Webhooks | Action-heavy flat rows | Endpoint rows with URL, prompt, delivery metadata, copy, and delete in the inspector | Refresh, create, one-time secret display/copy, revoke/delete |
| Profiles | Existing profile list and selected-profile inspector | Unchanged; explicitly excluded for #1523 | All profile selection and controls remain owned by `Profiles.tsx` |
| Skills | Bespoke catalog split in fixture/live modes | Searchable catalog rows with content, live metrics, edit, and delete in the inspector | Fixture/live refresh, create, edit/delete managed skills, live reload/content/error behavior |
| Playbooks | Bespoke catalog split in fixture/live modes | Searchable slash-command rows with template and managed actions in the inspector | Fixture/live refresh, create, edit/delete managed playbooks, read-only policy, composer availability notice |
| Cookbook | Action-heavy recipe rows | Recipe title/step rows with steps, run, session status, and delete in the inspector | Fixture/live refresh, create, run/open owned session, delete |
| Review Queue | Proposal card grid with actions repeated per card | Proposal rows with evidence, safety projection, deployment/outcome state, and human-gated actions in the inspector | Status filter, refresh, evidence expansion, approve/conditional approve/reject/revert, confirmations |
| Report Card | Bespoke agent rail and report detail | Agent/run-count rows with metrics and run evidence in the inspector | Time-window filtering, refresh, completion/waste/corrections, repeated-mistake and evidence detail |
| Email | Bespoke signal rail and message detail | Subject/sender rows with message context and selected-signal launch action in the inspector | Refresh, read-only message inspection, seeded Email Assistant launch |
| Gallery | Artifact card grid plus separate selection summary | Artifact rows with specialized media preview, metadata, deliverable/project actions, and selected-artifact launch in the inspector | Fixture/live refresh, image/video/icon preview fallback, open deliverable/project, seeded Creative Media launch |
| Agent Settings | Fixture/live configuration lists | Unchanged; explicitly excluded for #1514 | `SettingsTool`, `LiveSettingsTool`, and `AutoPromotionSettings` remain untouched |

## Checks

- `cd apps/web && npm run typecheck` — pass; `tsc -b` exited 0 with no diagnostics.
- `cd apps/web && npm run build` — pass; 1,683 modules transformed and Vite built
  the production bundle in 13.49 seconds. Vite retained its existing warning for
  the 1,489.22 kB JavaScript chunk.
- `cd apps/web && node --test src/components/ToolWorkspace.contract.test.mjs` —
  pass; 13 tests passed, 0 failed.
- `git diff --check` — pass; no whitespace errors.
- Playwright, screenshots, the Electron runtime, and live-backed action checks —
  not run. This worker was explicitly prohibited from binding sockets, launching
  Playwright, starting Vite, or launching Electron. The fixture-mode rendered
  coverage is authored in `apps/web/tests/pages/agent-tools-list-inspector.spec.ts`
  for the orchestrator to run, including same-viewport screenshots for every
  in-scope tool plus narrow-width and 200% zoom receipts.
