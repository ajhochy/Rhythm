---
date: 2026-07-08
repo: Rhythm
branch: null
pr: null
issues: [943, 944]
status: complete
tags: [run, rhythm, config-doctor]
---

# Config Doctor: Full System Audit & Refactor

This session performed a deep audit and comprehensive refactoring of the Rhythm agent and skill configuration, addressing numerous inconsistencies and implementing several new automated workflows.

## Summary of Actions

1.  **Initial Diagnostics & Issue Filing:**
    - Ran `npm run doctor` and identified a stale Python dependency and several MCP authentication failures (Canva, Notion, Supabase).
    - Used `gitnexus` to discover a missing UI for viewing background agent sessions and filed issue **#943**.
    - Diagnosed a missing `GITHUB_TOKEN` on the Rhythm server and filed issue **#944** to track the fix.

2.  **Architectural Investigation & Clarification:**
    - Investigated the "Cookbook" feature, determining it is a system for running on-demand agent workflows.
    - Clarified the distinction between on-demand **Cookbook Recipes** and time-based **Scheduled Tasks**.
    - Mapped and created a visual diagram of the **Agent Delegation Tree** and saved it to the Obsidian vault.

3.  **Skill & Agent Configuration Cleanup:**
    - Performed a full audit of all skills, identifying over 40 empty "stub" skills.
    - **Resolved Duplicates:** Fixed 8 "Developer Workflow" skills that had complete versions in one directory and empty stubs in another by copying the full implementations to the correct location.
    - **Implemented/Refactored the following Agent/Skill pairs:**
        - `config-doctor`: Implemented a comprehensive, multi-phase workflow for diagnostics and repair based on this session's process.
        - `daily-dev-summary`: Implemented the full workflow from user-provided text.
        - `monday-worship-planning`: Refactored a monolithic block of text into a clean Agent Profile and a detailed Skill.
        - `secretary`: Refactored the mixed-content skill into a clean Agent Profile and a procedural, logic-based Skill with improved routing rules.
        - `librarian`: Expanded the agent into a "Vault Expert Manager" with a toolkit of skills, a dedicated `obsidian-nightly-maintenance` skill, and a new scheduled task for automation.
        - `ableton-setlist-build`: Implemented the skill from its canonical source file and correctly associated it with the `worship-production` agent.

4.  **Fantasy Football System Implementation:**
    - Implemented three core orchestration skills (`ffb-tuesday-refresh`, `ffb-podcast-vibes`, `ffb-daily-dashboard-update`) from user-provided workflows.
    - Implemented four modular skills (`ffb-dynasty`, `ffb-roster`, `ffb-trades`, `ffb-tff-vibes`) by copying their local implementations.
    - Created three new **Scheduled Tasks** to fully automate the entire FFB system.
