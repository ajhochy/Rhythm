# Summary

- Fixed #1510 preference migration so saved explicit `true` and `false` choices survive hydration, host changes, and relaunch; only a missing value takes the default-off behavior.
- Fixed #1510 terminal playback handling so failure, cancellation, and idle remain sticky for the affected session. Replayed `busy` events cannot restart audio; only explicit prompt submission opens the next turn generation.
- Fixed #1373 legacy relay adoption so only relay reachability failures fall back to the stored direct path. Relay 401, 403, invalid health, and mismatched-host responses now fail closed with visible, actionable state.
- Added regressions that failed before the implementation and pass afterward.

# Files changed

- `apps/mobile/providers/opencode-provider-utils.ts` — preserve stored working-sound booleans during migration.
- `apps/mobile/providers/opencode-provider.tsx` — keep terminal sound state closed across replayed busy events.
- `apps/mobile/lib/pairing/paired-host-store.ts` — propagate relay auth/scope/identity failures and expose actionable states.
- `apps/mobile/tests/contract/issue-1510-working-sound.test.mjs` — cover explicit preference preservation and busy replays after failure/cancellation.
- `apps/mobile/tests/paired-host.test.mjs` — cover relay 401, 403, and mismatched-host adoption failures without direct fallback.
- `REPORT.md` — this report.

# Checks run

- Launch discipline: `pwd` returned `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-review-r1`; `git rev-parse --abbrev-ref HEAD` returned `mega/fix-review-r1`; patch-based write probe passed and was removed.
- Red regression run: `cd apps/mobile && node --test tests/contract/issue-1510-working-sound.test.mjs tests/paired-host.test.mjs` — failed as expected on explicit opt-in preservation, replayed busy after failure, and relay 401/403/host mismatch.
- Focused green rerun: the same command — passed 15/15 tests.
- Required self-check: `cd apps/mobile && npm run typecheck && npm run lint && node --test tests/contract/issue-1510-working-sound.test.mjs tests/paired-host.test.mjs tests/provider-utils.test.mjs` — exit 0; 16/16 tests passed. Lint reported three existing warnings in unrelated files and zero errors.
- `git diff --check` — passed.
- Branch/SHA checked: `mega/fix-review-r1` at `c429d3688ed84e41e2c33db16d1e9fcfc0cf523a` (working-tree changes are intentionally uncommitted).

# Decisions

- Treat any stored boolean as an explicit user choice. The migration marker remains for compatibility, but does not override saved `true` or `false`; absence alone maps to `false`.
- Use the existing per-session stopped set as the terminal-state guard. Terminal events close the current generation; `sendPrompt` is the only production path that reopens playback for the next generation. Non-idle status replays never reopen it.
- Relay fallback is limited to normalized network failures, status 0, and 5xx reachability failures. A 401 neutralizes the rejected device credential and publishes `revoked`; a 403 preserves the credential and publishes actionable `accountMismatch`; a health response for another host is rejected before relay adoption.
- MAJOR 3 was not implemented: physical-iPhone and actual-Electron audible source attribution/qualification remains AJ-hands work.
- MAJOR 5 was not implemented: relay SSE/PTY/prompt resume, tenant/project isolation, and sanitized observability proofs remain outside this branch.
- MAJOR 6 was not implemented: packaged-app icon/signature/visual evidence belongs to the Electron worker/AJ qualification path.
- No sockets, servers, commits, stashes, checkouts, or repo files outside `apps/mobile/**` and `REPORT.md` were modified. The required Dev Dashboard run tracker was updated through its publish script after verification.
- GitNexus tools and a repo-local index were unavailable in this session. Before editing, targeted static caller analysis found two migration hydration callers, one private relay-adoption caller, and provider-local sound-state callers; no high/critical blast radius was identified.
