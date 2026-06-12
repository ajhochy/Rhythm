# OPC-M2-3 — Tool-specific renderers (diff, terminal, checklist, child-session chip)

**Milestone:** M2 — Rendering parity
**Branch:** `opc-m2-3-tool-specific-renderers`
**Depends on:** OPC-M2-1

## Summary

Replace the one-size generic tool card with per-tool renderers matching OpenCode conventions,
dispatched by tool name with the generic args+output card as fallback:

- `edit` / `write` / `apply_patch` → unified diff widget (new `_UnifiedDiffView`: per-line +/- coloring via tokens — success-tinted additions, danger-tinted deletions, monospace, file path header, collapsed beyond 20 lines with "Show all")
- `bash` → terminal-style output: monospace, preserved whitespace, ANSI escape sequences stripped, command shown as header, exit-code badge on error state
- `todowrite` → checklist (checked/unchecked per item status)
- `task` → child-session chip showing the subagent description + status (navigation wired in M3-6; chip is inert here)
- `read`/`glob`/`grep`/`webfetch`/`websearch`/`skill`/`plan`/`lsp` → keep generic card (explicitly listed as fallback)

ToolState (pending/running/completed/error) drives a leading status indicator on every renderer.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (dispatch)
- `apps/desktop_flutter/lib/features/agents/views/_tool_renderers/` (new: `_unified_diff_view.dart`, `_terminal_output_view.dart`, `_todo_checklist_view.dart`, `_task_chip.dart`)

## Acceptance criteria

1. An `edit` tool part (real-shape fixture with old/new content or patch) renders the diff view: added lines styled with the success role, removed with danger, monospace family; file path visible.
2. A diff longer than 20 lines renders collapsed with a "Show all (N lines)" affordance that expands on tap.
3. A `bash` tool part renders the command header + output with preserved whitespace (multi-space run intact in the rendered string) and ANSI codes stripped (fixture contains `\x1b[31m`; rendered text does not); error state shows the exit code.
4. A `todowrite` part renders one checklist row per todo with correct checked state.
5. A `task` part renders a chip with the subagent description and live ToolState indicator.
6. An unrecognized tool name renders the existing generic card (regression test).
7. ToolState pending/running/completed/error each render a distinct indicator (golden-free: assert by icon/semantics).
8. All colors via `RhythmColorRoles`; `flutter test` green; `ai-workflow checks --level pr` exits 0.

## Required tests (flutter test)

- New `opc_m2_3_tool_renderers_test.dart` covering criteria 1-7 with recorded v1.14.49 tool-part fixtures (one per tool).

## Out of scope

- Child-session navigation (M3-6). Changes-tab session diff (M3-1 — reuses `_UnifiedDiffView`). Todo side panel (M3-5 — reuses checklist widget). Real terminal/PTY (out of scope permanently).
