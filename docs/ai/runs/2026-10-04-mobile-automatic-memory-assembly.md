---
date: 2026-10-04
repo: Rhythm
branch: codex/mobile-memory-terra-local-20261004
pr: null
issues: []
status: unverified
tags: [run, rhythm, api-server, mobile, memory]
---

# Mobile automatic-memory assembly — source-only run

## Scope

- Base: `48fd15593c3037053e320f1829f2135f596de1b7`.
- Backend-only change. The frozen TestFlight 18 mobile client was not edited,
  built, activated, or published.
- No application, native retrieval service, API, provider, model, private
  credential, private vault, or server was accessed. All exercised paths used
  in-memory SQLite, temporary synthetic canonical files, and fake fetches.

## Files

- `apps/api_server/src/services/automatic_memory_preface.ts`
- `apps/api_server/src/services/ws_gateway.ts`
- `apps/api_server/src/services/mobile_opencode_proxy.ts`
- `apps/api_server/src/__tests__/mobile_automatic_memory_assembly.test.ts`
- `docs/ai/runs/2026-10-04-mobile-automatic-memory-assembly.md`

The shared helper uses the existing automatic retrieval and body-free
provenance mechanisms. WS keeps its existing transient-system layering. The
mobile async path runs only after authorization and duplicate suppression,
requires the server catalog's matching owner/project/cwd binding, and adds a
preface only to the per-forward hidden system body before its existing final
size check. Missing, foreign, or null-owner catalog rows skip memory only;
they do not alter transport authorization. Sync prompt operations remain
denied.

## Checks

- RED before source change: the new isolated mobile assembly regression failed
  3 of 5 assertions because the old proxy forwarded no memory preface,
  retrieval, or provenance.
- GREEN:
  `cd apps/api_server && env -i HOME=<fresh-home> TMPDIR=<fresh-tmp> PATH=/usr/bin:/bin /Users/ajhochhalter/.local/bin/node node_modules/vitest/vitest.mjs run src/__tests__/mobile_automatic_memory_assembly.test.ts`
  — 5/5 passed.
- Focused non-server synthetic suite used the same isolated environment and
  direct Vitest command across the mobile assembly, WS seam, canonical
  own/global join, semantic retrieval, provenance, mobile routing, managed
  history, catalog, and profile-scope contracts — 102/103 passed.
- The sole failure was the pre-existing
  `issue_1285_mobile_prompt_stream` fixture: it does not initialize an
  isolated managed-history SQLite database, so the unchanged first proxy guard
  returns `RECONCILIATION_REQUIRED` before the new assembly point. The
  supervisor independently reproduced the same result from an untouched exact
  base archive; no fixture or guard was changed here.
- Typecheck:
  `cd apps/api_server && env -i HOME=<fresh-home> TMPDIR=<fresh-tmp> PATH=/usr/bin:/bin /Users/ajhochhalter/.local/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false`
  — exit 0.
- `git diff --check` — clean.

## Limitations and next verification

This is unverified, source-only evidence. It does not establish behavior in a
packaged client, paired phone, running backend, or real retrieval service.

After the normal builder handoff, perform one ordinary authenticated paired
mobile Sol prompt in a fresh owner-bound chat with the same generic request.
Verify the server-side canonical provenance references, exactly one hidden
engine memory block, and one completed zero-tool turn through the normal mobile
gateway—not merely through desktop WS.
