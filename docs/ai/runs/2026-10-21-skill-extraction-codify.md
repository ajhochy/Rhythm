---
date: 2026-10-21
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
tags: [run, rhythm, packaged, skill-extraction]
---

# Skill extraction Codify from private native Recon

## Files

- `apps/web/tests/packaged/packaged-ai-private-skill-extraction.spec.ts`: checked packaged contract from the observed fresh synthetic actor path. It requires explicit model opt-in and a bounded loan before the packaged fixture launches; it provisions one no-tools fixed-Luna profile through normal API, sends the two observed UI turns after the source-defined cold window, proves one attributable system extraction in API/DB/SDK, and requires the third turn to leave the extraction count at one. Exact owned cleanup, profile/visibility restoration, the shared unexpected-error audit, and caller-owned whole-fixture scrub remain mandatory. Sanitized per-test evidence uses `testInfo.outputPath` and a JSON attachment; no private output directory is required at test discovery.
- `docs/testing/results/recon-ai-skill-extraction.md`: sanitized observed transcript and limits.

## Checks

- Private native Recon on signed `825c53bc9f1b4d3081de8a6a5a5c38de129a93d9`: 1/1, 0 unexpected/skipped/flaky; run 0, scrub 0, unchanged source hashes. Observation: `/private/tmp/rhythm-skill-extract-recon-20261021/output-0T2ZJA/observation.json`.
- Guarded strict TypeScript for the new checked spec exited 0. Guarded Playwright `--list` with `packaged-ai-playwright.config.ts` discovered exactly one case in one file and exited 0. `git diff --check` exited 0. Independent native Confirm: **UNRUN**. The private Recon is not promoted to checked green evidence.

## Notes

The exact source queue marker and the system SDK input containing both nonce prompts establish attribution in the otherwise empty fixture. No permanent source-session foreign key exists. The third turn tests this in-process lifetime guard only; restart and broader background policy remain open. The shared feature-test audit retains a private raw runtime attachment; publish only sanitized metadata.

`docs/testing/results/` is gitignored in this worktree. The new Recon note exists on disk but requires an explicit `git add -f docs/testing/results/recon-ai-skill-extraction.md` when the parent stages reviewed files; it is not silently tracked.
