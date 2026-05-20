# Failure Patterns

## 2026-05-19 — PR #617 batch (20 smoke-test follow-ups) — Partial smoke

- **Result**: smoke FAIL (5 issues + 2 fresh bugs); verification claimed PASS — divergence
- **Category**: C1 (missing contract) dominant; C3 ×2, C5 ×1, C6 ×2, C7 ×2
- **Criteria affected**: #620 live-sync, #625 cold-bubble, #623 task-context, #622 question-tool, #610 slash-popover, OpenRouter no-answer, AppDelegate launch
- **Root cause**: orchestrator skipped acceptance-contract for the entire batch; verification-gate smoke probes hit the source dev server, not the bundled :4001 the Flutter app actually spawns.
- **Suggested fix**: make acceptance-contract a hard gate before coding-agent dispatch for smoke-test-followup runs; add a bundled-artifact smoke probe to verification-gate that curls /sync/now and /health against the spawned :4001 after a clean dist build.

## 2026-05-19 — PR #621 — agent FK tolerance

- See `.agent-stack/postmortems/2026-05-19-pr-621-agent-fk-tolerance.json`.
