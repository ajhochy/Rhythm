# Rhythm — project state

## Current focus

Org Reviewer pre-review evaluation (Harness²-style, all improvement kinds, one whole-run token cap), qualified with packaged Playwright and live private-engine tests, including a review of the actual Rhythm config. Qualification across all 18 kinds and all AI features is incomplete.

## Active branch / PR

- Worktree `/private/tmp/rhythm-feature-playwright-2026-10-19`, branch `test/feature-playwright-2026-10-19`, HEAD `ea093809b2` plus docs. No push, PR, merge, install or release. The original checkout's dirt is preserved.
- Local signed app: exact `edc8e8259e`, deep strict verified (`apps/electron/dist/Rhythm.app`).

## In progress

- Default whole-run cap is now 1.5M (`edc8e8259e`). The packaged settings check passes. The routed, managed and actual-Secretary live reruns are **waiting on a fresh Anthropic token**: the loans need at least 30 minutes of token life and never refresh.
- The full approve → fresh-use → revert journey (plan `docs/ai/plans/2026-10-21-org-reviewer-end-to-end-playwright.md`, O1–O10) is still unrun.

## Risks / known issues

- Intermittent: on the first actual-Secretary attempt (3332856) the engine stopped answering after `ensureRhythmMcp` persisted config. Schedule creation timed out at 20 s. It did not reproduce on rerun.
- The actual Secretary scan passes safety checks and now sees the exact failure evidence, but it yields 0 diagnoses and 0 proposals. Do not rerun it unchanged hoping for a proposal.
- Real external MCP integrations (Gmail/PCO/Obsidian) are not reproduced in evaluation. Only the controlled `evaluation-*` fixture tools are trusted.
- The GitNexus index is about 340 commits stale and the new org-evaluation modules are unindexed. Manual blast-radius review applies.
- About 50 no-model fixtures from Oct 20–21 (`/private/tmp/rhythm-ai-fixture-*`, disposable actor tokens only) await an explicit cleanup pass.

## Test status

- Integrated org-eval checkpoint at edc8e8: 220 passed, 1 legacy-Docker skip, 40 files. MCP 3/3. API, MCP and web tsc pass. Packaged settings spec 1/1 (no model).
- Live, signed bundle: managed tool original/candidate pair **passes** (1ab737 and a1c906); routed 4/4 **fail** on the old 100k budget (a1c906; not yet rerun at 1.5M); actual-Secretary Playwright **passes** (3332856 rerun); no-model installer sandbox **passes**.
- Kind coverage: `docs/ai/plans/2026-10-21-org-evaluation-kind-coverage.md`. Runs: `docs/ai/runs/2026-10-21-org-reviewer-claude-takeover.md`, `2026-10-21-org-evaluation-implementation.md`.

## Next step

After the user's Rhythm app refreshes the Anthropic login, rerun routed 4 cases, the managed pair and actual Secretary on `edc8e8259e`. Then qualify the routed kinds, run the packaged evaluation journey through approval and fresh use, and close the remaining per-kind gaps.
