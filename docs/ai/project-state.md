# Rhythm — Project State

## Current focus

- **Bucket H2 API/OCU (#1058, #1063, #1088):** automated verification passed; draft PR #1461 open.
- Preserve unrelated active work: Org Optimizer/self-improvement #1448, mobile smart-client PR #1383, Numbat observability PR #1453, H1 Flutter fixes PR #1459, and Bucket C relay/mobile PR #1460.

## Active branch / PR

- H2: `codex/mega-h2-api-ocu` → draft PR #1461; verification PASS `e75c2091-c349-4c24-85b3-52469ea58f95`, preserving functional evidence from `721a2db7-14da-4d11-915d-22a478abd6f1`.
- Org Optimizer/self-improvement: `agent-stack/si-causal-runtime-v2-codex`; issue #1448 continues beyond unaffected foundation draft PR #1398.
- Mobile smart client: `mobile/smart-client-rebuild` → PR #1383; manual smoke pending.
- Numbat observability: `numbat-opencode-observability` → PR #1453; manual smoke pending.
- H1 Flutter fixes: `codex/mega-h1-flutter-fixes` → draft PR #1459; manual smoke pending.
- Bucket C relay/mobile: `codex/mega-c-relay-mobile` → draft PR #1460; archive, TestFlight, and physical-device smoke pending.

## In progress

- H2 contract `docs/ai/contracts/issue-1058-1063-1088.json`: **12/12 pass**, `not_tested` empty; run note `docs/ai/runs/2026-08-19-mega-h2-api-ocu.md`.
- Worktree cleanup is explicit opt-in and defaults to **KEEP**. Cleanup resolves the primary repo, deletes the engine session before removing the linked worktree, and retains local worktree metadata on failure.
- The migration is additive, nullable, guarded, and non-destructive; Postgres parity is already present.
- Org Optimizer C2-D S6 remains the next live-sandbox slice before C3–C6; receipt filtering is not yet load-bearing, so its fail-closed promotion guard remains in place.

## Risks / known issues

- H2 has no outstanding automated contract criteria. Manual transcript-header placement and dirty-file tooltip smoke remains prudent before merge.
- PR #1383 still needs on-device ready-state smoke; PR #1453 its Numbat hook smoke; PR #1459 its three H1 manual checks; PR #1460 its archive, TestFlight, and physical-iPhone checks.

## Test status

- H2 focused API tests **122/122**; existing cleanup contracts **5/5**; live #1058 **2/2**; live #1088 Google/Gemini **1/1** with nonempty assistant output.
- Flutter full suite **1222/1222**; API full suite **4484 passed**; `ai-workflow checks --level pr` passed all **16 stages**.
- Transcript-header tests and golden compare **13/13**; checked-in branch badge golden is **1200×180**.
- PR #1383, PR #1453, PR #1459, and PR #1460 retain their previously recorded verification status; Org Optimizer remains on its per-slice gate.

## Next step

AJ: run the prudent transcript-header placement/tooltip smoke on draft PR #1461. Keep Org Optimizer, PR #1383, PR #1453, PR #1459, and PR #1460 workflows unchanged.
