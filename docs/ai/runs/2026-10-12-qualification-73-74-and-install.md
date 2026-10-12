---
date: 2026-10-12
repo: rhythm
branch: codex/rhythm-deliverables-completion-20261010
pr: none
issues: []
status: installed-0.18.74
tags: [run, rhythm]
---

## Files (commits)
5654e6b2 engine data path helper (XDG) + fixture API log · 03769f3b OpenAI sync + auth watcher run in qualification ·
776ed655 opencode.json writers honor RHYTHM_OPENCODE_CONFIG_PATH (real config was rewritten by 0.18.71) ·
23c6578c typecheck fix · 75253cbe goal capture verbs · 0727a7e8 stale-at-delivery summary · 03a07ad0 coordinator message timeout 60s.

## Checks
- 0.18.71: contract 14/15 (c12 needs a coding run); dispatch counters cross-checked against isolated engine history.
- 0.18.73: real coding run from chat in fixture; evaluator passed; held; in-app restart; c12 PASS.
  Dayflow/router cases are refused after a real coding delegation exists (deliberate active_authority guard).
- Leaks found and fixed: API read user's real auth.json; qualification rewrote user's ~/.config/opencode/opencode.json
  plugin list (restored; backup opencode.json.bak.20261012-before-qual-restore); API log in ~/Library/Logs.
- Live DB cleanup (backup rhythm.db.bak-20261012-before-claude-cleanup): root 90af1132 cwd/model/permission
  restored, test token + test project removed, 16 test manager/worker sessions archived; FK check unchanged (8 pre-existing).
- 0.18.74 verified (digest, codesign, spctl, stapler, team, source, engine) and installed as /Applications/Rhythm.app;
  runs on live DB, qualification route 404, Coordinator chat idle with no hold.

## Notes
AJ redirected scope: simple coordinator over the existing coding workflow; bounded layer considered over-built.
