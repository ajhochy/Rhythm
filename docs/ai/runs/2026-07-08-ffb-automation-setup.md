---
date: 2026-07-08
repo: Rhythm
branch: null
pr: null
issues: []
status: complete
tags: [run, rhythm, config-doctor, ffb]
---

# Config Doctor: FFB Automation Setup

This session focused on implementing the full Fantasy Football automation system within Rhythm, based on user-provided workflows.

## Summary of Actions

1.  **Architectural Plan:** Analyzed the provided FFB routines and designed a three-tiered implementation plan using the established Agent/Skill/Task pattern.
2.  **Skill Implementation:**
    - Implemented the `ffb-tuesday-refresh` skill to handle the weekly data ingestion.
    - Implemented the `ffb-podcast-vibes` skill for daily podcast transcription and analysis.
    - Implemented the `ffb-daily-dashboard-update` skill to act as the main daily orchestrator.
    - Implemented the four modular FFB skills (`ffb-dynasty`, `ffb-roster`, `ffb-trades`, `ffb-tff-vibes`) by refactoring and copying their implementations from the local `Claude-FFB` project, ensuring they function as pure, procedural workflows.
3.  **Task Automation:**
    - Created three new Scheduled Tasks in Rhythm to run these skills autonomously:
        - A weekly task for the data refresh.
        - A daily task for podcast ingestion.
        - A daily task for the main dashboard update.

The result is a complete, autonomous FFB analysis system managed by the `fantasy-gm` specialist agent.
