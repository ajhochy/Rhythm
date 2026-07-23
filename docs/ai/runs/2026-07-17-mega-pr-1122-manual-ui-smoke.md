---
date: 2026-07-17
repo: Rhythm
branch: mega/opencode-utilization-1042-1108
pr: 1122
issues: [1043, 1046, 1047, 1051, 1052, 1059, 1061, 1062, 1063, 1064, 1065, 1066, 1074, 1079, 1084]
status: 9 PASS (live) / 1 partial-live / 5 code-verified-only / 0 FAIL
tags: [run, Rhythm]
---

# Manual UI smoke — draft PR #1122 (mega, #1042–#1108)

Human manual-smoke step (per `project-state.md` "Next step") driven by a background
agent against a real `flutter run -d macos` build, connected to an isolated sandbox
backend on :4001 (copied DB, isolated HOME, `AGENT_LOCAL=true`), mirroring
`tools/dev/sandbox.sh up()` but on port 4001 so the Flutter app's hardwired
`localhost:4001` picked it up.

## Files

No source files changed. Read for verification: `_permission_card.dart`,
`agents_view.dart`, `_question_tool_card.dart`, `_project_vcs_chip.dart`,
`_at_mention_popover.dart`, `_files_tab.dart`, `rhythm_inspector.dart`, plus their
controllers/tests.

## Checks

| # | Item | Result | Evidence |
|---|------|--------|----------|
| #1064 | Changes tab scope toggle + export patch | ✅ PASS (live) | This session / All uncommitted / vs default branch toggle + export icon observed |
| #1066 | "Prepare project for agents" | ✅ PASS (live) | Session ⋮ menu shows the action wired to `initializeProject()` |
| #1061 | `@`-mention file popover | ✅ PASS (live) | Popover opened on `@`, correctly empty for non-project cwd |
| #1062 | Inspector Files tab | ✅ PASS (live) | Breadcrumb + directory listing; 2MB cap enforced server-side (`FILE_CONTENT_CAP_BYTES`) |
| #1059 | Worktree UI toggle | ✅ PASS (live) | "Run in isolated worktree" toggle present in new-session dialog |
| #1051 | Playbooks manager | ✅ PASS (live) | List + "+ New playbook"; built-ins/skill/MCP read-only, `playbook.managed` editable |
| #1052 | Slash popover | ✅ PASS (live) | Custom playbooks + built-ins both listed with arg hints |
| #1074 | Tool Permissions tri-state | ✅ PASS (live) | Ask/Allow/Deny segmented control, "12 overrides set" |
| #1079 | "Show in agent picker" | ✅ PASS (live) | Toggle present; profile list shows picker tags |
| #1063 | Branch badge (hidden case) | ✅ PASS (live, partial) | Confirmed hidden for non-git cwd; git-shown case verified in code only |
| #1043 | PermissionCard always-allow/deny-reason | 🟡 code-verified | Needs a live tool-approval turn; composer typing was unreliable |
| #1046 | Composer "Queued" chip | 🟡 code-verified | Needs an active agent turn to observe |
| #1047 | QuestionToolCard Other/multi-select | 🟡 code-verified | Needs a live question event |
| #1065 | `!cmd` shell escape | 🟡 code-verified | Composer keyboard input (backspace/typed text) was flaky under `cliclick` |
| #1084 | Prod-mirror task read-only | 🟡 code-verified | Sandbox DB has no `prod_mirror` rows; the real one only exists on production (correctly left untouched) |

**Result:** 0 FAIL. Every feature's UI/wiring confirmed present; gap is live-click
confidence on 5 items (agent-turn-dependent or composer-typing-dependent), not a
discovered defect.

## Notes

**Safety finding (latent bug, not caused by this PR):** `ApiServerService._killOrphanIfPresent()`
treats any process with PPID 1 as an orphan and kills it, then spawns its own
embedded server against **live production paths** (`~/Library/Application
Support/Rhythm/rhythm.db`). The first `nohup`'d sandbox launch had PPID 1 and got
killed+replaced this way; caught immediately (no writes occurred in that window),
fixed by relaunching without `nohup`. Recommend a follow-up issue: orphan-detection
should key off something more specific than PPID==1 (e.g. check the command line
for `--rhythm-sandbox`, or require the PID file to be stale) so a dev's backgrounded
sandbox server can't be silently replaced by one pointed at production.

**GUI automation:** `cliclick` coordinate clicks worked reliably (Accessibility
granted in this environment). Keyboard input (backspace/typed text) frequently
no-op'd or landed incorrectly — this is what blocked live verification of the 5
typing/turn-dependent items above, not a defect in the app.

Teardown completed cleanly: Rhythm app + `flutter run` quit, sandbox api_server
(verified via command-line containing `--rhythm-sandbox=...` before kill) and its
engine child killed, `:4001`/`:4097` confirmed free, `/tmp/rhythm-uismoke` removed.
Production was never touched. Nothing committed, pushed, or merged.
