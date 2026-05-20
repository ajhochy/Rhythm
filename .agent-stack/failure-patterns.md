# Failure Patterns

## 2026-05-20 — PR #617 rounds 1-5 (#627, #628, #632-639) — Partial pass

- **Result**: 8 of 10 criteria PASS at smoke; #638 (3 sub-criteria) FAIL across 5 rounds, parked as known bug. verification-gate emitted PASS each round; manual smoke caught the divergence each time.
- **Category**: C2 dominant. Five rounds of (contract green-fail → fix → contract green-pass → verification PASS → smoke FAIL) on the same underlying issue. Each round addressed a real bug, contract tests were valid for what they tested, but each contract only covered ONE failure mode of a criterion that had multiple.
- **Criteria affected**: #638 c1/c3/c4 — full-view error rendering for new sessions; bubble works, full view doesn't.
- **Root cause**: acceptance-contract picks one failure mode per criterion. For #638 the criterion "error visible in full view" spans (resumed session × selected) × (new session × selected) × (new session × selection-cleared) × (new session × pre-listener-subscribe race) — at least 4 modes. Each round wrote a contract for one mode, fixed it, declared done; smoke uncovered the next mode. The bubble works as a fallback because it has its own independent render path that catches transient state.
- **Suggested fix**: acceptance-contract rubric MUST enumerate plausible failure modes (cold vs warm, new vs resumed, fast vs slow async, selected vs cleared) and write a test that covers the worst-case combination. A single mode is insufficient for any user-visible criterion. Pattern threshold: 2 rounds of C2 divergence on the same issue triggers a forced "enumerate modes" step in the next contract pass.

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
