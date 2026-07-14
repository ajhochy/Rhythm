---
date: 2026-07-14
repo: Rhythm
branch: fix/boot-stomp-config-revert-class
pr: null
issues: [930]
status: diagnosed
tags: [run, Rhythm]
---

# Fallback plugin config repair

## Files

- `~/.config/opencode/opencode.json` — removed 15 stale/duplicate Anthropic plugin registrations and retained only the plugin bundled in `/Applications/Rhythm.app`.

## Checks

- Live `/opencode/auth/`: Anthropic, OpenAI, Google, and OpenRouter are authenticated.
- Live `/opencode/auth/accounts`: Team and Personal Claude accounts are present and healthy.
- Compared plugin hashes: the config referenced multiple different existing builds plus twelve missing paths.
- `python3 -m json.tool ~/.config/opencode/opencode.json` passed after repair.

## Notes

- The running engine loaded the old plugin list and requires a Rhythm app restart before the repair is active.
- Root recurrence risk is source-level: `ensureRequiredPlugins()` preserves stale absolute paths to other copies of `rhythm-anthropic-accounts`, allowing each dev/worktree launch to accumulate another registration. It should remove prior paths for that vendored plugin before adding the current build's resolved path.
- Symptom confirmed against the stale `958-wiring` copy: it implements `markSpillover()` for Team Claude → Personal Claude, but does not contain `markAccountsExhausted()` or an `exhausted:true` report. If that registration wins the shared Anthropic auth hook, same-provider fallback works while the server never receives the signal required to redispatch onto Codex/Gemini/OpenRouter.
- After restart, re-run the live forced-exhaustion fallback test to verify Team Claude → Personal Claude → Codex → Gemini behavior on this machine.
