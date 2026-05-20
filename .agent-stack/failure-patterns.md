# Failure Patterns

## 2026-05-20 — PR #617/#633 focused 4-fix batch — Partial smoke

- **Result**: smoke FAIL (4 items: 2 #628 rendering, 2 #632); verification claimed PASS — divergence
- **Category**: C2 dominant (wrong contract — passed unit, failed reality) + C1×2 (missing contract for layout/role-filter)
- **Criteria affected**: #628 truncation, #628 user-message visibility, #632 Gemini 3 Flash silent-close, #632 curated-visibility picker mismatch
- **Root cause**: acceptance-contract chose the easier-to-mock SDK branch (`{}`) instead of the worst-case (data + session-close); verification-gate's smoke probes covered only /health, not feature endpoints (/agent-models/visibility, /agents/models/catalog) where the real bug lived; #628 contract didn't enumerate layout or role-filter invariants.
- **Suggested fix**: acceptance-contract rubric must enumerate 2-3 plausible failure modes and pick the worst; verification-gate must curl feature endpoints (not just health); orchestrator's smoke-handoff must pre-run every curl/ps/Computer Use check itself.

## 2026-05-19 — PR #617 batch (20 smoke-test follow-ups) — Partial smoke

- **Result**: smoke FAIL (5 issues + 2 fresh bugs); verification claimed PASS — divergence
- **Category**: C1 (missing contract) dominant; C3 ×2, C5 ×1, C6 ×2, C7 ×2
- **Criteria affected**: #620 live-sync, #625 cold-bubble, #623 task-context, #622 question-tool, #610 slash-popover, OpenRouter no-answer, AppDelegate launch
- **Root cause**: orchestrator skipped acceptance-contract for the entire batch; verification-gate smoke probes hit the source dev server, not the bundled :4001 the Flutter app actually spawns.
- **Suggested fix**: make acceptance-contract a hard gate before coding-agent dispatch for smoke-test-followup runs; add a bundled-artifact smoke probe to verification-gate that curls /sync/now and /health against the spawned :4001 after a clean dist build.

## 2026-05-19 — PR #621 — agent FK tolerance

- See `.agent-stack/postmortems/2026-05-19-pr-621-agent-fk-tolerance.json`.
