---
date: 2026-07-07
repo: Rhythm
branch: fix/agent-scope-null-clear
status: ready-for-coding
issues: [931]
order: 3
depends_on: [923]
tags: [issue, Rhythm, mcp-scope, diagnostics, flutter]
---

# #931 — Surface degraded/deny-all scope states (minimal)

## Summary

Current logs and the Agent Profiles UI blur the difference between
unrestricted (`null`), deny-all (`[]`), malformed/fail-closed, and stale
profile metadata — so scope failures look like tool bugs. Add the smallest
possible diagnostic surface: profile id/name + scope kind in logs for
malformed/fail-closed/deny-all, and a UI badge/text distinguishing
unrestricted vs deny-all vs malformed/degraded. Reuse existing sheet and
data models; no new abstractions.

## Scope (in)

- API/log path: when scope resolves to malformed, fail-closed, or deny-all,
  include profile id + name + scope kind in the log line. Reuse existing
  logger; no new log framework.
- Agent Profiles sheet: distinguish unrestricted, deny-all, and
  malformed/degraded with existing badge/text widgets. Reuse
  `_agent_profile_sheet.dart` and current data models.
- Diagnostic-only. No auto-repair, no data mutation.

## Non-goals (out)

- No scope resolution logic changes (that is #923).
- No new data models, no new API endpoints, no new state machine.
- No auto-repair of malformed profile rows, no live data cleanup.
- No provider/auth lifecycle, no delegation security.
- No broad profile hygiene UI overhaul.

## Likely files

- `apps/api_server/src/services/agent_profile_scope.ts` (log lines)
- Agent-config route/model files if already carrying scope summaries — only
  if the field already exists; do not add a new endpoint.
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
- Co-located API parser/log tests (if a log harness exists) and a Flutter
  widget test.

> Run GitNexus `impact` on the scope resolver and the sheet widget before
> editing. Halt and surface on HIGH/CRITICAL.

## Acceptance criteria

- [ ] Logs for malformed / fail-closed / deny-all scope resolution include
      profile id, profile name, and scope kind (mcp vs skill).
- [ ] Agent Profiles UI visibly distinguishes:
      - unrestricted (null)
      - deny-all (`[]`)
      - malformed / degraded
- [ ] No behavior change to scope resolution or fail-closed semantics.
- [ ] No new data model, no new API endpoint.
- [ ] If Flutter touched: `dart format . --set-exit-if-changed` exits 0 and
      `flutter analyze --no-fatal-infos` exits 0.
- [ ] Focused API parser/log test (if cheap harness exists) OR a commented
      `// ponytail: log line, assert via grep in CI if no harness` note.
- [ ] One Flutter widget test for the visible status badge.

## Tests / validation

```bash
# API side (if log harness exists)
cd apps/api_server
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run src/services/agent_profile_scope

# Flutter side (if sheet touched)
cd apps/desktop_flutter
dart format . --set-exit-if-changed
flutter analyze --no-fatal-infos
flutter test test/features/agents
```

- If no log harness exists, skip the API log test and leave a `ponytail:`
  note naming the ceiling (manual grep verification in CI). Do not build a
  log harness for this ticket.
- One widget test is enough; no per-state matrix unless trivial.

## Safety notes

- Diagnostic-only. Do not mutate profile rows, do not auto-repair.
- No live runtime interruption; no production data edits.
- Draft PR only. No merge, no `main` push.
- Reuse existing widgets — do not introduce a new badge component if one
  already exists in the sheet.

## Dependencies

- #923 helpful (the unrestricted/deny-all distinction is meaningful only
  once clear actually lands). Can start UI in parallel if #923 is in flight,
  but do not merge before #923.

## Out-of-scope exclusions (explicit)

- #917 / #915 — excluded.
- No delegation security (#914/#920), no provider/auth lifecycle
  (#922/#927), no large features (#929/#930, #418/#71).
