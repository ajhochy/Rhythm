---
date: 2026-10-19
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

## Context

The live Grid/Luna classifier returned score 0.85 for a one-literal JavaScript edit. The existing 0.35 boundary mapped it to tier 2 despite the classifier describing single-file edits as tier 3. The user explicitly requested a calibration fix after real-model qualification exposed this mismatch.

## Decision

Move only the default tier-3/tier-2 boundary to 1.5, between ordinal level 1 (routine/single-file) and level 2 (multi-file/moderate). Retain easy/frontier boundaries 0.1 and 2.25, the exact question wording, conservative tier-2 rules fallback, account eligibility and escalation behavior. Explicit grid override files remain authoritative; saved first-prompt decisions are not retroactively changed.

## Alternatives

- Raising the threshold only just above 0.85 fits one example and still promotes routine edits near ordinal level 1.
- Rewriting the classifier question or replacing all cutoffs changes more behavior than this failure warrants.
- Forcing a cheap model despite account or model unavailability would bypass a separate safety/eligibility policy.

## Consequences

A preselected 12-case synthetic set keeps routine examples (scores 0.82–0.98) at tier 3, multi-file/research (2–2.01) at tier 2, and hard work (2.97–3) at tier 1. Unit boundary guards and packaged real-model checks protect these expectations. This small regression set does not establish overall production routing quality; retain broader held-out evaluation as a separate qualification task. See `docs/ai/runs/2026-10-19-router-calibration-fix.md` for commands and results.
